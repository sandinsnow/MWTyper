// 第 3 轮「敌对视角」审计 spike（任务 #7 Round 3）
//
// 目的：不是重复跑既有回归，而是主动寻找「测试没覆盖到的失效路径」。
// 本文件由 QA 独占维护（owner: software-qa-engineer），工程师不得修改。
//
// 覆盖方向（team-lead 指定的 7 个方向中可在 jsdom 内测的部分）：
//   A/D1-edge      D1 身份快照的边界：3+ 标签快速切换 / openFile 命中已打开且 dirty 的文件 / 关闭当前 dirty 标签
//   B/save-race    save() 的 await 之后未按 savingId 保护 refs → 跨标签污染（标题栏路径 / dirty 态 / 落盘目标）
//   B/saveas-race  save() 的 savingId 取自 await 之后 → 「另存为」期间切标签会把结果写到错误的标签
//   B/save-during  save() 的 await 期间继续输入 → 落盘后 dirty 被清零，输入内容既未落盘又被标记为已保存
//   H/restore-race restoreSnapshot 的 await 之后无条件 loadBuffer → 编辑区内容被旧文件的快照替换
//   C/flush-iso    flushAllDirty 的失败隔离：单个标签保存抛错时其余标签仍落盘且 Promise 不 reject
//   D/modal-race   T02 弹窗 Promise 模式的竞态：模态期间全局快捷键未被屏蔽 → 叠加浮层 / 单槽状态顶掉第一个 Promise
//   E/a11y-sem     a11y 语义的真实有效性：tab↔tabpanel 关联、treeitem 层级、aria-expanded 真值、dialog 容器本体
//   F/css          T01 CSS 的实际生效性：--accent-strong 落点 + 仍用 --accent 的对比度实测 + prefers-reduced-motion 覆盖面
//   G/stats        E02/E08 序号防乱：状态栏字数与「本次 +N 字」基线必须属于当前标签
//
// 运行（pnpm 已失效，用 Node v24 直调 tsx）：
//   /c/Users/Admin/scoop/persist/nvm/nodejs/v24.20.0/node.exe node_modules/tsx/dist/cli.mjs spikes/audit3.ts
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
  ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
(w.Range as { prototype: Range }).prototype.getClientRects = emptyRectList;
(w.Range as { prototype: Range }).prototype.getBoundingClientRect = emptyRect;
(w.Element as { prototype: Element }).prototype.getClientRents = emptyRectList;
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
    mediaListeners.get(query)?.delete(fn);
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
const { flushAllDirty } = await import("../src/App");
type Tab = import("../src/App").Tab;
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
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const flush = async (ms = 0) => { await act(async () => { await sleep(ms); }); };
/** 等待统计防抖（scheduleStats 为 300ms）真正落定。 */
const flushStats = async () => { await flush(450); };

// ---------------------------------------------------------------- 挂载辅助
interface Mounted { root: Root; container: HTMLElement; renders: number; unmount: () => void; }

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
  await flush(30);
  return {
    root,
    container,
    get renders() { return renders; },
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
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
function statusWords(): number {
  const m = /字数\s*(\d+)/.exec(statusBarText());
  return m ? Number(m[1]) : -1;
}
function statusSessionAdded(): number {
  const m = /本次\s*\+(\d+)\s*字/.exec(statusBarText());
  return m ? Number(m[1]) : -1;
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
async function typeInEditor(text: string) {
  await act(async () => { editor().commands.insertContentAt(1, text); });
  await flush(10);
}
function dialogButtons(text: string): HTMLElement | undefined {
  return qa<HTMLElement>('[role="dialog"] button').find((b) => b.textContent?.trim() === text);
}

/** 当前唯一浮层对话框的可见文本（用于断言确认框的语义类别）。 */
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

/** 在文件树里右键某个文件（用于触发「删除」等上下文菜单项）。 */
async function openCtxMenuOnFile(name: string): Promise<void> {
  const row = qa<HTMLElement>(".tree-row[role='treeitem']").find(
    (r) => (r.querySelector(".tree-name")?.textContent ?? "").trim() === name
  );
  if (!row) throw new Error(`文件树中找不到 ${name}`);
  await act(async () => {
    row.dispatchEvent(
      new (window as unknown as Window).MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      })
    );
  });
  await flush(20);
}

/** 点击某个文件右键菜单里的指定项。 */
async function clickCtxMenuItemFor(name: string, label: string): Promise<void> {
  const item = qa<HTMLElement>("[role='menu'] [role='menuitem']").find(
    (b) => (b.textContent ?? "").trim() === label
  );
  if (!item) throw new Error(`${name} 的右键菜单里找不到「${label}」`);
  await act(async () => { click(item, label); });
  await flush(20);
}

/** 给 api.saveFile 加上人为延迟，模拟真实 Tauri IPC 的耗时窗口。 */
function slowSaveFile(delayMs: number): { calls: { path: string; content: string }[]; restore: () => void } {
  const real = api.saveFile;
  const calls: { path: string; content: string }[] = [];
  (api as { saveFile: typeof api.saveFile }).saveFile = (async (path: string, content: string) => {
    calls.push({ path, content });
    if (delayMs > 0) await sleep(delayMs);
    return real(path, content);
  }) as typeof api.saveFile;
  return {
    calls,
    restore: () => { (api as { saveFile: typeof api.saveFile }).saveFile = real; },
  };
}

