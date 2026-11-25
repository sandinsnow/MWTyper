// M1 验证：表格工具栏命令（prosemirror-tables × 自定义 GFM schema）+ 写作快捷键。
// 运行：pnpm spike:m1editor（需 Node 24 在 PATH）
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
const { extensions, markdown } = await import("../src/editor/extensions");
const { selectionInTable } = await import("../src/editor/TableToolbar");
const pmTables = await import("prosemirror-tables");
const { computeMatches, findUpdate, findKey, findReplace } = await import("../src/editor/find-replace");
const { highlightDecorations, hljsKey } = await import("../src/editor/code-block");
// 与 src/editor/code-block.ts 解析的是同一个模块实例（同一 URL → 同一 ESM 单例），
// 因此这里拿到的 hljs 已带上 code-block.ts 注册的语言表。
// 独立参照只用它做「hljs → HTML」这一步，**不复用** code-block.ts 的正则解析与栈逻辑。
const { default: hljs } = await import("highlight.js/lib/core");

let failures = 0;
const check = (ok: boolean, msg: string, note = "") => {
  console.log((ok ? "OK " : "!! ") + msg + (note ? " — " + note : ""));
  if (!ok) failures++;
};

const MD = "前文\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后文\n";
const editor = new Editor({
  element: document.getElementById("editor")!,
  extensions: [...extensions, findReplace],
  content: markdown.parse(MD),
});

const countRows = () => {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableRow") n++;
    return true;
  });
  return n;
};
const countCols = () => {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableRow" && n === 0) n = node.childCount;
    return true;
  });
  return n;
};
const hasTable = () => {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "table") found = true;
    return true;
  });
  return found;
};

// 光标放进表格主体单元格
let cellPos = -1;
editor.state.doc.descendants((node, pos) => {
  if (cellPos < 0 && node.type.name === "tableCell") cellPos = pos;
  return true;
});
editor.commands.setTextSelection(cellPos + 2);
check(selectionInTable(editor), "selectionInTable：单元格内为 true");

const run = (cmd: (s: typeof editor.state, d?: typeof editor.view.dispatch, v?: typeof editor.view) => boolean) =>
  cmd(editor.state, editor.view.dispatch, editor.view);

check(countRows() === 2 && countCols() === 2, "初始表格 2 行 2 列");
check(run(pmTables.addRowAfter) && countRows() === 3, "addRowAfter → 3 行");
check(run(pmTables.addColumnAfter) && countCols() === 3, "addColumnAfter → 3 列");
check(run(pmTables.deleteRow) && countRows() === 2, "deleteRow → 2 行");
check(run(pmTables.deleteColumn) && countCols() === 2, "deleteColumn → 2 列");

// 增删后往返不动点
const md1 = markdown.serialize(editor.getJSON());
const md2 = markdown.serialize(markdown.parse(md1));
check(md1 === md2, "表格命令后 serialize 不动点");

check(run(pmTables.deleteTable) && !hasTable(), "deleteTable → 表格移除");

// 快捷键：Ctrl+1 标题 / Ctrl+0 正文 / Ctrl+K 链接
editor.commands.setContent(markdown.parse("一段文字\n"), { emitUpdate: false });
editor.commands.setTextSelection(3);
const key = (k: string) =>
  new dom.window.KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true });
const handled = (ev: KeyboardEvent) =>
  editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev)) === true;

check(handled(key("1")) && editor.state.selection.$from.parent.type.name === "heading", "Ctrl+1 → 标题");
check(editor.state.selection.$from.parent.attrs.level === 1, "标题级别为 1");
check(handled(key("0")) && editor.state.selection.$from.parent.type.name === "paragraph", "Ctrl+0 → 正文");

editor.commands.setTextSelection({ from: 1, to: 5 });
check(handled(key("k")), "Ctrl+K 触发链接");
const json = JSON.stringify(editor.getJSON());
check(json.includes("https://example.test"), "链接 href 已写入");

// B2 闸门：增量装饰 / 增量查找 与全文重算逐项等价（含代码块内外、跨块、删除块、多范围改动）
//
// 闸门设计（QA M3 复审要求，防「同义反复」假通过）：
//   1. 期望值一律来自**独立朴素参照**（naiveFind / refHighlight），
//      参照实现不 import 被测模块的任何函数，也不复用其算法路径；
//      若期望值仍由被测函数自身派生，功能整体失效时两侧同时为空 → 恒等 → 闸门假通过。
//   2. 命中数必须有 > 0 的绝对断言，否则「恒返回空集」类整体失效被恒真的等价断言掩盖。
//   3. 必须逐项比对 from/to（并用 textBetween 复核区间文本），
//      否则 off-by-one 这类「命中数不变、位置错误」的缺陷逃逸。
const B2_DOC = [
  "# 标题 test",
  "",
  "段落 test 文本 test。",
  "",
  "```js",
  "const test = 1;",
  "function foo() { return test; }",
  "```",
  "",
  "块后 test 文本",
  "",
  "```py",
  "x = test",
  "```",
].join("\n");

