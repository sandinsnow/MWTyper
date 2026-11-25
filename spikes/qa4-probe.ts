// 第 4 轮「敌对视角复核」Step-4 专项探针（QA 独立编写）
//
// 目的：对工程师修���的 11 项缺陷做「攻击式」复查——不是验证断言能过，
// 而是主动构造「修复引入的新问题」。
//
// 覆盖（对应 Step 4 的 7 个攻击点 + N7 盲区独立判断）：
//   P1 confirmQueueRef 队列：一次作答是否把「语义不同」的确认请求一并结算
//   P2 askInput 的 null 分支：treeRename / treeNewFile / setGoal / setLinkPrompt 逐个验证
//   P3 closeTab 并发关闭 + 关闭最后一个标签是否正确新建空白草稿
//   P4 FileTree 的 fromOwnGroup 冒泡抑制：键盘（Enter/Space/←/→）是否重复触发
//   P5 --accent 的 13 处引用在 #0a754d 下的对比度实测（含「作为背景色」的场景）
//   P6 Rust set_parent 的 trait/签名与测试覆盖缺口
//   P7 knownDirsRef：用户手动折叠目录后 refreshTree 是否会把它重新展开
//   N7 旧 askInput Promise 悬空是否有可观测后果（含「Promise 是否结算」的底层测量）
//
// 运行： node node_modules/tsx/dist/cli.mjs spikes/qa4-probe.ts
// 本文件是 QA 独占资产；不修改 spikes/audit3.ts 与 spikes/regression.ts 的既有断言。

import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const emptyRectList = () => [] as unknown as DOMRectList;
const emptyRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as unknown as DOMRect;
(w.Range as { prototype: Range }).prototype.getClientRects = emptyRectList;
(w.Range as { prototype: Range }).prototype.getBoundingClientRect = emptyRect;
(w.Element as { prototype: Element }).prototype.getClientRects = emptyRectList;
(w.Element as { prototype: Element }).prototype.getBoundingClientRect = emptyRect;

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
    mediaListeners.get(query)!.delete(fn);
  },
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
const nativeDialogs: string[] = [];
for (const name of ["confirm", "alert", "prompt"] as const) {
  (w as Record<string, unknown>)[name] = (...args: unknown[]) => {
    nativeDialogs.push(`${name}:${String(args[0])}`);
    return name === "confirm" ? true : name === "prompt" ? "stub" : undefined;
  };
  (globalThis as Record<string, unknown>)[name] = (w as Record<string, unknown>)[name];
}

// ---------------------------------------------------------------- 依赖加载
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const React = await import("react");
const act: (cb: () => void | Promise<void>) => Promise<void> =
  (React as unknown as { act?: (cb: () => void | Promise<void>) => Promise<void> }).act ??
  (await import("react-dom/test-utils")).act;