// =================================================================== A. D1 身份快照的边界
group("A/D1-edge");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n", "/demo/C.md": "# C\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md", "C.md");
  check(
    ["A.md", "B.md", "C.md"].every((n) => tabNames().some((t) => t.startsWith(n))),
    "A-0 三个文件各自成为独立标签（未命名草稿标签同时存在）",
    tabNames().join(",")
  );

  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("MARK_A");
  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await typeInEditor("MARK_B");
  await act(async () => { click(findTab("C.md"), "C"); });
  await flush(20);
  await typeInEditor("MARK_C");
  check(
    editorText().includes("MARK_C") && !editorText().includes("MARK_A"),
    "A-1 C 中只有 MARK_C（未串入 A 的标记）",
    editorText()
  );

  // 快速连切 3 个标签（A→B→C→A），每次切换后立刻断言当前内容
  const seq = ["A.md", "B.md", "C.md", "A.md", "B.md", "C.md"];
  const seen: string[] = [];
  for (const name of seq) {
    await act(async () => { click(findTab(name), name); });
    await flush(5);
    seen.push(`${name}:${editorText().replace(/\s+/g, "")}`);
  }
  check(
    seen[0].includes("MARK_A") && seen[1].includes("MARK_B") && seen[2].includes("MARK_C"),
    "A-2 快速连切后每个标签内容仍是自己的（首轮 A/B/C）",
    seen.slice(0, 3).join(" | ")
  );
  check(
    seen[3].includes("MARK_A") && seen[4].includes("MARK_B") && seen[5].includes("MARK_C"),
    "A-3 快速连切第二轮仍然一一对应（无串位）",
    seen.slice(3).join(" | ")
  );
  check(
    !seen.some((s) => (s.startsWith("A.md") && s.includes("MARK_B")) || (s.startsWith("B.md") && s.includes("MARK_A"))),
    "A-4 快速连切中未出现跨标签内容互串",
    seen.join(" | ")
  );

  // 关闭当前 dirty 标签 → 取消 → 标签与内容都应保留
  await act(async () => { click(findTab("C.md"), "C"); });
  await flush(20);
  await act(async () => { click(closeButtonOf("C.md"), "C 关闭按钮"); });
  await flush(20);
  check(!!q('[role="dialog"]'), "A-5 关闭 dirty 标签弹出确认对话框");
  await act(async () => { click(dialogButtons("取消"), "取消"); });
  await flush(20);
  check(!!findTab("C.md"), "A-6 取消关闭后 C 标签仍在");
  check(editorText().includes("MARK_C"), "A-7 取消关闭后 C 的内容未被清空", editorText());
  check(tabIsDirty("C.md"), "A-8 取消关闭后 C 仍为 dirty");

  // 确认关闭 → C 消失，激活的应是 B，且 B 内容正确
  await act(async () => { click(closeButtonOf("C.md"), "C 关闭按钮"); });
  await flush(20);
  await act(async () => { click(dialogButtons("确定"), "确定"); });
  await flush(30);
  check(!findTab("C.md"), "A-9 确认关闭后 C 标签消失");
  check(activeTabName().startsWith("B.md"), "A-10 关闭当前标签后激活的是相邻的 B", activeTabName());
  check(editorText().includes("MARK_B") && !editorText().includes("MARK_C"), "A-11 关闭后 B 的内容是 B 自己的", editorText());

  // openFile 命中「已打开且 dirty」的文件：内容不得被磁盘版本覆盖
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("MARK_A2");
  check(tabIsDirty("A.md"), "A-12 A 已变脏");
  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await act(async () => {
    click(qa<HTMLElement>(".tree-row").find((r) => (r.querySelector(".tree-name")?.textContent ?? "").trim() === "A.md"), "树中的 A.md");
  });
  await flush(30);
  check(activeTabName().startsWith("A.md"), "A-13 从文件树重新打开已 dirty 的 A → 激活 A", activeTabName());
  check(editorText().includes("MARK_A2"), "A-14 重新打开已 dirty 的 A 未丢失未保存内容", editorText());
  check(tabIsDirty("A.md"), "A-15 重新打开后 A 仍为 dirty（未被当作干净文件重载）");

  app.unmount();
}

// =================================================================== B. save() 的跨标签污染
group("B/save-race");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 }); // 关闭自动保存，隔离定时器，只考察手动保存路径
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await typeInEditor("MARK_B_DIRTY");
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("MARK_A_DIRTY");
  check(tabIsDirty("A.md"), "B-1 A 已变脏");

  const slow = slowSaveFile(250);
  try {
    // 触发对 A 的保存（路径 /demo/A.md）
    await act(async () => { pressKey("s", { ctrlKey: true }); });
    await flush(5);
    check(slow.calls.length === 1 && slow.calls[0].path === "/demo/A.md", "B-2 已发起对 A 的保存", JSON.stringify(slow.calls));

    // 保存尚未完成时，用户切到 B
    await act(async () => { click(findTab("B.md"), "B"); });
    await flush(5);
    check(activeTabName().startsWith("B.md"), "B-3 保存进行中已切换到 B", activeTabName());

    // 等待保存完成（await 之后的收尾逻辑此刻才执行）
    await flush(400);

    check(
      titleBarName().startsWith("B.md"),
      "B-4 保存完成后标题栏仍显示当前标签 B（B.md）而非被保存的 A.md",
      `title=${titleBarName()} active=${activeTabName()}`
    );
    check(
      !statusBarText().includes("已保存"),
      "B-5 B 仍有未保存内容时状态栏不应显示「已保存」",
      statusBarText()
    );

    // 竞态后的后果：B 的内容被写到 A.md
    await act(async () => { pressKey("s", { ctrlKey: true }); });
    await flush(400);
    const fs = readMockFs();
    check(
      !String(fs["/demo/A.md"] ?? "").includes("MARK_B_DIRTY"),
      "B-6 保存 B 时不得把 B 的内容写进 A.md（跨标签落盘）",
      `A.md=${JSON.stringify(fs["/demo/A.md"])} B.md=${JSON.stringify(fs["/demo/B.md"])}`
    );
    check(
      String(fs["/demo/B.md"] ?? "").includes("MARK_B_DIRTY"),
      "B-7 B 的内容应落到 B.md",
      `B.md=${JSON.stringify(fs["/demo/B.md"])}`
    );
    check(
      String(fs["/demo/A.md"] ?? "").includes("MARK_A_DIRTY"),
      "B-8 A.md 仍保有 A 自己的内容",
      `A.md=${JSON.stringify(fs["/demo/A.md"])}`
    );
  } finally {
    slow.restore();
    app.unmount();
  }
}