/**
 * 装饰签名：位置 + class。
 *
 * 注意：Decoration.inline(from, to, attrs, spec) 的第 3 个参数是 attrs、第 4 个才是 spec，
 * 而 Decoration.spec getter 返回 type.spec。code-block.ts 用的是
 * `Decoration.inline(from, to, { class: cls })` → class 落在 type.attrs.class，
 * spec 为空对象。旧闸门读 d.spec.class 恒为 undefined → class 比较是空转（假通过）。
 * 这里改读 type.attrs.class，使 class 真正参与比较。
 */
const decoSig = (set: {
  find(): Array<{ from: number; to: number; type?: { attrs?: Record<string, string> } }>;
}): string =>
  set
    .find()
    .map((d) => `${d.from}-${d.to}:${d.type?.attrs?.class ?? ""}`)
    .join("|");

const matchSig = (matches: { from: number; to: number }[]): string =>
  matches.map((m) => `${m.from}-${m.to}`).join("|");

/**
 * 独立朴素参照（查找）：不依赖被测模块的任何函数，
 * 直接遍历 doc 的全部 text 节点，用 indexOf 扫描查询词。
 * 参照实现必须与被测代码完全解耦，否则「被测功能整体失效」时两侧同时为空 → 恒等 → 闸门假通过。
 * 推进步长取 query.length（与正则 `g` 的非重叠语义一致），跨节点的匹配不计入（与实现同语义）。
 */
function naiveFind(doc: any, query: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const q = query.toLowerCase();
  doc.descendants((node: any, pos: number) => {
    if (node.type?.name !== "text") return true;
    const text: string = node.text ?? "";
    const hay = text.toLowerCase();
    let i = hay.indexOf(q);
    while (i !== -1) {
      out.push({ from: pos + i, to: pos + i + query.length });
      i = hay.indexOf(q, i + query.length);
    }
    return true;
  });
  return out;
}

/**
 * 独立朴素参照（高亮）：不复用 code-block.ts 的正则分词 + class 栈，
 * 而是把 hljs 输出的 HTML 交给 DOMParser 解析成 DOM 树，
 * 再按文本节点顺序累加偏移，还原出每个高亮片段的 (from, to, class)。
 *
 * 两条路径（正则栈 vs DOM 树遍历）在算法上完全独立，
 * 因此「高亮位置错位 / class 错配」会被真实捕获，而不是恒真通过。
 */
function refHighlight(doc: any): { from: number; to: number; cls: string }[] {
  const out: { from: number; to: number; cls: string }[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type?.name !== "codeBlock") return true;
    const lang: string | null = node.attrs?.language ?? null;
    const text: string = node.textContent ?? "";
    if (!lang || !text || !hljs.getLanguage(lang)) return true;
    const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
    let offset = 0;
    const walk = (el: Element) => {
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 3) {
          const t = child.textContent ?? "";
          const cls = (child.parentElement as HTMLElement | null)?.getAttribute("class") ?? "";
          if (cls && t.length) out.push({ from: pos + 1 + offset, to: pos + 1 + offset + t.length, cls });
          offset += t.length;
        } else if (child.nodeType === 1) {
          walk(child as Element);
        }
      }
    };
    walk(body);
    return true;
  });
  return out;
}

const refHighlightSig = (doc: any): string =>
  refHighlight(doc)
    .map((d) => `${d.from}-${d.to}:${d.cls}`)
    .join("|");

interface BlockRange { from: number; to: number }
type Tr = ReturnType<typeof editor.state.tr>;
const codeBlocks = (): BlockRange[] => {
  const out: BlockRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") out.push({ from: pos, to: pos + node.nodeSize });
    return true;
  });
  return out;
};

const scenarios: { name: string; edit: (tr: Tr, blocks: BlockRange[]) => void }[] = [
  { name: "代码块内插入", edit: (tr, b) => { tr.insertText("X", b[0].from + 3); } },
  { name: "代码块外插入", edit: (tr) => { tr.insertText("test ", 2); } },
  { name: "跨块边界删除", edit: (tr, b) => { tr.delete(b[0].to - 2, b[0].to + 2); } },
  { name: "删除整个代码块", edit: (tr, b) => { tr.delete(b[0].from, b[0].to); } },
  { name: "多范围同时改动", edit: (tr, b) => { tr.insertText("test ", 2); tr.insertText("Y", b[0].from + 2); } },
  { name: "代码块语言切换", edit: (tr, b) => { tr.setNodeMarkup(b[0].from, undefined, { language: "typescript" }); } },
  { name: "代码块首部插入", edit: (tr, b) => { tr.insertText("let ", b[0].from + 1); } },
  { name: "跨两个代码块删除", edit: (tr, b) => { tr.delete(b[0].from + 2, b[1].to - 2); } },
];

