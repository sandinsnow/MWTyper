import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useModal } from "../ui/Modal";
import { MARKDOWN_REF, type MarkdownRefItem } from "./markdown-ref";
import { shortcutGroups } from "./shortcuts";
import { api, type AppInfo, type UpdateManifest } from "../ipc";

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
export function compareVersions(a: string, b: string): number {
  const pa = String(a).replace(/^v/, "").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

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
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string>("");
  const navRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useModal(onClose, navRef);

  // 打开时拉取应用信息与更新清单
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api.appInfo().then((i) => { if (alive) setInfo(i); }).catch(() => {});
    void api.updateManifestPath().then((p) => { if (alive) setManifestPath(p); }).catch(() => {});
    void api.readUpdateManifest()
      .then((m) => {
        if (!alive) return;
        setManifest(m);
        setManifestError("");
        setCheckedAt(new Date().toLocaleString("zh-CN"));
      })
      .catch((e) => {
        if (!alive) return;
        setManifest(null);
        setManifestError(String(e));
        setCheckedAt(new Date().toLocaleString("zh-CN"));
      });
    return () => { alive = false; };
  }, [open]);

  const groups = useMemo(() => shortcutGroups(), []);
  const hasUpdate = !!info && !!manifest && compareVersions(manifest.version, info.version) > 0;

  const insert = (item: MarkdownRefItem) => {
    if (!editor || !item.template) return;
    editor.chain().focus().insertContent(item.template).run();
    onNotify("success", `已插入：${item.syntax.split("\n")[0]}`);
  };

  const recheck = () => {
    setChecking(true);
    setManifestError("");
    void api.readUpdateManifest()
      .then((m) => {
        setManifest(m);
        setCheckedAt(new Date().toLocaleString("zh-CN"));
      })
      .catch((e) => setManifestError(String(e)))
      .finally(() => setChecking(false));
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
                    <span>上次检查</span>
                    <b>{checkedAt || "尚未检查"}</b>
                  </div>
                </div>

                {manifestError && (
                  <div className="help-warn">更新清单无法解析：{manifestError}</div>
                )}

                {hasUpdate ? (
                  <div className="help-newver">
                    <div className="help-newver-head">发现新版本 {manifest.version}</div>
                    {manifest.notes && <pre className="help-notes">{manifest.notes}</pre>}
                    {manifest.publishedAt && <div className="help-pub">发布于 {manifest.publishedAt}</div>}
                    {manifest.url && (
                      <div className="help-update-actions">
                        <button className="tb-btn" type="button" onClick={() => void copyUrl(manifest.url ?? "")}>
                          复制下载链接
                        </button>
                        <a className="tb-btn" href={manifest.url} target="_blank" rel="noreferrer">
                          打开下载页
                        </a>
                      </div>
                    )}
                  </div>
                ) : manifest ? (
                  <div className="help-ok">当前已是最新版本（{manifest.version}）。</div>
                ) : (
                  <div className="help-note-box">
                    <p>
                      本应用是<b>离线优先</b>设计，未内置在线更新源。检查更新读取的是本机更新清单文件：
                    </p>
                    <code className="help-path">{manifestPath || "%APPDATA%\\MWTyper\\update-manifest.json"}</code>
                    <p>文件格式（把版本号换成你要发布的版本）：</p>
                    <pre className="help-notes">{`{
  "version": "0.2.0",
  "url": "https://example.com/MWTyper-0.2.0-setup.exe",
  "notes": "修复了…",
  "publishedAt": "2026-11-25"
}`}</pre>
                  </div>
                )}

                <div className="help-update-actions">
                  <button className="tb-btn" type="button" onClick={recheck} disabled={checking}>
                    {checking ? "检查中…" : "立即检查"}
                  </button>
                </div>
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