// =================================================================== B2. 「另存为」期间的标签切换
group("B/saveas-race");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await typeInEditor("MARK_B_DIRTY");
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("MARK_A_DIRTY");

  const realPick = api.pickSaveFile;
  (api as { pickSaveFile: typeof api.pickSaveFile }).pickSaveFile = (async () => {
    await sleep(250); // 模拟原生「另存为」对话框停留期间
    return "/demo/Saved.md";
  }) as typeof api.pickSaveFile;

  try {
    await act(async () => { pressKey("s", { ctrlKey: true, shiftKey: true }); });
    await flush(10);
    await act(async () => { click(findTab("B.md"), "B"); });
    await flush(5);
    check(activeTabName().startsWith("B.md"), "B2-1 「另存为」对话框期间已切换到 B", activeTabName());
    await flush(400);

    check(
      titleBarName().startsWith("B.md"),
      "B2-2 「另存为」完成后标题栏应仍显示当前标签 B",
      `title=${titleBarName()} active=${activeTabName()}`
    );
    check(
      tabIsDirty("B.md"),
      "B2-3 「另存为」不得把 B 标签的 dirty 态清掉（B 仍有未保存编辑）",
      `tabNames=${tabNames().join(",")}`
    );
    check(
      !!findTab("B.md") && (findTab("B.md")?.querySelector(".tab-name")?.textContent ?? "").includes("B.md"),
      "B2-4 「另存为」不得把 B 标签改名为 Saved.md",
      `tabNames=${tabNames().join(",")}`
    );
  } finally {
    (api as { pickSaveFile: typeof api.pickSaveFile }).pickSaveFile = realPick;
    app.unmount();
  }
}

// =================================================================== B3. 保存期间继续输入
group("B/save-during");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openTreeFile("A.md");
  await typeInEditor("FIRST");
  check(tabIsDirty("A.md"), "B3-1 A 已变脏");

  const slow = slowSaveFile(250);
  try {
    await act(async () => { pressKey("s", { ctrlKey: true }); });
    await flush(20);
    // 保存尚未完成时继续输入
    await typeInEditor("SECOND");
    check(tabIsDirty("A.md"), "B3-2 保存期间继续输入，dirty 应保持");
    await flush(400);

    const fs = readMockFs();
    check(
      String(fs["/demo/A.md"] ?? "").includes("FIRST") && !String(fs["/demo/A.md"] ?? "").includes("SECOND"),
      "B3-3 落盘内容应只含保存发起时的文本（FIRST），不含之后的输入",
      `A.md=${JSON.stringify(fs["/demo/A.md"])}`
    );
    check(
      tabIsDirty("A.md"),
      "B3-4 保存完成后仍存在未落盘的新输入，dirty 必须保持（不得被清零）",
      `dirtyDot=${tabIsDirty("A.md")} status=${statusBarText()}`
    );
    check(
      !statusBarText().includes("已保存"),
      "B3-5 状态栏不得显示「已保存」（实际有未落盘内容）",
      statusBarText()
    );
  } finally {
    slow.restore();
    app.unmount();
  }
}

// =================================================================== H. restoreSnapshot 的竞态
group("H/restore-race");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  // 在 A 上产生一次改动，保证快照内容与当前内容不同
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(30);
  await typeInEditor("MARK_A_EDITED");
  // 打开 A（会自动创建快照）
  await act(async () => { click(qa<HTMLElement>(".tree-row").find((r) => (r.querySelector(".tree-name")?.textContent ?? "").trim() === "A.md"), "树中的 A.md"); });
  await flush(60);

  await switchSidebarTab("历史");
  const items = qa<HTMLElement>(".history-item");
  check(items.length > 0, "H-1 历史面板列出了 A 的快照", `items=${items.length}`);
  if (items.length) {
    await act(async () => { click(items[0], "快照条目"); });
    await flush(40);
    const restoreBtn = q<HTMLElement>(".modal-restore");
    check(!!restoreBtn, "H-2 快照详情弹窗有「恢复此版本」按钮");
    const slow = slowSaveFile(300);
    try {
      await act(async () => { click(restoreBtn!, "恢复此版本"); });
      await flush(40);
      const confirmBtn = dialogButtons("确定");
      check(!!confirmBtn, "H-3 恢复快照前有确认弹窗");
      await act(async () => { click(confirmBtn!, "确定"); });
      await flush(20);
      // 恢复流程的 await 期间用户切到 B
      await act(async () => { click(findTab("B.md"), "B"); });
      await flush(5);
      check(activeTabName().startsWith("B.md"), "H-4 恢复流程进行中已切换到 B", activeTabName());
      await flush(500);

      check(
        editorText().includes("B") && !editorText().includes("A"),
        "H-5 恢复流程结束后编辑区应仍是 B 的内容（不得被 A 的快照替换）",
        `editor=${editorText().replace(/\s+/g, "")}`
      );
      check(
        titleBarName().startsWith("B.md"),
        "H-6 恢复流程结束后标题栏应仍显示 B.md",
        `title=${titleBarName()} active=${activeTabName()}`
      );
      check(
        editorText().includes("MARK_A_EDITED") === false,
        "H-7 切到 B 后 B 的内容不得被 A 的编辑内容覆盖",
        `editor=${editorText().replace(/\s+/g, "")}`
      );
    } finally {
      slow.restore();
    }
  }
  app.unmount();
}

