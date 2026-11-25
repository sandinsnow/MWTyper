import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { EditorView } from "@codemirror/view";
import { Fragment } from "@tiptap/pm/model";
import { useEditor } from "./editor/useEditor";
import { extensions, markdown, splitFrontmatter, joinFrontmatter, setImageBaseGetter } from "./editor/extensions";
import { pmPosToTextOffset, restoreCaret, collapseSelection } from "./editor/caret";
import { imageAssets } from "./editor/image-assets";
import { htmlPaste } from "./editor/html-paste";
import TableToolbar, { selectionInTable } from "./editor/TableToolbar";
import FileTree, { collectDirPaths, collectDirSizes, TREE_AUTO_EXPAND_MAX_NODES } from "./sidebar/FileTree";
import Outline from "./sidebar/Outline";
import HistoryPanel from "./sidebar/HistoryPanel";
import SearchPanel from "./sidebar/SearchPanel";
import Palette, { type PaletteCommand } from "./commands/Palette";
import StatusBar from "./statusbar/StatusBar";
import { useTheme } from "./theme";
import { buildThemeCss } from "./theme/apply";
import { focusMode } from "./editor/focus";
import { findReplace, findKey } from "./editor/find-replace";
import FindReplaceBar from "./editor/FindReplaceBar";
import SettingsPanel from "./settings/SettingsPanel";
import { ConfirmDialog, PromptDialog } from "./ui/Modal";
import { ToastHost, type Toast } from "./ui/Toast";
import { setLinkPrompt } from "./editor/shortcuts";
import HelpCenter, { type HelpSection } from "./help/HelpCenter";
import ModeSegments, { type EditMode } from "./ui/ModeSegments";
import TitleMenu, { type TitleMenuGroup } from "./ui/TitleMenu";
import {
  api,
  dirname,
  basename,
  isTauri,
  type TreeNode,
  type Settings,
  type Stats,
} from "./ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 编辑器的三种模式。
 * - wysiwyg：所见即所得（tiptap 渲染态直接编辑）
 * - source：纯 Markdown 源码（CodeMirror 6）
 * - split  ：随航（源码 ｜ 实时预览 并排；左栏 CodeMirror 是事实源，
 *            右栏复用富文本实例做只读预览）
 */
type Mode = "wysiwyg" | "source" | "split";

// CM6 全家桶仅在源码模式加载（首屏不含）
const SourceMode = lazy(() => import("./editor/SourceMode").then((m) => ({ default: m.SourceMode })));

/**
 * 恢复富文本光标。
 *
 * 文档长度没变（源码模式里没改内容）时按绝对位置精确还原；改过内容时按比例
 * 估算——精确映射需要把文本偏移反解成 PM 位置，代价与复杂度都不划算，
 * 而比例估算在常见场景（改了开头几行）已经足够接近。
 */
export { pmPosToTextOffset, restoreCaret } from "./editor/caret";

export interface Tab {
  id: number;
  path: string | null;
  name: string;
  text: string;
  dirty: boolean;
}

/**
 * 确认请求的语义类别。
 * 队列结算时只批量结算「同一语义类别」的连续请求：不同类别的请求（如「删除文件」与
 * 「关闭标签」）语义后果完全不同，若一并结算，用户会只看到队首的对话框却被连带
 * 执行了从未确认过的操作（丢弃未保存内容），造成数据丢失。
 */
type ConfirmKind = "close-tab" | "delete-file" | "restore-snapshot" | "generic";

interface ConfirmState {
  /** 语义类别：同类别可批量结算，跨类别必须逐个向用户确认。 */
  kind: ConfirmKind;
  title: string;
  message: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface PromptState {
  /** 自增序号：作为 PromptDialog 的 key，新请求必须重挂载（否则会沿用上次的输入文本）。 */
  id: number;
  title: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
}

/**
 * 关窗前落盘所有脏标签（纯函数，供 jsdom 直接验证）。
 * 活动标签的最新文本可能还停留在 editor ref 中、未 stash 回 tabs，因此用 currentText() 实时取；
 * 其余标签只能使用各自快照。无 path 的草稿跳过，逐个串行落盘。
 */
export async function flushAllDirty(
  tabs: Tab[],
  currentText: () => string,
  activeId: number,
  save: (tab: Tab, text: string) => Promise<void>
): Promise<void> {
  for (const tab of tabs) {
    if (!tab.dirty || !tab.path) continue;
    const text = tab.id === activeId ? currentText() : tab.text;
    try {
      await save(tab, text);
    } catch {
      // 关窗流程尽力而为：单个失败不阻断其余标签落盘。
    }
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  /**
   * 文件树已展开的目录（受控，持有在 App 而非 FileTree 内部）。
   * FileTree 位于条件渲染内：切换侧栏页签或 Ctrl+\ 收起侧栏都会让它卸载重挂载。
   * 若展开状态留在 FileTree 内部，重挂载会丢失用户手动折叠的目录、并让「默认全展开」重新生效。
   */
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [mode, setMode] = useState<Mode>("wysiwyg");
  /**
   * CodeMirror 实例就绪的计数。
   * 源码模式是 React.lazy 懒加载的：首次切到「源码 / 随航」时，CM 可能还没挂载完，
   * 此刻依赖 [mode] 的副作用拿到的 cmViewRef 是 null —— 滚动监听就再也绑不上了。
   * 用这个计数在 CM 就绪后重新触发。
   */
  const [cmReady, setCmReady] = useState(0);
  const [sourceText, setSourceText] = useState("");
  const [stats, setStats] = useState<Stats>({ words: 0, chars: 0, reading_minutes: 0 });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"files" | "outline" | "search" | "history">("files");
  const [recentOpen, setRecentOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"commands" | "files">("commands");
  const [findOpen, setFindOpen] = useState<null | "find" | "replace">(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 帮助中心：打开状态 + 当前分区 */
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSection, setHelpSection] = useState<HelpSection>("markdown");
  const [themes, setThemes] = useState<string[]>([]);
  const [themesDir, setThemesDir] = useState("");
  const [snapVersion, setSnapVersion] = useState(0);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, path: null, name: "未命名", text: "", dirty: false }]);
  const [activeId, setActiveId] = useState(1);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [sessionMinutes, setSessionMinutes] = useState(0);
  /**
   * 「本次 +N 字」的基线字数。
   * 只由「装载缓冲」那一次 stats 响应确定（见 loadBuffer）；编辑触发的防抖统计不得改写它，
   * 否则慢响应会把基线推到编辑之后，「本次 +N 字」永远显示 +0。
   */
  const [baselineWords, setBaselineWords] = useState<number | null>(null);

  const settingsRef = useRef<Settings | null>(null);
  const workspaceRef = useRef<string | null>(null);
  const filePathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const modeRef = useRef<Mode>("wysiwyg");
  const sourceTextRef = useRef("");
  const frontmatterRef = useRef("");
  const lastMdRef = useRef("");
  const lastSavedTextRef = useRef<string | null>(null);
  const editorRef = useRef<import("@tiptap/core").Editor | null>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  /** 切到源码模式前的富文本光标（pos + 当时的文档长度，用于还原） */
  const savedCaretRef = useRef<{ pos: number; size: number }>({ pos: 0, size: 0 });
  /** 源码模式（CodeMirror）的光标位置 + 记录它时的源码文本 */
  const cmSelRef = useRef<{ anchor: number; head: number; text: string } | null>(null);

