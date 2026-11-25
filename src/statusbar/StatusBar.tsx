import type { Stats } from "../ipc";

interface Props {
  stats: Stats;
  mode: "wysiwyg" | "source" | "split";
  dirty: boolean;
  saving: boolean;
  goal: number;
  sessionAdded: number;
  sessionMinutes: number;
  /** 专注模式 / 打字机模式是否开启 —— 状态栏要显示出来，
   *  否则用户开启后看不到任何指示，会以为「没生效」。 */
  focusMode?: boolean;
  typewriterMode?: boolean;
}

export default function StatusBar({
  stats, mode, dirty, saving, goal, sessionAdded, sessionMinutes, focusMode, typewriterMode,
}: Props) {
  const pct = goal > 0 ? Math.min(100, Math.round((stats.words / goal) * 100)) : 0;
  return (
    <footer className="statusbar">
      <span>字数 {stats.words}</span>
      <span>字符 {stats.chars}</span>
      <span>约 {stats.reading_minutes} 分钟</span>
      {goal > 0 && (
        <span className="goal" title={`写作目标 ${stats.words}/${goal} 字`}>
          <span className="goal-bar">
            <span className="goal-fill" style={{ width: `${pct}%` }} />
          </span>
          {pct}%
        </span>
      )}
      <span className="session">本次 +{sessionAdded} 字 · {sessionMinutes} 分钟</span>
      <span className="spacer" />
      {focusMode && (
        <span className="mode-flag" title="专注模式已开启（F8 切换）">专注</span>
      )}
      {typewriterMode && (
        <span className="mode-flag" title="打字机模式已开启（F9 切换）">打字机</span>
      )}
      <span>{mode === "wysiwyg" ? "所见即所得" : mode === "split" ? "随航" : "源码"}</span>
      <span>{saving ? "保存中…" : dirty ? "未保存" : "已保存"}</span>
    </footer>
  );
}