// =================================================================== D. 自动保存定时器的身份校验
// 敌对点：自动保存定时器在「调度瞬间」捕获 path/id，回调时校验身份。
// 必须证明：定时器到期时不会把某个标签的内容写进另一个标签的文件。
group("D/autosave-timer");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 300 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(30);
  await typeInEditor("MARK_A_AUTO");
  // 定时器尚未到期就切到 B
  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(30);
  await typeInEditor("MARK_B_AUTO");
  await flush(900); // 等待自动保存到期
  const fs1 = readMockFs();
  check(
    !String(fs1["/demo/A.md"] ?? "").includes("MARK_B_AUTO"),
    "D-1 自动保存不得把 B 的内容写进 A.md",
    `A.md=${JSON.stringify(fs1["/demo/A.md"])} B.md=${JSON.stringify(fs1["/demo/B.md"])}`
  );
  check(
    !String(fs1["/demo/B.md"] ?? "").includes("MARK_A_AUTO"),
    "D-2 自动保存不得把 A 的内容写进 B.md",
    `A.md=${JSON.stringify(fs1["/demo/A.md"])} B.md=${JSON.stringify(fs1["/demo/B.md"])}`
  );
  check(
    String(fs1["/demo/B.md"] ?? "").includes("MARK_B_AUTO"),
    "D-3 B 的自动保存应把 B 的内容写进 B.md",
    `B.md=${JSON.stringify(fs1["/demo/B.md"])}`
  );

  // 切回脏标签 A → 应重新排程自动保存并最终落盘
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(1200);
  const fs2 = readMockFs();
  check(
    String(fs2["/demo/A.md"] ?? "").includes("MARK_A_AUTO"),
    "D-4 切回脏标签 A 后应重新排程自动保存并把 A 的内容落盘",
    `A.md=${JSON.stringify(fs2["/demo/A.md"])}`
  );
  check(
    !String(fs2["/demo/B.md"] ?? "").includes("MARK_A_AUTO"),
    "D-5 切回 A 后的自动保存不得污染 B.md",
    `B.md=${JSON.stringify(fs2["/demo/B.md"])}`
  );
  app.unmount();
}

// =================================================================== C. flushAllDirty 失败隔离
group("C/flush-iso");
{
  const calls: { path: string | null; text: string }[] = [];
  const tabs: Tab[] = [
    { id: 1, path: "/demo/A.md", name: "A.md", text: "SNAP_A", dirty: true },
    { id: 2, path: "/demo/B.md", name: "B.md", text: "SNAP_B", dirty: true },
    { id: 3, path: "/demo/C.md", name: "C.md", text: "SNAP_C", dirty: true },
    { id: 4, path: null, name: "未命名", text: "DRAFT", dirty: true },
  ];
  let rejected = false;
  try {
    await flushAllDirty(tabs, () => "LIVE", 1, async (tab, text) => {
      calls.push({ path: tab.path, text });
      if (tab.path === "/demo/B.md") throw new Error("磁盘只读：保存失败");
    });
  } catch {
    rejected = true;
  }
  check(!rejected, "C-1 单个标签保存抛错时 flushAllDirty 的 Promise 不得 reject（否则关窗流程中断）");
  check(calls.length === 3, "C-2 出错标签之后的脏标签仍被落盘", `calls=${calls.length} ${JSON.stringify(calls)}`);
  check(calls.some((c) => c.path === "/demo/C.md"), "C-3 出错点之后的 C.md 依然落盘");
  check(!calls.some((c) => c.path === null), "C-4 无 path 的草稿仍未被 flush");
}

