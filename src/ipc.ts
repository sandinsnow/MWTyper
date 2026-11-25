import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: TreeNode[];
}

export interface Settings {
  theme: "system" | "light" | "dark";
  autosave_ms: number;
  recent_files: string[];
  sidebar_open: boolean;
  /** 侧栏宽度，180–420 px；前后端默认均为 240。 */
  sidebar_width: number;
  /** 随航模式左右两栏的比例（百分比），20–80；前后端默认均为 50。 */
  split_ratio: number;
  goal_words: number;
  focus_mode: boolean;
  typewriter_mode: boolean;
  snapshot_keep: number;
  snapshot_days: number;
  zoom: number;
  custom_theme: string;
}

/** 应用信息（版本 / 构建时间） */
export interface AppInfo {
  name: string;
  version: string;
  buildTime: string;
}

/** 更新清单（放在 %APPDATA%\\MWTyper\\update-manifest.json） */
export interface UpdateManifest {
  version: string;
  url?: string;
  notes?: string;
  publishedAt?: string;
}

export interface Stats {
  words: number;
  chars: number;
  reading_minutes: number;
}

export interface FsChange {
  path: string;
  kind: "create" | "modify" | "remove";
}

export interface SearchHit {
  path: string;
  line_no: number;
  line: string;
}

export interface SearchResult {
  hits: SearchHit[];
  truncated: boolean;
  files_scanned: number;
  elapsed_ms: number;
}

export interface SnapshotMeta {
  id: string;
  ts: string;
  hash: string;
  auto: boolean;
  bytes: number;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---- 浏览器 mock：pnpm dev 无 Tauri 运行时时的可预览后端（localStorage 持久化） ----

const MOCK_KEY = "mwtyper-mock-fs";
const MOCK_SETTINGS_KEY = "mwtyper-mock-settings";

interface MockFs {
  files: Record<string, string>;
}

function mockLoad(): MockFs {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* 损坏则重建 */ }
  return {
    files: {
      "/demo/欢迎.md": "# 欢迎使用 MWTyper\n\n这是浏览器预览的演示工作区（真实文件操作请在 Tauri 窗口中使用）。\n\n- 左侧文件树可打开/新建/重命名/删除\n- `Ctrl+/` 切换源码模式\n- 试试粘贴一张图片\n\n```ts\nconst hello = \"MWTyper\";\n```\n",
      "/demo/笔记/示例.md": "## 示例笔记\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n\n行内公式 $E=mc^2$。\n",
    },
  };
}

function mockSave(fs: MockFs) {
  localStorage.setItem(MOCK_KEY, JSON.stringify(fs));
}

function mockBuildTree(root: string): TreeNode {
  const fs = mockLoad();
  const prefix = root.endsWith("/") ? root : root + "/";
  const rootName = root.split("/").filter(Boolean).pop() || root;
  const dirs: Record<string, TreeNode> = {};
  const ensureDir = (path: string): TreeNode => {
    if (dirs[path]) return dirs[path];
    const node: TreeNode = {
      name: path.split("/").filter(Boolean).pop() || path,
      path,
      kind: "dir",
      children: [],
    };
    dirs[path] = node;
    return node;
  };
  const rootNode = ensureDir(root);
  rootNode.name = rootName;
  for (const filePath of Object.keys(fs.files).sort()) {
    if (!filePath.startsWith(prefix)) continue;
    const rel = filePath.slice(prefix.length);
    // 与 Rust 侧一致：忽略隐藏目录/node_modules/target/dist，仅 md/markdown/txt
    if (rel.split("/").some((seg) => seg.startsWith(".") || seg === "node_modules" || seg === "target" || seg === "dist")) continue;
    if (!/\.(md|markdown|txt)$/i.test(filePath)) continue;
    const parts = rel.split("/");
    let cur = rootNode;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = root + "/" + parts.slice(0, i + 1).join("/");
      const child = ensureDir(dirPath);
      if (!cur.children!.some((c) => c.path === dirPath)) cur.children!.push(child);
      cur = child;
    }
    cur.children!.push({ name: parts[parts.length - 1], path: filePath, kind: "file" });
  }
  const sortTree = (n: TreeNode) => {
    n.children?.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    n.children?.forEach(sortTree);
  };
  sortTree(rootNode);
  return rootNode;
}

