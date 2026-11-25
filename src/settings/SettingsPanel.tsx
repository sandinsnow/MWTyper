import { useEffect, useId, useRef, useState } from "react";
import type { Settings } from "../ipc";
import { useModal } from "../ui/Modal";

interface Props {
  settings: Settings;
  themes: string[];
  themesDir: string;
  onChange: (patch: Partial<Settings>) => void;
  /** 安装内置示例主题（写入主题目录） */
  onInstallThemes: () => void;
  installingThemes?: boolean;
  onClose: () => void;
}

/** 数字输入：本地 string state，允许清空重输，失焦/回车时才提交。 */
function NumberRow({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const parsed = Number.parseInt(text, 10);
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export default function SettingsPanel({
  settings,
  themes,
  themesDir,
  onChange,
  onClose,
  onInstallThemes,
  installingThemes,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { onKeyDown, restoreFocus } = useModal(onClose, closeRef);
  const titleId = useId();
  const num = (v: string, fallback: number) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const dismiss = () => {
    restoreFocus();
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <span className="modal-title" id={titleId}>设置</span>
          <button ref={closeRef} className="modal-close" aria-label="关闭设置" onClick={dismiss}>×</button>
        </div>
        <div className="modal-body settings-body">
          <label className="settings-row">
            <span>主题</span>
            <select value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as Settings["theme"] })}>
              <option value="system">随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label className="settings-row">
            <span>自定义主题</span>
            <select value={settings.custom_theme} onChange={(e) => onChange({ custom_theme: e.target.value })}>
              <option value="">无</option>
              {themes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="settings-row">
            <span>示例主题</span>
            <button
              type="button"
              disabled={installingThemes}
              onClick={() => void onInstallThemes()}
              title="把内置的 5 套示例主题（每套都带浅色与深色两套配色）安装到主题目录"
            >
              {installingThemes ? "安装中…" : "安装内置主题"}
            </button>
          </div>
          <div
            className="settings-hint"
            title={
              "推荐只写基色，系统自动派生整套配色并做深浅配比：\n" +
              ":root {\n  --mw-base-bg: #fbf1d8;\n  --mw-base-accent: #b58900;\n}\n" +
              "（可另加 [data-theme=\"dark\"] 块显式指定暗色基色；不给则自动派生）\n" +
              "也可以直接覆盖任意 CSS 变量，如 --bg-editor / --fg / --accent。"
            }
          >
            把 .css 文件放入 {themesDir} 即可热加载。推荐只写基色
            <code>--mw-base-bg</code> / <code>--mw-base-accent</code>
            —— 系统会派生出整套配色（含标题栏 / 侧栏 / 状态栏 / 编辑区 / 代码块）并自动做深浅配比；也可直接覆盖任意 CSS 变量。
          </div>
          <label className="settings-row">
            <span>自动保存</span>
            <select value={settings.autosave_ms} onChange={(e) => onChange({ autosave_ms: num(e.target.value, 1000) })}>
              <option value={0}>关闭</option>
              <option value={500}>0.5 秒</option>
              <option value={1000}>1 秒</option>
              <option value={2000}>2 秒</option>
              <option value={5000}>5 秒</option>
            </select>
          </label>
          <NumberRow label="快照保留个数" value={settings.snapshot_keep} min={1} max={500} onCommit={(v) => onChange({ snapshot_keep: v })} />
          <NumberRow label="每日快照保留天数" value={settings.snapshot_days} min={1} max={365} onCommit={(v) => onChange({ snapshot_days: v })} />
          <NumberRow label="写作目标（字，0 关闭）" value={settings.goal_words} min={0} max={1000000} onCommit={(v) => onChange({ goal_words: v })} />
          <NumberRow label="侧栏宽度（180–420）" value={settings.sidebar_width ?? 240} min={180} max={420} onCommit={(v) => onChange({ sidebar_width: v })} />
          <div className="settings-row">
            <span>编辑区缩放</span>
            <span className="settings-zoom">
              <button onClick={() => onChange({ zoom: Math.max(50, settings.zoom - 10) })}>−</button>
              {settings.zoom}%
              <button onClick={() => onChange({ zoom: Math.min(200, settings.zoom + 10) })}>＋</button>
              <button onClick={() => onChange({ zoom: 100 })}>重置</button>
            </span>
          </div>
          <label className="settings-row">
            <span>专注模式（F8）</span>
            <input type="checkbox" checked={settings.focus_mode} onChange={(e) => onChange({ focus_mode: e.target.checked })} />
          </label>
          <label className="settings-row">
            <span>打字机滚动（F9）</span>
            <input type="checkbox" checked={settings.typewriter_mode} onChange={(e) => onChange({ typewriter_mode: e.target.checked })} />
          </label>
        </div>
      </div>
    </div>
  );
}