// =================================================================== D. 弹窗 Promise 竞态
group("D/modal-race");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor("MARK_A");
  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await typeInEditor("MARK_B");
  check(tabIsDirty("A.md") && tabIsDirty("B.md"), "D-0 A、B 均已变脏");

  // 点 A 的 × → 确认弹窗（焦点在「取消」按钮上，快捷键不会被输入框保护逻辑吞掉）
  await act(async () => { click(closeButtonOf("A.md"), "A 关闭按钮"); });
  await flush(20);
  check(qa('[role="dialog"]').length === 1, "D-1 初始只有一个模态浮层", `count=${qa('[role="dialog"]').length}`);

  // 模态打开时全局快捷键仍生效 → 命令面板叠加在上
  await openPalette();
  check(
    qa('[role="dialog"][aria-modal="true"]').length === 1,
    "D-2 模态浮层打开时不应再叠加第二个 aria-modal 浮层",
    `dialogs=${qa('[role="dialog"][aria-modal="true"]').length}`
  );
  check(!!q(".palette"), "D-3 （记录）命令面板确实在模态之上被打开");

  // 从命令面板触发「关闭当前标签」→ 第二个 confirm 请求顶掉第一个（单槽状态）
  await runPaletteCommand("关闭当前标签");
  const dlgText = q('[role="dialog"]')?.textContent ?? "";
  check(
    dlgText.includes("A.md"),
    "D-4 第二个确认请求不应顶掉第一个尚未回答的确认请求（否则第一个 Promise 被孤儿化）",
    `dialogText=${dlgText.replace(/\s+/g, " ").slice(0, 80)}`
  );
  check(
    qa('[role="dialog"]').length === 1,
    "D-5 同一时刻不应并存两个确认浮层",
    `dialogs=${qa('[role="dialog"]').length}`
  );

  // 回答当前这个确认框 → 两个关闭请求都应完成（A 与 B 都关闭）
  await act(async () => { click(dialogButtons("确定"), "确定"); });
  await flush(30);
  check(!findTab("B.md"), "D-6 被回答的确认框对应的 B 标签已关闭", tabNames().join(","));
  check(
    !findTab("A.md"),
    "D-7 先前那个被顶掉的关闭请求也应完成（A 也应被关闭，不能被静默丢弃）",
    `tabNames=${tabNames().join(",")}`
  );

  // askInput 同样受单槽状态影响：第二个请求会顶掉第一个
  await openPalette();
  await runPaletteCommand("写作目标");
  const promptInput = q<HTMLInputElement>('.modal input');
  check(!!promptInput, "D-8 写作目标弹出输入框");
  if (promptInput) {
    await act(async () => { setInputValue(promptInput, "111"); });
    await flush(10);
    await openPalette();
    await runPaletteCommand("写作目标");
    const promptInput2 = q<HTMLInputElement>('.modal input');
    check(
      !!promptInput2 && promptInput2.value !== "111",
      "D-9 第二个输入请求不得沿用上一个输入框里已输入的文本（新弹窗应显示自己的默认值）",
      `value=${JSON.stringify(promptInput2?.value)}`
    );
  }
  // 清理浮层
  await act(async () => {
    const cancel = dialogButtons("取消");
    if (cancel) click(cancel, "取消");
  });
  await flush(20);
  await act(async () => { pressKey("Escape"); });
  await flush(20);

  app.unmount();
}

// --- D-10 ~ D-13：跨语义类别的确认请求不得被队首的作答一并结算 ---
// D-5 的批量结算只在「同一语义类别」内成立（同为「关闭标签」的多个请求）。
// 但确认框有三种语义：关闭标签 / 删除文件 / 恢复快照。
// 若 settleConfirm 把整个队列用一个布尔值结算，答一个「删除文件」就会把
// 队列里用户根本没看到的「关闭标签」请求一并确认 → 正在编辑的脏标签被强制关闭。
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

  // 队首请求：删除 B（语义：破坏性文件操作）
  // 队尾请求：关闭 A（语义：丢弃未保存内容）
  // 构造顺序（真实可达路径）：
  //   步骤 1：在文件树里右键 B.md → 删除 → 队首 = 「删除文件」确认框。
  //           此时活动标签仍是 A（A 是脏标签）。
  //   步骤 2：用命令面板执行「关闭当前标签」→ 对 A 发起「关闭标签」确认 → 排到队尾。
  //   步骤 3：用户回答队首的「删除」→ 队列里那个「关闭 A」必须仍待单独确认。
  //   —— 这正是「用户只看到了删除 B 的确认框，却连带关掉了 A」的真实路径。
  await openCtxMenuOnFile("B.md");
  await clickCtxMenuItemFor("B.md", "删除");
  await flush(30);
  check(
    /删除/.test(dialogText()) && /B\.md/.test(dialogText()),
    "D-10 队首是「删除文件」确认框",
    dialogText().slice(0, 80)
  );

  // 现在排队一个「关闭标签」请求（语义不同）
  await openPalette();
  await runPaletteCommand("关闭当前标签");
  await flush(30);
  check(
    qa('[role="dialog"]').length === 1,
    "D-11 第二个确认请求不得顶掉队首（两个请求应共存于队列中）",
    `dialogs=${qa('[role="dialog"]').length}`
  );

  // 回答队首的「删除」→ 只有队首该被执行；队尾的「关闭 A」必须留待用户单独确认
  await act(async () => { click(dialogButtons("确定")!, "确定"); });
  await flush(120);
  const fsAfter = readMockFs();
  check(
    !("/demo/B.md" in fsAfter) && Object.keys(fsAfter).some((p) => p.includes("trash") && p.includes("B.md")),
    "D-12 回答「删除·确定」后，队首的删除语义必须照常生效（B.md 被移入回收站）",
    JSON.stringify(Object.keys(fsAfter))
  );
  check(
    !!findTab("A.md"),
    "D-13 回答「删除·确定」后，用户从未看到其确认框的脏标签 A 不得被连带关闭",
    tabNames().join(",")
  );
  check(
    tabIsDirty("A.md"),
    "D-13b 被连带关闭的标签其未保存状态与内容也不得丢失",
    `dirty=${tabIsDirty("A.md")} tabs=${tabNames().join(",")}`
  );
  check(
    !!dialogButtons("确定"),
    "D-13c 队尾的「关闭 A」请求必须仍待用户单独确认（不得被队首的作答一并结算）",
    dialogText().slice(0, 80)
  );

  app.unmount();
}

