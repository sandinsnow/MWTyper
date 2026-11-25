// M3 回归测试（任务 #7）
// 覆盖：D1 标签切换数据串位 / D3(E01) 自动保存跨标签竞态 / D2 渲染谓词 / a11y 静态断言
// 运行：node v24 直调 tsx（绕开失效的 pnpm）：
//   /c/Users/Admin/scoop/persist/nvm/nodejs/v24.20.0/node.exe node_modules/tsx/dist/cli.mjs spikes/regression.ts
//
// 约束：离线环境无 Vitest/RTL/axe-core，用 jsdom@31 + tsx 手写挂载测试（见 .workbuddy/review/incremental-prd.md §5b D 类）。
import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// ---------------------------------------------------------------- jsdom 环境
const dom = new JSDOM(
  "<!doctype html><html><body><div id='root'></div></body></html>",
  { pretendToBeVisual: true, url: "http://localhost/" }
);
const w = dom.window as unknown as Record<string, unknown>;
for (const k of [
  "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "Element", "Node", "DocumentFragment", "MutationObserver", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "DOMParser", "XMLSerializer", "Range",
  "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent",
  "CSS", "history", "location", "localStorage", "NodeFilter", "Text",
]) {
  if (w[k] !== undefined) (globalThis as Record<string, unknown>)[k] = w[k];
}
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未实现 Range.getClientRects（工程师已遇到），ProseMirror 坐标计算会抛 → 打桩
const emptyRectList = () => [] as unknown as DOMRectList;
const emptyRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
(w.Range as { prototype: Range }).prototype.getClientRects = emptyRectList;
(w.Range as { prototype: Range }).prototype.getBoundingClientRect = emptyRect;
(w.Element as { prototype: Element }).prototype.getClientRects = emptyRectList;
(w.Element as { prototype: Element }).prototype.getBoundingClientRect = emptyRect;

// matchMedia：theme.ts 在 useState 初始化器里同步调用，jsdom 无实现
const mediaListeners = new Map<string, Set<(e: { matches: boolean }) => void>>();
(w.matchMedia as unknown) = (query: string) => ({
  media: query,
  matches: false,
  onchange: null,
  addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => {
    if (!mediaListeners.has(query)) mediaListeners.set(query, new Set());
    mediaListeners.get(query)!.add(fn);
  },
  removeEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => {
    mediaListeners.get(query)?.delete(fn);
  },
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
// 原生弹窗：T02 已替换为 React 原语，这里仅防遗漏（记录调用不抛错）
const nativeDialogs: string[] = [];
for (const name of ["confirm", "alert", "prompt"] as const) {
  (w as Record<string, unknown>)[name] = (...args: unknown[]) => {
    nativeDialogs.push(`${name}:${String(args[0])}`);
    return name === "confirm" ? true : name === "prompt" ? "stub" : undefined;
  };
  (globalThis as Record<string, unknown>)[name] = (w as Record<string, unknown>)[name];
}

// ---------------------------------------------------------------- 依赖加载（globals 就绪后）
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const React = await import("react");
const act: (cb: () => void | Promise<void>) => Promise<void> =
  (React as unknown as { act?: (cb: () => void | Promise<void>) => Promise<void> }).act ??
  (await import("react-dom/test-utils")).act;
const { flushAllDirty } = await import("../src/App");
type Tab = import("../src/App").Tab;
const { findKey, computeMatches } = await import("../src/editor/find-replace");

const { Profiler, createElement } = React;

// ---------------------------------------------------------------- 测试框架
const results: { group: string; name: string; ok: boolean; note: string }[] = [];
let currentGroup = "";
const group = (g: string) => { currentGroup = g; };
const check = (ok: boolean, name: string, note = "") => {
  results.push({ group: currentGroup, name, ok, note });
  console.log(`${ok ? "OK " : "!! "}[${currentGroup}] ${name}${note ? " — " + note : ""}`);
  return ok;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const flush = async (ms = 0) => { await act(async () => { await sleep(ms); }); };
const fail = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

// ---------------------------------------------------------------- App 挂载辅助
interface Mounted {
  root: Root;
  container: HTMLElement;
  renders: number;
  unmount: () => void;
}

const MOCK_FS_KEY = "mwtyper-mock-fs";
const MOCK_SETTINGS_KEY = "mwtyper-mock-settings";

function seedMockFs(files: Record<string, string>) {
  localStorage.setItem(MOCK_FS_KEY, JSON.stringify({ files }));
}
function seedSettings(patch: Record<string, unknown>) {
  localStorage.setItem(MOCK_SETTINGS_KEY, JSON.stringify(patch));
}
function readMockFs(): Record<string, string> {
  const raw = localStorage.getItem(MOCK_FS_KEY);
  try {
    return raw ? (JSON.parse(raw).files ?? {}) : {};
  } catch {
    return {};
  }
}
function resetLocalStorage() {
  localStorage.clear();
  nativeDialogs.length = 0;
}

async function mountApp(): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let renders = 0;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        Profiler,
        { id: "app", onRender: () => { renders++; } },
        createElement((await import("../src/App")).default)
      )
    );
  });
  // 等待首屏异步效果（readSettings / listTree）落定
  await flush(30);
  return {
    root,
    container,
    get renders() { return renders; },
    unmount: () => {
      act(() => { root.unmount(); });
      container.remove();
    },
  };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));

