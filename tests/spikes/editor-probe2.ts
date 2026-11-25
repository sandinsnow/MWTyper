// 编辑器缺陷回归守卫 · 第二批（v1.8 改写）
// 原为「替换后果实测」；相关缺陷已修复，断言已反转为「修复生效」。
//
// 运行：node node_modules/tsx/dist/cli.mjs .workbuddy/review/editor-probe2.ts
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
const { extensions, markdown } = await import("../../src/editor/extensions");
const { findReplace, findUpdate, replaceCurrent, getFindState } = await import("../../src/editor/find-replace");

let pass = 0;
let fail = 0;
function report(ok: boolean, name: string, detail = ""): void {
  if (ok) { pass++; console.log(`OK  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`!!  ${name}${detail ? " — " + detail : ""}`); }
}
function mk(md: string) {
  return new Editor({
    element: document.getElementById("editor")!,
    extensions: [...extensions, findReplace],
    content: markdown.parse(md),
  });
}
function catchErr(fn: () => void): string {
  try { fn(); return ""; } catch (e) { return e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
}

// ---------------------------------------------------------- F-1 后续崩溃
// 原假设：替换文本含换行 → 造出含换行的文本节点 → 后续编辑崩溃 / 段落被拆开
// 已修（normalizeReplacement 把换行折叠为空格）：现在断言「不崩溃、不拆段」。
console.log("\n=== F-1 含换行的文本节点 → 后续编辑是否崩溃 ===");
{
  const ed = mk("hello world\n");
  findUpdate(ed, { query: "hello", caseSensitive: false, wholeWord: false, current: 0 });
  replaceCurrent(ed, "第一行\n第二行");
  console.log(`     替换后 getText(): ${JSON.stringify(ed.getText())}`);
  console.log(`     替换后 Markdown 序列化: ${JSON.stringify(markdown.serialize(ed.getJSON()))}`);
  // 后续编辑：在该节点内插入字符
  const err = catchErr(() => {
    ed.commands.insertContentAt(1, "X");
  });
  report(err === "", "F-1 在替换后的文本节点内继续输入不抛异常", err || "未抛异常");

  // 序列化是否产生结构错乱的 Markdown
  const md = markdown.serialize(ed.getJSON());
  report(md.split("\n").filter((l) => l.trim()).length <= 1,
    "F-2 序列化后段落未被拆成多行（Markdown 结构完好）", JSON.stringify(md));
}

// ---------------------------------------------------------- F-3 mark 丢失范围
// 原假设：替换会丢掉 mark → 序列化后加粗消失
// 已修（按 mark 边界分段替换）：现在断言加粗必须保留。
console.log("\n=== F-3 mark 丢失的影响范围 ===");
{
  const ed = mk("**粗体词** 和普通词\n");
  findUpdate(ed, { query: "粗体词", caseSensitive: false, wholeWord: false, current: 0 });
  replaceCurrent(ed, "替换后");
  const md = markdown.serialize(ed.getJSON());
  console.log(`     序列化结果: ${JSON.stringify(md)}`);
  report(md.includes("**替换后**"), "F-3 加粗标记在序列化后保留（Markdown 语义不丢）", JSON.stringify(md));
}

// ---------------------------------------------------------- F-4 链接中的替换
// 原假设：替换链接文字 → 链接目标一并消失
// 已修：现在断言链接结构与目标必须保留。
console.log("\n=== F-4 链接文本中的替换 ===");
{
  const ed = mk("[链接文字](https://example.com)\n");
  findUpdate(ed, { query: "链接文字", caseSensitive: false, wholeWord: false, current: 0 });
  const n = getMatches(ed);
  replaceCurrent(ed, "新文字");
  const md = markdown.serialize(ed.getJSON());
  console.log(`     匹配 ${n} 处 → 序列化: ${JSON.stringify(md)}`);
  report(md.includes("https://example.com") && md.includes("[新文字]"),
    "F-4 替换链接文字后链接目标与语法保留", JSON.stringify(md));
}
function getMatches(ed: import("@tiptap/core").Editor) {
  return getFindState(ed).matches.length;
}

// ---------------------------------------------------------- F-5 表格内替换
console.log("\n=== F-5 表格单元格内的替换 ===");
{
  const ed = mk("| a | b |\n| --- | --- |\n| 目标 | 2 |\n");
  findUpdate(ed, { query: "目标", caseSensitive: false, wholeWord: false, current: 0 });
  const n = getMatches(ed);
  replaceCurrent(ed, "新值");
  const md = markdown.serialize(ed.getJSON());
  console.log(`     匹配 ${n} 处 → 序列化: ${JSON.stringify(md)}`);
  report(md.includes("新值") && md.includes("| a | b |"), "F-5 表格内替换后表格结构完好", JSON.stringify(md));
}

// ---------------------------------------------------------- F-6 图片 alt 中的替换
console.log("\n=== F-6 图片（alt 属性）不参与查找（预期） ===");
{
  const ed = mk("![说明文字](assets/a.png)\n");
  findUpdate(ed, { query: "说明文字", caseSensitive: false, wholeWord: false, current: 0 });
  const n = getMatches(ed);
  report(n === 0, "F-6 图片 alt 中的文字不被查找到（预期行为）", `匹配 ${n} 处`);
}

console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
console.log(fail === 0 ? "== 结论：全部回归守卫通过（缺陷已修复且修复未回退） ==" : "== 结论：存在回归（修复被回退） ==");
process.exit(fail === 0 ? 0 : 1);