// =================================================================== E. a11y 语义的真实有效性
group("E/a11y-sem");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/子目录/B.md": "# B\n" });
  const app = await mountApp();
  await openDemoFolder();

  // (1) tab ↔ tabpanel 的程序化关联
  const tabBtns = qa<HTMLElement>('.sidebar-tabs button[role="tab"]');
  const panel = q('.sidebar-body[role="tabpanel"]');
  check(!!panel, "E-1 侧栏内容区 role=tabpanel 存在");
  check(
    tabBtns.every((b) => !!b.getAttribute("aria-controls")),
    "E-2 每个 role=tab 都应通过 aria-controls 指向其 tabpanel",
    `missing=${tabBtns.filter((b) => !b.getAttribute("aria-controls")).map((b) => b.textContent).join(",")}`
  );
  check(
    !!panel?.getAttribute("aria-labelledby"),
    "E-3 tabpanel 应通过 aria-labelledby 回指当前 tab",
    `aria-labelledby=${panel?.getAttribute("aria-labelledby") ?? "(缺失)"}`
  );

  // (2) treeitem 层级：子 treeitem 必须落在父 treeitem（或其 role=group）内
  const dirRow = qa<HTMLElement>('.tree-row[role="treeitem"]').find((r) => r.querySelector(".tree-name")?.textContent?.trim() === "子目录");
  check(!!dirRow, "E-4 找到目录行");
  if (dirRow) {
    const initial = dirRow.getAttribute("aria-expanded");
    check(initial === "true" || initial === "false", "E-5 目录 treeitem 带 aria-expanded", `aria-expanded=${initial}`);
    const child = qa<HTMLElement>('.tree-row[role="treeitem"]').find((r) => r.querySelector(".tree-name")?.textContent?.trim() === "B.md");
    const childInSubtree = !!child && !!dirRow.contains(child);
    check(
      childInSubtree,
      "E-6 treeitem 的子节点应嵌套在父 treeitem（或其 role=group）内，否则读屏无法获知层级",
      `childNested=${childInSubtree} childParentRole=${child?.parentElement?.getAttribute("role") ?? "(none)"}`
    );

    // 点击目录 → aria-expanded 必须在 true/false 之间翻转，且子树随之出现/消失
    const childPresent = () => qa<HTMLElement>('.tree-row[role="treeitem"]').some((r) => r.querySelector(".tree-name")?.textContent?.trim() === "B.md");
    const before = childPresent();
    await act(async () => { click(dirRow, "目录行"); });
    await flush(20);
    const after1 = qa<HTMLElement>('.tree-row[role="treeitem"]').find((r) => r.querySelector(".tree-name")?.textContent?.trim() === "子目录");
    const expanded1 = after1?.getAttribute("aria-expanded");
    const child1 = childPresent();
    check(
      expanded1 !== initial && child1 !== before,
      "E-7 折叠/展开目录后 aria-expanded 真值翻转且子树随之出现或消失（语义与视觉一致）",
      `before=${initial}/${before} after=${expanded1}/${child1}`
    );
    await act(async () => { click(after1!, "目录行(再点)"); });
    await flush(20);
    const after2 = qa<HTMLElement>('.tree-row[role="treeitem"]').find((r) => r.querySelector(".tree-name")?.textContent?.trim() === "子目录");
    check(
      after2?.getAttribute("aria-expanded") === initial,
      "E-8 再次点击后 aria-expanded 回到初始值",
      `initial=${initial} now=${after2?.getAttribute("aria-expanded")}`
    );

    // E-12：子树必须包在 role="group" 容器内（ARIA tree 规范的层级容器角色）
    const groupOfChild = child?.closest('[role="group"]');
    check(
      !!groupOfChild && groupOfChild.getAttribute("role") === "group",
      "E-12 子树必须被包在 role=group 的容器内（ARIA tree 层级容器）",
      `groupRole=${groupOfChild?.getAttribute("role") ?? "(none)"} parentRole=${child?.parentElement?.getAttribute("role") ?? "(none)"}`
    );

    // E-13：用户手动折叠的状态在侧栏页签切换（FileTree 重挂载）后必须保留
    await act(async () => { click(after2!, "目录行(手动折叠)"); });
    await flush(20);
    const collapsed = qa<HTMLElement>('.tree-row[role="treeitem"]').find((r) => r.querySelector(".tree-name")?.textContent?.trim() === "子目录");
    check(
      collapsed?.getAttribute("aria-expanded") === "false",
      "E-13a 用户手动折叠后 aria-expanded=false",
      `expanded=${collapsed?.getAttribute("aria-expanded")}`
    );
    await switchSidebarTab("历史");
    await flush(30);
    await switchSidebarTab("文件");
    await flush(40);
    const afterRemount = qa<HTMLElement>('.tree-row[role="treeitem"]').find((r) => r.querySelector(".tree-name")?.textContent?.trim() === "子目录");
    check(
      afterRemount?.getAttribute("aria-expanded") === "false",
      "E-13b 用户手动折叠的状态在侧栏页签切换（FileTree 重挂载）后必须保留",
      `expanded=${afterRemount?.getAttribute("aria-expanded")}`
    );
  }

  // (3) role=dialog 必须落在真正的浮层容器上（而非空壳 wrapper）
  await act(async () => { click(q('button[title^="设置"]'), "设置"); });
  await flush(20);
  const dlg = q('[role="dialog"][aria-modal="true"]');
  const hasTitle = !!dlg?.querySelector(".modal-title");
  const hasButtons = (dlg?.querySelectorAll("button").length ?? 0) > 0;
  check(!!dlg && hasTitle && hasButtons, "E-9 role=dialog 落在含标题与按钮的浮层容器本体上", `title=${hasTitle} buttons=${hasButtons}`);
  check(
    !!dlg?.getAttribute("aria-labelledby") || !!dlg?.getAttribute("aria-label"),
    "E-10 模态浮层有可访问名（aria-labelledby / aria-label）"
  );
  await act(async () => { click(qa<HTMLElement>('[role="dialog"] .modal-close')[0], "关闭设置"); });
  await flush(20);
  check(!q('[role="dialog"]'), "E-11 设置浮层已关闭");

  app.unmount();
}

