// 独立抽查：不是复述 serde-probe，而是换一批用例/换一条判据路径，
// 目的是验证「序列化保真修复」没有引入新的结构漂移。
// 运行：node node_modules/tsx/dist/cli.mjs .workbuddy/review/serde-spotcheck.ts
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='editor'></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const w = dom.window as unknown as Record<string, unknown>;
for (const k of [
  "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Node",
  "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "DOMParser", "XMLSerializer", "Range", "CustomEvent", "Event",
  "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent", "CSS", "history", "location", "localStorage",
]) {
  if (w[k] !== undefined) (globalThis as Record<string, unknown>)[k] = w[k];
}
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
dom.window.prompt = () => "https://example.test";

const { markdown } = await import("../../src/editor/extensions");

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`PASS [${name}] ${detail}`);
  } else {
    fail += 1;
    console.log(`FAIL [${name}] ${detail}`);
  }
}

/** 取顶层节点类型序列 */
function topTypes(doc: any): string[] {
  return (doc.content ?? []).map((n: any) => n.type);
}
/** 取全文纯文本 */
function allText(doc: any): string {
  const walk = (n: any): string => {
    if (n.type === "text") return n.text ?? "";
    return (n.content ?? []).map(walk).join("");
  };
  return (doc.content ?? []).map(walk).join("\n");
}
function roundtrip(md: string): string {
  return markdown.serialize(markdown.parse(md));
}

// S-1 嵌套列表：不应被行首转义破坏
{
  const src = "- 第一层\n  - 第二层\n- 第三层";
  const out = roundtrip(src);
  const doc = markdown.parse(src);
  check("S-1a 嵌套列表结构保持", topTypes(doc).join(",") === "bulletList", `top=${topTypes(doc).join(",")}`);
  check("S-1b 嵌套列表往返文本一致", allText(markdown.parse(out)).replace(/\s+/g, " ") === allText(doc).replace(/\s+/g, " "), `out=${JSON.stringify(out)}`);
  check("S-1c 嵌套列表不被转义", !out.includes("\\-"), `out=${JSON.stringify(out)}`);
}

// S-2 代码块内的 "- x" 不应被转义
{
  const src = "```md\n- 不是列表\n```";
  const out = roundtrip(src);
  check("S-2 代码块内容原样", out.includes("- 不是列表") && !out.includes("\\-"), `out=${JSON.stringify(out)}`);
}

// S-3 引用块往返
{
  const src = "> 引用一行\n> 引用两行";
  const out = roundtrip(src);
  check("S-3 引用块往返", topTypes(markdown.parse(out)).join(",") === "blockquote", `out=${JSON.stringify(out)}`);
  check("S-3b 引用块文本保留", allText(markdown.parse(out)).includes("引用两行"), `out=${JSON.stringify(out)}`);
}

// S-4 表格往返（含单元格内管道符与行内格式）
{
  const src = "| 表头 | 值 |\n| --- | --- |\n| a | **粗** |";
  const out = roundtrip(src);
  check("S-4 表格往返含表头分隔行", out.includes("| --- | --- |"), `out=${JSON.stringify(out)}`);
  check("S-4b 表格表头保留", allText(markdown.parse(out)).includes("表头"), `out=${JSON.stringify(out)}`);
  check("S-4c 单元格加粗保留", out.includes("**粗**"), `out=${JSON.stringify(out)}`);
}

// S-5 图片与链接往返
{
  const src = "![图](img/a.png)\n\n[链接](https://example.com)";
  const out = roundtrip(src);
  check("S-5 图片链接往返", out.includes("![图](img/a.png)") && out.includes("[链接](https://example.com)"), `out=${JSON.stringify(out)}`);
}

// S-6 软换行段落（编辑器里 Shift+Enter 产生）：再解析应仍是同一段落
{
  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "第一行\n- 第二行" }] }],
  };
  const out = markdown.serialize(doc as any);
  const re = markdown.parse(out);
  check("S-6 软换行段落再解析仍是段落", topTypes(re).join(",") === "paragraph", `out=${JSON.stringify(out)} top=${topTypes(re).join(",")}`);
  check("S-6b 软换行段落文本一致", allText(re).includes("第二行"), `out=${JSON.stringify(out)} text=${JSON.stringify(allText(re))}`);
}

// S-7 列表项内的多行段落（lazy continuation）
{
  const src = "- 第一行\n  第二行";
  const out = roundtrip(src);
  const re = markdown.parse(out);
  check("S-7 列表项多行往返", topTypes(re).join(",") === "bulletList", `out=${JSON.stringify(out)}`);
  check("S-7b 列表项多行文本保留", allText(re).includes("第二行"), `out=${JSON.stringify(out)}`);
}

// S-8 rawHtml 节点确实落到 doc 里，且 html 原文逐字节保留
{
  const doc = markdown.parse("<!-- 精确注释 <b> & \"引号\" -->");
  const raw = (doc.content ?? []).find((n: any) => n.type === "rawHtml");
  check("S-8 rawHtml 节点存在", !!raw, `top=${topTypes(doc).join(",")}`);
  check("S-8b rawHtml 原文逐字节", raw?.attrs?.html === "<!-- 精确注释 <b> & \"引号\" -->", `html=${JSON.stringify(raw?.attrs?.html)}`);
}

// S-9 真实列表不应被转义（CommonMark 正确行为不能被破坏）
{
  const src = "- 真列表";
  const out = roundtrip(src);
  check("S-9 真列表不被转义", out === "- 真列表", `out=${JSON.stringify(out)}`);
}

// S-10 标题/普通段落不受影响
{
  const src = "# 真标题\n\n普通段落";
  const out = roundtrip(src);
  check("S-10 标题段落往返", out === "# 真标题\n\n普通段落", `out=${JSON.stringify(out)}`);
}

// S-11 数学公式与任务列表
{
  const src = "$E=mc^2$\n\n- [ ] 待办\n- [x] 完成";
  const out = roundtrip(src);
  check("S-11 公式任务列表往返", out.includes("待办") && out.includes("完成"), `out=${JSON.stringify(out)}`);
}

// S-12 HTML 注释不会污染普通段落（不会把注释内容并进正文）
{
  const src = "正文前\n\n<!-- c -->\n\n正文后";
  const out = roundtrip(src);
  const re = markdown.parse(out);
  check("S-12 注释块独立成节点", topTypes(re).includes("rawHtml"), `top=${topTypes(re).join(",")}`);
  check("S-12b 正文未被注释污染", allText(re).includes("正文前") && allText(re).includes("正文后") && !allText(re).includes("<!-- c -->"), `text=${JSON.stringify(allText(re))}`);
}

// S-13 序列化不修改传入的 JSON（幂等前提：不能就地改 doc）
{
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "- 不是列表" }] }] };
  const snapshot = JSON.stringify(doc);
  markdown.serialize(doc as any);
  check("S-13 序列化不改入参", JSON.stringify(doc) === snapshot, `after=${JSON.stringify(doc)}`);
}

// S-14 空文档
{
  const out = roundtrip("");
  check("S-14 空文档往返", typeof out === "string", `out=${JSON.stringify(out)}`);
}

console.log("\n========== 汇总 ==========");
console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