function editor(): any {
  const el = q(".ProseMirror");
  return el ? (el as unknown as { editor?: any }).editor : null;
}
function editorText(): string {
  const ed = editor();
  return ed ? ed.state.doc.textContent : "";
}
function click(el: Element | null | undefined, label = "") {
  if (!el) throw new Error(`点击目标不存在：${label}`);
  (el as HTMLElement).click();
}
function tabNames(): string[] {
  return qa<HTMLElement>(".tabbar .tab").map((t) => (t.querySelector(".tab-name")?.textContent ?? "").trim());
}
function findTab(name: string): HTMLElement | undefined {
  return qa<HTMLElement>(".tabbar .tab").find((t) =>
    (t.querySelector(".tab-name")?.textContent ?? "").trim().startsWith(name)
  );
}
function tabIsDirty(name: string): boolean {
  return !!findTab(name)?.querySelector(".dirty-dot");
}
async function waitFor(pred: () => boolean, timeout = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred()) return true;
    await flush(10);
  }
  return pred();
}
async function openDemoFolder(): Promise<void> {
  await act(async () => { click(q('button[title^="打开文件夹"]'), "打开文件夹"); });
  const ok = await waitFor(() => qa(".tree-row").length > 0);
  if (!ok) throw new Error("文件树未渲染");
}
async function openTreeFile(name: string): Promise<void> {
  const row = qa<HTMLElement>(".tree-row").find((r) => (r.querySelector(".tree-name")?.textContent ?? "").trim() === name);
  if (!row) throw new Error(`文件树中找不到 ${name}`);
  await act(async () => { click(row, name); });
  await flush(30);
}
/** 依次打开若干文件，使其各自成为独立标签（当前激活的是最后一个）。 */
async function openFilesAsTabs(...names: string[]): Promise<void> {
  for (const n of names) await openTreeFile(n);
  const missing = names.filter((n) => !findTab(n));
  if (missing.length) throw new Error(`标签栏未出现：${missing.join(",")}`);
}
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new (w.Event as typeof Event)("input", { bubbles: true }));
}
function pressKey(key: string, opts: KeyboardEventInit = {}) {
  const ev = new (w.KeyboardEvent as typeof KeyboardEvent)("keydown", { key, bubbles: true, cancelable: true, ...opts });
  (w as unknown as Window).dispatchEvent(ev);
}