// =================================================================== F. CSS 实际生效性
group("F/css");
{
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf-8");

  const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const vars = new Map<string, string>();
  for (const m of rootBlock.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
  check(vars.has("--accent") && vars.has("--accent-strong"), "F-0 :root 含 --accent / --accent-strong");

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
  const accentStrong = vars.get("--accent-strong")!;
  const fgDim = vars.get("--fg-dim")!;
  const bgEditor = vars.get("--bg-editor")!;
  const bgSide = vars.get("--bg-side")!;

  const strongUsed = (css.match(/var\(--accent-strong\)/g) ?? []).length;
  check(strongUsed >= 5, "F-1 --accent-strong 已用于多处激活态", `uses=${strongUsed}`);
  check(
    ratio(accentStrong, bgEditor) >= 4.5,
    "F-2 --accent-strong 在编辑底色上达到 WCAG AA 4.5:1",
    `ratio=${ratio(accentStrong, bgEditor).toFixed(2)} (${accentStrong} on ${bgEditor})`
  );
  check(
    ratio(fgDim, bgSide) >= 4.5,
    "F-3 --fg-dim 在侧栏底色上达到 AA 4.5:1（U05 已修）",
    `ratio=${ratio(fgDim, bgSide).toFixed(2)} (${fgDim} on ${bgSide})`
  );

  // 仍用 --accent 的「文字/指示器」场景是否达标
  check(
    /\.ProseMirror\s+a\s*\{[^}]*color:\s*var\(--accent\)/.test(css),
    "F-4 （记录）编辑区链接确实仍用 --accent"
  );
  check(
    ratio(accent, bgEditor) >= 4.5,
    "F-5 编辑区链接色 --accent 在编辑底色上应达 AA 4.5:1",
    `ratio=${ratio(accent, bgEditor).toFixed(2)} (${accent} on ${bgEditor})`
  );
  check(
    ratio(accent, bgSide) >= 4.5,
    "F-6 大纲当前项 --accent 在侧栏底色上应达 AA 4.5:1",
    `ratio=${ratio(accent, bgSide).toFixed(2)} (${accent} on ${bgSide})`
  );
  check(
    ratio(accent, bgSide) >= 3,
    "F-7 选中态指示器（侧栏页签下边框）--accent 对比度应 ≥3:1（WCAG 1.4.11 非文本对比）",
    `ratio=${ratio(accent, bgSide).toFixed(2)}`
  );
  check(
    ratio(accent, bgEditor) >= 3,
    "F-8 焦点环 --accent 在编辑底色上应 ≥3:1（WCAG 2.2 焦点指示器非文本对比）",
    `ratio=${ratio(accent, bgEditor).toFixed(2)}`
  );

  // prefers-reduced-motion 是否真的覆盖了全部 transition/animation
  const transitionDecls = (css.match(/transition\s*:/g) ?? []).length;
  const animationDecls = (css.match(/animation\s*:/g) ?? []).length;
  const reducedBlock = /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? "";
  check(
    reducedBlock.includes("*") && reducedBlock.includes("transition: none !important"),
    "F-9 reduced-motion 采用通配兜底规则",
    reducedBlock.replace(/\s+/g, " ").slice(0, 90)
  );
  check(
    transitionDecls + animationDecls > 0,
    "F-10 存在 transition/animation 声明（需要 reduced-motion 覆盖）",
    `transition=${transitionDecls} animation=${animationDecls}`
  );
  const perRule = [...css.matchAll(/([^{}]+)\{([^{}]*transition\s*:[^{}]*)\}/g)].filter((m) => !m[0].includes("prefers-reduced-motion"));
  check(
    perRule.length === transitionDecls,
    "F-11 所有 transition 声明都落在元素选择器上（可被通配兜底覆盖）",
    `rules=${perRule.length} decls=${transitionDecls}`
  );

  // 所有「用 --accent 画焦点指示器」的规则都必须达到 3:1（WCAG 2.2 焦点可见）
  const focusRules: { sel: string; line: number }[] = [];
  css.split("\n").forEach((ln, i) => {
    if (!ln.includes("var(--accent)")) return;
    if (!/:focus/.test(ln)) return;
    focusRules.push({ sel: (ln.split("{")[0] ?? "").trim(), line: i + 1 });
  });
  const badFocus = focusRules.filter(() => ratio(accent, bgEditor) < 3);
  check(
    badFocus.length === 0,
    "F-12 所有用 --accent 画的焦点指示器都应达 3:1（WCAG 2.2 焦点可见）",
    badFocus.length
      ? badFocus.map((r) => `L${r.line} ${r.sel} ratio=${ratio(accent, bgEditor).toFixed(2)}`).join(" | ")
      : `focusRules=${focusRules.length}`
  );
}

// =================================================================== G. E02/E08 序号防乱
group("G/stats");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  // A = 1 词，B = 4 词，两者可区分
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B C D E\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  await flushStats();
  check(statusWords() === 4, "G-1 当前标签 B 的状态栏字数为 4", `words=${statusWords()} (${statusBarText()})`);

  await act(async () => { click(findTab("A.md"), "A"); });
  await flushStats();
  check(statusWords() === 1, "G-2 切到 A 后状态栏字数变为 1（未停留在 B 的 4）", `words=${statusWords()} (${statusBarText()})`);
  check(statusSessionAdded() === 0, "G-3 切标签后「本次 +N 字」基线归零", `added=${statusSessionAdded()}`);

  // 在 A 中新增 2 个词（插入到标题前，形成独立词）→ A 变 3 词，仍与 B 的 4 词可区分
  await typeInEditor(" ALPHA BETA ");
  await flushStats();
  check(statusWords() === 3, "G-4 在 A 中新增 2 个词后字数为 3", `words=${statusWords()} (${statusBarText()})`);
  check(statusSessionAdded() === 2, "G-5 「本次 +N 字」等于本次新增的 2 个词", `added=${statusSessionAdded()}`);

  // 快速连切后，字数必须属于当前标签
  for (const n of ["B.md", "A.md", "B.md", "A.md"]) {
    await act(async () => { click(findTab(n), n); });
    await flush(5);
  }
  await flushStats();
  check(statusWords() === 3, "G-6 快速连切后字数属于当前标签 A（3 词，而非 B 的 4 词）", `words=${statusWords()} (${statusBarText()})`);

  app.unmount();
}