// ---------------------------------------------------------------- 基线自检
// 独立参照本身必须先自证可用（参照非空 + 与被测全文重算一致），
// 否则后续逐项比对可能因参照本身失效而恒真。
{
  editor.commands.setContent(markdown.parse(B2_DOC), { emitUpdate: false });
  const baseFind = naiveFind(editor.state.doc, "test");
  check(baseFind.length > 0, "B2 查找参照非空（基线）", `count=${baseFind.length}`);
  check(
    matchSig(baseFind) === matchSig(computeMatches(editor.state.doc, "test", false, false)),
    "B2 查找参照与全文重算命中集一致（基线）",
    `ref=${matchSig(baseFind)}`
  );
  const baseDeco = refHighlight(editor.state.doc);
  check(baseDeco.length > 0, "B2 高亮参照非空（基线）", `count=${baseDeco.length}`);
  check(
    refHighlightSig(editor.state.doc) === decoSig(highlightDecorations(editor.state.doc)),
    "B2 高亮参照与全文重算一致（基线）",
    `ref=${refHighlightSig(editor.state.doc)}`
  );
}

// ---------------------------------------------------------------- 场景逐项比对
for (const scenario of scenarios) {
  editor.commands.setContent(markdown.parse(B2_DOC), { emitUpdate: false });
  findUpdate(editor, { query: "test", caseSensitive: false, wholeWord: false, current: 0 });
  const before = editor.state;
  const blocks = codeBlocks();
  const tr = before.tr;
  scenario.edit(tr, blocks);

  // 期望值 = 独立朴素参照在新文档上的结果（绝不来自被测函数）。
  const refMatches = naiveFind(tr.doc, "test");
  const refDeco = refHighlight(tr.doc);
  const refDecoSig = refDeco.map((d) => `${d.from}-${d.to}:${d.cls}`).join("|");
  const fullDecoSig = decoSig(highlightDecorations(tr.doc));

  editor.view.dispatch(tr);
  const actualDeco = decoSig(hljsKey.getState(editor.state)!);
  const actualMatches = findKey.getState(editor.state)!.matches;

  // (1) 非空绝对断言：命中数必须 > 0，防止「恒返回空集」被等价断言掩盖。
  check(actualMatches.length > 0, `B2 查找非空：${scenario.name}`, `count=${actualMatches.length}`);
  check(refMatches.length > 0, `B2 查找参照非空：${scenario.name}`, `count=${refMatches.length}`);

  // (2) 逐项位置精确比对：命中数相同且每个 from/to 逐一相同。
  const sameCount = actualMatches.length === refMatches.length;
  const samePos =
    sameCount && actualMatches.every((m, i) => m.from === refMatches[i].from && m.to === refMatches[i].to);
  check(samePos, `B2 查找等价：${scenario.name}`, `actual=${matchSig(actualMatches)} ref=${matchSig(refMatches)}`);

  // (3) 区间文本复核：每个命中的区间文本必须恰好等于查询词（捕获 off-by-one）。
  const badRanges = actualMatches.filter((m) => tr.doc.textBetween(m.from, m.to) !== "test");
  check(
    actualMatches.length > 0 && badRanges.length === 0,
    `B2 查找位置精确：${scenario.name}`,
    `bad=${JSON.stringify(badRanges)}`
  );

  // (4) 补充印证：被测函数的全量重算与独立参照一致（期望值来源仍是参照，此处仅作交叉验证）。
  check(
    matchSig(computeMatches(tr.doc, "test", false, false)) === matchSig(refMatches),
    `B2 查找全量交叉印证：${scenario.name}`,
    `full=${matchSig(computeMatches(tr.doc, "test", false, false))}`
  );

  // (5) 高亮等价：增量结果 == 独立参照（位置 + class 全等）。
  check(actualDeco === refDecoSig, `B2 高亮等价：${scenario.name}`, `actual=${actualDeco} ref=${refDecoSig}`);
  // (6) 高亮等价：增量结果 == 被测全文重算（增量 vs 全量的原始意图，class 真正参与比较）。
  check(actualDeco === fullDecoSig, `B2 高亮增量全量等价：${scenario.name}`, `actual=${actualDeco} full=${fullDecoSig}`);
}

editor.destroy();
console.log(`\n== M1 编辑器增强：${failures === 0 ? "PASS" : `${failures} FAIL`} ==`);
if (failures > 0) process.exit(1);