// =================================================================== A. D1
group("A/D1");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 }); // 排除 E01 干扰：autosave 关闭
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });

  const app = await mountApp();
  check(!!editor(), "D1-0 空 App 挂载成功（tiptap 实例已创建，@tauri-apps/api/window 顶层 import 无副作用）");
  check(nativeDialogs.length === 0, "D1-0b 挂载过程未触发原生弹窗", nativeDialogs.join("|"));

  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");
  check(editorText().includes("B"), "D1-1 A/B 两个标签已就绪（当前为 B）", editorText());
  check(tabNames().some((n) => n.startsWith("A.md")) && tabNames().some((n) => n.startsWith("B.md")),
    "D1-2 标签栏同时存在 A.md 与 B.md", tabNames().join(","));

  // 切回 A 并输入独特文本
  await act(async () => { click(findTab("A.md"), "A 标签"); });
  await flush(20);
  check(editorText().includes("A") && !editorText().includes("B"), "D1-3 切回 A，编辑器内容为 A", editorText());
  await act(async () => { editor().commands.insertContentAt(1, "UNIQUE_A"); });
  await flush(10);
  check(editorText().includes("UNIQUE_A"), "D1-4 A 中已输入 UNIQUE_A", editorText());
  check(tabIsDirty("A.md"), "D1-5 A 标签 dirty 点亮");

  // 切到 B
  await act(async () => { click(findTab("B.md"), "B 标签"); });
  await flush(20);
  check(!editorText().includes("UNIQUE_A"), "D1-6 切到 B 后 B 的内容不含 UNIQUE_A", editorText());

  // 切回 A
  await act(async () => { click(findTab("A.md"), "A 标签"); });
  await flush(20);
  check(editorText().includes("UNIQUE_A"), "D1-7 切回 A 后 A 的文本仍含 UNIQUE_A（核心判据）", editorText());
  check(tabIsDirty("A.md"), "D1-8 切回 A 后 dirty 态仍正确");

  // 再次切到 B，检查 B 未被写入 A 的内容（修复前 stash 串位会让 B 的 tab 持有 A 文本）
  await act(async () => { click(findTab("B.md"), "B 标签"); });
  await flush(20);
  check(!editorText().includes("UNIQUE_A"), "D1-9 二次切到 B，B 仍不含 UNIQUE_A（stash 未串位）", editorText());
  check(editorText().includes("B"), "D1-10 二次切到 B，B 内容为其自身", editorText());

  app.unmount();
}

// ---------------------------------------------------------------- D1 补充路径：newFile
group("A/D1-newFile");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await act(async () => { editor().commands.insertContentAt(1, "UNIQUE_A"); });
  await flush(10);
  await act(async () => { click(q('button[title^="新建"]'), "新建"); });
  await flush(20);
  check(!editorText().includes("UNIQUE_A"), "D1-10 newFile 后新文档为空（未串入 A 的编辑）", editorText());
  await act(async () => { click(findTab("A.md"), "A 标签"); });
  await flush(20);
  check(editorText().includes("UNIQUE_A"), "D1-11 newFile 后切回 A，A 文本仍含 UNIQUE_A", editorText());
  app.unmount();
}

// ---------------------------------------------------------------- D1 补充路径：openFile
group("A/D1-openFile");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/C.md": "# C\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await act(async () => { editor().commands.insertContentAt(1, "UNIQUE_A"); });
  await flush(10);
  await act(async () => { click(qa<HTMLElement>(".tree-row").find((r) => (r.querySelector(".tree-name")?.textContent ?? "").trim() === "C.md"), "C 文件"); });
  await flush(30);
  check(!editorText().includes("UNIQUE_A"), "D1-12 openFile 打开 C 后 C 内容不含 UNIQUE_A", editorText());
  await act(async () => { click(findTab("A.md"), "A 标签"); });
  await flush(20);
  check(editorText().includes("UNIQUE_A"), "D1-13 openFile 后切回 A，A 文本仍含 UNIQUE_A", editorText());
  app.unmount();
}

// =================================================================== B. D3 / E01
group("B/D3");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 100 }); // >0 的防抖自动保存
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();

  // clearTimeout spy（App 使用裸全局 clearTimeout）
  const realClear = globalThis.clearTimeout;
  let clearCalls = 0;
  (globalThis as Record<string, unknown>).clearTimeout = ((id: unknown) => {
    if (id !== null && id !== undefined) clearCalls++;
    return realClear(id as never);
  }) as typeof clearTimeout;

  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");
  await act(async () => { click(findTab("A.md"), "A 标签"); });
  await flush(20);
  await act(async () => { editor().commands.insertContentAt(1, "UNIQUE_A"); });
  await flush(5);
  check(tabIsDirty("A.md"), "D3-1 A 已变脏");

  // 切到干净 B（必须在 autosave_ms 内，模拟真实快速切换）
  const clearsBefore = clearCalls;
  await act(async () => { click(findTab("B.md"), "B 标签"); });
  await flush(5);
  check(clearCalls > clearsBefore, "D3-2 切标签时调用了 clearTimeout（定时器被清理）", `clearCalls=${clearCalls}`);
  check(tabIsDirty("A.md"), "D3-3 切走期间 A 的 dirty 态在 tab state 中保留");

  // 等待超过 autosave_ms：不应发生任何错写
  await flush(250);
  const fs1 = readMockFs();
  check(!String(fs1["/demo/B.md"] ?? "").includes("UNIQUE_A"), "D3-4 B 的文件未被错写 A 的内容", String(fs1["/demo/B.md"]));
  check(!String(fs1["/demo/A.md"] ?? "").includes("UNIQUE_A"), "D3-5 A 的定时保存被取消（切走后未误触发）", String(fs1["/demo/A.md"]));

  // 切回 A → loadBuffer 应重新调度 autosave
  await act(async () => { click(findTab("A.md"), "A 标签"); });
  await flush(250);
  const fs2 = readMockFs();
  check(String(fs2["/demo/A.md"] ?? "").includes("UNIQUE_A"), "D3-6 切回 A 后 autosave 落盘，A 文件含 UNIQUE_A", String(fs2["/demo/A.md"]));
  check(!String(fs2["/demo/B.md"] ?? "").includes("UNIQUE_A"), "D3-7 B 的文件始终未被错写", String(fs2["/demo/B.md"]));
  check(!tabIsDirty("A.md"), "D3-8 落盘后 A 的 dirty 态清除");

  (globalThis as Record<string, unknown>).clearTimeout = realClear;
  app.unmount();
}