const mockListeners = new Set<(e: FsChange) => void>();
function mockEmit(change: FsChange) {
  mockListeners.forEach((fn) => fn(change));
}

/**
 * 仅浏览器预览/自动化测试用：模拟「文件在外部被修改」的 fs-changed 事件。
 *
 * 真实的 Tauri 后端在文件被外部改写时会推 `fs-changed`，浏览器 mock 没有
 * 文件系统监听器，无法自行产生该事件；没有它就无法在预览环境里验证
 * 「冲突横幅 → 重新加载」这条链路（该链路曾因 openFile 的 dirty 短路而
 * 变成点了没反应的死按钮）。Tauri 运行时本函数不被调用。
 */
export function mockEmitFileChange(path: string, kind: FsChange["kind"] = "modify"): void {
  mockEmit({ path, kind });
}

const MOCK_SNAP_KEY = "mwtyper-mock-snaps";
const MOCK_THEMES_KEY = "mwtyper-mock-themes";

/** 内置示例主题（与 src-tauri/examples 的主题文件同源，仅 mock 用） */
const THEME_BUILTIN: Record<string, string> = {
  "warm-sample": ":root {\n  --mw-base-bg: #fbf1d8;\n  --mw-base-fg: #4a4235;\n  --mw-base-accent: #b58900;\n}\n\n[data-theme=\"dark\"] {\n  --mw-base-bg: #241f18;\n  --mw-base-fg: #e8dfd0;\n  --mw-base-accent: #e0b155;\n}\n",
  celadon: ":root {\n  --mw-base-bg: #f1f5f3;\n  --mw-base-fg: #22322c;\n  --mw-base-accent: #1f6f5c;\n}\n\n[data-theme=\"dark\"] {\n  --mw-base-bg: #16201d;\n  --mw-base-fg: #d6e3de;\n  --mw-base-accent: #4fbf9f;\n}\n",
  dusk: ":root {\n  --mw-base-bg: #f4f2f8;\n  --mw-base-fg: #2f2a3d;\n  --mw-base-accent: #6d4aa8;\n}\n\n[data-theme=\"dark\"] {\n  --mw-base-bg: #1c1a26;\n  --mw-base-fg: #ddd8ea;\n  --mw-base-accent: #b39ae0;\n}\n",
  graphite: ":root {\n  --mw-base-bg: #f4f4f5;\n  --mw-base-fg: #27272a;\n  --mw-base-accent: #52525b;\n}\n\n[data-theme=\"dark\"] {\n  --mw-base-bg: #1a1a1c;\n  --mw-base-fg: #d4d4d8;\n  --mw-base-accent: #a1a1aa;\n}\n",
  "sea-salt": ":root {\n  --mw-base-bg: #f1f5f9;\n  --mw-base-fg: #1f2937;\n  --mw-base-accent: #0369a1;\n}\n\n[data-theme=\"dark\"] {\n  --mw-base-bg: #111c26;\n  --mw-base-fg: #d6e3ee;\n  --mw-base-accent: #56a8e0;\n}\n",
};

