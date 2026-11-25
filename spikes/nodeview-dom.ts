// M0 spike ③：代码块 NodeView + highlight.js 高亮（jsdom 实测）
// 判据：1) NodeView 渲染出语言选择器与高亮 span；2) 编辑事务后高亮仍在、文本正确；
//       3) 语言切换（含 select 真实 change 事件）生效；4) serialize→parse JSON 稳定。
// 运行：pnpm spike:nodeview（需 Node 24 在 PATH）
import { JSDOM } from "jsdom";
import { writeFileSync } from "node:fs";

const dom = new JSDOM("<!doctype html><html><body><div id='editor'></div><div id='editor2'></div></body></html>", {
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

// globals 就绪后再加载编辑器模块（避免模块顶层触碰 document）
const { Editor } = await import("@tiptap/core");
const { extensions, markdown } = await import("../src/editor/extensions");

const BODY = `# 标题

\`\`\`ts
const x: number = 42;
console.log(x);
\`\`\`

结束。
`;

const report: string[] = [];
const log = (s: string) => { report.push(s); console.log(s); };
let failures = 0;
const check = (ok: boolean, msg: string) => {
  log((ok ? "OK " : "!! ") + msg);
  if (!ok) failures++;
};

const editor = new Editor({
  element: document.getElementById("editor")!,
  extensions,
  content: markdown.parse(BODY),
});

const root = editor.view.dom;

// 1) NodeView 结构 + 初始高亮
const wrap = root.querySelector(".code-block");
check(!!wrap, "NodeView 渲染出 .code-block 容器");
const select = wrap?.querySelector("select.code-block-lang") as HTMLSelectElement | null;
check(!!select && select.value === "typescript", `语言选择器存在且 ts 归一化为 typescript（实际 ${select?.value}）`);
const codeEl = () => root.querySelector(".code-block code")!;
check(codeEl().textContent.includes("const x: number = 42;"), "代码文本正确");
check(!!codeEl().querySelector("span.hljs-keyword"), "初始高亮：存在 hljs-keyword decoration span");

// 2) 编辑事务：在代码块末尾插入文本
let cbPos = -1;
let cbSize = 0;
editor.state.doc.descendants((n, pos) => {
  if (n.type.name === "codeBlock" && cbPos < 0) { cbPos = pos; cbSize = n.content.size; }
});
check(cbPos >= 0, "文档中定位到 codeBlock");
editor.view.dispatch(editor.view.state.tr.insertText(" // 注释", cbPos + 1 + cbSize));
check(codeEl().textContent.includes("// 注释"), "编辑事务：插入文本已反映到 DOM");
check(codeEl().textContent.includes("const x: number = 42;"), "编辑事务：原文本未丢失");
check(!!codeEl().querySelector("span.hljs-keyword"), "编辑事务后高亮 decoration 仍在（核心判据）");
check(!!codeEl().querySelector("span.hljs-comment"), "新插入的注释被高亮为 hljs-comment");

// 3) 语言切换：select 真实 change 事件 → setNodeMarkup
select!.value = "javascript";
select!.dispatchEvent(new (w.Event as typeof Event)("change"));
check(editor.state.doc.nodeAt(cbPos)?.attrs.language === "javascript", "select change → 节点 language 属性更新为 javascript");
check(!!codeEl().querySelector("span.hljs-keyword"), "切换语言后高亮重建");
check(select!.value === "javascript", "NodeView.update 同步选择器值");

// 4) 无语言 → 纯文本（无高亮 span）
editor.view.dispatch(editor.view.state.tr.setNodeMarkup(cbPos, undefined, { language: null }));
check(!codeEl().querySelector("[class^='hljs-']"), "language=null 时无高亮 span");
check(codeEl().textContent.includes("// 注释"), "language=null 时文本完整");

// 5) 往返稳定（真实扩展集，含 CodeBlockHljs）
// 判据=serialize 不动点：getJSON 带 schema 默认 attrs（如 link.target），mm.parse 输出稀疏，
// JSON 深比不对称；文本才是唯一事实源（SPEC §5.1）
const json1 = editor.getJSON();
const mdOut = markdown.serialize(json1);
check(mdOut === markdown.serialize(markdown.parse(mdOut)), "serialize→parse→serialize 不动点（文本往返稳定）");
check(mdOut.includes("```javascript") || mdOut.includes("```ts") || mdOut.includes("```\n"), "序列化保留代码围栏");

// 6) 全要素样本：表格/任务列表/公式/图片的渲染 + 真实编辑器往返稳定
const FULL = `# 标题一 H1

普通段落，包含**粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://example.com)与![图片](assets/img.png)。

- [ ] 待办任务
- [x] 已完成任务

\`\`\`ts
const x: number = 42;
\`\`\`

| 列A | 列B |
| --- | --- |
| 1 | 2 |
| 中文 | **粗体字** |

行内公式 $E=mc^2$ 与块级：

$$
\\int_0^1 x^2 dx
$$
`;
const editor2 = new Editor({
  element: document.getElementById("editor2")!,
  extensions,
  content: markdown.parse(FULL),
});
const root2 = editor2.view.dom;
check(root2.querySelectorAll("table th").length === 2, "全要素：表格渲染 2 个表头单元格");
check(root2.querySelectorAll("table td").length === 4, "全要素：表格渲染 4 个数据单元格");
check(root2.querySelectorAll("ul[data-type='taskList'] input[type='checkbox']").length === 2, "全要素：任务列表 2 个复选框");
check(root2.querySelectorAll("ul[data-type='taskList'] li[data-checked='true']").length === 1, "全要素：恰 1 个已勾选（tiptap 3 状态在 li[data-checked]）");
check(!!root2.querySelector(".katex"), "全要素：KaTeX 行内公式已渲染");
check(!!root2.querySelector(".katex-display"), "全要素：KaTeX 块级公式以 displayMode 渲染");
check(!!root2.querySelector("img[src='assets/img.png']"), "全要素：图片按相对路径渲染");
const fj1 = editor2.getJSON();
const fmd = markdown.serialize(fj1);
check(fmd === markdown.serialize(markdown.parse(fmd)), "全要素：真实编辑器 serialize 不动点（文本往返稳定）");
editor2.destroy();

editor.destroy();
writeFileSync(new URL("./nodeview-report.txt", import.meta.url), report.join("\n"), "utf-8");
log(failures === 0 ? "== 结论：spike ③ PASS ==" : `== 结论：spike ③ FAIL（${failures} 项） ==`);
process.exit(failures === 0 ? 0 : 1);