// =================================================================== G2. 快速切回标签后的会话基线
group("G/session-base");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B C D\n" });
  const app = await mountApp();
  await openDemoFolder();
  await openFilesAsTabs("A.md", "B.md");

  // 在 A 中输入 1 个词（尾部补空格，避免与既有词粘连成同一 token）
  await act(async () => { click(findTab("A.md"), "A"); });
  await flush(20);
  await typeInEditor(" ONE ");
  await flushStats();
  check(statusWords() === 2, "G2-1a 在 A 中输入 1 个词后字数为 2", `words=${statusWords()} (${statusBarText()})`);
  check(statusSessionAdded() === 1, "G2-1b 在 A 中输入 1 个词后「本次 +1 字」", `added=${statusSessionAdded()} words=${statusWords()}`);

  // 快速切到 B 再切回 A（间隔 < 统计防抖 300ms）→ 基线应重置为 A 的当前字数
  await act(async () => { click(findTab("B.md"), "B"); });
  await flush(20);
  await act(async () => { click(findTab("A.md"), "A"); });
  await flushStats();
  check(
    statusSessionAdded() === 0,
    "G2-2 切回 A 后「本次 +N 字」基线应按 A 重置为 0",
    `added=${statusSessionAdded()} words=${statusWords()}`
  );

  // 再输入 1 个词 → 应为 +1（而不是 0，也不是别的标签的增量）
  await typeInEditor(" TWO ");
  await flushStats();
  check(
    statusSessionAdded() === 1,
    "G2-3 切回后再输入 1 个词，「本次 +N 字」应为 +1（基线未被旧请求污染）",
    `added=${statusSessionAdded()} words=${statusWords()}`
  );

  app.unmount();
}

// =================================================================== G3. stats 响应乱序时的基线归属
// 敌对点：loadBuffer 用 api.stats(tab.text) 建立「本次 +N 字」基线，
// 而 initialWordsRef 只在「第一个返回的 stats 响应」里被赋值。
// 若加载时的响应比防抖后的响应更晚到达，基线就会落在编辑之后 → 「本次 +N 字」永远显示 +0。
group("G/stats-latency");
{
  resetLocalStorage();
  seedSettings({ autosave_ms: 0 });
  seedMockFs({ "/demo/A.md": "# A\n", "/demo/B.md": "# B C D\n" });
  const real = api.stats;
  const statsCalls: string[] = [];
  // 只给「装载 A 缓冲」那一次 stats 调用加延迟，模拟真实 IPC 的慢响应
  (api as { stats: typeof api.stats }).stats = (async (md: string) => {
    statsCalls.push(md);
    if (md === "# A\n") await sleep(600);
    return real(md);
  }) as typeof api.stats;
  const app = await mountApp();
  try {
    await openDemoFolder();
    await openFilesAsTabs("A.md");
    // 加载响应仍在途中时立刻编辑
    await typeInEditor(" ONE ");
    await flush(900);
    check(
      statusWords() === 2,
      "G3-1 慢响应下字数仍应正确统计为 2",
      `words=${statusWords()} (${statusBarText()}) calls=${JSON.stringify(statsCalls)}`
    );
    check(
      statusSessionAdded() === 1,
      "G3-2 基线应取「装载缓冲时」的字数（1），慢响应不得把基线推到编辑之后",
      `added=${statusSessionAdded()} words=${statusWords()} calls=${JSON.stringify(statsCalls)}`
    );
  } finally {
    (api as { stats: typeof api.stats }).stats = real;
    app.unmount();
  }
}

// =================================================================== 汇总
const total = results.length;
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log("\n== 第 3 轮敌对视角审计汇总 ==");
console.log(`总计 ${total} 项，通过 ${passed}，失败 ${failed.length}`);
if (failed.length) {
  console.log("失败项（需路由）：");
  for (const f of failed) console.log(`  !! [${f.group}] ${f.name}${f.note ? " — " + f.note : ""}`);
}
writeFileSync(
  fileURLToPath(new URL("./audit3-report.txt", import.meta.url)),
  results.map((r) => `${r.ok ? "OK " : "!! "}[${r.group}] ${r.name}${r.note ? " — " + r.note : ""}`).join("\n"),
  "utf-8"
);
console.log(failed.length === 0 ? "== 结论：敌对视角审计全部 PASS ==" : `== 结论：敌对视角审计 ${failed.length} 项 FAIL（源码缺陷，见报告）==`);
process.exit(failed.length === 0 ? 0 : 1);
