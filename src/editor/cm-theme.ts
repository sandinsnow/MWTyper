import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

// ---------------------------------------------------------------------------
// 源码模式（CodeMirror 6）的双主题语法高亮
//
// 上一轮的问题：`SourceMode.tsx` 里写的是 `themeComp.of(dark ? cmDark : [])`
// —— **亮色主题传入空数组**，于是亮色下根本没有专属高亮样式，落到 CodeMirror
// `basicSetup` 自带的默认 fallback；暗色则是本文件之前那套硬编码 GitHub Dark。
// 结果：两套主题的高亮**完全不一致**，且 `**粗体**`/`*斜体*`/`~~删除线~~`/
// `> 引用`/列表标记/表格分隔线 在两套主题里都几乎与正文无色差。
//
// 本文件给出**成对**的两套主题，并按项目自身的 CSS 变量取背景/前景，
// 使源码模式与富文本模式的观感统一。
//
// 另见 `cm-marks.ts`：Markdown 的标记符（# > - * ` [）在 lezer 里全部映射到
// 同一个 `tags.processingInstruction`，**无法用 HighlightStyle 区分**，
// 那部分用 Decoration 单独着色。
// ---------------------------------------------------------------------------

/** 两套主题共用的容器样式：背景/前景跟随项目令牌，不硬编码颜色 */
function containerTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--bg-editor)",
        color: "var(--fg)",
        // 等宽字体/字号/行距与预览里的代码块、行内代码**同一组令牌**
        // （--mw-mono / --mw-code-size / --mw-code-line）——「两处源码编辑」必须长得一样。
        fontFamily: "var(--mw-mono)",
        fontSize: "calc(var(--mw-code-size) * var(--editor-zoom, 1))",
        lineHeight: "var(--mw-code-line)",
        // Chromium 给 contenteditable 的**默认焦点环**（dotted 1px 灰框）会套住整个
        // 源码区 —— 那是浏览器默认样式，不是我们的设计观感。源码编辑器有光标与当前行
        // 高亮，本身就是焦点指示（WCAG 允许文本控件用光标表达焦点）。
        outline: "none",
      },
      // 光标跟随主题强调色，与所见即所得侧一致
      ".cm-content": { caretColor: "var(--accent)" },
      ".cm-gutters": {
        // 行号列：与正文同底色 + 一条细分割线，比「一整块灰底」安静；
        // 数字用等宽数字对齐（tabular-nums），位数变化时列宽不抖。
        backgroundColor: "transparent",
        color: "var(--fg-dim)",
        border: "none",
        borderRight: "1px solid var(--border)",
        fontVariantNumeric: "tabular-nums",
        // 行号固定宽度：源码模式用「编辑器整体居中」代替「内容居中」，
        // 行号才会紧贴代码，不会出现中间一大段断裂空白。
        // 宽度值与 styles.css 的 --mw-gutter-w 同源，改一处即两处同步。
        minWidth: "var(--mw-gutter-w)",
      },
      ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "var(--sel) !important",
      },
      ".cm-cursor": { borderLeftColor: "var(--fg)" },
      ".cm-tooltip": { backgroundColor: "var(--bg-side)", color: "var(--fg)", border: "1px solid var(--border)" },
      ".cm-panels": { backgroundColor: "var(--bg-side)", color: "var(--fg)" },
      ".cm-panel.cm-search input, .cm-panel.cm-search button": {
        backgroundColor: "var(--bg-editor)", color: "var(--fg)", border: "1px solid var(--border)",
      },
      ".cm-searchMatch": { backgroundColor: "var(--find-bg)", color: "var(--find-fg)" },
      ".cm-searchMatch-selected": { backgroundColor: "var(--find-bg-current)", color: "var(--find-fg)" },
    },
    { dark }
  );
}

/**
 * Markdown 语法的 token 配色。
 *
 * 注意：`tags.strikethrough` 在这里列了但**不会生效** ——
 * `@codemirror/lang-markdown@6.5.2` 的 `markdown()` 没有 extensions 参数、
 * 也不导出 `GFM`，CommonMark 解析器不认 GFM 删除线，
 * 所以 `~~删除线~~` 在源码模式里根本不会被解析成 strikethrough tag。
 * （删除线的高亮只在所见即所得侧成立。）
 */
export const cmLight = [
  containerTheme(false),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading1, color: "#0550ae", fontWeight: "bold" },
      { tag: tags.heading2, color: "#0550ae", fontWeight: "bold" },
      { tag: tags.heading3, color: "#0550ae", fontWeight: "bold" },
      { tag: tags.heading4, color: "#0550ae", fontWeight: "bold" },
      { tag: tags.heading5, color: "#0550ae", fontWeight: "bold" },
      { tag: tags.heading6, color: "#0550ae", fontWeight: "bold" },
      { tag: tags.strong, color: "#24292f", fontWeight: "bold" },
      { tag: tags.emphasis, color: "#24292f", fontStyle: "italic" },
      { tag: tags.strikethrough, color: "#57606a", textDecoration: "line-through" },
      { tag: tags.link, color: "#0969da", textDecoration: "underline" },
      { tag: tags.url, color: "#0a3069" },
      { tag: tags.monospace, color: "#cf222e" },
      { tag: tags.quote, color: "#57606a", fontStyle: "italic" },
      { tag: tags.list, color: "#0550ae" },
      { tag: tags.labelName, color: "#0550ae" },
      { tag: tags.string, color: "#0a3069" },
      { tag: tags.comment, color: "#57606a", fontStyle: "italic" },
      { tag: tags.escape, color: "#cf222e" },
      { tag: tags.character, color: "#0550ae" },
      { tag: tags.contentSeparator, color: "#8c959f" },
      { tag: tags.processingInstruction, color: "#57606a" },
      { tag: tags.content, color: "#1f2328" },
    ])
  ),
];

export const cmDark = [
  containerTheme(true),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading1, color: "#7ee787", fontWeight: "bold" },
      { tag: tags.heading2, color: "#7ee787", fontWeight: "bold" },
      { tag: tags.heading3, color: "#7ee787", fontWeight: "bold" },
      { tag: tags.heading4, color: "#7ee787", fontWeight: "bold" },
      { tag: tags.heading5, color: "#7ee787", fontWeight: "bold" },
      { tag: tags.heading6, color: "#7ee787", fontWeight: "bold" },
      { tag: tags.strong, color: "#d6d9de", fontWeight: "bold" },
      { tag: tags.emphasis, color: "#d6d9de", fontStyle: "italic" },
      { tag: tags.strikethrough, color: "#8b949e", textDecoration: "line-through" },
      { tag: tags.link, color: "#79c0ff", textDecoration: "underline" },
      { tag: tags.url, color: "#a5d6ff" },
      { tag: tags.monospace, color: "#ffa657" },
      { tag: tags.quote, color: "#8b949e", fontStyle: "italic" },
      { tag: tags.list, color: "#79c0ff" },
      { tag: tags.labelName, color: "#79c0ff" },
      { tag: tags.string, color: "#a5d6ff" },
      { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
      { tag: tags.escape, color: "#ff7b72" },
      { tag: tags.character, color: "#79c0ff" },
      { tag: tags.contentSeparator, color: "#6e7681" },
      { tag: tags.processingInstruction, color: "#8b949e" },
      { tag: tags.content, color: "#d6d9de" },
    ])
  ),
];