// ---------------------------------------------------------------- D3(c)：flushAllDirty 纯函数
group("B/D3-flush");
{
  const calls: { path: string | null; text: string }[] = [];
  const tabs: Tab[] = [
    { id: 1, path: "/demo/A.md", name: "A.md", text: "SNAP_A", dirty: true },
    { id: 2, path: "/demo/B.md", name: "B.md", text: "SNAP_B", dirty: true },
    { id: 3, path: null, name: "未命名", text: "DRAFT", dirty: true },
    { id: 4, path: "/demo/C.md", name: "C.md", text: "CLEAN", dirty: false },
  ];
  await flushAllDirty(tabs, () => "LIVE_A", 1, async (tab, text) => {
    calls.push({ path: tab.path, text });
  });
  check(calls.length === 2, "D3c-1 仅 dirty && 有 path 的标签被 flush（2 个）", `calls=${calls.length}`);
  const a = calls.find((c) => c.path === "/demo/A.md");
  const b = calls.find((c) => c.path === "/demo/B.md");
  check(a?.text === "LIVE_A", "D3c-2 活动标签使用 currentText() 实时文本", `got=${a?.text}`);
  check(b?.text === "SNAP_B", "D3c-3 非活动标签使用 stash 快照", `got=${b?.text}`);
  check(!calls.some((c) => c.path === null), "D3c-4 无 path 的草稿被跳过");
  check(!calls.some((c) => c.path === "/demo/C.md"), "D3c-5 干净标签未被 flush");
  check(
    calls.filter((c) => c.path === "/demo/A.md").length === 1 && calls.filter((c) => c.path === "/demo/B.md").length === 1,
    "D3c-6 每个 dirty 标签恰好被落盘一次"
  );
}

// =================================================================== B2. 查找替换功能（非同义反复的独立断言）
group("B/find");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# 标题一\n\n段落 target 文本 target。\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(20);

  // 单元层：computeMatches 必须真的找到命中（现有 m1-editor spike 用它自身作参照，属同义反复，无法发现此问题）
  const doc0 = editor().state.doc;
  // 独立朴素参照：直接按 doc.textContent 统计出现次数，不调用被测函数，避免同义反复
  const naiveCount = (needle: string): number => {
    const hay = String(doc0.textContent ?? "").toLowerCase();
    return hay.split(needle.toLowerCase()).length - 1;
  };
  const unit = computeMatches(doc0, "target", false, false);
  check(
    unit.length === naiveCount("target"),
    "FIND-1 computeMatches 命中数与独立朴素参照一致",
    `got=${unit.length} ref=${naiveCount("target")}`
  );

  // 位置精确性：每个命中的区间文本必须恰好等于查询词（捕获 off-by-one 等"非空但错误"缺陷）
  const badRanges = unit.filter((m) => doc0.textBetween(m.from, m.to) !== "target");
  check(
    unit.length > 0 && badRanges.length === 0,
    "FIND-6 每个命中的区间文本精确等于 target（位置精确性）",
    `matches=${unit.length} bad=${badRanges.length} badRanges=${JSON.stringify(badRanges)}`
  );

  // 非空 + 绝对数量断言：防止"恒返回空集"这类整体失效被恒真的等价性断言掩盖
  check(unit.length === 2 && unit.length > 0, "FIND-7 computeMatches 命中数为 2 且非空", `got=${unit.length}`);

  // 装饰层：命中应产生 .find-match 高亮
  await act(async () => {
    editor().view.dispatch(editor().view.state.tr.setMeta(findKey, { query: "target", caseSensitive: false, wholeWord: false, current: 0 }));
  });
  await flush(20);
  const st = findKey.getState(editor().state) as any;
  check((st?.matches?.length ?? 0) === 2, "FIND-2 find meta 后插件状态含 2 个命中", `matches=${st?.matches?.length}`);
  check(qa(".find-match").length === 2, "FIND-3 命中产生 .find-match 高亮装饰", `count=${qa(".find-match").length}`);

  // 替换层：replaceAll 应真的改写文档
  await act(async () => {
    const { replaceAll } = await import("../src/editor/find-replace");
    replaceAll(editor(), "X");
  });
  await flush(20);
  check(!editor().state.doc.textContent.includes("target"), "FIND-4 全部替换后文档中不再有 target", editor().state.doc.textContent);
  check(editor().state.doc.textContent.includes("X"), "FIND-5 全部替换写入了替换文本", editor().state.doc.textContent);

  app.unmount();
}