function mockThemesLoad(): Record<string, string> {
  const raw = localStorage.getItem(MOCK_THEMES_KEY);
  if (raw) return JSON.parse(raw);
  const seed = {
    // 基色写法（推荐）：只声明 4 个基色，系统推导出整套令牌并自动做深浅配比。
    // 显式给出暗色基色时按给定值用；不给则由系统压暗底色、提亮强调色自动派生。
    "warm-sample": [
      ":root {",
      "  --mw-base-bg: #fbf1d8;",
      "  --mw-base-fg: #4a4235;",
      "  --mw-base-accent: #b58900;",
      "}",
      "",
      "[data-theme=\"dark\"] {",
      "  --mw-base-bg: #241f18;",
      "  --mw-base-fg: #e8dfd0;",
      "  --mw-base-accent: #e0b155;",
      "}",
      "",
    ].join("\n"),
  };
  localStorage.setItem(MOCK_THEMES_KEY, JSON.stringify(seed));
  return seed;
}
interface MockSnapStore {
  [key: string]: { metas: SnapshotMeta[]; contents: Record<string, string> };
}
function mockSnapsLoad(): MockSnapStore {
  try {
    return JSON.parse(localStorage.getItem(MOCK_SNAP_KEY) || "{}");
  } catch {
    return {};
  }
}
function mockHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const defaultSettings: Settings = {
  theme: "system", autosave_ms: 1000, recent_files: [], sidebar_open: true, sidebar_width: 240,
  goal_words: 0, focus_mode: false, typewriter_mode: false, snapshot_keep: 50, snapshot_days: 30, zoom: 100, custom_theme: "",
  split_ratio: 50,
};

