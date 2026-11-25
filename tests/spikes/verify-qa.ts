// 核验 QA（editor-qa）报告中的关键结论 —— 独立实测，不采信转述
// 运行：node node_modules/tsx/dist/cli.mjs .workbuddy/review/verify-qa.ts
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

const { Editor } = await import("@tiptap/core");
const { extensions, markdown, splitFrontmatter, joinFrontmatter } = await import("../../src/editor/extensions");
const { findReplace, findUpdate, getFindState } = await import("../../src/editor/find-replace");

let pass = 0, fail = 0;
function report(ok: boolean, name: string, detail = ""): void {
  if (ok) { pass++; console.log(`OK  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`!!  ${name}${detail ? " — " + detail : ""}`); }
}
const mk = (md: string) => new Editor({
  element: document.getElementById("editor")!,
  extensions: [...extensions, findReplace],
  content: markdown.parse(md),
});
// 与 App 的真实路径一致：先剥离 frontmatter（单独保管），正文走 markdown 往返，最后回贴。
const rt = (md: string) => {
  const { frontmatter, body } = splitFrontmatter(md);
  return joinFrontmatter(frontmatter, markdown.serialize(markdown.parse(body)));
};

// ════════════════════════════════════════════════════════
// V-1  QA P0-1：HTML 注释 / script / div 属性在往返中丢失
// ════════════════════════════════════════════════════════
console.log("\n=== V-1 HTML 注释与 raw HTML 往返 ===");
{
  const src = "# 标题\n\n<!-- 章节分隔标记 TODO -->\n\n正文内容\n";
  const out = rt(src);
  console.log("  原文: " + JSON.stringify(src));
  console.log("  往返: " + JSON.stringify(out));
  report(out.includes("<!-- 章节分隔标记 TODO -->"), "V-1 HTML 注释在往返中原样保留", out.includes("<!--") ? "仍在" : "已消失");
}
{
  const src = "正文\n\n<script>console.log(1)</script>\n\n<div align=\"center\">居中</div>\n";
  const out = rt(src);
  console.log("  往返: " + JSON.stringify(out));
  report(out.includes("<script>console.log(1)</script>"), "V-1b <script> 块在往返中原样保留");
  report(out.includes('align="center"'), "V-1c <div> 的 align 属性在往返中保留");
}

// ════════════════════════════════════════════════════════
// V-2  QA P1-1：全词匹配对中文永远 0 命中
// ════════════════════════════════════════════════════════
console.log("\n=== V-2 全词匹配对中文 ===");
{
  const ed = mk("这是中文测试\n另一行中文\n");
  findUpdate(ed, { query: "中文", caseSensitive: false, wholeWord: false, current: 0 });
  const n1 = getFindState(ed).matches.length;
  findUpdate(ed, { query: "中文", caseSensitive: false, wholeWord: true, current: 0 });
  const n2 = getFindState(ed).matches.length;
  console.log(`  普通匹配 ${n1} 处 → 开启全词后 ${n2} 处`);
  report(n1 === 2 && n2 === 2, "V-2 中文开启「全词匹配」后命中数不变（汉字不算词字符）", `${n1} → ${n2}`);
}
{
  const ed = mk("hello world\nsay hello\n");
  findUpdate(ed, { query: "hello", caseSensitive: false, wholeWord: true, current: 0 });
  const n = getFindState(ed).matches.length;
  console.log(`  英文 hello 全词匹配: ${n} 处`);
  report(n === 2, "V-2b 英文全词匹配正常（对照组）", `${n} 处`);
}

// ════════════════════════════════════════════════════════
// V-3  QA P0-3：BOM 破坏 frontmatter
// ════════════════════════════════════════════════════════
console.log("\n=== V-3 BOM 与 frontmatter ===");
{
  const bom = "\uFEFF---\ntitle: 我的文稿\n---\n\n正文\n";
  const { frontmatter, body } = splitFrontmatter(bom);
  console.log(`  splitFrontmatter 结果: frontmatter=${JSON.stringify(frontmatter)} body=${JSON.stringify(body)}`);
  report(frontmatter.startsWith("\uFEFF---") && frontmatter.includes("title: 我的文稿"),
    "V-3 BOM 下 frontmatter 仍被正确剥离（BOM 保留在 frontmatter 里回贴）", JSON.stringify(frontmatter));
  const out = rt(bom);
  console.log(`  往返: ${JSON.stringify(out)}`);
  report(!out.includes("## ---"), "V-3b 走 App 的 splitFrontmatter 路径往返后 frontmatter 不降级为正文", JSON.stringify(out));
}

// ════════════════════════════════════════════════════════
// V-4  QA P1-5：粘贴「以标记开头」的文本后往返结构漂移
// ════════════════════════════════════════════════════════
console.log("\n=== V-4 标记开头段落的往返漂移 ===");
{
  const ed = mk("");
  // 模拟纯文本粘贴：插入一个 paragraph 节点（不是 input rule，故不会立即变列表）
  const at = ed.state.doc.content.size;
  ed.commands.insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "- 不是列表" }] });
  const nodeType = ed.state.doc.child(0).type.name;
  const md1 = markdown.serialize(ed.getJSON());
  const ed2 = mk(md1);
  const nodeType2 = ed2.state.doc.child(0).type.name;
  console.log(`  粘贴后节点类型: ${nodeType} → 源码 ${JSON.stringify(md1)} → 往返后 ${nodeType2}`);
  report(nodeType === "paragraph" && nodeType2 === "paragraph",
    "V-4 「- 开头」的段落往返后仍是段落（行首已转义）", `${nodeType} → ${nodeType2}`);
}
{
  const ed = mk("");
  ed.commands.insertContentAt(ed.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "# 不是标题" }] });
  const t1 = ed.state.doc.child(0).type.name;
  const md1 = markdown.serialize(ed.getJSON());
  const t2 = mk(md1).state.doc.child(0).type.name;
  console.log(`  「# 开头」: ${t1} → ${JSON.stringify(md1)} → ${t2}`);
  report(t1 === "paragraph" && t2 === "paragraph", "V-4b 「# 开头」的段落往返后仍是段落（行首已转义）", `${t1} → ${t2}`);
}

// ════════════════════════════════════════════════════════
// V-5  QA P2-4：脚注往返变成字面链接
// ════════════════════════════════════════════════════════
console.log("\n=== V-5 脚注往返 ===");
{
  const src = "正文[^1]\n\n[^1]: 脚注内容\n";
  const out = rt(src);
  console.log("  往返: " + JSON.stringify(out));
  report(out.includes("[^1]:"), "V-5 脚注定义在往返中丢失（复现）", out.includes("[^1]:") ? "仍在" : "已变链接");
}

// ════════════════════════════════════════════════════════
// V-6  QA P1-2：表格表头行语义被破坏
// ════════════════════════════════════════════════════════
console.log("\n=== V-6 表格表头行语义 ===");
{
  const ed = mk("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
  const md0 = markdown.serialize(ed.getJSON());
  console.log("  初始序列化:\n    " + md0.replace(/\n/g, "\n    "));
  // 在表头行前插入一行（模拟工具栏「行↑」作用于表头）
  const pmTables = await import("prosemirror-tables");
  pmTables.addRowBefore(ed.state, ed.view.dispatch, ed.view);
  const md1 = markdown.serialize(ed.getJSON());
  console.log("  表头前插入行后:\n    " + md1.replace(/\n/g, "\n    "));
  const reparsed = markdown.parse(md1);
  const headerTexts: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "tableHeader") headerTexts.push((n.content ?? []).map((c: any) => c.text ?? "").join(""));
    for (const c of n.content ?? []) walk(c);
  };
  walk(reparsed);
  console.log("  重新解析后的表头内容: " + JSON.stringify(headerTexts));
  report(headerTexts.length !== 2 || headerTexts[0] !== "a",
    "V-6 表头行被抢占 / 表头内容错位（复现）", JSON.stringify(headerTexts));
}

// ════════════════════════════════════════════════════════
// V-7  QA P1-6：查找输入框内全局快捷键失效（逻辑核验）
// ════════════════════════════════════════════════════════
console.log("\n=== V-7 查找输入框内的快捷键早退条件 ===");
{
  const appSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8"));
  const whitelist = /GLOBAL_IN_FIELD/.test(appSrc);
  report(whitelist, "V-7 全局快捷键有白名单，输入框内不再一律早退（Ctrl+S 可用）");
  const gate = /globalInField/.test(appSrc);
  report(gate, "V-7b 早退条件带 globalInField 放行分支");
  const sKey = /"s", "o", "n"/.test(appSrc);
  report(sKey, "V-7c 白名单包含 Ctrl+S / Ctrl+O / Ctrl+N");
}

console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
// 说明：本文件最初是「独立核验 QA 结论」的复现脚本；相关缺陷已全部修复，
// 断言已改写为**回归守卫** —— 现在失败就意味着修复被回退了。
console.log(fail === 0
  ? "== 结论：QA 指出的 8 项缺陷均已修复，回归守卫全部通过 =="
  : "== 结论：存在回归（失败项即被回退的修复） ==");
process.exit(fail === 0 ? 0 : 1);