// =================================================================== C. D2
group("C/D2");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 }); // 避免保存产生 toast 引发额外渲染
  seedMockFs({ "/demo/A.md": "# 标题一\n\n## 标题二\n\n正文 UNIQUE_A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(20);

  const base = app.renders;

  // (1) 纯 meta 事务 → 不应触发顶层渲染
  await act(async () => {
    editor().view.dispatch(editor().view.state.tr.setMeta("mwtyperFocusToggle", true));
  });
  await flush(10);
  const afterPureMeta = app.renders;
  check(afterPureMeta === base, "D2-1 纯 meta 事务（mwtyperFocusToggle）不触发 App 顶层渲染", `renders ${base} → ${afterPureMeta}`);

  // (2) selection 移动 → 应触发
  await act(async () => { editor().commands.setTextSelection(3); });
  await flush(10);
  const afterSel = app.renders;
  check(afterSel > afterPureMeta, "D2-2 选区移动仍触发 App 顶层渲染（大纲当前节高亮依赖）", `renders ${afterPureMeta} → ${afterSel}`);

  // (3) find meta → 应触发
  await act(async () => {
    editor().view.dispatch(editor().view.state.tr.setMeta(findKey, { query: "正文", caseSensitive: false, wholeWord: false, current: 0 }));
  });
  await flush(10);
  const afterFind = app.renders;
  check(afterFind > afterSel, "D2-3 find meta 仍触发 App 顶层渲染（x/y 计数依赖）", `renders ${afterSel} → ${afterFind}`);

  // (4) 打字 → 应触发
  await act(async () => { editor().commands.insertContentAt(1, "X"); });
  await flush(10);
  const afterType = app.renders;
  check(afterType > afterFind, "D2-4 打字（docChanged）仍触发 App 顶层渲染", `renders ${afterFind} → ${afterType}`);

  // (5) 大纲当前节高亮不冻结
  await act(async () => { click(qa<HTMLElement>(".sidebar-tabs button").find((b) => b.textContent === "大纲"), "大纲页签"); });
  await flush(20);
  const outlineItems = qa(".outline-item");
  check(outlineItems.length >= 2, "D2-5 大纲列出标题", `count=${outlineItems.length}`);
  // 光标移到第二个标题内
  const heading2Pos = (() => {
    let p = -1;
    editor().state.doc.descendants((node: any, pos: number) => {
      if (p < 0 && node.type.name === "heading" && node.attrs.level === 2) p = pos;
      return true;
    });
    return p;
  })();
  await act(async () => { editor().commands.setTextSelection(heading2Pos + 1); });
  await flush(20);
  const activeOutline = q(".outline-item.active");
  check(!!activeOutline && (activeOutline.textContent ?? "").includes("标题二"), "D2-6 大纲当前节高亮跟随选区刷新（未冻结）", activeOutline?.textContent ?? "(无)");

  // (6) 查找替换 x/y 计数不冻结
  await act(async () => {
    pressKey("f", { ctrlKey: true });
  });
  await flush(20);
  const findInput = q<HTMLInputElement>(".find-bar input");
  check(!!findInput, "D2-7 查找栏已打开");
  if (findInput) {
    await act(async () => { setInputValue(findInput, "正文"); });
    await flush(30);
    const count = q(".find-count")?.textContent ?? "";
    const st = findKey.getState(editor().state) as any;
    const docText = editor().state.doc.textContent;
    check(
      /1\/\d+/.test(count),
      "D2-8 FindReplaceBar 的 x/y 命中计数未冻结",
      `count=${count} inputValue=${JSON.stringify(findInput.value)} pluginQuery=${JSON.stringify(st?.query)} matches=${st?.matches?.length} docHasTarget=${docText.includes("正文")} docLen=${docText.length}`
    );
  }

  app.unmount();
}

// =================================================================== D. a11y 静态断言
group("D/a11y");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/子目录/B.md": "# B\n" });
  const app = await mountApp();

  // 浮层 role=dialog + aria-modal
  await act(async () => { click(q('button[title^="设置"]'), "设置"); });
  await flush(20);
  const dlg = q('[role="dialog"][aria-modal="true"]');
  check(!!dlg, "D-a11y-1 设置浮层有 role=dialog + aria-modal=true");

  // 命令面板
  await act(async () => { pressKey("p", { ctrlKey: true, shiftKey: true }); });
  await flush(20);
  const paletteDlg = q('[role="dialog"][aria-modal="true"]');
  check(!!paletteDlg, "D-a11y-2 命令面板浮层有 role=dialog + aria-modal=true");
  await act(async () => { pressKey("Escape"); });
  await flush(10);

  // 侧栏页签
  const tabBtns = qa<HTMLElement>('.sidebar-tabs button[role="tab"]');
  check(tabBtns.length === 4, "D-a11y-3 侧栏四个页签有 role=tab", `count=${tabBtns.length}`);
  check(tabBtns.filter((b) => b.hasAttribute("aria-selected")).length === 4, "D-a11y-4 侧栏页签均有 aria-selected");
  check(!!q('.sidebar-body[role="tabpanel"]'), "D-a11y-5 侧栏内容区有 role=tabpanel");

  // 文件树 treeitem
  await act(async () => { click(q('button[title^="打开文件夹"]'), "打开文件夹"); });
  await waitFor(() => qa(".tree-row").length > 0);
  const treeItems = qa<HTMLElement>('.tree-row[role="treeitem"]');
  check(treeItems.length > 0, "D-a11y-6 文件树行有 role=treeitem", `count=${treeItems.length}`);
  check(treeItems.every((t) => t.hasAttribute("tabindex")), "D-a11y-7 文件树行有 tabindex（键盘可达）");
  check(treeItems.some((t) => t.hasAttribute("aria-expanded")), "D-a11y-8 目录行有 aria-expanded");

  // 搜索面板 flag aria-pressed
  await act(async () => { click(qa<HTMLElement>(".sidebar-tabs button").find((b) => b.textContent === "搜索"), "搜索页签"); });
  await flush(20);
  const searchFlags = qa<HTMLElement>(".search-flags button");
  check(searchFlags.length === 3 && searchFlags.every((b) => b.hasAttribute("aria-pressed")), "D-a11y-9 搜索面板开关有 aria-pressed", `count=${searchFlags.length}`);

  // 查找栏 flag aria-pressed
  await act(async () => { pressKey("f", { ctrlKey: true }); });
  await flush(20);
  const findFlags = qa<HTMLElement>(".find-row button[aria-pressed]");
  check(findFlags.length >= 2, "D-a11y-10 查找栏开关有 aria-pressed", `count=${findFlags.length}`);
  await act(async () => { pressKey("Escape"); });
  await flush(10);

  app.unmount();
}