async function mockInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const fs = mockLoad();
  switch (cmd) {
    case "list_tree":
      return mockBuildTree(args.root as string);
    case "read_file": {
      const p = args.path as string;
      if (!(p in fs.files)) throw "文件不存在（mock）";
      return fs.files[p];
    }
    case "save_file":
      fs.files[args.path as string] = args.content as string;
      mockSave(fs);
      return null;
    case "rename_path": {
      const old = args.old as string;
      const nw = args.new as string;
      if (!(old in fs.files) || nw in fs.files) throw "重命名失败（mock）";
      fs.files[nw] = fs.files[old];
      delete fs.files[old];
      mockSave(fs);
      return null;
    }
    case "delete_path": {
      const p = args.path as string;
      const dest = `/demo/.mwtyper/trash/${Date.now()}-${p.split("/").pop()}`;
      fs.files[dest] = fs.files[p];
      delete fs.files[p];
      mockSave(fs);
      mockEmit({ path: p, kind: "remove" });
      return dest;
    }
    case "save_image_asset": {
      const name = (args.name as string).replace(/[^\w.-]/g, "-");
      const rel = `assets/${Date.now()}-${name}`;
      const base = args.baseDir as string;
      fs.files[`${base}/${rel}`] = `data:image/png;base64,${args.dataB64 as string}`;
      mockSave(fs);
      return rel;
    }
    case "read_settings": {
      try {
        const stored = JSON.parse(localStorage.getItem(MOCK_SETTINGS_KEY) || "{}") as Partial<Settings>;
        return {
          ...defaultSettings,
          ...stored,
          // 旧 localStorage 数据缺字段时兜底，避免得到 undefined 宽度
          sidebar_width: stored.sidebar_width ?? defaultSettings.sidebar_width,
        };
      } catch {
        return defaultSettings;
      }
    }
    case "write_settings":
      localStorage.setItem(MOCK_SETTINGS_KEY, JSON.stringify(args.settings));
      return null;
    case "pick_folder":
      return "/demo";
    case "pick_open_file":
      return "/demo/欢迎.md";
    case "pick_save_file":
      return `/demo/${args.defaultName as string}`;
    case "stats":
      return mockStats(args.md as string);
    case "watch_folder":
    case "unwatch_folder":
      return null;
    case "search_workspace": {
      const t0 = performance.now();
      const root = args.root as string;
      const query = args.query as string;
      if (!query) return { hits: [], truncated: false, files_scanned: 0, elapsed_ms: 0 };
      let pat = args.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (args.wholeWord) pat = `\\b(?:${pat})\\b`;
      let re: RegExp;
      try {
        re = new RegExp(pat, args.caseSensitive ? "" : "i");
      } catch (e) {
        throw `正则无效：${e}`;
      }
      const limit = (args.limit as number) || 500;
      const hits: SearchHit[] = [];
      let truncated = false;
      let scanned = 0;
      const prefix = root.endsWith("/") ? root : root + "/";
      for (const [p, text] of Object.entries(fs.files)) {
        if (!p.startsWith(prefix) || p.includes("/.mwtyper/") || !/\.(md|markdown|txt)$/.test(p)) continue;
        scanned++;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            if (hits.length >= limit) {
              truncated = true;
              break;
            }
            hits.push({ path: p, line_no: i + 1, line: lines[i].trim().slice(0, 300) });
          }
        }
        if (truncated) break;
      }
      return { hits, truncated, files_scanned: scanned, elapsed_ms: Math.round(performance.now() - t0) };
    }
    case "snapshot_save": {
      const store = mockSnapsLoad();
      const key = `${args.workspace}|${args.path}`;
      const entry = store[key] || (store[key] = { metas: [], contents: {} });
      const content = args.content as string;
      const hash = mockHash(content);
      if (entry.metas[0]?.hash === hash) return entry.metas[0];
      const now = new Date();
      const pad = (n: number, w = 2) => String(n).padStart(w, "0");
      const id = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}-${hash}`;
      const meta: SnapshotMeta = { id, ts: now.toISOString(), hash, auto: args.auto as boolean, bytes: content.length };
      entry.contents[id] = content;
      entry.metas.unshift(meta);
      const keep = (args.keep as number) ?? 50;
      const days = (args.days as number) ?? 30;
      const seen = new Set<string>();
      entry.metas = entry.metas.filter((m, i) => {
        const dateKey = m.id.slice(0, 8);
        const age = (Date.now() - new Date(m.ts).getTime()) / 86400000;
        const dailyLast = age <= days && !seen.has(dateKey);
        if (dailyLast) seen.add(dateKey);
        if (i < keep || dailyLast) return true;
        delete entry.contents[m.id];
        return false;
      });
      localStorage.setItem(MOCK_SNAP_KEY, JSON.stringify(store));
      return meta;
    }
    case "snapshot_list": {
      const store = mockSnapsLoad();
      return store[`${args.workspace}|${args.path}`]?.metas ?? [];
    }
    case "snapshot_read": {
      const store = mockSnapsLoad();
      const entry = store[`${args.workspace}|${args.path}`];
      const id = args.id as string;
      if (!entry || !(id in entry.contents)) throw "快照不存在（mock）";
      return entry.contents[id];
    }
    case "export_html":
      return `<!doctype html><html><head><meta charset="utf-8"><title>${args.title}</title><style>${args.extraCss}</style></head><body data-theme="${args.theme}"><pre>${(args.md as string).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;
    case "md_to_html":
      return `<pre>${(args.md as string).replace(/</g, "&lt;")}</pre>`;
    case "themes_dir_path":
      return "%APPDATA%/MWTyper/themes（浏览器预览为虚拟目录）";
    case "reveal_themes_dir":
      return null;
    case "app_info":
      return { name: "MWTyper", version: "0.1.0", buildTime: String(Math.floor(Date.now() / 1000) - 86400) };
    case "read_update_manifest": {
      const themes = mockThemesLoad();
      const m = (themes as Record<string, string>)["__update_manifest"];
      if (!m) return null;
      try {
        return JSON.parse(m);
      } catch {
        throw "更新清单格式有误（mock）";
      }
    }
    case "install_builtin_themes": {
      const themes = mockThemesLoad();
      const installed: string[] = [];
      for (const [name, css] of Object.entries(THEME_BUILTIN)) {
        if (themes[name]) continue; // 已存在不覆盖
        themes[name] = css;
        installed.push(name);
      }
      localStorage.setItem(MOCK_THEMES_KEY, JSON.stringify(themes));
      return installed;
    }
    case "update_manifest_path":
      return "/demo/update-manifest.json";
    case "open_external":
      // 浏览器 mock 下没有系统浏览器可调起；记录到控制台便于调试。
      console.info("[mock] open_external:", args.url);
      return null;
    case "list_themes":
      return Object.keys(mockThemesLoad()).sort();
    case "read_theme": {
      const themes = mockThemesLoad();
      const name = args.name as string;
      if (!/^[A-Za-z0-9_-]+$/.test(name) || !(name in themes)) throw "主题不存在（mock）";
      return themes[name];
    }
    case "watch_themes":
      return null;
    default:
      throw `mock 未实现命令：${cmd}`;
  }
}