  /**
   * 等 CodeMirror 实例就位后把焦点交给它。
   * 源码模式是 React.lazy 懒加载的，切过去的那一刻 view 可能还没挂载。
   */
  const focusCodeMirror = useCallback((retries = 12): void => {
    const v = cmViewRef.current;
    if (v) {
      v.focus();
      return;
    }
    if (retries > 0) window.setTimeout(() => focusCodeMirror(retries - 1), 50);
  }, []);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const statsSeqRef = useRef(0);
  const toastIdRef = useRef(1);
  const saveRef = useRef<(opts?: { auto?: boolean; asNew?: boolean }) => Promise<void>>(async () => {});
  const openFileRef = useRef<(path: string) => Promise<void>>(async () => {});
  const tabsRef = useRef<Tab[]>(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(1);
  const nextTabId = useRef(2);
  const editorAreaRef = useRef<HTMLDivElement | null>(null);
  /** 随航模式右栏（预览）的滚动容器 */
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  /** 滚动联动的单向锁：正在被哪一侧驱动（"source" / "preview" / null） */
  const scrollLockRef = useRef<"source" | "preview" | null>(null);
  const scrollCooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTwPos = useRef(-1);
  const sessionStartRef = useRef(Date.now());
  /** 装载序号：只有最近一次「装载缓冲」的 stats 响应才允许建立会话基线。 */
  const loadSeqRef = useRef(0);
  /** D-5：确认请求 FIFO 队列（队首可见，一次作答结算整批）。 */
  const confirmQueueRef = useRef<ConfirmState[]>([]);
  /** D-8：输入请求自增序号，用作 PromptDialog 的 key，强制新请求重挂载。 */
  const promptSeqRef = useRef(0);
  /** D-8：当前输入请求；新请求取代旧请求时用它结算旧 Promise。 */
  const promptRef = useRef<PromptState | null>(null);
  /** D-7：被关闭的活动标签信息，待 tabs 提交后统一落地新的活动标签。 */
  const pendingActivateRef = useRef<{ closedIndex: number } | null>(null);
  /**
   * P9-3：已经出现过的目录集合。
   * 只对「新出现的目录」默认展开，不覆盖用户手动折叠的状态（状态本身由 App 持有）。
   */
  const knownTreeDirsRef = useRef<Set<string>>(new Set());

  const effectiveTheme = useTheme(settings?.theme ?? "system");

  const currentText = useCallback((): string => {
    // 随航模式下 CodeMirror 是事实源，同样返回源码文本。
    if (modeRef.current === "source" || modeRef.current === "split") return sourceTextRef.current;
    const ed = editorRef.current;
    if (!ed) return sourceTextRef.current;
    return joinFrontmatter(frontmatterRef.current, markdown.serialize(ed.getJSON()));
  }, []);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = toastIdRef.current++;
    setToasts((list) => [...list, { id, kind, message }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  // D-5：确认请求进入 FIFO 队列。已有对话框在显示时，新请求只入队、
  // 不顶掉队首（否则先到的 Promise 会被孤儿化、永不结算）。
  const askConfirm = useCallback(
    (message: string, title = "请确认", danger = false, kind: ConfirmKind = "generic"): Promise<boolean> =>
      new Promise((resolve) => {
        const request: ConfirmState = { kind, message, title, danger, resolve };
        confirmQueueRef.current.push(request);
        if (confirmQueueRef.current.length === 1) setConfirmState(request);
      }),
    []
  );

  // D-5 + P1：一次作答只结算「队首及其后连续同 kind」的请求。
  // - 同类别（例如两个「关闭标签」）一次结算整段：语义一致，符合 D-6/D-7 的预期。
  // - 跨类别（例如队首「删除文件」、队尾「关闭标签」）必须分开：把队尾留在队列里，
  //   并把队首换成队列中的下一个请求，让用户逐个确认，避免连带丢弃未保存内容。
  const settleConfirm = useCallback((ok: boolean) => {
    const queue = confirmQueueRef.current;
    if (!queue.length) {
      setConfirmState(null);
      return;
    }
    const headKind = queue[0].kind;
    let count = 0;
    while (count < queue.length && queue[count].kind === headKind) count++;
    const batch = queue.splice(0, count);
    // 剩余请求（跨类别）继续排队：把队首换成下一个请求，逐个向用户确认。
    setConfirmState(queue[0] ?? null);
    for (const request of batch) request.resolve(ok);
  }, []);

  // D-8：新的输入请求取代旧请求（旧请求立即以 null 结算，避免 Promise 悬空），
  // 并携带自增 id，使 PromptDialog 强制重挂载、不沿用上次的输入文本。
  const askInput = useCallback(
    (title: string, defaultValue: string): Promise<string | null> =>
      new Promise((resolve) => {
        promptRef.current?.resolve(null);
        const request: PromptState = { id: ++promptSeqRef.current, title, defaultValue, resolve };
        promptRef.current = request;
        setPromptState(request);
      }),
    []
  );

  const pushRecent = useCallback((path: string) => {
    setSettings((s) =>
      s ? { ...s, recent_files: [path, ...s.recent_files.filter((p) => p !== path)].slice(0, 20) } : s
    );
  }, []);

  const refreshTree = useCallback(async () => {
    const ws = workspaceRef.current;
    if (!ws) return;
    try {
      setTree(await api.listTree(ws));
    } catch {
      setTree(null);
    }
  }, []);

  // P9-3：默认展开全部目录（文件树需要直接呈现层级，ARIA tree 要求子节点嵌在父 treeitem 内）。
  // 只对「新出现的目录」默认展开，不覆盖用户手动折叠的状态。
  // 大目录保护：子树节点数超过 TREE_AUTO_EXPAND_MAX_NODES 的目录不自动展开，
  // 否则含上万条目的目录会一次渲染出海量 DOM 行，拖慢侧栏（用户仍可手动展开）。
  useEffect(() => {
    if (!tree) return;
    const dirs = collectDirPaths(tree);
    const sizes = collectDirSizes(tree);
    const fresh = dirs.filter((p) => !knownTreeDirsRef.current.has(p));
    for (const p of dirs) knownTreeDirsRef.current.add(p);
    if (!fresh.length) return;
    setTreeExpanded((s) => {
      const next = new Set(s);
      for (const p of fresh) {
        if ((sizes.get(p) ?? 0) <= TREE_AUTO_EXPAND_MAX_NODES) next.add(p);
      }
      return next;
    });
  }, [tree]);

  const toggleTreeDir = useCallback((path: string) => {
    setTreeExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  }, []);

  // ---- 定时自动保存：调度瞬间捕获标签身份，回调时校验，避免跨标签误存 ----
  const scheduleAutosave = useCallback(() => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    const ms = settingsRef.current?.autosave_ms ?? 1000;
    const path = filePathRef.current;
    const id = activeIdRef.current;
    if (ms <= 0 || !path) return;
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      if (activeIdRef.current !== id || filePathRef.current !== path || !dirtyRef.current) return;
      void saveRef.current({ auto: true });
    }, ms);
  }, []);

  // ---- 多标签：活动缓冲暂存/装载（单 tiptap 实例，undo 栈不跨标签保留） ----
  const stashActive = useCallback(() => {
    // D1：所有 ref 读取必须在调用瞬间完成，setState 更新器内禁止再读 ref。
    const leavingId = activeIdRef.current;
    const leavingText = currentText();
    const leavingPath = filePathRef.current;
    const leavingDirty = dirtyRef.current;
    const leavingName = leavingPath ? basename(leavingPath) : "未命名";
    setTabs((ts) =>
      ts.map((t) =>
        t.id === leavingId
          ? { ...t, path: leavingPath, name: leavingName, text: leavingText, dirty: leavingDirty }
          : t
      )
    );
  }, [currentText]);

