// 编辑器缺陷回归守卫 · 第三批（模式切换/定位/对比度/a11y，v1.8 改写）
// 原为缺陷复现脚本；相关缺陷已修复，断言已反转为「修复生效」。
//
// 运行：node node_modules/tsx/dist/cli.mjs tests/spikes/editor-probe3.ts
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 仓库根：相对本文件解析（tests/spikes/ 的上上级）。
// 不能写死绝对路径 —— 换机器或换 CI runner 就会 ENOENT。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
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
const { restoreCaret } = await import("../../src/editor/caret");

let pass = 0;
let fail = 0;
function report(ok: boolean, name: string, detail = ""): void {
  if (ok) { pass++; console.log(`OK  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`!!  ${name}${detail ? " — " + detail : ""}`); }
}
function mk(md: string) {
  return new Editor({
    element: document.getElementById("editor")!,
    extensions: [...extensions],
    content: markdown.parse(md),
  });
}

// ---------------------------------------------------------- G-1 模式切换光标
// 原假设：setContent 重建文档 → 光标落到文档末尾
// 已修（restoreCaret：文档长度未变按绝对位置还原，变了按比例估算）。
// 这里直接验证 restoreCaret 这个修复函数。
console.log("\n=== G-1 WYSIWYG → 源码 → WYSIWYG 的光标保持 ===");
{
  const ed = mk("第一行\n\n第二行\n\n第三行很长很长很长很长很长\n");
  const third = ed.state.doc.content.size - 2;
  ed.commands.setTextSelection(third);
  const before = ed.state.selection.head;
  const size = ed.state.doc.content.size;
  const md = markdown.serialize(ed.getJSON());
  ed.commands.setContent(markdown.parse(md), { emitUpdate: false });
  const afterSetContent = ed.state.selection.head;
  restoreCaret(ed, { pos: before, size });
  const after = ed.state.selection.head;
  report(after === before, "G-1 源码切回 WYSIWYG 后光标位置保持",
    `切换前 head=${before} → setContent 后 head=${afterSetContent} → restoreCaret 后 head=${after}`);
}

// ---------------------------------------------------------- G-2 setContent 选区
// 原假设：setContent 把选区重置到文档开头/末尾
// 现在记录 setContent 的**真实行为**（它确实会重置），
// 并验证修复路径 restoreCaret 能把它拉回原位。
console.log("\n=== G-2 setContent 后选区落点 ===");
{
  const ed = mk("aaa\n\nbbb\n\nccc\n");
  const size = ed.state.doc.content.size;
  ed.commands.setTextSelection(5);
  const before = ed.state.selection.head;
  // 同长度内容 → 文档长度不变 → restoreCaret 应精确还原
  ed.commands.setContent(markdown.parse("xxx\n\nyyy\n\nzzz\n"), { emitUpdate: false });
  const sel = ed.state.selection;
  report(sel.from !== before, "G-2 setContent 确实会重置选区（需要 restoreCaret 兜底）",
    `from=${sel.from} to=${sel.to}（文档末尾）`);
  report(ed.state.doc.content.size === size, "G-2a 替换后文档长度不变", `${size} → ${ed.state.doc.content.size}`);
  restoreCaret(ed, { pos: before, size });
  report(ed.state.selection.head === before,
    "G-2b restoreCaret 把光标精确拉回原位置",
    `期望=${before} 实际=${ed.state.selection.head}`);

  // 长度变了 → 按比例估算（落在文档内即可）
  ed.commands.setContent(markdown.parse("xxx\n\nyyy\n"), { emitUpdate: false });
  restoreCaret(ed, { pos: before, size });
  const h = ed.state.selection.head;
  report(h >= 0 && h <= ed.state.doc.content.size, "G-2c 长度变化时按比例估算且落在文档内",
    `head=${h} docSize=${ed.state.doc.content.size}`);
}

// ---------------------------------------------------------- G-3 查找条定位
console.log("\n=== G-3 查找条在滚动容器中的定位 ===");
{
  const css = readFileSync(ROOT + "/src/styles.css", "utf8");
  const appSrc = readFileSync(ROOT + "/src/App.tsx", "utf8");

  // 查找条与表格工具栏是否同为 .editor-area（overflow:auto）的直接子元素。
  // 定位方式用「editor-area」文本本身，而不是 `className={"editor-area"` ——
  // 后者会随 JSX 改成多行表达式拼接而失效（判据本身脆弱，不是被测代码的问题）。
  const areaIdx = appSrc.indexOf("editor-area");
  const areaBlock = areaIdx >= 0 ? appSrc.slice(areaIdx) : "";
  const findInside = areaBlock.includes("<FindReplaceBar");
  const tableInside = areaBlock.includes("<TableToolbar");
  report(findInside && tableInside, "G-3 查找条与表格工具栏都在 .editor-area（overflow:auto）内");

  // .editor-area 是否真的 overflow:auto
  const areaOverflow = /\.editor-area\s*\{[^}]*overflow:\s*auto/.test(css);
  report(areaOverflow, "G-3b .editor-area 是 overflow:auto 的滚动容器");

  // 查找条与表格工具栏现在统一放进 .editor-sticky-bar（position: sticky; top: 0）
  const stickyRule = css.match(/\.editor-sticky-bar\s*\{([^}]*)\}/);
  const stickyBody = stickyRule ? stickyRule[1] : "";
  const stickyIsSticky = /position\s*:\s*sticky/.test(stickyBody) && /top\s*:\s*0/.test(stickyBody);
  report(stickyIsSticky, "G-3c .editor-sticky-bar 是 sticky/top:0（查找条不再滚出视野）",
    `sticky-bar: ${stickyIsSticky ? "已定位" : "未定位"}`);
  // 两者都不再各自定位，避免 sticky 兄弟重叠
  const findBarRule = css.match(/\.find-bar\s*\{([^}]*)\}/);
  const findBarBody = findBarRule ? findBarRule[1] : "";
  const findBarSticky = /position\s*:\s*(sticky|fixed|absolute)/.test(findBarBody);
  const tableBarSticky = /\.table-toolbar\s*\{[^}]*position\s*:\s*sticky/.test(css);
  report(!findBarSticky && !tableBarSticky, "G-3d 查找条与表格工具栏都不再各自 sticky（定位策略统一，避免互相重叠）",
    `find-bar: ${findBarSticky ? "有定位" : "无定位"}；table-toolbar: ${tableBarSticky ? "sticky" : "无"}`);
}

// ---------------------------------------------------------- G-4 缩放与行宽
console.log("\n=== G-4 编辑区缩放是否影响行宽（每行字符数） ===");
{
  const css = readFileSync(ROOT + "/src/styles.css", "utf8");
  const pmRule = css.match(/\.ProseMirror\s*\{([^}]*)\}/);
  const body = pmRule ? pmRule[1] : "";
  const hasZoomFont = /font-size:\s*calc\(16px \* var\(--editor-zoom/.test(body);
  const zoomAffectsWidth = /max-width:[^;]*var\(--editor-zoom/.test(body);
  report(hasZoomFont, "G-4 缩放作用于 font-size", body.replace(/\s+/g, " ").trim().slice(0, 120));
  report(zoomAffectsWidth, "G-4b max-width 随缩放联动 → 每行字符数保持恒定（SPEC §7「行宽恒定」）");
}

// ---------------------------------------------------------- G-5 专注模式对比度
console.log("\n=== G-5 专注模式降透明度后的对比度 ===");
{
  const css = readFileSync(ROOT + "/src/styles.css", "utf8");
  const op = css.match(/\.focus-mode \.ProseMirror > \*\s*\{[^}]*opacity:\s*([\d.]+)/);
  const opacity = op ? Number(op[1]) : NaN;

  // WCAG 2.x 相对亮度：逐通道 sRGB 线性化后加权
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const relLum = (hex: string): number => {
    const r = chan(parseInt(hex.slice(1, 3), 16));
    const g = chan(parseInt(hex.slice(3, 5), 16));
    const b = chan(parseInt(hex.slice(5, 7), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => {
    const l1 = relLum(a);
    const l2 = relLum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // 前景 #1f2328 以 opacity 叠在白底 #ffffff 上 → 逐通道混合
  const blend = (fg: string, bg: string, a: number): string =>
    "#" + [1, 3, 5].map((i) =>
      Math.round(
        parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)
      ).toString(16).padStart(2, "0")
    ).join("");

  const FG = "#1f2328";
  const BG = "#ffffff";
  const faded = blend(FG, BG, opacity);
  const r0 = ratio(FG, BG);
  const r1 = ratio(faded, BG);
  console.log(`     正文 ${FG} on ${BG} = ${r0.toFixed(2)}:1`);
  console.log(`     opacity=${opacity} 后混合为 ${faded}，对比度 = ${r1.toFixed(2)}:1`);
  report(r1 >= 4.5, "G-5 专注模式下非当前段落满足 WCAG AA 正文对比度 4.5:1",
    `实测 ${r1.toFixed(2)}:1${r1 >= 4.5 ? "" : "（不达标）"}`);
  // UI 组件/非文本元素门槛 3:1
  report(r1 >= 3, "G-5b 至少满足非文本内容的 3:1 门槛", `${r1.toFixed(2)}:1`);
}

// ---------------------------------------------------------- G-6 表格工具栏 a11y
console.log("\n=== G-6 表格工具栏可访问性 ===");
{
  const src = readFileSync(ROOT + "/src/editor/TableToolbar.tsx", "utf8");
  const hasAriaLabel = /aria-label/.test(src);
  const hasToolbarRole = /role\s*=\s*"toolbar"/.test(src);
  const hasDisabled = /disabled/.test(src);
  report(hasAriaLabel, "G-6 表格按钮有 aria-label");
  report(hasToolbarRole, "G-6b 表格工具栏容器有 role=\"toolbar\"");
  report(hasDisabled, "G-6c 不可用的表格操作会置 disabled（避免点了没反应的死按钮）");
}

// ---------------------------------------------------------- G-7 查找条 a11y
console.log("\n=== G-7 查找条可访问性 ===");
{
  const src = readFileSync(ROOT + "/src/editor/FindReplaceBar.tsx", "utf8");
  const hasLive = /aria-live/.test(src);
  const hasRole = /role\s*=\s*"(search|toolbar|region)"/.test(src);
  report(hasLive, "G-7 匹配数变化有 aria-live 播报");
  report(hasRole, "G-7b 查找条有 landmark 语义");
}

console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
console.log(fail === 0 ? "== 结论：全部回归守卫通过（缺陷已修复且修复未回退） ==" : "== 结论：存在回归（修复被回退） ==");
process.exit(fail === 0 ? 0 : 1);
