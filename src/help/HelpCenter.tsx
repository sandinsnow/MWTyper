import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useModal } from "../ui/Modal";
import { MARKDOWN_REF, type MarkdownRefItem } from "./markdown-ref";
import { shortcutGroups } from "./shortcuts";
import { api, type AppInfo, type UpdateManifest } from "../ipc";
import { compareVersions, fetchLatest, RELEASES_PAGE, type LatestInfo } from "../update";

export type HelpSection = "markdown" | "shortcuts" | "update" | "about";

interface Props {
  open: boolean;
  section: HelpSection;
  onSection: (s: HelpSection) => void;
  onClose: () => void;
  /** 当前编辑器（用于「插入语法模板」）；为 null 时不显示插入按钮 */
  editor: Editor | null;
  onNotify: (kind: "success" | "error" | "info", message: string) => void;
}

const SECTIONS: { id: HelpSection; label: string; icon: string }[] = [
  { id: "markdown", label: "Markdown 速查", icon: "📝" },
  { id: "shortcuts", label: "快捷键", icon: "⌨" },
  { id: "update", label: "检查更新", icon: "↻" },
  { id: "about", label: "关于", icon: "ⓘ" },
];

/** 比较两个语义化版本号：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export { compareVersions };

/**
 * 帮助中心：Markdown 速查 / 快捷键 / 检查更新 / 关于。
 *
 * 模态焦点管理沿用 `useModal`（Escape 关闭、Tab 循环、关闭后归还焦点）。
 */