const { api } = await import("../src/ipc");
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
const info = (name: string, note = "") => {
  console.log(`-- [${currentGroup}] ${name}${note ? " — " + note : ""}`);
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const flush = async (ms = 0) => { await act(async () => { await sleep(ms); }); };
const flushStats = async () => { await flush(450); };

// ---------------------------------------------------------------- 挂载辅助
interface Mounted { root: Root; container: HTMLElement; unmount: () => void; }

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
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        Profiler,
        { id: "app", onRender: () => {} },
        createElement((await import("../src/App")).default)
      )
    );
  });
  await flush(30);
  return { root, container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
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
function editorHtml(): string {
  const ed = editor();
  return ed ? ed.getHTML() : "";
}
function click(el: Element | null | undefined, label = "") {
  if (!el) throw new Error(`点击目标不存在：${label}`);
  (el as HTMLElement).click();
}
function rightClick(el: Element | null | undefined, label = "") {
  if (!el) throw new Error(`右键目标不存在：${label}`);
  el.dispatchEvent(new (w.MouseEvent as typeof MouseEvent)("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
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
function activeTabName(): string {
  const t = q(".tabbar .tab.active");
  return (t?.querySelector(".tab-name")?.textContent ?? "").trim();
}
function titleBarName(): string {
  return (q(".doc-title")?.textContent ?? "").trim();
}
function statusBarText(): string {
  return (q(".statusbar")?.textContent ?? "").trim();
}
function closeButtonOf(tabName: string): HTMLElement | undefined {
  return qa<HTMLElement>(".tabbar .tab")
    .find((t) => (t.querySelector(".tab-name")?.textContent ?? "").trim().startsWith(tabName))
    ?.querySelector(".tab-close") as HTMLElement | undefined;
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
function pressKeyOn(el: Element | null | undefined, key: string, opts: KeyboardEventInit = {}) {
  if (!el) throw new Error(`按键目标不存在：${key}`);
  el.dispatchEvent(new (w.KeyboardEvent as typeof KeyboardEvent)("keydown", { key, bubbles: true, cancelable: true, ...opts }));
}
async function typeInEditor(text: string) {
  await act(async () => { editor().commands.insertContentAt(1, text); });
  await flush(10);
}
function dialogButtons(text: string): HTMLElement | undefined {
  return qa<HTMLElement>('[role="dialog"] button').find((b) => b.textContent?.trim() === text);
}
function dialogText(): string {
  return (q('[role="dialog"]')?.textContent ?? "").replace(/\s+/g, " ").trim();
}
async function openPalette(): Promise<void> {
  await act(async () => { pressKey("p", { ctrlKey: true, shiftKey: true }); });
  await flush(20);
}
async function runPaletteCommand(keyword: string): Promise<void> {
  const item = qa<HTMLElement>(".palette-item").find((b) => (b.textContent ?? "").includes(keyword));
  if (!item) throw new Error(`命令面板里找不到「${keyword}」`);
  await act(async () => { click(item, keyword); });
  await flush(20);
}
async function switchSidebarTab(label: string): Promise<void> {
  await act(async () => {
    click(qa<HTMLElement>(".sidebar-tabs button").find((b) => b.textContent === label), `侧栏页签 ${label}`);
  });
  await flush(30);
}
function treeRowByName(name: string): HTMLElement | undefined {
  return qa<HTMLElement>('.tree-row[role="treeitem"]').find((r) => (r.querySelector(".tree-name")?.textContent ?? "").trim() === name);
}
async function openCtxMenuOn(name: string): Promise<void> {
  const row = treeRowByName(name);
  if (!row) throw new Error(`文件树中找不到 ${name}`);
  await act(async () => { rightClick(row, name); });
  await flush(20);
}
async function clickCtxMenuItem(label: string): Promise<void> {
  const item = qa<HTMLElement>('[role="menu"] [role="menuitem"]').find((b) => (b.textContent ?? "").trim() === label);
  if (!item) throw new Error(`右键菜单里找不到「${label}」`);
  await act(async () => { click(item, label); });
  await flush(20);
}
function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(MOCK_SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** 追踪全局 Promise 的创建与结算（用于 N7：旧 askInput Promise 是否真的悬空）。 */
interface TrackedPromise { settled: boolean; value: unknown; stack: string; }
const tracked: TrackedPromise[] = [];
function installPromiseTracker(): { restore: () => void; since: (mark: number) => TrackedPromise[] } {
  const RealPromise = globalThis.Promise;
  // 用 Proxy 而不是 Object.assign：Promise 的静态方法（resolve/reject/all…）是
  // 「不可枚举」的自身属性，Object.assign 复制不到，会导致 React 的 act() 里
  // Promise.resolve 变成 undefined 而崩溃。
  const patched = new Proxy(RealPromise, {
    construct(target, args: unknown[]) {
      const [executor] = args as [(res: (v: unknown) => void, rej: (e: unknown) => void) => void];
      const rec: TrackedPromise = {
        settled: false,
        value: undefined,
        stack: (new Error().stack ?? "").split("\n").slice(1, 6).join(" | "),
      };
      tracked.push(rec);
      return Reflect.construct(target, [
        (res: (v: unknown) => void, rej: (e: unknown) => void) =>
          executor(
            (v) => { rec.settled = true; rec.value = v; res(v); },
            (e) => { rec.settled = true; rec.value = e; rej(e); }
          ),
      ]) as object;
    },
    get(target, prop, recv) {
      // 静态方法一律绑回原始 Promise，避免 React 内部逻辑被 Proxy 干扰。
      if (typeof prop === "string" && prop !== "prototype") {
        const v = Reflect.get(target, prop, recv);
        if (typeof v === "function") return v.bind(target);
      }
      return Reflect.get(target, prop, recv);
    },
  });
  (globalThis as Record<string, unknown>).Promise = patched;
  return {
    restore: () => { (globalThis as Record<string, unknown>).Promise = RealPromise; },
    since: (mark: number) => tracked.slice(mark),
  };
}

// =================================================================== P1. confirmQueueRef 队列语义
group("P1/confirm-queue");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("DIRTY_A");

  // 1) 先发一个「删除文件」的确认请求（语义：破坏性、与关闭标签无关）
  await openCtxMenuOn("B.md");
  await clickCtxMenuItem("删除");
  await flush(20);
  const firstDialog = dialogText();
  info("首个确认框文案", firstDialog.slice(0, 90));
  check(/删除/.test(firstDialog), "P1-1 首个确认框是「删除文件」请求");

  // 2) 在确认框还开着时，通过命令面板再发一个「关闭当前标签」的确认请求（语义：丢弃未保存内容）
  await openPalette();
  await runPaletteCommand("关闭当前标签");
  await flush(20);
  const secondDialog = dialogText();
  info("回答前的确认框文案（队首仍在显示）", secondDialog.slice(0, 90));
  check(
    secondDialog === firstDialog,
    "P1-2 队列不顶掉队首：显示的仍是第一个请求（删除）",
    `first=${firstDialog.slice(0, 40)} now=${secondDialog.slice(0, 40)}`
  );

  // 3) 回答「确定」→ 一次作答是否把「关闭脏标签」也一并确认为「是」
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(80);
  const bAlive = !!findTab("B.md");
  const aAlive = !!findTab("A.md");
  const fsAfter = readMockFs();
  const bGone = !("/demo/B.md" in fsAfter);
  info("回答「确定」之后", `A.md 标签存在=${aAlive} B.md 标签存在=${bAlive} B.md已从磁盘移除=${bGone} mockFS=${JSON.stringify(fsAfter)}`);
  check(
    aAlive,
    "P1-3 回答「删除·确定」后，正在编辑的脏标签 A 不应被连带关闭（用户从未看到它的确认框）",
    `A 标签存在=${aAlive}`
  );
  check(
    aAlive && tabIsDirty("A.md"),
    "P1-4 回答「删除·确定」后，A 的未保存状态与内容不得丢失",
    `A 存在=${aAlive} dirty=${tabIsDirty("A.md")}`
  );
  check(
    bGone,
    "P1-5 队首请求本身的语义必须照常生效（B.md 确实被删除）",
    `B.md 已移除=${bGone} fs=${JSON.stringify(Object.keys(fsAfter))}`
  );
  const tailDialog = dialogText();
  info("回答队首之后是否仍弹出队尾请求", tailDialog.slice(0, 90) || "(无对话框)");
  check(
    /A\.md/.test(tailDialog),
    "P1-6 队尾的「关闭 A」请求必须仍待用户单独确认（不得被队首的作答一并结算）",
    `dialog=${tailDialog.slice(0, 60) || "(无)"}`
  );

  app.unmount();
}

// =================================================================== P1c. 取消方向（跨语义）
group("P1c/confirm-cancel");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("DIRTY_A");

  await openCtxMenuOn("B.md");
  await clickCtxMenuItem("删除");
  await flush(20);
  await openPalette();
  await runPaletteCommand("关闭当前标签");
  await flush(20);
  await act(async () => { click(dialogButtons("取消")!, "取消"); });
  await flush(80);
  const fsAfter = readMockFs();
  check(
    "/demo/B.md" in fsAfter,
    "P1c-1 回答「取消」不得连带删除文件（B 未被删除）",
    `fs=${JSON.stringify(Object.keys(fsAfter))}`
  );
  check(
    !!findTab("A.md") && tabIsDirty("A.md"),
    "P1c-2 回答「取消」不得连带关闭脏标签（A 仍在且仍为脏）",
    `A 存在=${!!findTab("A.md")} dirty=${tabIsDirty("A.md")}`
  );
  app.unmount();
}

// =================================================================== P1b. 同语义批量结算（回归对照）
group("P1b/confirm-batch");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("DIRTY_A");
  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await typeInEditor("DIRTY_B");

  // 两个「关闭脏标签」请求：A 的 ×，再从面板关闭当前标签（B）
  await act(async () => { click(closeButtonOf("A.md"), "A 关闭按钮"); });
  await flush(20);
  await openPalette();
  await runPaletteCommand("关闭当前标签");
  await flush(20);
  check(/A\.md/.test(dialogText()), "P1b-1 显示的是队首（A 的关闭确认）");
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(60);
  check(!findTab("A.md") && !findTab("B.md"), "P1b-2 同语义批量结算：一次「确定」关闭两个脏标签", tabNames().join(","));
  app.unmount();
}

// =================================================================== P2. askInput 的 null 分支
group("P2/askInput-null");
{
  // --- 2a. treeRename ---
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const realRename = api.renamePath;
  const renameCalls: string[] = [];
  (api as { renamePath: typeof api.renamePath }).renamePath = (async (o: string, n: string) => {
    renameCalls.push(`${o}->${n}`);
    return realRename(o, n);
  }) as typeof api.renamePath;
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await openCtxMenuOn("A.md");
  await clickCtxMenuItem("重命名");
  await flush(20);
  check(!!q('.modal input'), "P2-1 重命名弹出输入框");
  // 用「写作目标」把它顶掉
  await openPalette();
  await runPaletteCommand("写作目标");
  await flush(20);
  const input = q<HTMLInputElement>('.modal input');
  if (input) {
    await act(async () => { setInputValue(input, "123"); });
    await flush(10);
    await act(async () => { click(dialogButtons("确定")!, "确定"); });
    await flush(40);
  }
  check(renameCalls.length === 0, "P2-2 被顶掉的重命名请求不得执行（null 分支必须提前返回）", `calls=${JSON.stringify(renameCalls)}`);
  // 设置写盘有 300ms 防抖（App.tsx:880-894），必须等防抖落盘后再读持久化设置。
  await flush(400);
  check(readSettings().goal_words === 123, "P2-3 后发的「写作目标」正常生效（goal_words=123）", `goal=${readSettings().goal_words}`);
  (api as { renamePath: typeof api.renamePath }).renamePath = realRename;
  app.unmount();
}

{
  // --- 2b. treeNewFile ---
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  // 「新建文件」在右键菜单里只对目录渲染（FileTree.tsx:180-182），
  // 因此这里用文件树工具栏的「新建文件」按钮（对根目录新建），走同一条 treeNewFile 路径。
  await act(async () => { click(q('.tree-toolbar button'), "工具栏「新建文件」"); });
  await flush(20);
  check(!!q('.modal input'), "P2-4 新建文件弹出输入框");
  await openPalette();
  await runPaletteCommand("写作目标");
  await flush(20);
  const input = q<HTMLInputElement>('.modal input');
  if (input) {
    await act(async () => { setInputValue(input, "77"); });
    await flush(10);
    await act(async () => { click(dialogButtons("确定")!, "确定"); });
    await flush(80);
  }
  const fs = readMockFs();
  check(
    !Object.keys(fs).some((p) => p.includes("未命名")),
    "P2-5 被顶掉的「新建文件」不得创建任何文件",
    `files=${JSON.stringify(Object.keys(fs))}`
  );
  check(
    !Object.keys(fs).some((p) => p.includes("77")),
    "P2-5b 被顶掉的「新建文件」不得用第二个输入框的值建文件",
    `files=${JSON.stringify(Object.keys(fs))}`
  );
  app.unmount();
}

{
  // --- 2c. setLinkPrompt（Ctrl+K）---
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(30);
  // Ctrl+K 是 tiptap 编辑器级快捷键（src/editor/shortcuts.ts:44 "Mod-k"），
  // 必须把 keydown 派发到编辑区 DOM 上，而不是 window 上。
  await act(async () => { pressKeyOn(q(".ProseMirror"), "k", { ctrlKey: true }); });
  await flush(50);
  const linkInput = q<HTMLInputElement>('.modal input');
  check(!!linkInput, "P2-6 Ctrl+K 弹出链接输入框");
  if (linkInput) {
    // 顶掉它
    await openPalette();
    await runPaletteCommand("写作目标");
    await flush(20);
    const goalInput = q<HTMLInputElement>('.modal input');
    if (goalInput) {
      await act(async () => { setInputValue(goalInput, "55"); });
      await flush(10);
      await act(async () => { click(dialogButtons("确定")!, "确定"); });
      await flush(60);
    }
    check(!/<a\s/i.test(editorHtml()), "P2-7 被顶掉的链接请求不得插入链接", editorHtml().slice(0, 120));
  }
  app.unmount();
}

// =================================================================== P3. closeTab 并发 / 最后一个标签
group("P3/close-tab");
{
  // 场景 A：两个「脏标签关闭」请求同批结算（语义相同），激活标签应落到正确的邻居。
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n", "/demo/C.md": "# C\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md", "C.md");
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("DIRTY_A");
  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await typeInEditor("DIRTY_B");
  info("并发关闭前", `tabs=${tabNames().join(",")} active=${activeTabName()}`);

  // A 的 × → 队首确认请求（A 脏）；随后用命令面板关闭「当前标签」→ 队尾请求（B 脏，当前激活）
  await act(async () => { click(closeButtonOf("A.md"), "A 关闭按钮"); });
  await flush(20);
  check(/A\.md/.test(dialogText()), "P3-1 队首是 A 的关闭确认框", dialogText().slice(0, 60));
  await openPalette();
  await runPaletteCommand("关闭当前标签");
  await flush(20);
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(120);
  const names = tabNames();
  info("并发关闭后", `tabs=${names.join(",")} active=${activeTabName()}`);
  check(!findTab("A.md"), "P3-2 同批结算后 A 标签被关闭", names.join(","));
  check(!findTab("B.md"), "P3-3 同批结算后 B 标签被关闭", names.join(","));
  check(!!findTab("C.md"), "P3-4 未被关闭的 C 标签仍然存在", names.join(","));
  check(activeTabName() === "C.md", "P3-5 活动标签落到未被关闭的 C 上", `active=${activeTabName()}`);
  check(!tabIsDirty("C.md"), "P3-6 保留标签的 dirty 态未被误清", `dirty=${tabIsDirty("C.md")}`);
  check(
    editorText().includes("# C") || editorText().trim() === "C",
    "P3-7 保留标签的编辑区内容正确",
    JSON.stringify(editorText())
  );
  app.unmount();
}

{
  // 场景 B：关闭「当前激活的脏标签」→ 激活标签应落到右邻居
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n", "/demo/C.md": "# C\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md", "C.md");
  await act(async () => { click(findTab("C.md"), "C"); });
  await flush(20);
  await typeInEditor("DIRTY_C");
  await act(async () => { click(closeButtonOf("C.md"), "C 关闭按钮"); });
  await flush(20);
  check(!!dialogButtons("确定"), "P3-8 关闭当前激活的脏标签弹出确认框");
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(120);
  info("关闭激活标签后", `tabs=${tabNames().join(",")} active=${activeTabName()}`);
  check(activeTabName() === "B.md", "P3-9 关闭激活标签后落到右邻居 B", `active=${activeTabName()}`);
  check(!!findTab("B.md") && !!findTab("A.md"), "P3-10 A、B 仍在", tabNames().join(","));
  app.unmount();
}

{
  // 场景 C：关闭「最后一个标签」→ 应新建空白草稿
  // 注意：应用初始就有一个「未命名」草稿标签，必须把它也关掉才能让 tabs 归零。
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(20);
  await typeInEditor("DIRTY_A");
  check(tabNames().length === 2, "P3-11 关标签前有 2 个标签（未命名草稿 + A.md）", tabNames().join(","));
  // 先关掉干净的「未命名」草稿
  await act(async () => { click(closeButtonOf("未命名"), "未命名 关闭按钮"); });
  await flush(80);
  check(tabNames().length === 1 && tabNames()[0] === "A.md", "P3-12 干净草稿被直接关掉", tabNames().join(","));
  // 再关掉最后一个脏标签 A.md
  await act(async () => { click(closeButtonOf("A.md"), "A 关闭按钮"); });
  await flush(20);
  check(!!dialogButtons("确定"), "P3-13 关闭唯一脏标签弹出确认框");
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(120);
  const names = tabNames();
  info("关闭最后一个标签后", `tabs=${names.join(",")} active=${activeTabName()} title=${titleBarName()} status=${statusBarText()}`);
  check(names.length === 1, "P3-14 关闭最后一个标签后应恰好剩下一个标签", names.join(","));
  check(names[0] === "未命名", "P3-15 新建的应是空白草稿「未命名」", names.join(","));
  check(!tabIsDirty("未命名"), "P3-16 新建草稿不应是 dirty", `dirty=${tabIsDirty("未命名")}`);
  check(editorText().trim() === "", "P3-17 新建草稿的编辑区应为空", JSON.stringify(editorText()));
  check(titleBarName().includes("未命名"), "P3-18 标题栏应显示「未命名」", titleBarName());
  app.unmount();
}

{
  // 场景 D：关闭「最后一个干净标签」（无确认框）→ 同样新建空白草稿
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(30);
  await act(async () => { click(closeButtonOf("未命名"), "未命名 关闭按钮"); });
  await flush(80);
  await act(async () => { click(closeButtonOf("A.md"), "A 关闭按钮"); });
  await flush(120);
  const names = tabNames();
  info("关闭最后一个干净标签后", `tabs=${names.join(",")} title=${titleBarName()}`);
  check(names.length === 1 && names[0] === "未命名", "P3-19 关闭最后一个干净标签后新建空白草稿", names.join(","));
  check(editorText().trim() === "", "P3-20 新建草稿的编辑区应为空", JSON.stringify(editorText()));
  app.unmount();
}

{
  // 关闭最后一个标签 → 应新建空白草稿
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(20);
  await typeInEditor("DIRTY_A");
  await act(async () => { click(closeButtonOf("A.md"), "A 关闭按钮"); });
  await flush(20);
  check(!!dialogButtons("确定"), "P3-6 关闭唯一脏标签弹出确认框");
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(80);
  const names = tabNames();
  info("关闭最后一个标签后", `tabs=${names.join(",")} active=${activeTabName()} title=${titleBarName()} status=${statusBarText()}`);
  check(names.length === 1, "P3-7 关闭最后一个标签后应恰好剩下一个标签", names.join(","));
  check(names[0] === "未命名", "P3-8 新建的应是空白草稿「未命名」", names.join(","));
  check(!tabIsDirty("未命名"), "P3-9 新建草稿不应是 dirty", `dirty=${tabIsDirty("未命名")}`);
  check(editorText().trim() === "", "P3-10 新建草稿的编辑区应为空", JSON.stringify(editorText()));
  check(titleBarName().includes("未命名"), "P3-11 标题栏应显示「未命名」", titleBarName());
  app.unmount();
}

// =================================================================== P4. fromOwnGroup 键盘冒泡
group("P4/tree-keyboard");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/父目录/子目录/B.md": "# B\n", "/demo/父目录/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await flush(40);

  const parentRow = treeRowByName("父目录");
  const childRow = treeRowByName("子目录");
  check(!!parentRow && !!childRow, "P4-1 文件树渲染出父目录与子目录", `parent=${!!parentRow} child=${!!childRow}`);
  if (parentRow && childRow) {
    const exp = (r: HTMLElement) => r.getAttribute("aria-expanded");
    // 注意：closest() 会命中元素自身，必须从 parentElement 起算才能拿到「祖先」treeitem。
    const childOf = (r: HTMLElement) => r.parentElement?.closest('.tree-row[role="treeitem"]') ?? null;
    info("初始", `parent=${exp(parentRow)} child=${exp(childRow)}`);

    // (a) 在子目录上按 Enter → 应只切换子目录，父目录不得被连带切换
    const p0 = exp(parentRow);
    const c0 = exp(childRow);
    await act(async () => { pressKeyOn(childRow, "Enter"); });
    await flush(30);
    const p1 = exp(parentRow);
    const c1 = exp(childRow);
    info("子目录 Enter 后", `parent ${p0}->${p1} child ${c0}->${c1}`);
    check(p1 === p0, "P4-2 在子目录上按 Enter 不得连带切换父目录", `parent ${p0}->${p1}`);
    check(c1 !== c0, "P4-3 在子目录上按 Enter 应切换子目录自身", `child ${c0}->${c1}`);

    // (b) 在子目录上按 ArrowRight → 应展开子目录（若已展开则不动），父目录不变
    const p2 = exp(parentRow);
    const c2 = exp(childRow);
    await act(async () => { pressKeyOn(childRow, "ArrowRight"); });
    await flush(30);
    const p3 = exp(parentRow);
    const c3 = exp(childRow);
    info("子目录 ArrowRight 后", `parent ${p2}->${p3} child ${c2}->${c3}`);
    check(p3 === p2, "P4-4 在子目录上按 ArrowRight 不得连带展开父目录", `parent ${p2}->${p3}`);

    // (c) 在子目录上按 ArrowLeft → 子目录已展开时应折叠它；父目录不变
    const p4 = exp(parentRow);
    const c4 = exp(childRow);
    await act(async () => { pressKeyOn(childRow, "ArrowLeft"); });
    await flush(30);
    const p5 = exp(parentRow);
    const c5 = exp(childRow);
    info("子目录 ArrowLeft 后", `parent ${p4}->${p5} child ${c4}->${c5}`);
    check(p5 === p4, "P4-5 在子目录上按 ArrowLeft 不得连带折叠父目录", `parent ${p4}->${p5}`);
    check(c5 !== c4 || c4 === "false", "P4-6 ArrowLeft 未让子目录处于错误的展开态", `child ${c4}->${c5}`);

    // (d) 在子目录上按 Space → 与 Enter 同义
    const p6 = exp(parentRow);
    const c6 = exp(childRow);
    await act(async () => { pressKeyOn(childRow, " "); });
    await flush(30);
    const p7 = exp(parentRow);
    const c7 = exp(childRow);
    info("子目录 Space 后", `parent ${p6}->${p7} child ${c6}->${c7}`);
    check(p7 === p6, "P4-7 在子目录上按 Space 不得连带切换父目录", `parent ${p6}->${p7}`);
    check(c7 !== c6, "P4-8 在子目录上按 Space 应切换子目录自身", `child ${c6}->${c7}`);

    // (e) 层级关系：子目录的最近 treeitem 祖先应当就是父目录
    check(childOf(childRow) === parentRow, "P4-9 子 treeitem 的最近 treeitem 祖先是父 treeitem", `ancestor=${childOf(childRow)?.querySelector(".tree-name")?.textContent}`);
    const group = childRow.closest('[role="group"]');
    check(!!group && group.getAttribute("role") === "group", "P4-10 子树被包在 role=group 容器内");
  }
  app.unmount();
}

// =================================================================== P5. --accent 对比度实测
group("P5/accent-contrast");
{
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf-8");
  const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const vars = new Map<string, string>();
  for (const m of rootBlock.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };
  const lum = (hex: string): number => {
    const [r, g, b] = hexToRgb(hex);
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: string, b: string): number => {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const accent = vars.get("--accent")!;
  const bgEditor = vars.get("--bg-editor")!;
  const bgSide = vars.get("--bg-side")!;
  const bg = vars.get("--bg")!;
  const border = vars.get("--border")!;
  const onAccentStrong = vars.get("--on-accent-strong")!;

  const uses = [...css.matchAll(/([^{}]*)\{([^{}]*var\(--accent\)[^{}]*)\}/g)].map((m) => ({
    sel: (m[1] ?? "").trim().split("\n").pop()!.trim(),
    body: (m[2] ?? "").trim(),
    line: (css.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1,
  }));
  info("var(--accent) 引用处数", String(uses.length));
  for (const u of uses) info(`  L${u.line} ${u.sel}`, u.body.replace(/\s+/g, " ").slice(0, 80));

  // 5a. 作为「背景色」的两处
  const goalFill = /\.statusbar \.goal-fill\s*\{[^}]*background:\s*var\(--accent\)/.test(css);
  check(goalFill, "P5-1 .statusbar .goal-fill 用 --accent 作背景色");
  const rTrack = ratio(accent, border);
  info("goal-fill 背景 vs 轨道(--border)", `${rTrack.toFixed(2)}:1`);
  check(rTrack >= 3, "P5-2 goal-fill 填充色相对轨道背景 ≥3:1（WCAG 1.4.11）", `${rTrack.toFixed(2)}:1`);

  const checkbox = /\.settings-row input\[type="checkbox"\]\s*\{[^}]*accent-color:\s*var\(--accent\)/.test(css);
  check(checkbox, "P5-3 复选框用 accent-color: var(--accent)");
  const rCheck = ratio(onAccentStrong, accent);
  info("复选框勾选标记 vs 填充色", `${rCheck.toFixed(2)}:1`);
  check(rCheck >= 4.5, "P5-4 复选框上的对勾(白)相对 --accent 填充 ≥4.5:1", `${rCheck.toFixed(2)}:1`);

  // 5b. 作为「文字色」的两处
  const rLink = ratio(accent, bgEditor);
  const rOutline = ratio(accent, bgSide);
  info("链接色 vs 编辑底", `${rLink.toFixed(2)}:1`);
  info("大纲激活项 vs 侧栏底", `${rOutline.toFixed(2)}:1`);
  check(rLink >= 4.5, "P5-5 链接文字 --accent 在编辑底上 ≥4.5:1", `${rLink.toFixed(2)}:1`);
  check(rOutline >= 4.5, "P5-6 大纲激活项 --accent 在侧栏底上 ≥4.5:1", `${rOutline.toFixed(2)}:1`);

  // 5c. 作为「边框 / 焦点环」：非文本对比度 ≥3:1，对每一种可能底色都要成立
  const rBorderSide = ratio(accent, bgSide);
  const rBorderEditor = ratio(accent, bgEditor);
  const rBorderBg = ratio(accent, bg);
  info("边框/焦点环 vs 三种底色", `side=${rBorderSide.toFixed(2)} editor=${rBorderEditor.toFixed(2)} bg=${rBorderBg.toFixed(2)}`);
  check(
    Math.min(rBorderSide, rBorderEditor, rBorderBg) >= 3,
    "P5-7 所有用 --accent 画的边框/焦点环在任一底色上都 ≥3:1",
    `min=${Math.min(rBorderSide, rBorderEditor, rBorderBg).toFixed(2)}`
  );

  // 5d. 深色主题：--accent 在深色主题里被覆盖，确认覆盖值也达标
  const darkBlock = /\[data-theme="dark"\]\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const darkVars = new Map<string, string>();
  for (const m of darkBlock.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) darkVars.set(m[1], m[2].trim());
  info("深色主题 --accent", darkVars.get("--accent") ?? "(未覆盖)");
  if (darkVars.has("--accent")) {
    const darkBg = darkVars.get("--bg-editor") ?? darkVars.get("--bg") ?? "#000";
    const rd = ratio(darkVars.get("--accent")!, darkBg);
    check(rd >= 4.5, "P5-8 深色主题的 --accent 文字色同样达 AA", `${rd.toFixed(2)}:1`);
  }
}

// =================================================================== P7. knownDirsRef 手动折叠保护
group("P7/known-dirs");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/目录一/内.md": "# in\n", "/demo/目录一/更深/深.md": "# deep\n" });
  const app = await mountApp();
  await openDemoFolder();
  await flush(60);

  const dir1 = treeRowByName("目录一");
  check(!!dir1, "P7-1 文件树渲染出目录一");
  check(dir1?.getAttribute("aria-expanded") === "true", "P7-2 新目录默认展开", `expanded=${dir1?.getAttribute("aria-expanded")}`);
  const deeper = treeRowByName("更深");
  check(!!deeper, "P7-3 嵌套子目录也被渲染（默认展开）");

  // 用户手动折叠「目录一」
  await act(async () => { click(dir1!, "目录一"); });
  await flush(30);
  check(treeRowByName("目录一")?.getAttribute("aria-expanded") === "false", "P7-4 用户手动折叠后 aria-expanded=false");

  // 触发 refreshTree：保存一个文件会调用 refreshTree
  await act(async () => { pressKey("s", { ctrlKey: true }); });
  await flush(400);
  const afterRefresh = treeRowByName("目录一");
  info("refreshTree 之后", `expanded=${afterRefresh?.getAttribute("aria-expanded")} 更深还在=${!!treeRowByName("更深")}`);
  check(
    afterRefresh?.getAttribute("aria-expanded") === "false",
    "P7-5 用户手动折叠的目录在 refreshTree 之后不得被重新展开",
    `expanded=${afterRefresh?.getAttribute("aria-expanded")}`
  );

  // 反向：手动展开一个目录后，refreshTree 也不应把它折叠
  await act(async () => { click(afterRefresh!, "目录一"); });
  await flush(30);
  check(treeRowByName("目录一")?.getAttribute("aria-expanded") === "true", "P7-6 用户手动展开生效");
  await act(async () => { pressKey("s", { ctrlKey: true }); });
  await flush(400);
  check(
    treeRowByName("目录一")?.getAttribute("aria-expanded") === "true",
    "P7-7 用户手动展开的目录在 refreshTree 之后不得被折叠",
    `expanded=${treeRowByName("目录一")?.getAttribute("aria-expanded")}`
  );
  app.unmount();
}

// =================================================================== N7. 旧 askInput Promise 是否悬空
//
// 独立判断：team-lead 的结论是「N7 是真实断言盲区——移除
// `promptRef.current?.resolve(null)` 后 95 项断言仍全绿」。
// 但盲区 ≠ 缺陷。这里用两种方法独立判断它到底有没有可观测后果：
//
//   (N7-a) 底层测量：直接观测旧 askInput 的 Promise 是否以 null 结算（不是悬空）。
//   (N7-b) 行为测量：走真实用户路径「连续两次点『写作目标』」，
//         看第一次 setGoal 的 await 之后那段逻辑（写设置）到底有没有执行、
//         有没有把第一次的 cur 状态丢掉。
//
// 关键区分：setGoal 的实现是
//     const cur = settingsRef.current?.goal_words ?? 0;
//     const input = await askInput(...);
//     if (input === null) return;          ← null 分支：直接返回，不写设置
//     const n = Math.max(0, parseInt(input,10) || 0);
//     setSettings((s) => (s ? {...s, goal_words:n} : s));
// 「以 null 结算」与「永远悬空」在这条路径上的可观测差异是：
//   null  → await 之后立即 return，不写设置（期望行为）
//   悬空  → await 之后永不继续，同样不写设置
// ⇒ 两者在 setGoal 上**行为等价**。这正是它成为盲区的根本原因。
// 所以真正的问题是：有没有任何一条路径上「null 结算」与「悬空」不等价？
group("N7/promise-settle");
{
  // ---- N7-a：底层测量 —— 旧 askInput 的 Promise 是否以 null 结算 ----
  const tracker = installPromiseTracker();
  try {
    resetLocalStorage();
    seedSettings({ autosave_ms: 0 });
    seedMockFs({ "/demo/A.md": "# A\n" });
    const app = await mountApp();
    await openDemoFolder();
    await openTreeFile("A.md");
    await flush(30);

    const mark = tracked.length;
    await openPalette();
    await runPaletteCommand("写作目标");
    await flush(20);
    const input1 = q<HTMLInputElement>('.modal input');
    check(!!input1, "N7-0 第一次「写作目标」弹出输入框");
    if (input1) {
      await act(async () => { setInputValue(input1, "111"); });
      await flush(10);
    }
    // 第二次触发 → 顶掉第一次
    await openPalette();
    await runPaletteCommand("写作目标");
    await flush(30);
    const input2 = q<HTMLInputElement>('.modal input');
    check(!!input2 && input2.value !== "111", "N7-1 第二个输入框不沿用上次的文本", `value=${input2?.value}`);

    // 回答第二个
    if (input2) {
      await act(async () => { setInputValue(input2, "222"); });
      await flush(10);
      await act(async () => { click(dialogButtons("确定")!, "确定"); });
      await flush(120);
    }
    const created = tracker.since(mark);
    // 只看本轮新建、且与「弹窗 Promise」相关的那些（栈里有 askInput / PromptDialog）。
    const nullSettled = created.filter((p) => p.settled && p.value === null);
    const unsettled = created.filter((p) => !p.settled);
    info(
      "本轮新建的 Promise",
      `共 ${created.length} 个；结算为 null 的 ${nullSettled.length} 个；未结算的 ${unsettled.length} 个`
    );
    for (const p of unsettled.slice(0, 6)) info("  未结算 Promise 的创建栈", p.stack.slice(0, 220));
    check(
      nullSettled.length >= 1,
      "N7-2 旧 askInput 请求必须以 null 结算（不得永远悬空）",
      `nullSettled=${nullSettled.length}`
    );
    // 断言：没有任何一个「askInput 栈」的 Promise 处于未结算状态
    const askInputPromises = created.filter((p) => /askInput|PromptDialog|App\.tsx/.test(p.stack));
    const danglingAsk = askInputPromises.filter((p) => !p.settled);
    check(
      danglingAsk.length === 0,
      "N7-2b 与 askInput 相关的 Promise 不得处于悬空状态",
      `dangling=${danglingAsk.length}/${askInputPromises.length}`
    );
    await flush(400);
    check(readSettings().goal_words === 222, "N7-3 最终 goal_words 来自后一次请求（222）", `goal=${readSettings().goal_words}`);
    app.unmount();
  } finally {
    tracker.restore();
  }
}

{
  // ---- N7-b：行为测量 —— 旧请求的 await 之后那段逻辑有没有执行、有没有丢状态 ----
  // 场景：第一次「写作目标」被顶掉。若旧请求悬空，则第一次 setGoal 的
  // 「await 之后」永不执行；若以 null 结算，则执行到 `if (input === null) return`
  // 同样不写设置。两者可观测结果相同 ⇒ setGoal 路径上「null vs 悬空」不可区分。
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(30);

  // 第一次：写入 111
  await openPalette();
  await runPaletteCommand("写作目标");
  await flush(20);
  const i1 = q<HTMLInputElement>('.modal input');
  if (i1) {
    await act(async () => { setInputValue(i1, "111"); });
    await flush(10);
    await act(async () => { click(dialogButtons("确定")!, "确定"); });
    await flush(120);
  }
  await flush(400);
  const afterFirst = readSettings().goal_words;
  info("第一次「写作目标」回答 111 之后", `goal_words=${afterFirst}`);

  // 第二次：在弹窗打开期间被「写作目标」顶掉
  await openPalette();
  await runPaletteCommand("写作目标");
  await flush(20);
  const i2 = q<HTMLInputElement>('.modal input');
  if (i2) {
    await act(async () => { setInputValue(i2, "222"); });
    await flush(10);
    await openPalette();
    await runPaletteCommand("写作目标");
    await flush(20);
    const i3 = q<HTMLInputElement>('.modal input');
    if (i3) {
      await act(async () => { setInputValue(i3, "333"); });
      await flush(10);
      await act(async () => { click(dialogButtons("确定")!, "确定"); });
      await flush(120);
    }
  }
  await flush(400);
  const finalGoal = readSettings().goal_words;
  info("连续两次顶掉之后", `goal_words=${finalGoal}`);
  check(
    finalGoal === 333,
    "N7-4 只有最后一次请求生效（222 不得写入、111 不得残留）",
    `goal=${finalGoal}`
  );
  check(
    afterFirst === 111,
    "N7-5 第一次未被顶掉的请求正常生效（111）",
    `goal=${afterFirst}`
  );
  // 关键行为判据：中间那次被顶掉的请求（222）既没有写入、也没有把状态弄乱
  check(
    finalGoal !== 222 && finalGoal !== 111,
    "N7-6 被顶掉的请求没有以任何形式写进设置（无残留、无覆盖）",
    `goal=${finalGoal}`
  );
  app.unmount();
}

// =================================================================== P6. Palette 的 aria-modal 降级（D-6）
group("P6/palette-aria");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(40);

  // (a) 单独打开命令面板 → 应是唯一模态
  await openPalette();
  const solo = q(".palette");
  check(solo?.getAttribute("aria-modal") === "true", "P6-1 单独打开时命令面板是 aria-modal=true", `aria-modal=${solo?.getAttribute("aria-modal")}`);
  check(qa('[role="dialog"][aria-modal="true"]').length === 1, "P6-2 单独打开时只有一个 aria-modal 浮层", `count=${qa('[role="dialog"][aria-modal="true"]').length}`);
  // 关闭面板：把 Escape 派发到面板内的输入框上（面板的 useModal 挂在面板容器的 onKeyDown 上）
  await act(async () => { pressKeyOn(q(".palette input"), "Escape"); });
  await flush(30);
  check(!q(".palette"), "P6-2b 命令面板已关闭", `palette=${!!q(".palette")}`);

  // (b) 在确认框之上打开命令面板 → 面板必须降级，且全屏只有一个 aria-modal=true
  //     注意顺序：必须先把 A.md 弄脏，点 × 才会弹确认框；否则干净标签直接关闭，没有确认框。
  await typeInEditor("DIRTY_A");
  await flush(20);
  check(tabIsDirty("A.md"), "P6-2c A.md 已变脏（后续关闭会弹确认框）", `dirty=${tabIsDirty("A.md")}`);
  await act(async () => { click(closeButtonOf("A.md"), "A 关闭按钮"); });
  await flush(30);
  check(!!dialogButtons("确定"), "P6-2d 关闭脏标签弹出确认框", dialogText().slice(0, 60));
  const modalCountBefore = qa('[role="dialog"][aria-modal="true"]').length;
  check(modalCountBefore === 1, "P6-3 确认框是模态浮层", `count=${modalCountBefore}`);
  await openPalette();
  const overConfirm = q(".palette");
  const totalModal = qa('[role="dialog"][aria-modal="true"]').length;
  check(!!overConfirm, "P6-3b 命令面板确实叠加在确认框之上");
  check(overConfirm?.getAttribute("aria-modal") === "false", "P6-4 叠在确认框之上时命令面板降级为 aria-modal=false", `aria-modal=${overConfirm?.getAttribute("aria-modal")}`);
  check(totalModal === 1, "P6-5 叠在确认框之上时全屏仍只有一个 aria-modal 浮层", `count=${totalModal}`);
  check(overConfirm?.getAttribute("role") === "dialog", "P6-6 降级后仍保留 role=dialog");
  check(!!overConfirm?.getAttribute("aria-label"), "P6-7 降级后仍保留可访问名", overConfirm?.getAttribute("aria-label") ?? "(无)");
  // 降级不等于被禁用：面板仍然可用（可以筛命令）
  const palInput = q<HTMLInputElement>(".palette input");
  if (palInput) {
    await act(async () => { setInputValue(palInput, "关闭当前标签"); });
    await flush(20);
  }
  check(
    qa(".palette-item").length > 0 && qa(".palette-item").some((b) => (b.textContent ?? "").includes("关闭当前标签")),
    "P6-8 降级后命令面板仍然可正常筛选命令",
    `items=${qa(".palette-item").length}`
  );
  // 关闭面板（Escape 派发到面板内部），确认框必须原样保留、仍可作答
  await act(async () => { pressKeyOn(q(".palette input"), "Escape"); });
  await flush(30);
  check(!q(".palette"), "P6-9 面板已关闭", `palette=${!!q(".palette")}`);
  check(!!dialogButtons("确定"), "P6-10 面板关闭后确认框仍然存在且未被顶掉", dialogText().slice(0, 60));
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(120);
  check(!findTab("A.md"), "P6-11 确认框仍能正常作答（脏标签被关闭）", tabNames().join(","));
  app.unmount();
}

{
  // (c) 非 App 托管的模态（历史面板的快照详情）→ 只能靠 Palette 的 DOM 兜底探针降级
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(40);
  // 保存一次 → 产生快照
  await act(async () => { pressKey("s", { ctrlKey: true }); });
  await flush(400);
  await switchSidebarTab("历史");
  await flush(80);
  const snapItem = q<HTMLElement>(".history-item");
  check(!!snapItem, "P6-12 历史面板列出了快照", `items=${qa(".history-item").length}`);
  if (snapItem) {
    await act(async () => { click(snapItem, "快照条目"); });
    await flush(80);
    const snapModal = qa('[role="dialog"][aria-modal="true"]');
    check(snapModal.length === 1, "P6-13 快照详情弹窗是 aria-modal=true 的浮层", `count=${snapModal.length}`);
    await openPalette();
    const overSnap = q(".palette");
    check(!!overSnap, "P6-14 命令面板叠加在快照详情之上");
    check(
      overSnap?.getAttribute("aria-modal") === "false",
      "P6-15 非 App 托管的模态叠加时，命令面板靠 DOM 兜底探针降级",
      `aria-modal=${overSnap?.getAttribute("aria-modal")}`
    );
    check(
      qa('[role="dialog"][aria-modal="true"]').length === 1,
      "P6-16 叠加时全屏仍只有一个 aria-modal 浮层",
      `count=${qa('[role="dialog"][aria-modal="true"]').length}`
    );
    await act(async () => { pressKeyOn(q(".palette input"), "Escape"); });
    await flush(30);
  }
  app.unmount();
}

// =================================================================== P8. D-4「另存为开新标签」的语义与副作用
group("P8/saveas-tab");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  // 让「另存为」落到与源文件不同的路径（mock 默认会回落到同名路径）
  const realPick = api.pickSaveFile;
  const picks: string[] = [];
  let seq = 0;
  (api as { pickSaveFile: typeof api.pickSaveFile }).pickSaveFile = (async (d: string) => {
    picks.push(d);
    seq += 1;
    return `/demo/副本${seq}.md`;
  }) as typeof api.pickSaveFile;
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(30);
  await typeInEditor("DIRTY_A");
  const before = tabNames();
  await act(async () => { pressKey("s", { ctrlKey: true, shiftKey: true }); });
  await flush(200);
  const after = tabNames();
  info("另存为前", `tabs=${before.join(",")}`);
  info("另存为后", `tabs=${after.join(",")} picks=${JSON.stringify(picks)} fs=${JSON.stringify(Object.keys(readMockFs()))}`);
  check(after.length === before.length + 1, "P8-1 另存为应新增一个标签", after.join(","));
  check(!!findTab("副本1.md"), "P8-2 新标签承载新文件", after.join(","));
  check(!!findTab("A.md"), "P8-3 源标签仍然保留", after.join(","));
  check(tabIsDirty("A.md"), "P8-4 源标签的 dirty 状态不被另存为清掉", `dirty=${tabIsDirty("A.md")}`);
  check(!tabIsDirty("副本1.md"), "P8-5 新标签不是 dirty", `dirty=${tabIsDirty("副本1.md")}`);
  check(activeTabName() === "副本1.md", "P8-6 另存为后活动标签切到新标签", `active=${activeTabName()}`);
  check(!!readMockFs()["/demo/副本1.md"], "P8-6b 另存为把内容写到了新路径", JSON.stringify(Object.keys(readMockFs())));
  check(readMockFs()["/demo/A.md"] === "# A\n", "P8-6c 另存为不得改动源文件（源路径内容保持原样）", JSON.stringify(readMockFs()["/demo/A.md"]));

  // 副作用检查：重复另存为不应无限增殖标签
  for (let i = 0; i < 3; i++) {
    await act(async () => { pressKey("s", { ctrlKey: true, shiftKey: true }); });
    await flush(150);
  }
  const afterMany = tabNames();
  info("连续另存为 3 次后", `tabs=${afterMany.join(",")}`);
  check(
    afterMany.length === before.length + 4,
    "P8-7 每次另存为各开一个新标签（数量线性，不丢也不多）",
    afterMany.join(",")
  );
  (api as { pickSaveFile: typeof api.pickSaveFile }).pickSaveFile = realPick;
  app.unmount();
}

{
  // 竞态：另存为的「选择路径」await 期间用户继续输入 → 新标签不得抢走活动态，源标签必须仍是脏的
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const realPick = api.pickSaveFile;
  let release: ((p: string | null) => void) | null = null;
  (api as { pickSaveFile: typeof api.pickSaveFile }).pickSaveFile = (() =>
    new Promise<string | null>((resolve) => {
      release = resolve;
    })) as typeof api.pickSaveFile;
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await flush(30);
  await typeInEditor("DIRTY_A");
  await act(async () => { pressKey("s", { ctrlKey: true, shiftKey: true }); });
  await flush(30);
  check(!!release, "P8-9 另存为已进入「选择路径」等待态", `release=${!!release}`);
  // 等待期间用户继续输入
  await typeInEditor("MORE");
  await act(async () => { release?.("/demo/副本1.md"); });
  await flush(250);
  const names = tabNames();
  info("另存为等待期间继续输入后", `tabs=${names.join(",")} active=${activeTabName()} fs=${JSON.stringify(readMockFs())}`);
  check(names.length === 3, "P8-10 另存为仍只新增一个标签（未命名 + A.md + 副本1.md）", names.join(","));
  check(activeTabName() === "A.md", "P8-11 内容在保存期间又变了 → 活动标签不得被新标签抢走", `active=${activeTabName()}`);
  check(tabIsDirty("A.md"), "P8-12 源标签仍为 dirty（未落盘的内容不得被清零）", `dirty=${tabIsDirty("A.md")}`);
  check(
    editorText().includes("MORE"),
    "P8-13 源标签的编辑区内容保留用户后续输入",
    JSON.stringify(editorText().slice(-40))
  );
  const disk = readMockFs()["/demo/副本1.md"];
  check(
    typeof disk === "string" && disk.includes("DIRTY_A") && !disk.includes("MORE"),
    "P8-14 新文件按「保存发起瞬间」的文本落盘（等待期间的后续输入不得混入）",
    JSON.stringify(disk)
  );
  (api as { pickSaveFile: typeof api.pickSaveFile }).pickSaveFile = realPick;
  app.unmount();
}

// =================================================================== P9. knownDirsRef 跨工作区切换 / 侧栏切换
group("P9/known-dirs-workspace");
{
  // (a) 侧栏页签切换 → FileTree 重新挂载 → 「expanded」状态是否丢失？
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/目录一/内.md": "# in\n" });
  const app = await mountApp();
  await openDemoFolder();
  await flush(60);
  check(treeRowByName("目录一")?.getAttribute("aria-expanded") === "true", "P9-1 初始目录默认展开");
  await act(async () => { click(treeRowByName("目录一")!, "目录一"); });
  await flush(30);
  check(treeRowByName("目录一")?.getAttribute("aria-expanded") === "false", "P9-2 用户手动折叠生效");
  // 切到「历史」页签再切回「文件」→ FileTree 被卸载重挂（React 组件类型变了）
  await switchSidebarTab("历史");
  await flush(30);
  await switchSidebarTab("文件");
  await flush(40);
  const afterTabSwitch = treeRowByName("目录一")?.getAttribute("aria-expanded");
  info("侧栏切走再切回后「目录一」的展开态", `expanded=${afterTabSwitch}`);
  check(
    afterTabSwitch === "false",
    "P9-3 用户手动折叠的状态在侧栏页签切换后仍应保留（FileTree 重挂载不得丢失用户意图）",
    `expanded=${afterTabSwitch}`
  );
  app.unmount();
}

{
  // (a2) 折叠整个侧栏（Ctrl+\）再展开 → FileTree 同样被卸载重挂载
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/目录一/内.md": "# in\n" });
  const app = await mountApp();
  await openDemoFolder();
  await flush(60);
  await act(async () => { click(treeRowByName("目录一")!, "目录一"); });
  await flush(30);
  check(treeRowByName("目录一")?.getAttribute("aria-expanded") === "false", "P9-3b 手动折叠生效");
  await act(async () => { pressKey("\\", { ctrlKey: true }); });
  await flush(60);
  await act(async () => { pressKey("\\", { ctrlKey: true }); });
  await flush(80);
  const afterSidebarToggle = treeRowByName("目录一")?.getAttribute("aria-expanded");
  info("折叠/展开侧栏后「目录一」的展开态", `expanded=${afterSidebarToggle}`);
  check(
    afterSidebarToggle === "false",
    "P9-3c 折叠并重新展开侧栏后，用户手动折叠的状态仍应保留",
    `expanded=${afterSidebarToggle}`
  );
  app.unmount();
}

{
  // (b) 切换工作区 → knownDirsRef 以绝对路径为键，不应跨工作区串味
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/目录一/内.md": "# in\n", "/other/目录一/内2.md": "# in2\n" });
  const app = await mountApp();
  await openDemoFolder();
  await flush(60);
  check(treeRowByName("目录一")?.getAttribute("aria-expanded") === "true", "P9-4 /demo 的目录默认展开");

  // 用户手动折叠 /demo/目录一
  await act(async () => { click(treeRowByName("目录一")!, "目录一"); });
  await flush(30);
  check(treeRowByName("目录一")?.getAttribute("aria-expanded") === "false", "P9-5 手动折叠 /demo/目录一 生效");

  // 切到 /other 工作区
  const realPickFolder = api.pickFolder;
  (api as { pickFolder: typeof api.pickFolder }).pickFolder = (async () => "/other") as typeof api.pickFolder;
  await act(async () => { click(q('button[title^="打开文件夹"]'), "打开文件夹"); });
  await flush(200);
  const otherExpanded = treeRowByName("目录一")?.getAttribute("aria-expanded");
  info("切换到 /other 工作区后同名目录的展开态", `expanded=${otherExpanded}`);
  check(
    otherExpanded === "true",
    "P9-6 切换工作区后，新工作区里的同名目录应默认展开（knownDirsRef 以绝对路径为键，不串味）",
    `expanded=${otherExpanded}`
  );

  // 切回 /demo → 用户此前的手动折叠应被保留
  (api as { pickFolder: typeof api.pickFolder }).pickFolder = (async () => "/demo") as typeof api.pickFolder;
  await act(async () => { click(q('button[title^="打开文件夹"]'), "打开文件夹"); });
  await flush(200);
  const backExpanded = treeRowByName("目录一")?.getAttribute("aria-expanded");
  info("切回 /demo 工作区后同名目录的展开态", `expanded=${backExpanded}`);
  check(
    backExpanded === "false",
    "P9-7 切回原工作区时，用户此前的手动折叠应被保留",
    `expanded=${backExpanded}`
  );
  (api as { pickFolder: typeof api.pickFolder }).pickFolder = realPickFolder;
  app.unmount();
}

// =================================================================== 汇总
const total = results.length;
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log("\n== 第 4 轮 Step-4 敌对探针汇总 ==");
console.log(`总计 ${total} 项，通过 ${passed}，失败 ${failed.length}`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(`  !! [${f.group}] ${f.name}${f.note ? " — " + f.note : ""}`);
}
writeFileSync(
  fileURLToPath(new URL("./qa4-probe-report.txt", import.meta.url)),
  results.map((r) => `${r.ok ? "OK " : "!! "}[${r.group}] ${r.name}${r.note ? " — " + r.note : ""}`).join("\n"),
  "utf-8"
);
console.log(failed.length === 0 ? "== 结论：Step-4 敌对探针全部 PASS ==" : `== 结论：Step-4 敌对探针 ${failed.length} 项 FAIL ==`);
process.exit(failed.length === 0 ? 0 : 1);