// ---------------------------------------------------------------- styles.css 文本正则
group("D/css");
{
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf-8");
  check(/:focus-visible/.test(css), "D-css-1 存在 :focus-visible 焦点环规则");
  check(/prefers-reduced-motion/.test(css), "D-css-2 存在 prefers-reduced-motion 媒体查询");
  check(/--accent-strong/.test(css), "D-css-3 存在 --accent-strong 对比度 token");
  check(/@media\s*\(max-width/.test(css), "D-css-4 存在响应式断点 @media (max-width)");
  check(/--diff-add/.test(css) && /--diff-del/.test(css), "D-css-5 diff 增删色已抽为变量");
}

// ---------------------------------------------------------------- 闸门自检（防止同义反复复发）
group("D/gate");
{
  // m1-editor spike 的 B2「查找等价」断言曾用被测函数 computeMatches 自身作参照，
  // 属同义反复：查找功能整体失效时两侧恒等，闸门仍报 PASS（实测变异注入 0/3 捕获）。
  // 这里做静态守卫：禁止该 spike 再把 computeMatches 当作期望值来源，并要求存在非空断言。
  const gateSrc = readFileSync(fileURLToPath(new URL("./m1-editor.ts", import.meta.url)), "utf-8");
  // 期望值不得由被测函数 computeMatches 派生。
  // 精确判定：只看「声明了 expected* 变量的赋值语句」是否来自 computeMatches。
  // 这样既覆盖 `const expectedMatches = matchSig(computeMatches(...))`，
  // 也覆盖 `const expected = computeMatches(...); check(matchSig(actual) === matchSig(expected))`；
  // 同时不误伤断言行里的「computeMatches 与独立参照互相印证」这类合法补充检查
  //（那种写法出现在 check(...) 内，不是 expected* 变量的赋值语句）。
  const expectedAssignLines = gateSrc
    .split(/\r?\n/)
    .filter((ln) => /^\s*(const|let|var)\s+\w*expected\w*\b/i.test(ln));
  const selfRef = expectedAssignLines.some((ln) => /computeMatches/.test(ln));
  check(
    !selfRef,
    "D-gate-1 m1-editor 的 B2 期望值不再用被测函数 computeMatches 自参照",
    selfRef ? `自参照行: ${expectedAssignLines.find((l) => /computeMatches/.test(l))?.trim()}` : ""
  );
  // 非空断言：兼容多种合法写法（>0 / !==0 / >=1 / truthy），避免过度绑定实现细节。
  // 若闸门被迁移到别的 spike 文件，则一并扫描 spikes/ 下所有 .ts（排除本文件自身）。
  const nonEmptyPatterns = [
    /matches\.length\s*>\s*0/i,
    /matches\.length\s*!==\s*0/i,
    /matches\.length\s*>=\s*1/i,
    /matches\.length\s*\?\s*true/i,
    /if\s*\(\s*\w*\.?matches\.length\s*\)/i,
  ];
  const spikeDir = fileURLToPath(new URL(".", import.meta.url));
  const gateFiles = ["m1-editor.ts"];
  if (!/B2\s*查找/.test(gateSrc)) {
    // 闸门已迁出 m1-editor.ts：扫描 spikes/ 下全部 .ts（排除 regression.ts 自身）
    for (const f of readdirSync(spikeDir)) {
      if (f.endsWith(".ts") && f !== "regression.ts" && !gateFiles.includes(f)) gateFiles.push(f);
    }
  }
  const nonEmptyHit = gateFiles.some((f) => {
    const text = readFileSync(join(spikeDir, f), "utf-8");
    return nonEmptyPatterns.some((re) => re.test(text));
  });
  check(nonEmptyHit, "D-gate-2 B2 查找闸门含「命中数非空」检查", `扫描文件=${gateFiles.join(",")}`);

  // 闸门源码集合（供 D-gate-5 复用）：若闸门迁出 m1-editor.ts，则并入 spikes/ 下其它 .ts
  const gateSources = gateFiles.map((f) => ({
    f,
    src: readFileSync(join(spikeDir, f), "utf-8"),
  }));

  // 源码侧守卫：descendants 回调中，非文本节点必须 return true（继续下降），
  // 否则 ProseMirror 会跳过整个子树，文本节点永不被访问（E01 根因）。
  const frSrc = readFileSync(fileURLToPath(new URL("../src/editor/find-replace.ts", import.meta.url)), "utf-8");
  const badGuard = /if\s*\(\s*!node\.isText\s*\|\|\s*!node\.text\s*\)\s*return\s+false\s*;/.test(frSrc);
  check(!badGuard, "D-gate-3 find-replace 的 descendants 守卫不返回 false（E01 根因已修）");

  // 其余 descendants 调用点必须使用「继续下降」语义，避免同类误用复发。
  // 注意：语义判定不能只看「回调里有没有 return false」—— code-block.ts 的
  // `if (node.type.name !== "codeBlock") return true; ... return false;` 是**正确**的
  // （命中 codeBlock 后不再下降进它的子节点）。真正的危险模式是「非匹配守卫返回 false」。
  // 故此处检查两种确凿的错误形态：
  //   形态1: if (!node.isText ...) return false;            —— E01 根因
  //   形态2: if (node.type.name !== "X") return false;      —— 取反守卫误返回 false
  const guardFiles = [
    "../src/App.tsx",
    "../src/sidebar/Outline.tsx",
    "../src/editor/code-block.ts",
  ];
  const offenders: string[] = [];
  for (const rel of guardFiles) {
    const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");
    const bad1 = /if\s*\(\s*!node\.isText[\s\S]{0,40}?\)\s*return\s+false\s*;/.test(text);
    const bad2 = /node\.type\.name\s*!==\s*["'][^"']+["']\s*\)\s*return\s+false\s*;/.test(text);
    if (bad1 || bad2) offenders.push(rel);
  }
  check(
    offenders.length === 0,
    "D-gate-4 其余 descendants 调用点均未误用 return false（find-replace 由 D-gate-3 覆盖）",
    `offenders=${offenders.join(",")}`
  );

  // D-gate-5：闸门读取装饰 class 的方式必须真的取到 class。
  //
  // 背景（工程师在 T03 重写闸门时发现，我方已独立复现确认）：
  //   ProseMirror 的 `Decoration.inline(from, to, attrs, spec)` —— 第 3 参是 attrs、第 4 参才是 spec；
  //   而 `Decoration.spec` getter 返回的是 `type.spec`（InlineType 里 `this.attrs = attrs; this.spec = spec || noSpec`）。
  //   `src/editor/code-block.ts` 用的是 `Decoration.inline(pos, pos, { class: cls })`
  //   → class 落在 `type.attrs.class`，spec 为空。
  //   若闸门读 `d.spec.class`，结果恒为 undefined → 两侧同时为空 → 恒等 → **假通过**。
  // 实测：旧读法得 `28-33:|41-42:|`（class 全空），新读法得 `28-33:hljs-keyword|41-42:hljs-number|...`。
  // 用 hljsclass 变异（把 code-block 产出的 class 篡改成常量）实测：
  //   历史闸门（两侧同用 d.spec.class）→ 两侧相等 → **PASS（假通过）**
  //   改造后闸门（独立参照 + attrs.class）→ FAIL ✔
  // 故此处静态守卫：闸门不得再读 d.spec.class 取 class。
  // 判定前必须剥离注释：工程师在闸门里写了说明性注释（"旧闸门读 d.spec.class 恒为 undefined"），
  // 注释中出现该字符串是合理的，只有**代码**中出现才是缺陷。
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const specClassRead = gateSources.some((g) => /\.spec\s*\??\.\s*class/.test(stripComments(g.src)));
  check(!specClassRead, "D-gate-5 闸门不读 d.spec.class 取 class（改读 type.attrs.class）");

  // D-gate-6：code-block 产出装饰时，class 必须放在 attrs 位（第 3 参），而非 spec 位（第 4 参）。
  // 若误放到 spec 位，则 d.type.attrs.class 为空，D-gate-5 的守卫也救不了。
  const cbSrc = readFileSync(fileURLToPath(new URL("../src/editor/code-block.ts", import.meta.url)), "utf-8");
  const clsInSpec = /Decoration\.inline\([^)]*,\s*\{\s*class\s*:/g;
  const inlineCalls = cbSrc.match(/Decoration\.inline\([^\n]*\)/g) ?? [];
  const badInline = inlineCalls.filter((c) => {
    // 第 3 参不是 { class: ... } 形态的 attrs，则 class 可能落在 spec 位
    const m = /Decoration\.inline\((.*)\)/.exec(c);
    if (!m) return false;
    const args = m[1];
    // 粗判：若 class 出现在第 4 段（spec 位）则危险
    const parts = args.split(",");
    return parts.length >= 4 && /class\s*:/.test(parts.slice(3).join(","));
  });
  check(badInline.length === 0, "D-gate-6 code-block 的 Decoration.inline 把 class 放在 attrs 位", `bad=${badInline.length}`);
}

// =================================================================== 汇总
const total = results.length;
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log("\n== 回归测试汇总 ==");
console.log(`总计 ${total} 项，通过 ${passed}，失败 ${failed.length}`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(`  !! [${f.group}] ${f.name}${f.note ? " — " + f.note : ""}`);
}
writeFileSync(
  fileURLToPath(new URL("./regression-report.txt", import.meta.url)),
  results.map((r) => `${r.ok ? "OK " : "!! "}[${r.group}] ${r.name}${r.note ? " — " + r.note : ""}`).join("\n"),
  "utf-8"
);
console.log(failed.length === 0 ? "== 结论：回归测试全部 PASS ==" : `== 结论：回归测试 ${failed.length} 项 FAIL ==`);
process.exit(failed.length === 0 ? 0 : 1);