export default function HelpCenter({ open, section, onSection, onClose, editor, onNotify }: Props) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [manifestPath, setManifestPath] = useState("");
  const [manifestError, setManifestError] = useState("");
  const [latest, setLatest] = useState<LatestInfo | null>(null);
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string>("");
  const navRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useModal(onClose, navRef);

  // 打开时拉取应用信息与本机更新清单路径（**不自动联网** —— 联网检查由用户主动触发）。
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api.appInfo().then((i) => { if (alive) setInfo(i); }).catch(() => {});
    void api.updateManifestPath().then((p) => { if (alive) setManifestPath(p); }).catch(() => {});
    // 本机更新清单是**离线兜底**：网络不通时仍能告诉用户「本机记录的版本是多少」。
    void api.readUpdateManifest()
      .then((m) => {
        if (!alive) return;
        setManifest(m);
        setManifestError("");
      })
      .catch((e) => {
        if (!alive) return;
        setManifest(null);
        setManifestError(String(e));
      });
    return () => { alive = false; };
  }, [open]);

  const groups = useMemo(() => shortcutGroups(), []);
  const hasUpdate = !!info && !!latest && compareVersions(latest.version, info.version) > 0;

  const insert = (item: MarkdownRefItem) => {
    if (!editor || !item.template) return;
    editor.chain().focus().insertContent(item.template).run();
    onNotify("success", `已插入：${item.syntax.split("\n")[0]}`);
  };

  /**
   * 检查远端是否有新版本：查 GitHub Releases 的最新正式版，与本地版本比对。
   * 断网/被墙时 fetch 可能长时间挂起 → 10 秒超时兜底（AbortController）。
   */
  const recheck = async () => {
    setChecking(true);
    setCheckError("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetchLatest(ctrl.signal);
      setLatest(r);
      setCheckedAt(new Date().toLocaleString("zh-CN"));
      if (!r.version) {
        setCheckError("远端返回的版本号无法解析");
      }
    } catch (e) {
      setLatest(null);
      setCheckedAt(new Date().toLocaleString("zh-CN"));
      setCheckError(
        ctrl.signal.aborted
          ? "检查超时（10 秒），请确认网络连接后重试"
          : `无法访问 GitHub：${String((e as Error)?.message ?? e)}`
      );
    } finally {
      clearTimeout(timer);
      setChecking(false);
    }
  };

  /** 在系统默认浏览器打开下载页（不用 <a target="_blank"> —— Tauri 里会在应用内开新窗口）。 */
  const openReleases = async () => {
    try {
      await api.openExternal(RELEASES_PAGE);
    } catch (e) {
      onNotify("error", `打开下载页失败：${String(e)}`);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      onNotify("success", "下载链接已复制");
    } catch {
      onNotify("error", "复制失败，请手动选中链接复制");
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="帮助中心"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <span className="modal-title">帮助中心</span>
          <button className="modal-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="help-body">
          <nav className="help-nav" ref={navRef} tabIndex={-1} aria-label="帮助分区">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={"help-nav-item" + (section === s.id ? " active" : "")}
                aria-current={section === s.id ? "page" : undefined}
                onClick={() => onSection(s.id)}
              >
                <span aria-hidden="true">{s.icon}</span> {s.label}
              </button>
            ))}
          </nav>

          <div className="help-content">
            {section === "markdown" && (
              <>
                <h3 className="help-title">Markdown 语法速查</h3>
                <p className="help-desc">
                  点「插入」把模板写到当前光标处；语法以 CommonMark + GFM 表格为准。
                </p>
                {MARKDOWN_REF.map((g) => (
                  <section key={g.id} className="help-group">
                    <h4 className="help-group-title">{g.title}</h4>
                    <table className="help-table">
                      <tbody>
                        {g.items.map((it) => (
                          <tr key={it.syntax}>
                            <td className="help-syntax"><code>{it.syntax}</code></td>
                            <td className="help-desc-cell">
                              {it.desc}
                              {it.note && <div className="help-note">提示：{it.note}</div>}
                            </td>
                            <td className="help-action">
                              {it.template && editor && (
                                <button className="tb-btn" type="button" onClick={() => insert(it)}>插入</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
              </>
            )}

            {section === "shortcuts" && (
              <>
                <h3 className="help-title">快捷键</h3>
                {groups.map((g) => (
                  <section key={g.group} className="help-group">
                    <h4 className="help-group-title">{g.group}</h4>
                    <table className="help-table">
                      <tbody>
                        {g.items.map((it) => (
                          <tr key={it.keys + it.desc}>
                            <td className="help-keys"><kbd>{it.keys}</kbd></td>
                            <td className="help-desc-cell">{it.desc}</td>
                            <td />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
              </>
            )}

            {section === "update" && (
              <>
                <h3 className="help-title">检查更新</h3>
                <div className="help-update">
                  <div className="help-update-row">
                    <span>当前版本</span>
                    <b>{info ? `${info.name} ${info.version}` : "读取中…"}</b>
                  </div>
                  <div className="help-update-row">
                    <span>构建时间</span>
                    <b>{info?.buildTime ? formatBuildTime(info.buildTime) : "—"}</b>
                  </div>
                  <div className="help-update-row">
                    <span>远端最新版</span>
                    <b>{latest ? `v${latest.version}` : "尚未检查"}</b>
                  </div>
                  <div className="help-update-row">
                    <span>上次检查</span>
                    <b>{checkedAt || "尚未检查"}</b>
                  </div>
                </div>

                <div className="help-update-actions">
                  <button className="tb-btn" type="button" onClick={() => void recheck()} disabled={checking}>
                    {checking ? "检查中…" : "检查远端更新"}
                  </button>
                  <button className="tb-btn" type="button" onClick={() => void openReleases()}>
                    打开发布页
                  </button>
                </div>

                {checkError && (
                  <div className="help-warn">
                    {checkError}
                    {manifest && (
                      <div>
                        本机更新清单记录：v{manifest.version}（{manifestPath || "%APPDATA%\\MWTyper\\update-manifest.json"}）
                      </div>
                    )}
                  </div>
                )}

                {manifestError && (
                  <div className="help-warn">本机更新清单无法解析：{manifestError}</div>
                )}

                {hasUpdate ? (
                  <div className="help-newver">
                    <div className="help-newver-head">发现新版本 {latest!.version}</div>
                    {latest!.notes && <pre className="help-notes">{latest!.notes}</pre>}
                    {latest!.publishedAt && <div className="help-pub">发布于 {latest!.publishedAt}</div>}
                    <div className="help-update-actions">
                      <button className="tb-btn" type="button" onClick={() => void openReleases()}>
                        打开下载页
                      </button>
                      {latest!.url && (
                        <button className="tb-btn" type="button" onClick={() => void copyUrl(latest!.url!)}>
                          复制下载链接
                        </button>
                      )}
                    </div>
                  </div>
                ) : latest ? (
                  <div className="help-ok">当前已是最新版本（{latest.version}）。</div>
                ) : (
                  <div className="help-note-box">
                    <p>
                      点「检查远端更新」会向 GitHub 查询本项目的最新正式发布版本 ——
                      只读一次公开的 Release 接口，<b>不上传任何数据</b>，也不会自动轮询。
                    </p>
                    <p>若网络不可用，可参考本机更新清单文件：</p>
                    <code className="help-path">
                      {manifestPath || "%APPDATA%\\MWTyper\\update-manifest.json"}
                    </code>
                    {manifest && <div className="help-pub">本机清单记录版本：{manifest.version}</div>}
                  </div>
                )}
              </>
            )}

            {section === "about" && (
              <>
                <h3 className="help-title">关于</h3>
                <div className="help-update">
                  <div className="help-update-row">
                    <span>应用</span>
                    <b>{info ? `${info.name} ${info.version}` : "读取中…"}</b>
                  </div>
                  <div className="help-update-row">
                    <span>构建时间</span>
                    <b>{info?.buildTime ? formatBuildTime(info.buildTime) : "—"}</b>
                  </div>
                  <div className="help-update-row">
                    <span>定位</span>
                    <b>本地优先的 Markdown 写作工具</b>
                  </div>
                </div>
                <p className="help-desc">
                  纯本地、纯 .md 文件：所见即所得 + 源码 + 随航三种编辑模式，本地快照历史、
                  跨文件全文搜索、键盘优先的命令面板。数据都是磁盘上的普通 Markdown 文件。
                </p>
                <p className="help-desc">
                  技术栈：Tauri 2 · Rust · React 18 · TypeScript · tiptap 3 · CodeMirror 6 · KaTeX。
                </p>
                <p className="help-desc">
                  自定义主题：把 .css 放进主题目录即可热加载，推荐只写
                  <code> --mw-base-bg </code> / <code>--mw-base-accent</code> 基色，
                  系统会派生出整套配色并自动做深浅配比。
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 构建时间是 Unix 秒 → 本地可读时间 */
function formatBuildTime(epoch: string): string {
  const n = Number(epoch);
  if (!Number.isFinite(n) || n <= 0) return epoch;
  return new Date(n * 1000).toLocaleString("zh-CN");
}
