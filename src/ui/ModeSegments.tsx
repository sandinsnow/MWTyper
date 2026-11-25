import { useRef, type KeyboardEvent } from "react";

export type EditMode = "wysiwyg" | "source" | "split";

interface Props {
  mode: EditMode;
  onChange: (mode: EditMode) => void;
}

const ITEMS: { id: EditMode; label: string; title: string; shortcut: string }[] = [
  { id: "wysiwyg", label: "所见即所得", title: "所见即所得：直接编辑渲染后的文档", shortcut: "Ctrl+/" },
  { id: "source", label: "源码", title: "源码模式：编辑原始 Markdown", shortcut: "Ctrl+/" },
  { id: "split", label: "随航", title: "随航编辑：源码 ｜ 实时预览 并排", shortcut: "Ctrl+Shift+/" },
];

/**
 * 编辑模式分段控件（单选）。
 *
 * 为什么用分段控件而不是两个独立按钮：标题栏里「⇄ 源码」和「⧉ 随航」两个按钮
 * 表达不清三态关系 —— 用户看不出「当前在哪一态」，也不知道点哪个能到哪一态。
 * 分段控件把三种模式并排、当前态高亮，**一眼可见、可直接点选**。
 *
 * 语义用 radiogroup（单选组）而非 tablist：三种模式不是三个「面板」，是同一个编辑器的三种状态。
 */
export default function ModeSegments({ mode, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = ITEMS.findIndex((x) => x.id === mode);
    let next = i;
    if (e.key === "ArrowLeft") next = (i - 1 + ITEMS.length) % ITEMS.length;
    else if (e.key === "ArrowRight") next = (i + 1) % ITEMS.length;
    else if (e.key === "Home") next = 0;
    else next = ITEMS.length - 1;
    onChange(ITEMS[next].id);
    // 焦点跟着走（单选组的键盘约定）
    const btns = ref.current?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    btns?.[next]?.focus();
  };

  return (
    <div
      className="mode-segments"
      role="radiogroup"
      aria-label="编辑模式"
      ref={ref}
      onKeyDown={onKeyDown}
    >
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={mode === it.id}
          className={"mode-segment" + (mode === it.id ? " active" : "")}
          title={`${it.title}（${it.shortcut}）`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