function mockStats(md: string): Stats {
  const text = md.replace(/```[\s\S]*?```/g, "").replace(/[#>*`|[\]!-]/g, " ");
  const chars = text.replace(/\s/g, "").length;
  const cjk = (text.match(/[一-鿿　-〿＀-￯]/g) || []).length;
  const latin = (text.replace(/[一-鿿　-〿＀-￯]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  const words = cjk + latin;
  return { words, chars, reading_minutes: words === 0 ? 0 : Math.ceil(words / 300) };
}

// ---- 统一 API ----

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args);
  return mockInvoke(cmd, args) as Promise<T>;
}

export const api = {
  listTree: (root: string) => call<TreeNode>("list_tree", { root }),
  readFile: (path: string) => call<string>("read_file", { path }),
  saveFile: (path: string, content: string) => call<void>("save_file", { path, content }),
  renamePath: (old: string, nw: string) => call<void>("rename_path", { old, new: nw }),
  deletePath: (path: string, workspace: string) => call<string>("delete_path", { path, workspace }),
  saveImageAsset: (baseDir: string, name: string, dataB64: string) =>
    call<string>("save_image_asset", { baseDir, name, dataB64 }),
  readSettings: () => call<Settings>("read_settings"),
  writeSettings: (settings: Settings) => call<void>("write_settings", { settings }),
  pickFolder: () => call<string | null>("pick_folder"),
  pickOpenFile: () => call<string | null>("pick_open_file"),
  pickSaveFile: (defaultName: string) => call<string | null>("pick_save_file", { defaultName }),
  stats: (md: string) => call<Stats>("stats", { md }),
  watchFolder: (path: string) => call<void>("watch_folder", { path }),
  unwatchFolder: () => call<void>("unwatch_folder"),
  watchThemes: () => call<void>("watch_themes"),
  themesDirPath: () => call<string>("themes_dir_path"),
  revealThemesDir: () => call<void>("reveal_themes_dir"),
  appInfo: () => call<AppInfo>("app_info"),
  readUpdateManifest: () => call<UpdateManifest | null>("read_update_manifest"),
  updateManifestPath: () => call<string>("update_manifest_path"),
  /** 在系统默认浏览器打开外部链接（「检查更新 → 打开下载页」）。 */
  openExternal: (url: string) => call<void>("open_external", { url }),
  listThemes: () => call<string[]>("list_themes"),
  installBuiltinThemes: () => call<string[]>("install_builtin_themes"),
  readTheme: (name: string) => call<string>("read_theme", { name }),
  onThemesChange: async (fn: (e: FsChange) => void): Promise<UnlistenFn> => {
    if (isTauri) return listen<FsChange>("themes-changed", (e) => fn(e.payload));
    return () => {};
  },
  onFsChange: async (fn: (e: FsChange) => void): Promise<UnlistenFn> => {
    if (isTauri) return listen<FsChange>("fs-changed", (e) => fn(e.payload));
    mockListeners.add(fn);
    return () => mockListeners.delete(fn);
  },
  searchWorkspace: (
    root: string,
    query: string,
    opts: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; limit?: number } = {}
  ) =>
    call<SearchResult>("search_workspace", {
      root,
      query,
      caseSensitive: opts.caseSensitive ?? false,
      wholeWord: opts.wholeWord ?? false,
      useRegex: opts.useRegex ?? false,
      limit: opts.limit,
    }),
  snapshotSave: (workspace: string, path: string, content: string, auto: boolean, keep?: number, days?: number) =>
    call<SnapshotMeta>("snapshot_save", { workspace, path, content, auto, keep, days }),
  snapshotList: (workspace: string, path: string) => call<SnapshotMeta[]>("snapshot_list", { workspace, path }),
  snapshotRead: (workspace: string, path: string, id: string) => call<string>("snapshot_read", { workspace, path, id }),
  exportHtml: (md: string, title: string, theme: string, extraCss: string, baseDir: string, embedImages: boolean) =>
    call<string>("export_html", { md, title, theme, extraCss, baseDir, embedImages }),
};

export function dirname(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i <= 0 ? "" : norm.slice(0, i);
}

export function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() || p;
}