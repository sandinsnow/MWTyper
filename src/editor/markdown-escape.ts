import { Extension } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";

// ---------------------------------------------------------------------------
// 段落行首转义（缺陷 B3）
//
// CommonMark 里行首的标记是有语义的：`-` → 列表、`#` → 标题、`>` → 引用、
// ``` → 代码块、`---` → 分隔线……一旦一个**普通段落**的文本以这些标记开头，
// 序列化出去再解析就会变成另一种节点类型（结构漂移）。
//
// 例：段落文本 "- 不是列表" → 序列化成 "- 不是列表" → 再解析变成 bulletList。
//
// 修法在序列化侧：只给「确实会被误解析」的行首补一个反斜杠（CommonMark 的
// ASCII 标点转义），让再解析时仍然是段落。
//
// 关键约束：只影响行首。行内的 `-`（"3-5 个"）、行内的 `#`（"C# 笔记"）一律不动。
//
// 注意：`>` 不在转义清单里 —— @tiptap/markdown 序列化文本时会做 HTML 实体编码
// （">" → "&gt;"），行首因此天然不是引用标记了，再补反斜杠反而会变成 "\&gt;"。
// ---------------------------------------------------------------------------

/**
 * marked 把反斜杠转义解析成 `escape` token，但 @tiptap/markdown 的行内解析
 * 没有 escape token 的处理器 → 转义字符被整段丢弃：
 *
 *   parse("\\- 不是列表") → paragraph(text " 不是列表")   // "-" 没了
 *
 * 没有这个处理器，B3 的转义方案在往返中会把字符吃掉，必须补上。
 */
export const MarkdownEscape = Extension.create({
  name: "markdownEscape",
  markdownTokenName: "escape",
  parseMarkdown: (token: MarkdownToken) => ({
    type: "text",
    text: typeof token.text === "string" ? token.text : "",
  }),
});

/** ATX 标题：1~6 个 # + 空白 */
const RE_ATX = /^#{1,6}(?:[ \t]|$)/;
/** 无序列表 */
const RE_BULLET = /^([-+*])(?:[ \t]|$)/;
/** 有序列表：数字 + `.` / `)` */
const RE_ORDERED = /^(\d{1,9})([.)])(?:[ \t]|$)/;
/** 围栏代码 */
const RE_FENCE = /^(`{3,}|~{3,})/;
/** 主题分隔线：--- / *** / ___（含 "- - -"） */
const RE_HR = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** setext 标题下划线 */
const RE_SETEXT = /^=+[ \t]*$/;
/** 链接引用定义：`[label]: url` */
const RE_LINKDEF = /^\[[^\]\n]*\]:/;
/** 删除线 */
const RE_STRIKE = /^~~/;
/** 强调：行首的 * / _ 且行内还有闭合标记 */
const RE_EMPH_STAR = /^\*(?!\s)[^*\n]*\*/;
const RE_EMPH_UNDER = /^_(?!\s)[^_\n]*_/;
/** 表格分隔行（`| --- | --- |`），用于判断相邻行会不会被吃成表格 */
const RE_TABLE_DELIM = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * 给「会被误解析成块级结构」的行首加反斜杠。
 * @param line 段落中的一行
 * @param tableContext 本行是否处于表格语境（相邻行是表格分隔行）
 */
export function escapeLineStart(line: string, tableContext = false): string {
  const indentMatch = /^(\s*)/.exec(line);
  const indent = indentMatch ? indentMatch[1] : "";
  // 4 空格及以上是缩进代码块；空格不是 ASCII 标点，反斜杠无法转义它，跳过。
  if (indent.length >= 4) return line;

  const rest = line.slice(indent.length);
  if (!rest) return line;

  // 标题 / 围栏代码 / 分隔线 / setext 下划线：转义行首第一个字符
  if (RE_ATX.test(rest)) return indent + "\\" + rest;
  if (RE_FENCE.test(rest)) return indent + "\\" + rest;
  if (RE_HR.test(rest)) return indent + "\\" + rest;
  if (RE_SETEXT.test(rest)) return indent + "\\" + rest;
  // 无序列表：转义列表符号
  if (RE_BULLET.test(rest)) return indent + "\\" + rest;
  // 有序列表：数字本身不用转义，转义 `.` / `)` 即可（"1. x" → "1\. x"）
  const ordered = RE_ORDERED.exec(rest);
  if (ordered) {
    const digits = ordered[1];
    return indent + digits + "\\" + rest.slice(digits.length);
  }
  // 链接引用定义：转义 `[`，否则会被 marked 当成定义吃掉
  if (RE_LINKDEF.test(rest)) return indent + "\\" + rest;
  // 删除线 / 强调
  if (RE_STRIKE.test(rest)) return indent + "\\" + rest;
  if (RE_EMPH_STAR.test(rest) || RE_EMPH_UNDER.test(rest)) return indent + "\\" + rest;
  // 表格行：只有相邻存在分隔行时才会被吃成表格，这时才需要转义
  if (tableContext && rest.startsWith("|")) return indent + "\\" + rest;

  return line;
}

/** 取节点的纯文本（用于判断相邻段落是否是表格分隔行） */
function plainText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (!Array.isArray(node.content)) return "";
  return node.content.map(plainText).join("");
}

/**
 * 转义一个段落的首行文本。
 * 只处理段落的**第一个无标记文本节点**：有标记的行首渲染出来是标记定界符
 * （如 `*斜体*`），不是块级标记，不会被误解析。
 */
function escapeParagraphContent(content: JSONContent[], nextSibling?: JSONContent): JSONContent[] {
  if (!content.length) return content;

  const first = content[0];
  if (first.type !== "text") return content;
  if (first.marks && first.marks.length > 0) return content;

  const text = first.text ?? "";
  if (!text) return content;

  const lines = text.split("\n");
  // 表格语境：段内后续行是分隔行，或紧邻的下一个段落是分隔行
  const nextText = nextSibling && nextSibling.type === "paragraph" ? plainText(nextSibling) : "";
  const tableContext =
    lines.slice(1).some((l) => RE_TABLE_DELIM.test(l)) || (nextText !== "" && RE_TABLE_DELIM.test(nextText.split("\n")[0]));

  let changed = false;
  const escaped = lines.map((line) => {
    const out = escapeLineStart(line, tableContext);
    if (out !== line) changed = true;
    return out;
  });
  if (!changed) return content;

  return [{ ...first, text: escaped.join("\n") }, ...content.slice(1)];
}

function transformChildren(children: JSONContent[]): JSONContent[] {
  return children.map((child, index) => {
    const next = children[index + 1];
    const copy: JSONContent = { ...child };
    if (Array.isArray(child.content)) copy.content = transformChildren(child.content);
    if (child.type === "paragraph") copy.content = escapeParagraphContent(child.content ?? [], next);
    return copy;
  });
}

/**
 * 复制一份 JSON，并把「会被误解析成块级结构」的段落行首做 CommonMark 转义。
 * 不修改入参（编辑器里的 doc 绝不能被就地改写）。
 */
export function escapeAmbiguousParagraphs(root: JSONContent): JSONContent {
  const copy: JSONContent = { ...root };
  if (Array.isArray(root.content)) copy.content = transformChildren(root.content);
  return copy;
}