  const loadBuffer = useCallback((tab: Tab) => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    const seq = ++statsSeqRef.current;
    const { frontmatter, body } = splitFrontmatter(tab.text);
    frontmatterRef.current = frontmatter;
    editorRef.current?.commands.setContent(markdown.parse(body), { emitUpdate: false });
    // setContent 是整篇替换 → 选区会变成「整篇」；编辑器若仍持有焦点，
    // 用户下一个按键就把整篇替换掉了（数据丢失）。必须收成折叠光标。
    if (editorRef.current) collapseSelection(editorRef.current);
    filePathRef.current = tab.path;
    setFilePath(tab.path);
    sourceTextRef.current = tab.text;
    setSourceText(tab.text);
    lastMdRef.current = tab.text;
    lastSavedTextRef.current = tab.dirty ? null : tab.text;
    dirtyRef.current = tab.dirty;
    setDirty(tab.dirty);
    setConflict(false);
    lastTwPos.current = -1;
    // 会话基线：以打开/切换时的字数为「本次 +N」起点
    sessionStartRef.current = Date.now();
    setSessionMinutes(0);
    // G3-2：基线只由「装载缓冲」这一次 stats 响应确定；编辑触发的防抖统计不得改写基线。
    const loadSeq = ++loadSeqRef.current;
    setBaselineWords(null);
    void api
      .stats(tab.text)
      .then((s) => {
        // 已切换到别的标签 → 这次装载的响应整体作废。
        if (loadSeq !== loadSeqRef.current) return;
        // 迟到的装载响应同样必须建立基线：它携带的是「装载缓冲时」的字数。
        setBaselineWords((prev) => (prev === null ? s.words : prev));
        // 只有仍是最新一次统计请求时才更新当前字数（防抖统计可能已经更新过）。
        if (seq === statsSeqRef.current) setStats(s);
      })
      .catch(() => {});
    // 切回尚未落盘的脏标签时重新排程，否则旧定时已被清空、再也不会自动保存。
    if (tab.dirty && tab.path) scheduleAutosave();
  }, [scheduleAutosave]);

  const activateTab = useCallback(
    (tab: Tab) => {
      if (tab.id === activeIdRef.current) return;
      if (autoTimer.current) {
        clearTimeout(autoTimer.current);
        autoTimer.current = null;
      }
      stashActive();
      activeIdRef.current = tab.id;
      setActiveId(tab.id);
      loadBuffer(tab);
    },
    [stashActive, loadBuffer]
  );

  const closeTab = useCallback(
    async (id: number) => {
      const t = tabsRef.current.find((x) => x.id === id);
      if (!t) return;
      if (t.dirty && !(await askConfirm(`「${t.name}」未保存，确定关闭？`, "关闭标签", true, "close-tab"))) return;
      // D-7：删除必须用函数式更新器，保证并发关闭（如批量结算确认）时
      // 后一次能看到前一次的结果，不会用陈旧快照把已删除的标签写回来。
      const wasActive = id === activeIdRef.current;
      const closedIndex = tabsRef.current.findIndex((x) => x.id === id);
      setTabs((ts) => ts.filter((x) => x.id !== id));
      if (wasActive) {
        // 活动标签被关闭 → 新的活动标签在 tabs 提交后由下面的 effect 统一落地。
        pendingActivateRef.current = { closedIndex };
      }
    },
    [askConfirm]
  );

  // D-7：标签被关闭后，在 tabs 提交之后再落地新的活动标签，
  // 避免用删除前的陈旧快照计算邻居（并发关闭时会把已删标签写回来）。
  useEffect(() => {
    if (tabs.length === 0) {
      // 最后一个标签被关闭 → 回到空白草稿
      const fresh: Tab = { id: nextTabId.current++, path: null, name: "未命名", text: "", dirty: false };
      setTabs([fresh]);
      activeIdRef.current = fresh.id;
      setActiveId(fresh.id);
      loadBuffer(fresh);
      return;
    }
    const pending = pendingActivateRef.current;
    if (!pending) return;
    pendingActivateRef.current = null;
    if (tabs.some((t) => t.id === activeIdRef.current)) return; // 活动标签仍在，无需切换
    const next = tabs[Math.min(pending.closedIndex, tabs.length - 1)];
    if (next) activateTab(next);
  }, [tabs, activateTab, loadBuffer]);

  const save = useCallback(
    async (opts?: { auto?: boolean; asNew?: boolean }) => {
      if (!editorRef.current) return;
      // D-1/D-3：在第一个 await 之前一次性捕获「本次保存归属的标签 id + 该标签 path + 该标签文本」。
      // 之后每一个 await 边界都必须以这个三元组为准：内容取自被保存的那个标签，
      // 而不是当前活动标签；跨标签的写入一律以身份校验为前提。
      const savingId = activeIdRef.current;
      const savingText = currentText();
      let path = filePathRef.current;
      if (!path || opts?.asNew) {
        if (opts?.auto) return;
        const picked = await api.pickSaveFile(path ? basename(path) : "未命名.md");
        if (!picked) return;
        path = picked;
      }
      const savingName = basename(path);
      setSaving(true);
      try {
        await api.saveFile(path, savingText);
        // D-1：await 之后先校验身份——只有「当前活动标签 === 本次保存归属的标签」时才允许改写全局状态。
        const stillActive = activeIdRef.current === savingId;
        // dirty 只在「保存发起之后内容没有再变」时才允许清零
        // （B3：保存期间继续输入时，落盘内容不含新输入，dirty 必须保持）。
        const latestText = stillActive
          ? currentText()
          : (tabsRef.current.find((t) => t.id === savingId)?.text ?? savingText);
        const unchanged = latestText === savingText;
        if (opts?.asNew) {
          // D-4：另存为不改动源标签（既不改名也不清 dirty），另开新标签承载新文件。
          const newTab: Tab = { id: nextTabId.current++, path, name: savingName, text: savingText, dirty: false };
          setTabs((ts) => [...ts, newTab]);
          // 只有「源标签仍是活动标签且内容未再变化」才切到新标签，否则保持当前活动标签不动。
          if (stillActive && unchanged) {
            stashActive();
            activeIdRef.current = newTab.id;
            setActiveId(newTab.id);
            loadBuffer(newTab);
          }
        } else {
          setTabs((ts) =>
            ts.map((t) =>
              t.id === savingId
                ? { ...t, path, name: savingName, text: unchanged ? savingText : t.text, dirty: !unchanged }
                : t
            )
          );
          if (stillActive) {
            filePathRef.current = path;
            setFilePath(path);
            lastSavedTextRef.current = savingText;
            dirtyRef.current = !unchanged;
            setDirty(!unchanged);
          }
        }
        pushRecent(path);
        if (!opts?.auto) pushToast("success", `已保存 ${savingName}`);
        if (!workspaceRef.current) {
          const dir = dirname(path);
          if (dir) {
            workspaceRef.current = dir;
            setWorkspace(dir);
          }
        }
        const ws = workspaceRef.current;
        if (ws) {
          void api
            .snapshotSave(ws, path, savingText, false, settingsRef.current?.snapshot_keep, settingsRef.current?.snapshot_days)
            .then(() => setSnapVersion((v) => v + 1))
            .catch(() => {});
        }
        void refreshTree();
      } catch (err) {
        pushToast("error", `保存失败：${err}`);
      } finally {
        setSaving(false);
      }
    },
    [currentText, pushRecent, refreshTree, pushToast, stashActive, loadBuffer]
  );
  saveRef.current = save;

  /** 关窗 flush 使用的保存器：严格写入传入的 tab.path / text，不读取当前 editor 状态。 */
  const saveTabText = useCallback(async (tab: Tab, text: string) => {
    if (!tab.path) return;
    await api.saveFile(tab.path, text);
    setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, text, dirty: false } : t)));
    if (tab.id === activeIdRef.current) {
      lastSavedTextRef.current = text;
      dirtyRef.current = false;
      setDirty(false);
    }
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      try {
        const existing = tabsRef.current.find((t) => t.path === path);
        if (existing && existing.dirty) {
          activateTab(existing);
          return;
        }
        const text = await api.readFile(path);
        const tab: Tab = existing
          ? { ...existing, text, dirty: false }
          : { id: nextTabId.current++, path, name: basename(path), text, dirty: false };
        // 先确立工作区再装载：图片 renderHTML 依赖 base 解析 asset 协议
        if (!workspaceRef.current) {
          const dir = dirname(path);
          if (dir) {
            workspaceRef.current = dir;
            setWorkspace(dir);
          }
        }
        stashActive();
        setTabs((ts) => (existing ? ts.map((t) => (t.id === tab.id ? tab : t)) : [...ts, tab]));
        activeIdRef.current = tab.id;
        setActiveId(tab.id);
        loadBuffer(tab);
        pushRecent(path);
        const ws = workspaceRef.current;
        if (ws) {
          void api
            .snapshotSave(ws, path, text, true, settingsRef.current?.snapshot_keep, settingsRef.current?.snapshot_days)
            .then(() => setSnapVersion((v) => v + 1))
            .catch(() => {});
        }
      } catch (err) {
        pushToast("error", `打开失败：${err}`);
      }
    },
    [pushRecent, activateTab, stashActive, loadBuffer, pushToast]
  );
  openFileRef.current = openFile;

  /**
   * 冲突横幅的「重新加载」：用磁盘内容覆盖当前未保存内容。
   *
   * 之前这里直接调 openFile(path)，而 openFile 开头有「标签已脏 → 只激活不重载」
   * 的短路 —— 冲突横幅恰恰只在**脏**的时候出现，于是「重新加载」永远命中短路，
   * 是个**点了没反应的死按钮**（与「保留我的」互为死结）。这里绕过短路直接读盘。
   */
  const reloadFromDisk = useCallback(async () => {
    const path = filePathRef.current;
    if (!path) return;
    try {
      const text = await api.readFile(path);
      // 读取期间用户可能已经切换了标签/文件：此时不得覆盖当前内容。
      if (filePathRef.current !== path) return;
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (!tab) return;
      const next: Tab = { ...tab, text, dirty: false };
      setTabs((ts) => ts.map((t) => (t.id === next.id ? next : t)));
      loadBuffer(next);
      pushToast("success", "已从磁盘重新加载");
    } catch (err) {
      pushToast("error", `重新加载失败：${err}`);
    }
  }, [loadBuffer, pushToast]);

  const scheduleStats = useCallback(() => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
    const id = activeIdRef.current;
    statsTimer.current = setTimeout(() => {
      statsTimer.current = null;
      if (activeIdRef.current !== id) return;
      const seq = ++statsSeqRef.current;
      void api
        .stats(currentText())
        .then((s) => {
          if (seq !== statsSeqRef.current || activeIdRef.current !== id) return;
          // G3-2：防抖统计只更新当前字数，绝不改写「本次 +N 字」的基线。
          setStats(s);
        })
        .catch(() => {});
    }, 300);
  }, [currentText]);

  const markChanged = useCallback(() => {
    const id = activeIdRef.current;
    dirtyRef.current = true;
    setDirty(true);
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, dirty: true } : t)));
    scheduleAutosave();
    scheduleStats();
  }, [scheduleAutosave, scheduleStats]);

  const onSourceChange = useCallback(
    (text: string) => {
      sourceTextRef.current = text;
      setSourceText(text);
      markChanged();
    },
    [markChanged]
  );

  const { editor, elementRef } = useEditor({
    extensions: [
      ...extensions,
      imageAssets(
        () => workspaceRef.current || (filePathRef.current ? dirname(filePathRef.current) : null),
        (msg) => pushToast("error", msg)
      ),
      htmlPaste,
      focusMode(() => settingsRef.current?.focus_mode ?? false),
      findReplace,
    ],
    content: markdown.parse(""),
    onUpdate: markChanged,
    // 可访问性：编辑区是真正的输入区域，屏幕阅读器需要知道它叫什么、能做什么。
    // contenteditable 元素默认被读作「可编辑文本」，但没有名字就无法被导航。
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Markdown 正文编辑区",
      },
    },
    // D2：纯装饰/meta 事务不触发顶层渲染，但 find 查询/导航必须放行。
    rerenderOn: (tr) => !!tr.getMeta(findKey),
  });
  editorRef.current = editor;
  setImageBaseGetter(() => workspaceRef.current || (filePathRef.current ? dirname(filePathRef.current) : null));

  /**
   * 富文本容器的 ref 回调：既喂给 useEditor（它只在挂载时读一次
   * elementRef.current 来创建编辑器），又作为随航模式**右栏预览**的滚动容器。
   * 用回调 ref 而不是两个独立 ref，是因为它们指向的是同一个 DOM 节点。
   */
  const editorWrapRef = useCallback((el: HTMLDivElement | null) => {
    elementRef.current = el;
    previewPaneRef.current = el;
  }, []);

  /**
   * 把 Markdown 文本灌进富文本实例，用作**随航模式的右栏预览**。
   *
   * 三个关键点：
   *  1. **不进 undo 栈**（`addToHistory: false`）—— 预览是频繁重建的，
   *     若进历史栈，用户切回所见即所得后按 Ctrl+Z 撤掉的是「预览同步」，
   *     而��是他自己的编辑。
   *  2. **不触发 onUpdate**（`preventUpdate: true`）—— 否则每次预览同步
   *     都会把文档标记为「已修改」。
   *  3. **保住滚动位置** —— setContent 会把视口定位到文档开头，
   *     预览的滚动必须自己恢复，否则用户每敲一个字预览就跳回顶部。
   */
  const syncPreview = useCallback((text: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const { frontmatter, body } = splitFrontmatter(text);
    frontmatterRef.current = frontmatter;
    const pane = previewPaneRef.current;
    const keep = pane ? pane.scrollTop : 0;
    try {
      const parsed = markdown.parse(body);
      const fragment = Fragment.from(
        (parsed.content ?? []).map((n) => ed.schema.nodeFromJSON(n)).filter(Boolean)
      );
      const tr = ed.state.tr
        .replaceWith(0, ed.state.doc.content.size, fragment)
        .setMeta("preventUpdate", true)
        .setMeta("addToHistory", false);
      ed.view.dispatch(tr);
      collapseSelection(ed);
    } catch {
      // 解析失败时退回 setContent（保证预览至少能更新）
      ed.commands.setContent(markdown.parse(body), { emitUpdate: false });
    }
    if (pane) pane.scrollTop = keep;
    lastMdRef.current = text;
  }, []);

  const toSource = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    // 记住 WYSIWYG 光标：切回富文本时恢复，否则光标会跳到文档开头/末尾。
    savedCaretRef.current = { pos: ed.state.selection.head, size: ed.state.doc.content.size };
    // 随航模式下 CodeMirror 才是事实源，**不能用只读预览的内容覆盖用户正在编辑的源码**。
    if (modeRef.current === "split") {
      // 随航期间富文本实例是只读预览；退出时必须恢复可编辑，
      // 否则切回所见即所得会出现「能看不能改」。
      ed.setEditable(true);
      modeRef.current = "source";
      setMode("source");
      focusCodeMirror();
      return;
    }
    const md = joinFrontmatter(frontmatterRef.current, markdown.serialize(ed.getJSON()));
    // 源码模式的光标：
    //  - 源码内容相对上次没变 → 沿用用户上次摆在源码里的位置（用户自己动过的光标
    //    不该被富文本光标覆盖）；
    //  - 源码变了（在富文本里编辑过）→ 按富文本光标换算过去，
    //    偏移要加上 frontmatter 长度（CM 的文档包含 frontmatter，而
    //    pmPosToTextOffset 算的是正文里的偏移）。
    if (!cmSelRef.current || cmSelRef.current.text !== md) {
      const off = frontmatterRef.current.length + pmPosToTextOffset(ed.state.doc, ed.state.selection.head);
      cmSelRef.current = { anchor: off, head: off, text: md };
    }
    sourceTextRef.current = md;
    setSourceText(md);
    lastMdRef.current = md;
    modeRef.current = "source";
    setMode("source");
    // 源码模式是懒加载的，CodeMirror 挂载后才有实例；轮询等它就位再交焦点，
    // 否则用户切过去看到的是一片没有光标的文本。
    focusCodeMirror();
  }, []);

  const toWysiwyg = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const wasSource = modeRef.current === "source";
    const wasSplit = modeRef.current === "split";
    if (wasSplit) {
      // 随航模式下 CodeMirror 是事实源，富文本实例只是只读预览。
      // 切回所见即所得前必须把预览**立刻**同步到 CM 的最新文本
      // （防抖可能还没到），否则用户会看到自己刚输入的字消失。
      syncPreview(sourceTextRef.current);
      lastMdRef.current = sourceTextRef.current;
      // 预览同步是整篇替换 → 选区会变成「整篇」，切回后用户首个按键会抹掉全文
      if (ed) collapseSelection(ed);
    } else if (sourceTextRef.current !== lastMdRef.current) {
      // 源码未改动时不重建文档：保留光标与 undo（SPEC §5.1）
      const { frontmatter, body } = splitFrontmatter(sourceTextRef.current);
      frontmatterRef.current = frontmatter;
      ed.commands.setContent(markdown.parse(body), { emitUpdate: false });
      lastMdRef.current = sourceTextRef.current;
    }
    if (wasSource) {
      // 两处光标丢失都要补回来：
      //  1) setContent 会把选区放到文档末尾；
      //  2) 源码模式下富文本容器是 display:none，浏览器的选区随之消失 ——
      //     ProseMirror 内部状态还在，但用户看不到光标。
      restoreCaret(ed, savedCaretRef.current);
      requestAnimationFrame(() => ed.view.focus());
    }
    ed.setEditable(true);
    modeRef.current = "wysiwyg";
    setMode("wysiwyg");
  }, [syncPreview]);

  /**
   * 进入「随航」模式：左侧源码、右侧实时预览。
   *
   * 事实源切换：从所见即所得进来时，富文本是事实源 → 把它的内容序列化成 Markdown
   * 交给左栏；之后用户在左栏打字，左栏（CodeMirror）成为事实源，
   * 右栏（富文本实例）退化为只读预览。
   */
  const toSplit = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (modeRef.current !== "split") {
      // 从所见即所得进来：富文本是事实源，先同步给左栏。
      const md = joinFrontmatter(frontmatterRef.current, markdown.serialize(ed.getJSON()));
      sourceTextRef.current = md;
      setSourceText(md);
      lastMdRef.current = md;
      savedCaretRef.current = { pos: ed.state.selection.head, size: ed.state.doc.content.size };
      const off = frontmatterRef.current.length + pmPosToTextOffset(ed.state.doc, ed.state.selection.head);
      cmSelRef.current = { anchor: off, head: off, text: md };
    }
    // 右栏变成只读预览
    ed.setEditable(false);
    modeRef.current = "split";
    setMode("split");
    focusCodeMirror();
  }, [focusCodeMirror]);

  const toggleSplit = useCallback(() => {
    if (modeRef.current === "split") {
      // 退出随航 → 回到所见即所得（预览里的内容已经是 CM 的最新文本）
      toWysiwyg();
    } else {
      toSplit();
    }
  }, [toSplit, toWysiwyg]);

  const toggleMode = useCallback(() => {
    // 随航也归到「非所见即所得」一侧：⇄ 按钮在随航时显示的就是「所见即所得」，
    // 点它必须真的回到所见即所得，而不是被当成「还没进源码」又进一次源码。
    if (modeRef.current === "wysiwyg") toSource();
    else toWysiwyg();
  }, [toSource, toWysiwyg]);

  // 随航模式：源码侧改动 → 防抖后同步到右栏预览。
  // 160ms 是权衡：低于 100ms 会在快速输入时反复重建文档（卡顿），
  // 高于 250ms 则预览「跟不上手」，用户会以为没生效。
  useEffect(() => {
    if (mode !== "split") return;
    const t = window.setTimeout(() => {
      syncPreview(sourceTextRef.current);
    }, 160);
    return () => window.clearTimeout(t);
  }, [sourceText, mode, syncPreview]);

  // 随航模式：两侧滚动联动。
  //
  // 关键在**单向锁**：两侧互相驱动会形成正反馈（用户滚左 → 右跟着滚 →
  // 右的 scroll 事件又触发左跟着滚），表现为持续抖动甚至无限循环。
  // 做法是：任一侧滚动时上锁并驱动对侧，冷却 120ms 后解锁；
  // 锁定期间对侧的 scroll 事件被忽略。
  useEffect(() => {
    if (mode !== "split") return;
    const cm = cmViewRef.current;
    const pane = previewPaneRef.current;
    if (!cm || !pane) return;

    const release = () => {
      if (scrollCooldownTimer.current) clearTimeout(scrollCooldownTimer.current);
      scrollCooldownTimer.current = window.setTimeout(() => {
        scrollLockRef.current = null;
        scrollCooldownTimer.current = null;
      }, 120);
    };
    const ratioOf = (top: number, size: number, client: number) => {
      const span = size - client;
      return span > 0 ? top / span : 0;
    };
    const onSourceScroll = () => {
      if (scrollLockRef.current === "preview") return;
      scrollLockRef.current = "source";
      const c = cm.scrollDOM;
      pane.scrollTop =
        ratioOf(c.scrollTop, c.scrollHeight, c.clientHeight) * Math.max(0, pane.scrollHeight - pane.clientHeight);
      release();
    };
    const onPreviewScroll = () => {
      if (scrollLockRef.current === "source") return;
      scrollLockRef.current = "preview";
      const c = cm.scrollDOM;
      c.scrollTop =
        ratioOf(pane.scrollTop, pane.scrollHeight, pane.clientHeight) * Math.max(0, c.scrollHeight - c.clientHeight);
      release();
    };

    cm.scrollDOM.addEventListener("scroll", onSourceScroll, { passive: true });
    pane.addEventListener("scroll", onPreviewScroll, { passive: true });
    return () => {
      cm.scrollDOM.removeEventListener("scroll", onSourceScroll);
      pane.removeEventListener("scroll", onPreviewScroll);
      if (scrollCooldownTimer.current) {
        clearTimeout(scrollCooldownTimer.current);
        scrollCooldownTimer.current = null;
      }
      scrollLockRef.current = null;
    };
  }, [mode, cmReady]);

  const newFile = useCallback(() => {
    stashActive();
    const tab: Tab = { id: nextTabId.current++, path: null, name: "未命名", text: "", dirty: false };
    setTabs((ts) => [...ts, tab]);
    activeIdRef.current = tab.id;
    setActiveId(tab.id);
    loadBuffer(tab);
    setStats({ words: 0, chars: 0, reading_minutes: 0 });
  }, [stashActive, loadBuffer]);

  const openFolder = useCallback(async () => {
    const picked = await api.pickFolder();
    if (!picked) return;
    workspaceRef.current = picked;
    setWorkspace(picked);
    setSidebarOpen(true);
    setSidebarTab("files");
    void refreshTree();
  }, [refreshTree]);

  const openFileDialog = useCallback(async () => {
    const picked = await api.pickOpenFile();
    if (picked) await openFile(picked);
  }, [openFile]);

  const treeNewFile = useCallback(
    async (dir: string) => {
      const name = await askInput("新文件名", "未命名.md");
      if (!name) return;
      const finalName = /\.\w+$/.test(name) ? name : `${name}.md`;
      const path = `${dir}/${finalName}`;
      try {
        await api.saveFile(path, "");
        await refreshTree();
        await openFile(path);
        pushToast("success", `已新建 ${finalName}`);
      } catch (err) {
        pushToast("error", `新建失败：${err}`);
      }
    },
    [refreshTree, openFile, askInput, pushToast]
  );

  const treeRename = useCallback(
    async (node: TreeNode) => {
      const name = await askInput("新名称", node.name);
      if (!name || name === node.name) return;
      const oldPath = node.path;
      const newPath = `${dirname(oldPath)}/${name}`;
      const newName = basename(newPath);
      try {
        await api.renamePath(oldPath, newPath);
        if (filePathRef.current === oldPath) {
          filePathRef.current = newPath;
          setFilePath(newPath);
        }
        // E03：同步所有指向旧路径的标签，防止 stashActive 把内容写回已不存在的路径。
        setTabs((ts) => ts.map((t) => (t.path === oldPath ? { ...t, path: newPath, name: newName } : t)));
        await refreshTree();
        pushToast("success", `已重命名为 ${newName}`);
      } catch (err) {
        pushToast("error", `重命名失败：${err}`);
      }
    },
    [refreshTree, askInput, pushToast]
  );

  const treeDelete = useCallback(
    async (node: TreeNode) => {
      if (!(await askConfirm(`删除「${node.name}」？将移入 .mwtyper/trash，可恢复。`, "删除文件", true, "delete-file"))) return;
      const deletedPath = node.path;
      try {
        await api.deletePath(deletedPath, workspaceRef.current || dirname(deletedPath));
        if (filePathRef.current === deletedPath) {
          filePathRef.current = null;
          setFilePath(null);
        }
        // E03：删除后标签退回未命名草稿，不再持有失效路径。
        setTabs((ts) => ts.map((t) => (t.path === deletedPath ? { ...t, path: null, name: "未命名" } : t)));
        await refreshTree();
        pushToast("success", `已删除 ${node.name}（可从 .mwtyper/trash 恢复）`);
      } catch (err) {
        pushToast("error", `删除失败：${err}`);
      }
    },
    [refreshTree, askConfirm, pushToast]
  );

  const jumpToHeading = useCallback(
    (index: number) => {
      if (modeRef.current === "source") toWysiwyg();
      const ed = editorRef.current;
      if (!ed) return;
      const positions: number[] = [];
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") positions.push(pos);
        return true;
      });
      const pos = positions[index];
      if (pos === undefined) return;
      ed.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    },
    [toWysiwyg]
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open;
      setSettings((s) => (s ? { ...s, sidebar_open: next } : s));
      return next;
    });
  }, []);

  const cycleTheme = useCallback(() => {
    setSettings((s) => {
      if (!s) return s;
      const order = ["system", "light", "dark"] as const;
      const next = order[(order.indexOf(s.theme) + 1) % order.length];
      return { ...s, theme: next };
    });
  }, []);

  // ---- M2：快照 / 搜索跳转 / 导出 / 专注 / 目标 ----
  const snapshotNow = useCallback(
    (auto: boolean) => {
      const ws = workspaceRef.current;
      const path = filePathRef.current;
      if (!ws || !path) return;
      void api
        .snapshotSave(ws, path, currentText(), auto, settingsRef.current?.snapshot_keep, settingsRef.current?.snapshot_days)
        .then(() => setSnapVersion((v) => v + 1))
        .catch(() => {});
    },
    [currentText]
  );

  const restoreSnapshot = useCallback(
    async (text: string) => {
      // D-7：在第一个 await 之前捕获身份（标签 id + 目标路径），
      // await 之后校验；不符则整个恢复放弃，不得改写编辑区与全局状态。
      const id = activeIdRef.current;
      const path = filePathRef.current;
      const ws = workspaceRef.current;
      if (!path || !ws) return;
      if (!(await askConfirm("恢复此版本会覆盖当前文件（当前内容会自动快照），确定继续？", "恢复快照", true, "restore-snapshot"))) return;
      // 确认期间用户可能已经切换标签 → 身份不符，整个恢复放弃。
      if (activeIdRef.current !== id || filePathRef.current !== path) {
        pushToast("info", "恢复已取消：当前标签已切换");
        return;
      }
      const name = basename(path);
      try {
        // 恢复前自动再快照当前内容（SPEC §5.6.1）
        await api.snapshotSave(ws, path, currentText(), true, settingsRef.current?.snapshot_keep, settingsRef.current?.snapshot_days);
        await api.saveFile(path, text);
        // 落盘期间用户仍可能切换标签 → 身份不符时不再触碰编辑区、标签与 dirty。
        if (activeIdRef.current !== id || filePathRef.current !== path) {
          pushToast("info", `${name} 已恢复，但当前标签已切换，编辑区未刷新`);
          return;
        }
        lastSavedTextRef.current = text;
        dirtyRef.current = false;
        setDirty(false);
        loadBuffer({ id, path, name, text, dirty: false });
        setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, text, dirty: false } : t)));
        setSnapVersion((v) => v + 1);
        pushToast("success", `已恢复 ${name} 的历史版本`);
      } catch (err) {
        pushToast("error", `恢复失败：${err}`);
      }
    },
    [currentText, loadBuffer, askConfirm, pushToast]
  );

  const openHit = useCallback(
    async (path: string, lineNo: number) => {
      await openFile(path);
      toSource();
      if (hitTimer.current) clearTimeout(hitTimer.current);
      hitTimer.current = setTimeout(() => {
        hitTimer.current = null;
        const v = cmViewRef.current;
        if (!v) return;
        const line = v.state.doc.line(Math.max(1, Math.min(lineNo, v.state.doc.lines)));
        v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
        v.focus();
      }, 120);
    },
    [openFile, toSource]
  );

  const exportBase = () => workspaceRef.current || (filePathRef.current ? dirname(filePathRef.current) : "");
  const exportTitle = () => (filePathRef.current ? basename(filePathRef.current).replace(/\.\w+$/, "") : "未命名");

  const doExportHtml = useCallback(async () => {
    try {
      const { buildExportHtml } = await import("./export");
      const html = await buildExportHtml(currentText(), exportTitle(), document.documentElement.dataset.theme || "light", exportBase(), document.getElementById("mwtyper-custom-theme")?.textContent ?? "");
      const picked = await api.pickSaveFile(`${exportTitle()}.html`);
      if (picked) {
        await api.saveFile(picked, html);
        pushToast("success", `已导出 HTML：${basename(picked)}`);
      }
    } catch (err) {
      pushToast("error", `导出失败：${err}`);
    }
  }, [currentText, pushToast]);

  const doExportPdf = useCallback(async () => {
    try {
      const { buildExportHtml, printHtml } = await import("./export");
      const html = await buildExportHtml(currentText(), exportTitle(), "light", exportBase(), document.getElementById("mwtyper-custom-theme")?.textContent ?? "");
      printHtml(html);
      pushToast("success", "已打开打印对话框（另存为 PDF）");
    } catch (err) {
      pushToast("error", `导出失败：${err}`);
    }
  }, [currentText, pushToast]);

  const toggleFocus = useCallback(() => {
    const s = settingsRef.current;
    if (!s) return;
    const next = { ...s, focus_mode: !s.focus_mode };
    settingsRef.current = next;
    setSettings(next);
    const ed = editorRef.current;
    if (ed) ed.view.dispatch(ed.state.tr.setMeta("mwtyperFocusToggle", true));
  }, []);

  const toggleTypewriter = useCallback(() => {
    const s = settingsRef.current;
    if (!s) return;
    const next = { ...s, typewriter_mode: !s.typewriter_mode };
    settingsRef.current = next;
    setSettings(next);
    lastTwPos.current = -1;
  }, []);

  const setGoal = useCallback(async () => {
    const cur = settingsRef.current?.goal_words ?? 0;
    const input = await askInput("写作目标（字数，0 = 关闭）", String(cur));
    if (input === null) return;
    const n = Math.max(0, parseInt(input, 10) || 0);
    setSettings((s) => (s ? { ...s, goal_words: n } : s));
  }, [askInput]);

  const showPanel = useCallback((tab: "files" | "outline" | "search" | "history") => {
    setSidebarOpen(true);
    setSidebarTab(tab);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setSettings((s) => (s ? { ...s, zoom: Math.min(200, Math.max(50, (s.zoom ?? 100) + delta)) } : s));
  }, []);

  const openPalette = useCallback((mode: "commands" | "files") => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  }, []);

  const openSettings = useCallback(() => {
    void api.listThemes().then(setThemes).catch(() => setThemes([]));
    void api.themesDirPath().then(setThemesDir).catch(() => {});
    setSettingsOpen(true);
  }, []);

  /**
   * 安装内置示例主题：写入主题目录后刷新下拉列表。
   * 已存在的同名文件**不覆盖**（Rust 侧保证），所以重复点不会丢用户的修改。
   */
  const [installingThemes, setInstallingThemes] = useState(false);
  const installThemes = useCallback(async () => {
    setInstallingThemes(true);
    try {
      const installed = await api.installBuiltinThemes();
      const list = await api.listThemes();
      setThemes(list);
      pushToast(
        "success",
        installed.length ? `已安装 ${installed.length} 套示例主题` : "示例主题已全部安装"
      );
    } catch (err) {
      pushToast("error", `安装示例主题失败：${err}`);
    } finally {
      setInstallingThemes(false);
    }
  }, [pushToast]);

  /** 打开帮助中心；可指定初始分区（命令面板可直达「检查更新」等） */
  const openHelp = useCallback((section: HelpSection = "markdown") => {
    setHelpSection(section);
    setHelpOpen(true);
  }, []);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
  }, []);

  // 自定义主题：注入 <style id="mwtyper-custom-theme">，覆盖 :root CSS 变量（SPEC §5.7）
  const applyCustomTheme = useCallback(async (name: string) => {
    const existing = document.getElementById("mwtyper-custom-theme");
    if (!name) {
      existing?.remove();
      return;
    }
    try {
      const css = await api.readTheme(name);
      // 主题文件若声明了基色（--mw-base-*），系统派生出**整套**令牌（深浅两套），
      // 这样一次改动就覆盖整个软件（标题栏 / 侧栏 / 状态栏 / 编辑区 / 弹窗 / 代码块），
      // 而不是只有编辑器那几项。用户显式写出的令牌仍会覆盖派生值。
      const { derived, injected } = buildThemeCss(css);
      let el = document.getElementById("mwtyper-custom-theme") as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement("style");
        el.id = "mwtyper-custom-theme";
        document.head.append(el);
      }
      el.textContent = derived ? `${derived}\n\n${injected}` : injected;
    } catch {
      existing?.remove();
    }
  }, []);

  // 设置加载 + 持久化
  useEffect(() => {
    void api.readSettings().then((s) => {
      settingsRef.current = s;
      setSettings(s);
      setSidebarOpen(s.sidebar_open);
    });
  }, []);
  // E13：设置写盘 300ms 防抖；失败不静默吞。
  useEffect(() => {
    settingsRef.current = settings;
    if (!settings) return;
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => {
      settingsTimer.current = null;
      void api.writeSettings(settings).catch((err) => pushToast("error", `设置保存失败：${err}`));
    }, 300);
    return () => {
      if (settingsTimer.current) {
        clearTimeout(settingsTimer.current);
        settingsTimer.current = null;
      }
    };
  }, [settings, pushToast]);

  // E01：关窗 flush；真正的数据逻辑在可导出的纯函数 flushAllDirty 里，这里只做事件接线。
  //
  // 关闭按钮曾经「点了没反应」，根因是权限：能力配置里只声明了
  // `core:window:allow-close`，而关闭流程走的是 `destroy()`（close → 触发
  // closeRequested → preventDefault → flush → destroy），`destroy` 未授权被
  // ACL 拒绝，而 `void promise` 把 rejection 吞掉 → 窗口永不关闭。
  //
  // 现在改成**幂等的二次 close**：
  //   第一次请求 → preventDefault → flush → 再次 close（此时不再拦截）→ 正常关闭
  // 正常路径只依赖已授权的 `allow-close`；`destroy` 仅作兜底（并已补授权）。
  useEffect(() => {
    const flush = () => flushAllDirty(tabsRef.current, currentText, activeIdRef.current, saveTabText);
    const onBeforeUnload = () => { void flush(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    let unlisten: (() => void) | undefined;
    if (isTauri) {
      void getCurrentWindow()
        .onCloseRequested((event) => {
          // closingRef：已决定关闭 → 第二次请求放行，走正常关闭流程
          if (closingRef.current) return;
          // flushingRef：正在落盘 → 这期间再点关闭必须拦住，
          // 否则会在 flush 之前就把窗口关掉，未保存内容丢失。
          if (flushingRef.current) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          flushingRef.current = true;
          void flush().finally(() => {
            flushingRef.current = false;
            closingRef.current = true;
            void getCurrentWindow()
              .close()
              .catch(() => {
                // 兜底：若 close 仍被拦截，退回 destroy（需要 allow-destroy 权限）
                closingRef.current = false;
                void getCurrentWindow().destroy().catch((err) => {
                  // 兜底也失败：已经没有别的办法关窗了，至少留下现场
                  console.error("[MWTyper] 窗口关闭失败（destroy）", err);
                });
              });
          });
        })
        .then((fn) => { unlisten = fn; })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      unlisten?.();
    };
  }, [currentText, saveTabText]);

  // E15：会话分钟数随真实时间递增。
  useEffect(() => {
    const t = setInterval(() => {
      setSessionMinutes(Math.floor((Date.now() - sessionStartRef.current) / 60000));
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Ctrl+K 的链接输入由 App 的 PromptDialog 提供，扩展内不再使用原生输入弹窗。
  useEffect(() => {
    setLinkPrompt(async (previous) => askInput("链接地址", previous || "https://"));
    return () => setLinkPrompt(null);
  }, [askInput]);

  // E18：卸载时统一清理所有 setTimeout 与拖拽监听。
  useEffect(() => () => {
    for (const timer of [autoTimer, statsTimer, treeTimer, settingsTimer, hitTimer, sourceSearchTimer]) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    }
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, []);

  useEffect(() => {
    void applyCustomTheme(settings?.custom_theme ?? "");
  }, [settings?.custom_theme, applyCustomTheme]);

  // 主题目录热加载：外部增删改 .css → 刷新列表并重读当前主题
  useEffect(() => {
    void api.watchThemes().catch(() => {});
    let un: (() => void) | undefined;
    void api
      .onThemesChange(() => {
        void api.listThemes().then(setThemes).catch(() => {});
        const cur = settingsRef.current?.custom_theme;
        if (cur) void applyCustomTheme(cur);
      })
      .then((fn) => {
        un = fn;
      });
    return () => un?.();
  }, [applyCustomTheme]);

  // 失焦即存盘（SPEC §5.1）
  useEffect(() => {
    const onBlur = () => {
      if (dirtyRef.current && filePathRef.current) void saveRef.current({ auto: true });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  // 文件监听：工作区优先，单文件时监听其所在目录
  const watchTarget = workspace ?? (filePath ? dirname(filePath) : null);
  useEffect(() => {
    if (!watchTarget) return;
    void api.watchFolder(watchTarget);
    return () => {
      void api.unwatchFolder();
    };
  }, [watchTarget]);

  // 外部变更：与当前文件相同 → 脏则冲突提示，干净且内容确实不同则静默重载
  useEffect(() => {
    let un: (() => void) | undefined;
    void api
      .onFsChange((e) => {
        const p = e.path.replace(/\\/g, "/");
        const cur = filePathRef.current?.replace(/\\/g, "/");
        if (cur && p === cur) {
          if (e.kind === "remove") {
            const removedId = activeIdRef.current;
            filePathRef.current = null;
            setFilePath(null);
            setTabs((ts) =>
              ts.map((t) => (t.id === removedId ? { ...t, path: null, name: "未命名" } : t))
            );
          } else if (dirtyRef.current) {
            setConflict(true);
          } else {
            void api
              .readFile(p)
              .then((text) => {
                // 自动保存自身写入也会触发事件：内容相同则忽略，避免光标被重置
                if (text !== lastSavedTextRef.current) void openFileRef.current(p);
              })
              .catch(() => {});
          }
        }
        const ws = workspaceRef.current?.replace(/\\/g, "/");
        if (ws && p.startsWith(ws + "/")) {
          if (treeTimer.current) clearTimeout(treeTimer.current);
          treeTimer.current = setTimeout(() => void refreshTree(), 300);
        }
      })
      .then((fn) => {
        un = fn;
      });
    return () => un?.();
  }, [refreshTree]);

  // 定时自动快照（SPEC §5.6：每 5 分钟，去重由后端 hash 保证）
  useEffect(() => {
    const t = setInterval(() => snapshotNow(true), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [snapshotNow]);

  // 切到源码模式时收起 WYSIWYG 查找栏（源码走 CM search）
  useEffect(() => {
    if (mode === "source") setFindOpen(null);
  }, [mode]);

  // 打字机滚动：光标块保持在编辑区垂直中央（SPEC §5.5）
  //
  // 「刚开启」必须强制滚动一次：lastTwPos 记的是上一次滚动的光标位置，
  // 若开启时光标恰好没动过（用户只是按了 F9），pos === lastTwPos 就会直接 return，
  // 用户看到的就是「按了没反应」。
  const twWasOnRef = useRef(false);
  useEffect(() => {
    const on = settings?.typewriter_mode ?? false;
    const justEnabled = on && !twWasOnRef.current;
    twWasOnRef.current = on;
    if (!on || mode !== "wysiwyg" || !editor) return;
    const area = editorAreaRef.current;
    if (!area) return;
    const pos = editor.state.selection.head;
    if (pos === lastTwPos.current && !justEnabled) return;
    lastTwPos.current = pos;
    const coords = editor.view.coordsAtPos(pos);
    const rect = area.getBoundingClientRect();
    area.scrollTop = coords.top - rect.top + area.scrollTop - area.clientHeight / 2;
  });

  // 专注模式的「当前段落高亮」由插件在**事务**里重算，而设置面板改的是 settings，
  // 不产生事务 —— 于是从面板勾选时段落变淡了、当前段落却没高亮，看起来像「没生效」。
  // 这里在开关变化时补一次 meta 事务，让插件重算。
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    // preventUpdate：这个事务只是让插件重算装饰，**不是内容变更**。
    // 必须带上它 —— 否则这个事务会唤醒 PM 的 appendTransaction 链
    // （trailing-node 等规范化插件会 append 一个 docChanged 事务），
    // tiptap 随即 emit('update') → markChanged → **新建的空白草稿被误标为「未保存」**。
    // tiptap 自己的 setContent 也是这么做的（`setMeta('preventUpdate', !emitUpdate)`）。
    ed.view.dispatch(
      ed.state.tr.setMeta("mwtyperFocusToggle", true).setMeta("preventUpdate", true)
    );
  }, [settings?.focus_mode]);

  // 全局快捷键（SPEC §7；编辑区内的格式快捷键在 tiptap 扩展里）
  useEffect(() => {
    // E07：输入框/可编辑区里的按键交给控件本身，F8/F9 作为全局功能键仍放行。
    //
    // 但「全局级」快捷键必须在任何输入框里都可用 —— 否则在查找栏里按 Ctrl+S
    // 完全没反应（保存是最高频的操作，却被输入框的早退逻辑吞掉）。
    // 这里只放行**语义无歧义**的应用级命令；Ctrl+F / Ctrl+H 留给输入框的原生行为。
    // 白名单里的键在**任何**输入框里都放行。
    // "?" 是 Ctrl+Shift+/ 的实际 key（多数布局下 Shift+/ 产生 "?"），
    // 不放行的话随航的快捷键在源码输入区里完全失效。
    const GLOBAL_IN_FIELD = new Set(["s", "o", "n", "/", "?", "\\", ",", "=", "+", "-", "p"]);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        // ProseMirror 本身是 contenteditable，但 Ctrl+S 等全局保存仍须在写作时可用。
        const inEditor = target.closest(".ProseMirror") !== null;
        const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target.isContentEditable && !inEditor);
        const globalInField =
          (e.ctrlKey || e.metaKey) && GLOBAL_IN_FIELD.has(e.key.toLowerCase());
        if (inField && e.key !== "F8" && e.key !== "F9" && !globalInField) return;
      }
      if (e.key === "F1") {
        e.preventDefault();
        openHelp("markdown");
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        toggleFocus();
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        toggleTypewriter();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        // Shift+/ 在多数布局下 e.key 是 "?"，但在部分输入工具里仍是 "/"。
        // 两种都判，随航快捷键才不会因布局/工具差异而失效。
        if (e.shiftKey) toggleSplit();
        else toggleMode();
      } else if (key === "?") {
        // Ctrl+Shift+/ 在多数键盘布局下 e.key 是 "?"（而不是 "/"），
        // 两边都判一下，避免布局差异导致快捷键失效。
        e.preventDefault();
        toggleSplit();
      } else if (key === "\\") {
        e.preventDefault();
        toggleSidebar();
      } else if (key === "s") {
        e.preventDefault();
        void save({ asNew: e.shiftKey });
      } else if (key === "n") {
        e.preventDefault();
        newFile();
      } else if (key === "o") {
        e.preventDefault();
        if (e.shiftKey) void openFolder();
        else void openFileDialog();
      } else if (key === "p" && e.shiftKey) {
        e.preventDefault();
        openPalette("commands");
      } else if (key === "p") {
        e.preventDefault();
        openPalette("files");
      } else if (key === "=" || key === "+") {
        e.preventDefault();
        zoomBy(10);
      } else if (key === "-") {
        e.preventDefault();
        zoomBy(-10);
      } else if (key === ",") {
        e.preventDefault();
        openSettings();
      } else if (key === "f" && e.shiftKey) {
        e.preventDefault();
        showPanel("search");
      } else if (key === "h" && e.shiftKey) {
        e.preventDefault();
        showPanel("history");
      } else if (key === "f" || key === "h") {
        e.preventDefault();
        if (modeRef.current === "wysiwyg") {
          setFindOpen(key === "h" ? "replace" : "find");
        } else {
          if (sourceSearchTimer.current) clearTimeout(sourceSearchTimer.current);
          sourceSearchTimer.current = setTimeout(() => {
            sourceSearchTimer.current = null;
            void import("@codemirror/search").then(({ openSearchPanel }) => {
              const v = cmViewRef.current;
              if (v) {
                v.focus();
                openSearchPanel(v);
              }
            });
          }, 60);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toggleMode, toggleSplit, toggleSidebar, save, newFile, openFolder, openFileDialog, toSource, toggleFocus, toggleTypewriter, showPanel, openPalette, zoomBy, openSettings, openHelp]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      { id: "new", title: "新建文稿", shortcut: "Ctrl+N", run: newFile },
      { id: "open", title: "打开文件…", shortcut: "Ctrl+O", run: () => void openFileDialog() },
      { id: "folder", title: "打开文件夹…", shortcut: "Ctrl+Shift+O", run: () => void openFolder() },
      { id: "save", title: "保存", shortcut: "Ctrl+S", run: () => void save() },
      { id: "saveAs", title: "另存为…", shortcut: "Ctrl+Shift+S", run: () => void save({ asNew: true }) },
      { id: "closeTab", title: "关闭当前标签", run: () => closeTab(activeIdRef.current) },
      { id: "mode", title: "切换 源码 / 所见即所得", shortcut: "Ctrl+/", run: toggleMode },
      { id: "sidebar", title: "切换侧栏", shortcut: "Ctrl+\\", run: toggleSidebar },
      { id: "theme", title: "切换主题（浅色 / 深色 / 随系统）", run: cycleTheme },
      { id: "focus", title: "专注模式", shortcut: "F8", keywords: "focus 沉浸", run: toggleFocus },
      { id: "typewriter", title: "打字机滚动", shortcut: "F9", keywords: "typewriter 居中", run: toggleTypewriter },
      { id: "exportHtml", title: "导出 HTML…", keywords: "export 网页", run: () => void doExportHtml() },
      { id: "exportPdf", title: "导出 PDF（打印）…", keywords: "export 打印", run: () => void doExportPdf() },
      { id: "help", title: "帮助中心", shortcut: "F1", keywords: "help 帮助 markdown 速查 更新", run: () => openHelp("markdown") },
      { id: "helpMarkdown", title: "Markdown 语法速查", keywords: "help markdown 语法 速查", run: () => openHelp("markdown") },
      { id: "helpShortcuts", title: "快捷键一览", keywords: "help 快捷键 shortcut", run: () => openHelp("shortcuts") },
      { id: "helpUpdate", title: "检查更新", keywords: "help 更新 update 版本", run: () => openHelp("update") },
      { id: "find", title: "查找（当前文件）", shortcut: "Ctrl+F", keywords: "find 搜索", run: () => setFindOpen("find") },
      { id: "replace", title: "替换（当前文件）", shortcut: "Ctrl+H", keywords: "replace 替换", run: () => setFindOpen("replace") },
      { id: "history", title: "快照历史", shortcut: "Ctrl+Shift+H", keywords: "history 版本 恢复", run: () => showPanel("history") },
      { id: "search", title: "跨文件搜索", shortcut: "Ctrl+Shift+F", keywords: "search 查找", run: () => showPanel("search") },
      { id: "outline", title: "大纲面板", run: () => showPanel("outline") },
      { id: "files", title: "文件面板", run: () => showPanel("files") },
      { id: "goal", title: "设置写作目标…", keywords: "goal 字数 进度", run: setGoal },
      { id: "quickOpen", title: "快速打开文件…", shortcut: "Ctrl+P", keywords: "open 文件 跳转", run: () => openPalette("files") },
      { id: "zoomIn", title: "放大编辑区", shortcut: "Ctrl+=", keywords: "zoom 缩放", run: () => zoomBy(10) },
      { id: "zoomOut", title: "缩小编辑区", shortcut: "Ctrl+-", keywords: "zoom 缩放", run: () => zoomBy(-10) },
      { id: "zoomReset", title: "重置缩放（100%）", keywords: "zoom 缩放 重置", run: () => setSettings((s) => (s ? { ...s, zoom: 100 } : s)) },
      { id: "settings", title: "设置…", shortcut: "Ctrl+,", keywords: "settings 偏好 主题 自动保存", run: openSettings },
    ];
    for (const p of settings?.recent_files ?? []) {
      list.push({ id: `recent:${p}`, title: `最近：${basename(p)}`, keywords: dirname(p), run: () => void openFile(p) });
    }
    return list;
  }, [newFile, openFileDialog, openFolder, save, closeTab, toggleMode, toggleSidebar, cycleTheme, toggleFocus, toggleTypewriter, doExportHtml, doExportPdf, showPanel, setGoal, openFile, openPalette, zoomBy, openSettings, settings?.recent_files]);

  /**
   * 标题栏的编辑模式分段控件回调：直接切到指定模式。
   * （与 Ctrl+/ 的「二态互切」并存 —— 快捷键保持原有语义，界面提供直选。）
   */
  const onModeChange = useCallback(
    (m: EditMode) => {
      if (m === "wysiwyg") toWysiwyg();
      else if (m === "source") toSource();
      else toSplit();
    },
    [toWysiwyg, toSource, toSplit]
  );

  /**
   * 「⋯ 更多」下拉菜单的内容：把低频操作按语义分组收纳。
   *
   * 分组依据是**语义类别**（文件 / 视图 / 帮助），不是控件类型 ——
   * 用户找「另存为」时想的是「这是文件操作」，不是「这是个按钮」。
   */
  const titleMenuGroups = useMemo<TitleMenuGroup[]>(
    () => [
      {
        title: "文件",
        items: [
          { id: "new", label: "新建文稿", shortcut: "Ctrl+N", run: newFile },
          { id: "open", label: "打开文件…", shortcut: "Ctrl+O", run: () => void openFileDialog() },
          { id: "saveAs", label: "另存为…", shortcut: "Ctrl+Shift+S", run: () => void save({ asNew: true }) },
          { id: "closeTab", label: "关闭当前标签", shortcut: "Ctrl+W", run: () => closeTab(activeIdRef.current) },
        ],
      },
      {
        title: "视图",
        items: [
          { id: "theme", label: "切换主题", shortcut: "", run: cycleTheme },
          { id: "focus", label: "专注模式", shortcut: "F8", checked: settings?.focus_mode === true, run: toggleFocus },
          { id: "typewriter", label: "打字机模式", shortcut: "F9", checked: settings?.typewriter_mode === true, run: toggleTypewriter },
          { id: "zoomIn", label: "放大编辑区", shortcut: "Ctrl+=", run: () => zoomBy(10) },
          { id: "zoomOut", label: "缩小编辑区", shortcut: "Ctrl+-", run: () => zoomBy(-10) },
          { id: "search", label: "跨文件搜索", shortcut: "Ctrl+Shift+F", run: () => showPanel("search") },
        ],
      },
      {
        title: "帮助",
        items: [
          { id: "helpMd", label: "Markdown 语法速查", run: () => openHelp("markdown") },
          { id: "helpKeys", label: "快捷键一览", run: () => openHelp("shortcuts") },
          { id: "helpUpdate", label: "检查更新", run: () => openHelp("update") },
        ],
      },
    ],
    [newFile, openFileDialog, openFolder, save, closeTab, cycleTheme, toggleFocus, toggleTypewriter, zoomBy, showPanel, openHelp, settings?.focus_mode, settings?.typewriter_mode]
  );

  const fileCommands = useMemo<PaletteCommand[]>(() => {
    const out: PaletteCommand[] = [];
    const walk = (n: TreeNode) => {
      if (n.kind === "file") {
        out.push({
          id: `file:${n.path}`,
          title: workspace && n.path.startsWith(workspace + "/") ? n.path.slice(workspace.length + 1) : n.path,
          keywords: n.name,
          run: () => void openFile(n.path),
        });
      }
      n.children?.forEach(walk);
    };
    if (tree) walk(tree);
    return out;
  }, [tree, workspace, openFile]);

  const themeLabel = settings?.theme === "light" ? "浅色" : settings?.theme === "dark" ? "深色" : "随系统";
  const sidebarWidth = Math.max(180, Math.min(420, settings?.sidebar_width ?? 240));

  // C4：侧栏拖拽调宽，结果走 patchSettings（E13 的 300ms 防抖写盘）。
  const startResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        const w = Math.max(180, Math.min(420, Math.round(startW + ev.clientX - startX)));
        patchSettings({ sidebar_width: w });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        resizeCleanupRef.current = null;
      };
      document.body.style.userSelect = "none";
      resizeCleanupRef.current = onUp;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, patchSettings]
  );

  // 「最近」浮层：点击外部关闭。
  // 用 document 监听而不是全屏遮罩 —— 遮罩会吞掉对标题栏其它按钮的点击
  // （浮层开着时点「⋯」只会关掉浮层，菜单不开）。
  useEffect(() => {
    if (!recentOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".recent-wrap")) setRecentOpen(false);
    };
    // 延到下一帧再挂，避免「打开浮层的那次点击」立刻把它关掉
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
    };
  }, [recentOpen]);

  // D-2：标题栏跟随「当前活动标签」，不再直接读全局 filePath
  // （保存竞态时全局 filePath 可能属于别的标签，会让标题栏显示错乱）。
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const titlePath = activeTab?.path ?? null;
  const titleName = activeTab?.name ?? "未命名";

  /** 关窗幂等标记：第一次 close 请求置位（拦截并 flush），第二次放行 */
  const closingRef = useRef(false);
  /** 正在落盘标志：flush 期间的再次关闭请求必须拦住，避免跳过落盘 */
  const flushingRef = useRef(false);

  /**
   * 执行 Tauri 窗口命令，失败时给出**可见**反馈。
   *
   * 之前所有窗口命令都是 `void getCurrentWindow().xxx()` —— promise 的 rejection
   * 被 `void` 静默吞掉，一旦权限缺失就表现为「按钮点了没反应」，
   * 用户无从判断是应用坏了还是自己没点对。（关闭按钮正是这样失效的。）
   */
  const runWinCmd = useCallback(
    (label: string, cmd: () => Promise<unknown>) => {
      void cmd().catch((err) => {
        pushToast("error", `${label}失败：${err}`);
      });
    },
    [pushToast]
  );
  /** 随航模式左右两栏的比例（百分比），持久化在设置里 */
  const splitRatio = settings?.split_ratio ?? 50;

  /** 拖拽调整「源码 / 预览」的分栏比例 */
  const startSplitResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const area = editorAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      const startX = e.clientX;
      const startRatio = splitRatio;
      const onMove = (ev: MouseEvent) => {
        const delta = ((ev.clientX - startX) / rect.width) * 100;
        patchSettings({ split_ratio: Math.max(20, Math.min(80, Math.round(startRatio + delta))) });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        resizeCleanupRef.current = null;
      };
      document.body.style.userSelect = "none";
      resizeCleanupRef.current = onUp;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [splitRatio, patchSettings]
  );

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <button className="tb-btn" title="侧栏 (Ctrl+\)" aria-label="切换侧栏" onClick={toggleSidebar}>
          <span aria-hidden="true">☰</span>
        </button>
        <span className="doc-title" data-tauri-drag-region title={titlePath ?? "未命名"}>
          {titleName}
          {dirty && <span className="dirty-dot" title="未保存" />}
        </span>
        <div className="tb-actions">
          {/*
            标题栏重组（v1.9）：
            右侧原本挤了 12 个控件（新建/打开/文件夹/保存/最近/主题/帮助/设置/源码/随航 + 3 个窗口键），
            视觉权重完全相同、看不出层级，且「⇄源码」与「⧉随航」两个按钮表达不清三态关系。

            现在的分工：
            - **保存** 保留为唯一实心主按钮（最高频）
            - **模式** 用三分段控件（所见即所得 / 源码 / 随航），当前态一眼可见、可直接点选
            - **低频操作** 收进「⋯ 更多」下拉菜单，按 文件 / 视图 / 帮助 分组
            - **设置** 与**窗口控制** 保持独立
          */}
          {/* 新建与保存是文档级的两个最高频动作 —— 留在标题栏；
              其余低频操作（打开文件 / 另存为 / 关闭标签 / 主题 / 专注 / 打字机 /
              缩放 / 跨文件搜索 / 帮助子项）收进「⋯ 更多」。 */}
          <button
            className="tb-btn tb-btn-ghost"
            title="新建文稿 (Ctrl+N)"
            aria-label="新建文稿"
            onClick={newFile}
          >
            <span aria-hidden="true">＋</span> <span className="tb-label">新建</span>
          </button>
          <button
            className="tb-btn tb-btn-primary"
            title="保存 (Ctrl+S)"
            aria-label="保存"
            disabled={saving}
            onClick={() => void save()}
          >
            <span aria-hidden="true">▣</span> <span className="tb-label">{saving ? "保存中…" : "保存"}</span>
          </button>

          <ModeSegments mode={mode} onChange={onModeChange} />

          <div className="recent-wrap">
            <button
              className="tb-btn tb-btn-ghost"
              title="最近打开的文件"
              aria-label="最近打开的文件"
              aria-expanded={recentOpen}
              onClick={() => setRecentOpen((v) => !v)}
            >
              <span aria-hidden="true">◷</span> <span className="tb-label">最近</span>
              <span className="tb-caret" aria-hidden="true">▾</span>
            </button>
            {recentOpen && (
              <>
                {/* 同理不用全屏遮罩（会吞掉对其它标题栏按钮的点击），
                    「点击外部关闭」由下面的 document 监听负责。 */}
                <div className="recent-popover">
                  {settings?.recent_files.length ? (
                    settings.recent_files.map((p) => (
                      <button
                        key={p}
                        className="recent-item"
                        onClick={() => {
                          setRecentOpen(false);
                          void openFile(p);
                        }}
                      >
                        <span>{basename(p)}</span>
                        <span className="recent-dir">{dirname(p)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="panel-empty">暂无最近文件</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 帮助：保留一个独立的「?」入口 —— 用户找帮助时会先看标题栏，
              把它完全藏进「⋯」会明显降低发现率。 */}
          <button
            className="tb-btn tb-btn-ghost"
            title="帮助中心 (F1)"
            aria-label="帮助中心"
            onClick={() => openHelp("markdown")}
          >
            <span aria-hidden="true">?</span> <span className="tb-label">帮助</span>
          </button>

          <TitleMenu
            label="更多操作"
            groups={titleMenuGroups}
          />

          <button
            className="tb-btn tb-btn-ghost"
            title="设置 (Ctrl+,)"
            aria-label="设置"
            onClick={openSettings}
          >
            <span aria-hidden="true">⚙</span> <span className="tb-label">设置</span>
          </button>

          {/* 窗口组：始终保留，不参与窄窗折叠 */}
          {isTauri && (
            <span
              className="win-controls"
              style={{ borderLeft: "1px solid var(--tb-border)", paddingLeft: 8 }}
            >
              {/* 窗口按钮用 **SVG** 而不是字符字形（`─` `□` `×`）：
                  字符字形依赖字体，在 line-height:1 的按钮里垂直位置飘忽，
                  `□` 在多数字体里还特别小 —— 三者大小与基线全对不齐。 */}
              <button className="tb-btn win-btn" title="最小化" aria-label="最小化" onClick={() => runWinCmd("最小化", () => getCurrentWindow().minimize())}>
                <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <line x1="2.5" y1="6" x2="9.5" y2="6" />
                </svg>
              </button>
              <button className="tb-btn win-btn" title="最大化 / 还原" aria-label="最大化或还原" onClick={() => runWinCmd("最大化", () => getCurrentWindow().toggleMaximize())}>
                <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <rect x="2.5" y="2.5" width="7" height="7" />
                </svg>
              </button>
              <button className="tb-btn win-btn win-close" title="关闭" aria-label="关闭窗口" onClick={() => runWinCmd("关闭", () => getCurrentWindow().close())}>
                <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <line x1="3.2" y1="3.2" x2="8.8" y2="8.8" />
                  <line x1="8.8" y1="3.2" x2="3.2" y2="8.8" />
                </svg>
              </button>
            </span>
          )}
        </div>
      </header>

      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={"tab" + (t.id === activeId ? " active" : "")}
            onClick={() => activateTab(t)}
            title={t.path ?? "未命名草稿"}
          >
            <span className="tab-name">
              {t.name}
              {t.dirty && <span className="dirty-dot" />}
            </span>
            <button
              className="tab-close"
              title="关闭标签"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {conflict && (
        <div className="conflict-banner">
          <span>文件已被外部修改，与当前未保存内容冲突。</span>
          <button onClick={() => void reloadFromDisk()}>重新加载</button>
          <button
            onClick={() => {
              setConflict(false);
              void save();
            }}
          >
            保留我的
          </button>
        </div>
      )}

      <div className="main">
        {sidebarOpen && (
          <>
            <aside className="sidebar" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
            <div className="sidebar-tabs" role="tablist" aria-label="侧栏面板">
              <button id="sb-tab-files" role="tab" aria-selected={sidebarTab === "files"} aria-controls="sb-panel" className={sidebarTab === "files" ? "active" : ""} onClick={() => setSidebarTab("files")}>文件</button>
              <button id="sb-tab-outline" role="tab" aria-selected={sidebarTab === "outline"} aria-controls="sb-panel" className={sidebarTab === "outline" ? "active" : ""} onClick={() => setSidebarTab("outline")}>大纲</button>
              <button id="sb-tab-search" role="tab" aria-selected={sidebarTab === "search"} aria-controls="sb-panel" className={sidebarTab === "search" ? "active" : ""} onClick={() => setSidebarTab("search")}>搜索</button>
              <button id="sb-tab-history" role="tab" aria-selected={sidebarTab === "history"} aria-controls="sb-panel" className={sidebarTab === "history" ? "active" : ""} onClick={() => setSidebarTab("history")}>历史</button>
            </div>
            <div className="sidebar-body" id="sb-panel" role="tabpanel" aria-labelledby={`sb-tab-${sidebarTab}`}>
              {sidebarTab === "files" ? (
                <FileTree
                  tree={tree}
                  currentPath={filePath}
                  expanded={treeExpanded}
                  onToggleDir={toggleTreeDir}
                  onOpenFile={(p) => void openFile(p)}
                  onNewFile={(d) => void treeNewFile(d)}
                  onOpenFolder={() => void openFolder()}
                  onRename={(n) => void treeRename(n)}
                  onDelete={(n) => void treeDelete(n)}
                />
              ) : sidebarTab === "outline" ? (
                <Outline editor={editor} mode={mode} sourceText={sourceText} onJump={jumpToHeading} />
              ) : sidebarTab === "search" ? (
                <SearchPanel workspace={workspace} onOpenHit={(p, l) => void openHit(p, l)} />
              ) : (
                <HistoryPanel
                  workspace={workspace}
                  filePath={filePath}
                  version={snapVersion}
                  currentText={currentText}
                  onRestore={(t) => void restoreSnapshot(t)}
                  onError={(message) => pushToast("error", message)}
                />
              )}
            </div>
            </aside>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧栏宽度"
              aria-valuemin={180}
              aria-valuemax={420}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              title="拖拽调整侧栏宽度（180–420）"
              onMouseDown={startResize}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const delta = e.key === "ArrowRight" ? 10 : -10;
                patchSettings({ sidebar_width: Math.max(180, Math.min(420, sidebarWidth + delta)) });
              }}
              style={{ width: 4, flex: "none", cursor: "col-resize", background: "var(--border)" }}
            />
          </>
        )}
        <div
          className={
            "editor-area" +
            (settings?.focus_mode ? " focus-mode" : "") +
            (mode === "split" ? " split" : "")
          }
          ref={editorAreaRef}
          style={
            {
              "--editor-zoom": String((settings?.zoom ?? 100) / 100),
              "--split-ratio": `${settings?.split_ratio ?? 50}%`,
            } as CSSProperties
          }
        >
          {/*
            查找条与表格工具栏统一放进 sticky 容器：
            单独放在滚动容器里时，查找条会随内容滚出视野，且打开它会把视图拉回文档顶部。
          */}
          {((findOpen && editor && mode === "wysiwyg") ||
            (mode === "wysiwyg" && editor && selectionInTable(editor))) && (
            <div className="editor-sticky-bar">
              {findOpen && editor && mode === "wysiwyg" && (
                <FindReplaceBar editor={editor} withReplace={findOpen === "replace"} onClose={() => setFindOpen(null)} />
              )}
              {mode === "wysiwyg" && editor && selectionInTable(editor) && <TableToolbar editor={editor} />}
            </div>
          )}
          {/*
            随航（split）模式的布局用 CSS Grid，**不改变 .editor-wrap 在 DOM 里的位置**。
            这是硬约束：tiptap 实例是在 useEditor 的挂载 effect 里一次性创建的，
            它的 element 指向这个 div；若 React 因分支切换而重建该 div，
            编辑器就会变成孤儿（状态还在、DOM 脱钩，表现为编辑器失去响应）。
            故三态共用同一棵子树，只用 class 控制显隐与网格位置。
          */}
          <div
            className={"split-source" + (mode === "wysiwyg" ? " hidden" : "")}
            aria-label="Markdown 源码"
          >
            {mode !== "wysiwyg" && (
              <Suspense fallback={null}>
                <SourceMode
                  key={activeId}
                  doc={sourceText}
                  onChange={onSourceChange}
                  dark={effectiveTheme === "dark"}
                  initialSelection={cmSelRef.current}
                  onSelectionChange={(sel) => {
                    cmSelRef.current = { ...sel, text: sourceTextRef.current };
                  }}
                  onReady={(v) => {
                    cmViewRef.current = v;
                    if (v) setCmReady((n) => n + 1);
                  }}
                />
              </Suspense>
            )}
          </div>
          <div
            className={"split-divider" + (mode === "split" ? "" : " hidden")}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整源码与预览的比例"
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={splitRatio}
            tabIndex={0}
            title="拖拽调整源码 / 预览比例"
            onMouseDown={startSplitResize}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const delta = e.key === "ArrowLeft" ? -2 : 2;
              patchSettings({ split_ratio: Math.max(20, Math.min(80, splitRatio + delta)) });
            }}
          />
          <div
            className={
              "editor-wrap" +
              (mode === "source" ? " hidden" : "") +
              (mode === "split" ? " split-preview" : "")
            }
            aria-label={mode === "split" ? "实时预览" : undefined}
            ref={editorWrapRef}
          />
        </div>
      </div>

      {/* C5：StatusBar 自身不改（T02 文件边界），通过继承的 --fg-dim 传递状态色 */}
      <div
        style={{
          display: "contents",
          "--fg-dim": saving ? "#60a5fa" : dirty ? "var(--dirty)" : "var(--accent)",
        } as CSSProperties}
      >
        <StatusBar
          stats={stats}
          mode={mode}
          dirty={dirty}
          saving={saving}
          goal={settings?.goal_words ?? 0}
          sessionAdded={Math.max(0, stats.words - (baselineWords ?? stats.words))}
          sessionMinutes={sessionMinutes}
          focusMode={settings?.focus_mode}
          typewriterMode={settings?.typewriter_mode}
        />
      </div>
      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          themes={themes}
          themesDir={themesDir}
          onChange={patchSettings}
          onInstallThemes={installThemes}
          installingThemes={installingThemes}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* 帮助中心：Markdown 速查 / 快捷键 / 检查更新 / 关于。
          **必须按需挂载**（helpOpen && …）：useModal 的聚焦 effect 只在挂载时跑一次，
          若组件一直挂着、只是内部 return null，打开时焦点不会被移进模态 ——
          Escape / Tab 循环就都失效了（实测 Escape 关不掉）。 */}
      {helpOpen && (
        <HelpCenter
          open
          section={helpSection}
          onSection={setHelpSection}
          onClose={() => setHelpOpen(false)}
          editor={editor}
          onNotify={(kind, message) => pushToast(kind, message)}
        />
      )}
      {paletteOpen && (
        <Palette
          commands={paletteMode === "files" ? fileCommands : commands}
          placeholder={paletteMode === "files" ? "输入文件名…" : undefined}
          onClose={() => setPaletteOpen(false)}
          // D-6：同屏只允许一个 aria-modal 浮层；已有其他模态时命令面板降级为非模态。
          deferModal={confirmState !== null || promptState !== null || (settingsOpen && settings !== null)}
        />
      )}
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        danger={confirmState?.danger}
        onConfirm={() => settleConfirm(true)}
        onCancel={() => settleConfirm(false)}
      />
      <PromptDialog
        key={promptState?.id ?? 0}
        open={promptState !== null}
        title={promptState?.title ?? ""}
        defaultValue={promptState?.defaultValue ?? ""}
        onSubmit={(value) => {
          const resolve = promptState?.resolve;
          promptRef.current = null;
          setPromptState(null);
          resolve?.(value);
        }}
        onCancel={() => {
          const resolve = promptState?.resolve;
          promptRef.current = null;
          setPromptState(null);
          resolve?.(null);
        }}
      />
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}