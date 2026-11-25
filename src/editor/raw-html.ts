import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";

// ---------------------------------------------------------------------------
// 原始 HTML 承载节点（缺陷 B1 / B4）
//
// marked 把「整块 HTML」统一归类成 `html` token：HTML 注释、<script>/<pre>、
// 带属性的 <div> 都在其中。@tiptap/markdown 的默认路径是
// `generateJSON(html, baseExtensions)` —— 当前 schema 里没有任何节点能承载
// 注释 / script / 带属性 div，于是整块内容被**静默丢弃**：
//
//   parse("# 标题\n\n<!-- TODO -->\n\n正文")
//     → { heading, paragraph(空), paragraph(正文) }   // 注释消失，还多出一个空段落
//
// 本节点把整块 HTML 原样存进 attrs.html，序列化时逐字节输出，不转义、不改写。
// ---------------------------------------------------------------------------

/** DOM 上承载 HTML 原文的属性名：编辑器里复制粘贴也能还原 */
export const RAW_HTML_ATTR = "data-raw-html";

/**
 * marked 的 html token 会把块尾的空行一起吞进 raw
 * （`"<!-- TODO -->\n\n"`），那部分属于 markdown 结构而不是 HTML 本体，
 * 去掉它才能让序列化结果与原文逐字节一致。
 */
export function trimRawHtml(raw: string): string {
  return raw.replace(/[ \t]*(\r?\n)+$/, "").replace(/[ \t]+$/, "");
}

/** 构造一个承载原始 HTML 的节点 */
export function rawHtmlNode(html: string): JSONContent {
  return { type: "rawHtml", attrs: { html } };
}

export const RawHtml = Node.create({
  name: "rawHtml",
  group: "block",
  atom: true,
  // leaf：HTML 原文只存在 attrs.html 里。放进 content 会让用户在编辑器里
  // 改到文本副本、与 attrs 脱钩，保存时以 attrs 为准就会丢改动。
  content: "",
  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute(RAW_HTML_ATTR) ?? "",
        renderHTML: (attributes: Record<string, any>) => ({ [RAW_HTML_ATTR]: attributes.html ?? "" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: `div[${RAW_HTML_ATTR}]` }];
  },
  renderHTML({ node, HTMLAttributes }) {
    // HTML 原文以「文本」形式呈现（ProseMirror 会转义），绝不注入真实标签，
    // 否则 <script> 会被浏览器执行。
    return ["div", mergeAttributes({ class: "mw-raw-html" }, HTMLAttributes), node.attrs.html ?? ""];
  },
  // 接管 marked 的 `html` token：块级 HTML 变成 rawHtml 节点，
  // 行内 HTML 返回空数组交回 @tiptap/markdown 的默认处理（generateJSON）。
  markdownTokenName: "html",
  parseMarkdown: (token: MarkdownToken) => {
    if (!token.block) return [];
    const raw = typeof token.raw === "string" ? token.raw : typeof token.text === "string" ? token.text : "";
    return rawHtmlNode(trimRawHtml(raw));
  },
  renderMarkdown: (node: JSONContent) => (typeof node.attrs?.html === "string" ? node.attrs.html : ""),
});
