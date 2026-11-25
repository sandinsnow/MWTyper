import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

// store 无 @codemirror/theme-one-dark：用 CSS 变量 + 自定义 HighlightStyle 自接暗色
export const cmDark = [
  EditorView.theme(
    {
      "&": { backgroundColor: "var(--bg-editor)", color: "var(--fg)" },
      ".cm-content": { caretColor: "var(--fg)" },
      ".cm-gutters": { backgroundColor: "var(--bg-side)", color: "var(--fg-dim)", border: "none" },
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
    },
    { dark: true }
  ),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading, color: "#7ee787", fontWeight: "bold" },
      { tag: tags.strong, fontWeight: "bold" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.strikethrough, textDecoration: "line-through" },
      { tag: [tags.link, tags.url], color: "#79c0ff" },
      { tag: tags.monospace, color: "#ffa657" },
      { tag: tags.quote, color: "#8b949e", fontStyle: "italic" },
      { tag: tags.list, color: "#ffa657" },
      { tag: [tags.separator, tags.comment], color: "#8b949e" },
      { tag: tags.keyword, color: "#ff7b72" },
      { tag: tags.string, color: "#a5d6ff" },
      { tag: tags.number, color: "#79c0ff" },
    ])
  ),
];