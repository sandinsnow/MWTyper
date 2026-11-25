// 编辑器缺陷回归守卫（v1.7 审查 → v1.8 改写）
// 目的：把「读源码时怀疑的若干编辑器缺陷」逐条变成可复现的实测结论，
//       避免把猜测当结论写进方案。
// v1.8 起：相关缺陷已修复，断言由「缺陷存在」反转为「修复生效」——
//          现在失败即意味着修复被回退。
//
// 运行：node node_modules/tsx/dist/cli.mjs .workbuddy/review/editor-probe.ts
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
const {
  findReplace, findUpdate, findNavigate, replaceCurrent, replaceAll, getFindState,
} = await import("../../src/editor/find-replace");

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

// ---------------------------------------------------------------- E-1
// 原假设：替换文本含换行 → schema.text("\n") 抛 RangeError → 替换崩溃
// 已修（normalizeReplacement 把换行折叠为空格）：现在断言「不抛异常且不拆段」。
console.log("\n=== E-1 替换文本含换行 ===");
{
  const ed = mk("hello world\n");
  findUpdate(ed, { query: "hello", caseSensitive: false, wholeWord: false, current: 0 });
  let threw = "";
  try {
    replaceCurrent(ed, "第一行\n第二行");
  } catch (e) {
    threw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  report(threw === "", "E-1 替换文本含换行不抛异常", threw || "未抛出异常");
  console.log(`     文档现状: ${JSON.stringify(ed.getText())}`);
  report(!ed.getText().includes("\n"), "E-1b 替换后文本节点内不含换行（段落不被拆开）", JSON.stringify(ed.getText()));
}

// ---------------------------------------------------------------- E-2
// 原假设：替换会丢失原有 mark（在加粗/链接文本中替换）
// 已修（按 mark 边界分段替换）：现在断言 mark 必须保留。
console.log("\n=== E-2 替换丢失原有 mark ===");
{
  const ed = mk("**粗体词** 和普通词\n");
  findUpdate(ed, { query: "粗体词", caseSensitive: false, wholeWord: false, current: 0 });
  replaceCurrent(ed, "替换后");
  const json = JSON.stringify(ed.getJSON());
  const hasBold = json.includes('"bold"');
  console.log(`     替换后 JSON: ${json.slice(0, 260)}`);
  report(hasBold, "E-2 替换后加粗 mark 保留", hasBold ? "mark 仍在" : "mark 已丢失");
}

// ---------------------------------------------------------------- E-3
// 原假设：findNavigate 只把光标放到匹配起点，不选中整个匹配
// 已修（TextSelection.create 选中整个匹配）：现在断言匹配被完整选中。
console.log("\n=== E-3 查找导航是否选中整个匹配 ===");
{
  const ed = mk("foo bar foo baz\n");
  findUpdate(ed, { query: "foo", caseSensitive: false, wholeWord: false, current: 0 });
  findNavigate(ed, 1);
  const sel = ed.state.selection;
  const selected = ed.state.doc.textBetween(sel.from, sel.to);
  report(sel.from !== sel.to && selected === "foo", "E-3 导航后整个匹配被选中",
    `from=${sel.from} to=${sel.to} selected=${JSON.stringify(selected)}`);
}

// ---------------------------------------------------------------- E-4
// 假设：replaceAll 在多个匹配下会破坏文档结构 / 位置错位
console.log("\n=== E-4 全部替换 ===");
{
  const ed = mk("aaa bbb aaa ccc aaa\n");
  findUpdate(ed, { query: "aaa", caseSensitive: false, wholeWord: false, current: 0 });
  const n = getFindState(ed).matches.length;
  replaceAll(ed, "X");
  const text = ed.getText();
  report(text === "X bbb X ccc X", "E-4 全部替换结果正确", `匹配 ${n} 处 → ${JSON.stringify(text)}`);
}

// ---------------------------------------------------------------- E-5
// 假设：查找条关闭（findClose）后 matches 清空，但插件 state 的 query 仍影响后续增量
console.log("\n=== E-5 关闭后重新查询 ===");
{
  const ed = mk("alpha beta\n");
  findUpdate(ed, { query: "alpha", caseSensitive: false, wholeWord: false, current: 0 });
  const before = getFindState(ed).matches.length;
  findUpdate(ed, { query: "", caseSensitive: false, wholeWord: false, current: 0 });
  const after = getFindState(ed).matches.length;
  report(before === 1 && after === 0, "E-5 清空查询后匹配数归零", `${before} → ${after}`);
}

// ---------------------------------------------------------------- E-6
// 假设：查找替换在「有 mark 的文本节点」内不产生匹配（mark 边界）
console.log("\n=== E-6 跨 mark 边界的查找 ===");
{
  const ed = mk("前半**后半**\n");
  findUpdate(ed, { query: "前后半", caseSensitive: false, wholeWord: false, current: 0 });
  const n = getFindState(ed).matches.length;
  report(n === 0, "E-6 跨 mark 边界不命中（首版限制，已知）", `匹配 ${n} 处`);
}

// ---------------------------------------------------------------- E-7
// 假设：替换后不重新聚焦编辑器（FindReplaceBar 的 replaceCurrent 后焦点仍在输入框）
console.log("\n=== E-7 替换后的文档状态与 current 索引 ===");
{
  const ed = mk("one two one\n");
  findUpdate(ed, { query: "one", caseSensitive: false, wholeWord: false, current: 0 });
  replaceCurrent(ed, "1");
  const f = getFindState(ed);
  console.log(`     替换后 matches=${f.matches.length} current=${f.current} text=${JSON.stringify(ed.getText())}`);
  report(f.matches.length === 1, "E-7 替换后匹配数正确重算", `matches=${f.matches.length}`);
}

// ---------------------------------------------------------------- E-8
// 原假设：查找替换未选中文本时，替换会破坏段落结构（多行文本）
// 已修（normalizeReplacement 折叠换行）：现在断言不抛异常且段落数不变。
console.log("\n=== E-8 替换多行文本对结构的影响 ===");
{
  const ed = mk("第一段\n\n第二段\n");
  const before = ed.state.doc.childCount;
  findUpdate(ed, { query: "第二段", caseSensitive: false, wholeWord: false, current: 0 });
  let err = "";
  try {
    replaceCurrent(ed, "行1\n\n行2");
  } catch (e) {
    err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  report(err === "", "E-8 多行替换不抛异常", err || "未抛出");
  report(ed.state.doc.childCount === before, "E-8b 替换后顶层块数量不变",
    `${before} → ${ed.state.doc.childCount}`);
  console.log(`     文档现状: ${JSON.stringify(ed.getText())}`);
}

// ---------------------------------------------------------------- E-9
// 假设：查找条查询变化会 dispatch 事务 → 触发顶层重渲染（性能）
console.log("\n=== E-9 查询输入触发的 transaction 数 ===");
{
  const ed = mk("x\n");
  let txCount = 0;
  ed.on("transaction", () => { txCount++; });
  findUpdate(ed, { query: "a", caseSensitive: false, wholeWord: false, current: 0 });
  findUpdate(ed, { query: "ab", caseSensitive: false, wholeWord: false, current: 0 });
  findUpdate(ed, { query: "abc", caseSensitive: false, wholeWord: false, current: 0 });
  report(txCount === 3, "E-9 每次查询输入产生 1 个 transaction", `实测 ${txCount} 个`);
}

console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
console.log(fail === 0 ? "== 结论：全部回归守卫通过（缺陷已修复且修复未回退） ==" : "== 结论：存在回归（修复被回退） ==");
process.exit(fail === 0 ? 0 : 1);
