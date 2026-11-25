import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
for (const k of ["document","HTMLElement","Element","Node","DocumentFragment","MutationObserver","getComputedStyle","requestAnimationFrame","cancelAnimationFrame","DOMParser","Range","Event","KeyboardEvent","MouseEvent","InputEvent","FocusEvent","CSS","history","location","localStorage","Text"]) {
  const v = (dom.window as unknown as Record<string, unknown>)[k]; if (v !== undefined) (globalThis as Record<string, unknown>)[k] = v;
}
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { Editor } = await import("@tiptap/core");
const { extensions, markdown } = await import("../../src/editor/extensions");
const { computeMatches } = await import("../../src/editor/find-replace");
const ed = new Editor({ element: document.body, extensions: [...extensions], content: markdown.parse("hello world\n这是中文测试\nhellox\n第 1 节\n") });
const t = (q: string, ww: boolean, note = "") => {
  const n = computeMatches(ed.state.doc, q, false, ww).length;
  console.log(`  ${ww ? "全词" : "普通"} "${q}" → ${n} 处 ${note}`);
  return n;
};
console.log("=== 词边界语义验证 ===");
t("hello", false); t("hello", true, "（应 1：hellox 中的不算）");
t("hellox", true, "（应 1）");
t("中文", false); t("中文", true, "（应 1：汉字不算词字符）");
t("1", true, "（应 1）");
