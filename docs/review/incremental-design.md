# MWTyper M3 增量实施任务清单

- 版本：v1.0（最终实施版，已并入 team-lead Q7 全部拍板 + QA 真实缺陷 + 精确行号锚点）
- 撰写：高见远（Architect）
- 日期：2026-11-21
- 依据：`.workbuddy/review/architecture-review.md`（含 §6/§7）、`.workbuddy/review/incremental-prd.md`、`.workbuddy/review/qa-ux-review.md`、`docs/system_design.md`、team-lead Q7 拍板与四条补充
- 性质：**只读设计交付，本阶段未改任何源码**。工程师拿本清单即可落地，无需回读审查报告。
- 排序原则：**数据安全 > 正确性 > 性能 > UX > 文档/构建验证**

---

## 0. 总览：有序任务表

| 序 | 任务ID | 标题 | 主要文件（关键行号） | 前置 | 优先级 | 并行车道 | 预估风险 |
|---|---|---|---|---|---|---|---|
| 1 | **I01** | 数据安全三件套：D1 stash 快照 + E01 定时器竞态 + E03 路径同步 + E18 清理 | `App.tsx:78-80,117-162,278-285,400-434,732-802` | — | **P0** | A（App 串行主道） | 高（行为改动，需重点回归） |
| 2 | **I02** | 源码模式数据正确：E04 doc 同步 + E09 悬挂引用/定时器 | `SourceMode.tsx:15-57`、`App.tsx:506-519,1007-1009` | I01 | **P0** | A | 高（回环风险） |
| 3 | **I03** | 异步乱序防护：E02 stats + E08 search | `App.tsx:130-151,287-295`、`SearchPanel.tsx:18-40` | I02 | P1 | A | 中 |
| 4 | **I04** | E07 快捷键吞输入框 | `App.tsx:732-802` | I03 | P1 | A（可与 I03 合并提交） | 低 |
| 5 | **I05** | 后端 P0：E05 导出 HTML 属性转义/XSS | `lib.rs:26-28,104-106,154-166,194`、`export.rs:79-86` | — | **P0** | B（Rust 道，与 A 并行） | 中（须保 KaTeX 透传） |
| 6 | **I06** | 后端 P1：E11 图片路径穿越 + E06 truncated | `export.rs:55-76,112-127`、`search.rs:68-110` | I05 | P1 | B | 中 |
| 7 | **I07** | A10 asset scope 收窄 + A11 watch debounce | `tauri.conf.json:23-30`、`watch.rs:53-88` | I06 | P1/P2 | B | 中 |
| 8 | **I08** | D2 阶段一：useEditor rerenderOn 谓词 | `useEditor.ts:5-23`、`App.tsx:314-324`、`find-replace.ts:20`（已导出） | I07 | P1 | A（须等 I01-I04 让出 App.tsx） | 中（计数冻结风险） |
| 9 | **I09** | A04/A05 decorations 增量（风险闸门，见 §2.9） | `code-block.ts:96-99`、`find-replace.ts:56-70` | — | P1 | C（编辑内核道，与 A/B 并行） | 中高（算法等价性） |
| 10 | **I10** | 字体裁剪 + A13 CM6 basicSetup 精选（后者先评估） | `main.tsx:5`、`export.ts:5-9`、`SourceMode.tsx:32-41`、`vite.config.ts:17-29` | — | P2 | C | 低（字体）/中（CM6） |
| 11 | **I11** | C1 统一弹窗原语（15 处 window.* 清零） | `src/ui/Modal.tsx`(新)、`src/ui/Toast.tsx`(新)、`App.tsx` 15 处、`shortcuts.ts:22`、`HistoryPanel.tsx:36` | I08 | P1 | A | 中（机械替换，量多） |
| 12 | **I12** | C2 标题栏图标化 + U10/U11 窄窗适配 | `App.tsx:859-912`、`styles.css:63-77` | I11 | P1 | A | 低 |
| 13 | **I13** | UX 地基：U01/U02/U03/U04/U05/U06/U07/U13/U14/U20 | `styles.css:4-51,138,155-159,257,260-289,298,313-341,357`、`各面板 aria` | I11 | P1 | A（CSS 可由另一人并行，见 §3） | 低（纯样式/属性） |
| 14 | **I14** | Q6 sidebar_width + C4 缩放行宽联动 | `fs.rs:163-200`、`ipc.ts:11-23,160-163`、`styles.css:127-130,194-232`、`App.tsx:453-459,990-994`、`SettingsPanel.tsx` | I13 | P2 | A（末段）/B（fs.rs） | 低（serde 前向兼容） |
| 15 | **I15** | A09 文档刷新 + 性能基准实测回填 | `SPEC.md`、`spikes/M1/M2-CONCLUSIONS.md` | I14、I10 | P1 | D（文档道，最后） | 低 |
| 16 | **I16** | B1 NSIS 两步构建验证（允许如实降级） | `tauri.conf.json:32-43`、构建产物目录 | I15 | P1 | D | 环境受限 |

**并行说明**：
- **车道 A**（App.tsx 独占）必须严格串行 I01→I02→I03→I04→I08→I11→I12→I13→I14，同一文件不可两人同时改。
- **车道 B**（Rust）I05→I06→I07→I14(fs.rs 部分) 可与车道 A 全程并行。
- **车道 C**（编辑内核/构建）I09、I10 可与 A/B 并行；I09 与 I10 不共享文件。
- **车道 D**（文档/构建验证）必须最后，依赖前面所有实测数据。

---

## 1. 共享约定（跨文件契约，先于一切改动确立）

### 1.1 验证命令（绕开失效的 pnpm，直接用 Node v24 调 CLI）
```bash
NODE=/c/Users/Admin/scoop/persist/nvm/nodejs/v24.20.0/node.exe
# typecheck
$NODE node_modules/typescript/bin/tsc --noEmit
# build
$NODE node_modules/vite/bin/vite.js build
# spike（示例）
$NODE node_modules/tsx/dist/cli.mjs spikes/m1-editor.ts
$NODE node_modules/tsx/dist/cli.mjs spikes/m1-ipc.ts
$NODE node_modules/tsx/dist/cli.mjs spikes/roundtrip.ts
# Rust（cargo/rustc 1.98.1 正常；QA 报的 0xc0000005 请 QA 复测确认是否偶发，勿预设永久故障）
cargo test --lib
# NSIS 两步
$NODE node_modules/@tauri-apps/cli/bin.js build --no-bundle
$NODE node_modules/@tauri-apps/cli/bin.js build   # 第二步允许因工具链下载失败而降级
```
> 每批改动后至少跑 typecheck + build + 相关 spike；全绿才进下一任务。

### 1.2 依赖红线
**禁止任何 `pnpm add` / `cargo add`**。全离线，新增包必然失败。测试用现有 `jsdom@31` + `tsx@4.23` 手写挂载，**不引入** Vitest / RTL / axe-core。

### 1.3 Settings 新增字段 sidebar_width（Q6）
```
fs.rs:163-200   #[serde(default = "d_sidebar_width")] pub sidebar_width: u64
                fn d_sidebar_width() -> u64 { 260 }   // Default impl 同步
ipc.ts:11-23    Settings interface 增 sidebar_width: number
ipc.ts:160-163  mock defaultSettings 增 sidebar_width: 260
styles.css:127-130  .sidebar { width: var(--sidebar-width, 260px) }
                    --sidebar-width 声明在 :root，clamp 180~420px
App.tsx         侧栏拖拽手柄 → patchSettings({ sidebar_width })（防抖 300ms）
```
serde 已前向兼容：旧 settings.json 缺字段自动取 260，不迁移。

### 1.4 findKey 导出签名（D2 用，**无需新增导出**）
`find-replace.ts:20` 已导出：`export const findKey = new PluginKey<FindState>("mwtyperFind");`
App.tsx 直接 `import { findKey } from "./editor/find-replace";`，谓词用 `tr.getMeta(findKey)`。

### 1.5 useEditor rerenderOn 签名（D2）
```ts
rerenderOn?: (tr: import("@tiptap/pm/state").Transaction) => boolean;
// 默认：tr.docChanged || tr.selectionSet
// App 传入：tr.docChanged || tr.selectionSet || !!tr.getMeta(findKey)
```

**D2 验收口径（权威，PRD D2 验收标准第 1 条以此为准）**：
- 必须触发 App 顶层渲染的三类事务：① `tr.docChanged`（打字/格式/恢复）；② `tr.selectionSet`（光标移动——`Outline.tsx:25` 在 render 期读 `editor.state.selection.from` 计算当前节高亮，不渲染则高亮回退）；③ findKey meta（`FindReplaceBar.tsx:27` 在 render 期直读 `getFindState(editor)` 且无自身订阅，不渲染则 x/y 冻结）。
- 归零对象仅为「既非 docChanged、也非 selectionSet、也非 findKey meta」的纯 meta 事务（如 focus toggle 的 `setMeta("mwtyperFocusToggle")`、纯装饰 meta）。注：focus toggle 另有 `setSettings` 触发渲染，与本谓词无关。
- PRD D2 第 1 条「selection 移动、find meta 不触发 App 顶层重渲染」**不成立**（属阶段二订阅下沉目标，本轮不做），请以本口径写用例，避免假失败。

### 1.6 新增 CSS 变量（I11/I13/I14 共用）
```
--accent-strong   亮 #047857 / 暗 #34d399（激活态文字对比度）
--fg-dim          亮 #5b6472 / 暗 #98a0ab
--diff-add / --diff-del   亮 #1a7f37 / #cf222e；暗 #3fb950 / #f85149
--overlay-bg / --shadow-modal / --radius-modal   浮层统一
--sidebar-width   260px（clamp 180~420px）
--warn-fg         未保存点琥珀色（与激活绿区分）
```

### 1.7 身份快照与序号纪律（I01–I03 共用）
- 凡在 `setState` 更新器内读 `useRef`，一律先在调用瞬间捕获为局部常量。
- 所有可能乱序的异步回调（stats/search）用自增序号 ref 校验后才写 state。
- 所有 `setTimeout`/`setInterval`/监听必须在 effect cleanup 清理；`onReady` 支持 `null`。

### 1.8 jsdom 测试挂载前置 stub（QA 确认，I01–I13 用例必需）
`jsdom@31 + tsx` 手写挂载 App 前必须注入，否则挂载阶段直接失败：
- `window.matchMedia`（`theme.ts:6-8` 在 useState 初始化器同步调用）→ stub 需含 `matches` + `addEventListener/removeEventListener`
- `window.confirm/alert/prompt`（jsdom 原生抛 Not implemented；D1 closeTab、newFile 等路径用到）→ 全部 stub
- `localStorage`（ipc mock 依赖）、`MutationObserver`、`requestAnimationFrame`（JSDOM 构造加 `pretendToBeVisual: true`）
- `act()` 用 `react-dom/test-utils`（React 18 自带）包住 `createRoot().render` 与所有触发事件；**断言必须在 `await act()` flush 之后**，不可在事件回调内同步断言——D1 根因正是 setTabs 更新器延迟到 render 阶段执行，同步断言会假通过
- `App.tsx:28` 顶层 `import { getCurrentWindow } from "@tauri-apps/api/window"` 在 jsdom 未验证 → **I01 第一步先跑"空 App 挂载成功"烟测**，确认不卡住再写后续用例
- Tauri close 事件在 jsdom 不可达 → 用 §2 I01 的 `flushAllDirty` 导出纯函数直接断言
- CSS 类 a11y（U01/U03/U04/U05/U11–U13）无法用 jsdom 断言 → 改为对 `styles.css` 文本做正则断言（如 `@media (prefers-reduced-motion: reduce)`、`:focus-visible`、`clamp(`），零依赖防回归

---

## 2. 逐任务具体改法（精确到函数/行号）

### I01 — 数据安全三件套（P0，车道 A）

这是**两个独立缺陷**，修法不同，不可合并处理：

**（1）D1 — stashActive 无条件标签串位**（`App.tsx:118-128`）
- 现状：`setTabs(ts => ts.map(t => t.id === activeIdRef.current ? {...text, dirty: dirtyRef.current} : t))`，更新器延迟执行时 `activeIdRef.current` 已是切后的 B → A 文本写进 B，A 保留旧文本。
- 改法：
```ts
const stashActive = useCallback(() => {
  const targetId = activeIdRef.current;   // 调用时快照
  const text = currentText();
  const path = filePathRef.current;
  const dirty = dirtyRef.current;
  const name = path ? basename(path) : "未命名";
  setTabs(ts => ts.map(t =>
    t.id === targetId ? { ...t, path, name, text, dirty } : t
  ));
}, [currentText]);
```
- **四个调用点（activateTab / newFile / openFile / closeTab）一律不动**。
- 验收：QA 用例 D1 —— autosave=0 前置（仅排除 E01 干扰，**不代表 E01 不存在**），A 输入 `UNIQUE_A` → 切 B → 切回 A → A 仍含该文本且 dirty 正确；补 newFile 与 openFile 两条路径。

**（2）E01 — 自动保存定时器跨标签**（`App.tsx:278-285,130-162,650-657`）
- 改法：`activateTab`/`loadBuffer` 入口 `if (autoTimer.current) clearTimeout(autoTimer.current)`；`loadBuffer` 后若 `tab.dirty` 则 `scheduleAutosave()` 重新调度（**即 D3 断言语义 = 方案 B**：不做切换时同步落盘，而是保留 A 的文本+dirty 在 tab state，切回 A 后由重新调度的定时器在 autosave_ms 内保存；切走期间 A 保持脏态但数据不丢）。新增 `beforeunload` 与 Tauri `close` 事件监听，flush 所有 `tabs.filter(t => t.dirty)`。
- **为可测试性抽纯函数**（QA 要求，jsdom 测不到真实 Tauri close）：把 flush 逻辑抽成导出函数 `flushAllDirty(tabs: Tab[], currentText: () => string, activeId: number, save: (tab) => Promise<void>): Promise<void>`，App 的 `beforeunload`/Tauri close 监听只调用它；jsdom 直接 import 调用该函数断言"所有脏标签都被 flush"，Tauri 侧只做代码审查确认接线。
- 验收：A 编辑（脏，1s 计时中）→ 立即切 B → 计时器触发不得写 B/跳过 A → 切回 A 仍脏且定时器重新调度 → `flushAllDirty` 单测断言全部脏标签落盘。

**（3）E03 — 重命名/删除 tabs.path 未同步**（`App.tsx:400-434,117-128`）
- 改法：`treeRename` 成功后 `setTabs(ts => ts.map(t => t.path === node.path ? {...t, path: newPath, name} : t))`；`treeDelete` 成功后同步将匹配 tab 的 path 置 null（或关闭该 tab），name 改"未命名"。同时 `filePathRef` 保持更新。
- 验收：打开 a.md → 重命名 b.md → 切走再切回 → Ctrl+S 不得复活 a.md；删除文件同理。

**（4）E18 — 三定时器卸载清理**（`App.tsx:78-80`）
- 改法：新增 effect 返回 `() => { clearTimeout(autoTimer.current); clearTimeout(statsTimer.current); clearTimeout(treeTimer.current); }`。
- 验收：HMR/卸载后无失效 state 更新告警。

**风险/回滚**：全部为行为改动，重点回归多标签全部路径。 innocence 检查：D1 修复不改变四个调用点签名，可单独回滚该函数。

---

### I02 — 源码模式数据正确（P0，车道 A，依赖 I01）

**（1）E04 — SourceMode 同标签内容刷新失效**（`SourceMode.tsx:23,31`）
- 现状：`docRef` 挂载时赋一次值，`doc: docRef.current`，无 `[doc]` effect；`key={activeId}` 只切标签重建。外部变更/恢复快照后 CM 显示旧文本并可能写回覆盖。
- 改法：加 `useEffect(() => { const v = viewRef.current; if (!v) return; const cur = v.state.doc.toString(); if (cur !== doc) { suppressChangeRef.current = true; v.dispatch({ changes: { from: 0, to: cur.length, insert: doc } }); suppressChangeRef.current = false; } }, [doc])`；`updateListener` 内 `if (suppressChangeRef.current) return` 抑制 onChange 回环。
- 验收：源码模式下外部修改当前文件 → CM 刷新；恢复快照 → CM 刷新且不把旧文本写回。

**（2）E09 — CM 悬挂引用 + setTimeout 未清理**（`App.tsx:506-519,783-797,1007-1009`、`SourceMode.tsx:45-48`）
- 改法：`onReady` 类型改 `(v: EditorView | null) => void`，SourceMode 卸载时 `onReadyRef.current?.(null)`；`openHit` 的 120ms 与源码搜索的 60ms `setTimeout` 存入 ref（如 `jumpTimer.current`），effect cleanup 清除；`cmViewRef.current` 每次使用前判空。
- 验收：命中跳转后 120ms 内切回 WYSIWYG/切标签 → 无异常、无焦点错乱。

**风险/回滚**：回环抑制是关键，务必用 ref 而非 state；单独回滚 SourceMode.tsx 即可。

---

### I03 — 异步乱序防护（P1，车道 A，依赖 I02）

**（1）E02 — stats 回调乱序**（`App.tsx:130-151,287-295`）
- 改法：新增 `statsSeqRef = useRef(0)`；`loadBuffer` 与 `scheduleStats` 每次请求前 `const seq = ++statsSeqRef.current`，回调内 `if (seq !== statsSeqRef.current) return;` 才写 `initialWordsRef`/`setStats`。
- 验收：A/B/C 字数差异大，快速连点标签 → 状态栏字数与"+N 字"基线正确。

**（2）E08 — 搜索结果竞态**（`SearchPanel.tsx:18-40`）
- 改法：新增 `searchSeqRef`，每次发起 `++searchSeqRef.current`，`.then/.catch` 内校验序号；清理函数递增序号使在途回调失效。
- 验收：大工作区快速改查询词 → 结果列表与输入框一致。

---

### I04 — E07 快捷键吞输入框（P1，车道 A，依赖 I03）

- 现状：`App.tsx:732-802` `window.addEventListener("keydown", onKey, true)` 捕获阶段无 `e.target` 判断。
- 改法：`onKey` 开头加：
```ts
const t = e.target as HTMLElement | null;
const editable = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
  t.tagName === "SELECT" || t.isContentEditable);
if (editable && e.key !== "F8" && e.key !== "F9") return;
```
- 验收：搜索框/查找框/设置数字框内按 Ctrl+S/P/+// → 不误触发；F8/F9 仍全局。

---

### I05 — E05 导出 HTML 属性转义/XSS（P0，车道 B）

- 精确落点：`lib.rs:26-28` escape_html 只 replace `& < >`；`lib.rs:105` href、`:159` title、`:163` src、`:164` alt 全用它拼进双引号属性 → `[x](a" onmouseover="alert(1))` 注入。
- 改法：
  1. `escape_html` 增加 `.replace('"', "&quot;").replace('\'', "&#39;")`（文本上下文同样安全）。
  2. 所有属性拼接点（105/159/163/164 + `language-*` `:100`）统一走转义后的值。
- **重要边界**：`lib.rs:194` `Event::Html | InlineHtml` 原样透传是 v1.3 为防丢内容的有意权衡，`export.ts:58-63` 靠它注入 KaTeX HTML。**不得删除透传**；若要处理不可信 md，另加"清洗开关"参数而非移除。
- 验收：新增单测断言 `href="a&quot; onmouseover=&quot;alert(1)"` 形式不逃逸；`cargo test --lib` 全绿；导出含公式的 md 仍正确渲染 KaTeX。

---

### I06 — E11 路径穿越 + E06 truncated（P1，车道 B，依赖 I05）

**（1）E11**（`export.rs:55-76,63`）
- 现状：`Path::new(&base_dir).join(&decoded)` 无校验，`![x](../../secret)` 可读任意文件内嵌。
- 改法：`let base = Path::new(&base_dir).canonicalize()?;`；`let p = base.join(&decoded).canonicalize()`；校验 `p.starts_with(&base)` 否则 `return caps[0].to_string()`（跳过内嵌）。
- 验收：`embeds_local_images_only`（`export.rs:112-127`）仍绿；新增穿越用例断言不外嵌。

**（2）E06**（`search.rs:68-110`）
- 现状：`truncated = hits.len() > limit`，各线程命中即 break 常为 `==limit` → 报 false。
- 改法：加 `AtomicBool stopped`；任一线程达 limit 时 `stopped.store(true)`；最终 `truncated = stopped.load(...)`。
- 验收：新增「单文件多命中触顶」与「并行 vs 单线程结果一致」测试；搜索面板"已截断"提示正确出现。

---

### I07 — A10 asset scope + A11 watch debounce（P1/P2，车道 B，依赖 I06）

**（1）A10**（`tauri.conf.json:23-30`）
- 现状：`assetProtocol.scope: ["**"]` 对整个文件系统开放。
- 改法：收窄为工作区与资源目录。因工作区运行时才确定，采用 Tauri 运行时 scope：`app.asset_protocol_scope().allow(Path)` 在 `open_folder`/`openFile` 确立工作区时动态授予；配置侧保留最小必需 scope。
- 验收：asset: 协议不可读工作区外文件；图片显示/导出不回退。

**（2）A11**（`watch.rs:53-88`）
- 现状：pending 只在 `RecvTimeoutError::Timeout` 分支刷新；持续 <150ms 事件流永不超时 → 通知无限延迟。
- 改法：用独立 debounce 计时器（如 `Instant` + 每次事件重置 deadline，主循环 `recv_timeout` 用 `deadline - now` 为超时值），到点即 flush。
- 验收：连续高频写文件 5s 后，变更事件在 300ms 内送达前端。

---

### I08 — D2 阶段一：rerenderOn 谓词（P1，车道 A，依赖 I04）

- 现状：`useEditor.ts:14-16` `ed.on("transaction", rerender)` → 每事务 setTick，`useEditor` 在 `App.tsx:314` 顶层调用 → 全树重渲染。
- 改法：
  - `useEditor.ts:5-23`：`EditorHostOptions` 增 `rerenderOn?: (tr: Transaction) => boolean`；监听回调改 `const rerender = (tr: Transaction) => { if (!rerenderOnRef.current || rerenderOnRef.current(tr)) setTick(t => t + 1); }`（用 ref 存最新谓词，避免闭包陈旧）。默认 `tr.docChanged || tr.selectionSet`。
  - `App.tsx:314-324`：传入 `rerenderOn: tr => tr.docChanged || tr.selectionSet || !!tr.getMeta(findKey)`；顶部 `import { findKey } from "./editor/find-replace";`（**已导出于 find-replace.ts:20，无需改该文件**）。
- **计数守住**：`FindReplaceBar.tsx:27` 的 `getFindState(editor)` 在 render 中直读、无订阅，完全靠 App 顶层重渲染刷新 x/y。谓词**必须**放行 `findKey` meta，否则计数冻结。
- **注意事项（本轮不追求 memo 收益）**：若工程师额外加 `React.memo`，App.tsx 多处内联 handler（`onClick={() => void save()}` 等）会击穿 memo，需先 `useCallback` 稳定——但本轮**不做**这层优化，谓词过滤才是有效部分。
- 验收：Profiler/渲染计数 spy —— 纯选区移动与 find meta 不再触发 App 顶层渲染；打字仍触发；FindReplaceBar x/y 计数不冻结。

---

### I09 — A04/A05 decorations 增量（P1，车道 C，风险闸门）

- 精确落点：`code-block.ts:96-99`（`apply: tr.docChanged ? highlightDecorations(tr.doc) : old.map(...)`）、`find-replace.ts:56-70`（`computeMatches(tr.doc, ...)`）。
- 改法：`apply` 改为：
```ts
apply(tr, old) {
  let next = old.map(tr.mapping, tr.doc);
  if (!tr.docChanged) return next;
  const ranges: {from:number,to:number}[] = [];
  tr.changes.iterChangedRanges((fa, ta, fb, tb) => ranges.push({from: fb, to: tb}));
  next = recomputeForRanges(tr.doc, ranges, next);  // 仅重算命中 range 的 block/文本节点
  return next;
}
```
- **风险闸门**：若 `recomputeForRanges` 的等价性无法保证（跨块映射/装饰重叠），**不要硬做**——按 team-lead 指示单列下一轮，本任务在清单中标记"暂缓"并说明理由。`focus.ts:29-30` 是 O(1) 单 node decoration，**不在优化范围**。
- 验收：增量结果与原全文重算在相同文档上逐项一致（等价性单测）；`spike:m1editor 13/13`、`roundtrip` 不动点 PASS。

---

### I10 — 字体裁剪 + A13 CM6 精选（P2，车道 C）

**（1）字体裁剪（低风险，必做）**
- 现状：`main.tsx:5` `import "katex/dist/katex.min.css"` 引用 woff2/woff/ttf 三格式，Vite 全产出（59 文件 ~1.07MB）；`export.ts:5-9` 只取 woff2。
- 改法：构建期改写 CSS 仅保留 woff2（vite 插件或自定义 css 副本），woff/ttf 不产出。省 ~770KB。
- 验收：`vite build` 后 dist 字体文件数从 59 降到 ~19，KaTeX 渲染正常。

**（2）A13 basicSetup → 精选扩展（中风险，先评估）**
- 现状：`SourceMode.tsx:32-41` 用 `basicSetup`（含 autocomplete/lint/fold/bracketMatching 等未用扩展），`vendor-codemirror` 603KB 最大 chunk。
- 评估门槛：替换后必须保留**现有功能**——markdown 语法高亮、行号、历史撤销、`lineWrapping`、暗色主题 Compartment 热切、`@codemirror/search` 面板（App.tsx:789 动态 import 依赖 basicSetup 提供的 search keymap）。
- 若无法满足，**标下一轮**，本任务只做字体裁剪。
- 无回归保证：精选扩展后跑 `spike:m1editor 13/13` + 手动验证 Ctrl+F/H 源码搜索面板、Ctrl+Z 撤销、主题切换。

---

### I11 — C1 统一弹窗原语（P1，车道 A，依赖 I08）

- 新建 `src/ui/Modal.tsx`：`useModal(close, initialFocus)`（Esc + 焦点陷阱 + 关闭归还焦点）、`ConfirmDialog`、`PromptDialog`。
- 新建 `src/ui/Toast.tsx`：`ToastHost` + `success/error/info`，3–5s 自动消失。
- 替换 15 处 `window.*`：
  - `App.tsx:168`(closeTab confirm)、`:228`(保存失败)、`:271`(打开失败)、`:385`(新建 prompt)、`:394`(新建失败)、`:402`(重命名 prompt)、`:412`(重命名失败)、`:421`(删除 confirm)、`:430`(删除失败)、`:500`(恢复失败)、`:531`(导出HTML失败)、`:542`(导出PDF失败)、`:566`(设置目标 prompt) → ConfirmDialog / PromptDialog / Toast
  - `shortcuts.ts:22`(Ctrl+K prompt) → 改为扩展配置项 `promptLink?: (prev) => string|null`，由 App 注入 PromptDialog
  - `HistoryPanel.tsx:36`(读取快照失败) → Toast
- 验收：`grep -rn "window\.\(alert\|confirm\|prompt\)" src/` 零结果；确认类可 Esc/回车、输入类焦点自动落入、失败类 3–5s 消失。

---

### I12 — C2 标题栏 + U10/U11（P1，车道 A，依赖 I11）

- `App.tsx:859-912`：常用按钮（新建/打开/保存/设置/模式/主题）改"图标+tooltip(title/aria-label)"；按"文件组｜视图组｜窗口组"加 1px 分隔；低频（文件夹/最近）收进溢出菜单；保存按钮强调色；`saving` 时禁用。
- `styles.css:63-77`：`.doc-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`；`.tb-actions { flex:none }`；`@media(max-width:1100px)` 折叠次要按钮文字。
- 验收：900px 最小窗口下标题省略、按钮不溢出；`themeLabel` 在 custom_theme 生效时有可见指示。

---

### I13 — UX 地基（P1，车道 A 的 CSS 部分可并行给第二人，依赖 I11）

| 项 | 文件:行号 | 改法 |
|---|---|---|
| U01 | `styles.css` 全局 + `:195/:298/:331/:357` | 加 `:focus-visible { outline:2px solid var(--accent); outline-offset:2px }`；4 处 `outline:none` → `:focus:not(:focus-visible){outline:none}` |
| U02 | 各面板 | 浮层 `role="dialog" aria-modal="true" aria-labelledby`；页签 `role="tab"`+`aria-selected`；flag 按钮 `aria-pressed`；`.tree-row` 改 `role="treeitem" tabIndex={0}` + Enter/方向键 + `aria-expanded` |
| U03 | `styles.css` | `@media (prefers-reduced-motion:reduce){ .goal-fill,.focus-mode .ProseMirror>*,.focus-current{transition:none!important} }` |
| U04 | `styles.css:257,276,304,339,362,278` | 激活态统一用 `--accent-strong` |
| U05 | `styles.css:10` | `--fg-dim` 亮 `#5b6472` / 暗 `#98a0ab` |
| U06 | `styles.css:285-286,317` | 抽 `--diff-add/--diff-del` 随主题 |
| U07 | `styles.css:313` | `.search-hit:hover { background:var(--bg-hover) }` + focus-visible 同款 |
| U13 | `styles.css:155-159`、`FileTree.tsx:93-97,123` | `left: Math.min(x, innerWidth-140)`、`top: Math.min(y, innerHeight-120)` |
| U14 | `styles.css:260-268,320-328` | 抽 `--overlay-bg/--shadow-modal/--radius-modal` 统一 |
| U20 | `HistoryPanel.tsx:55-76`、`SettingsPanel.tsx:17-22`、`Palette.tsx` | 复用 `useModal`：Esc 关闭 + 打开聚焦 + 关闭归还 + Tab 陷阱 |

- 验收：键盘 Tab 全程有焦点圈；所有浮层 Esc 可关；对比度关键项达标；右键菜单边缘不溢出。

---

### I14 — Q6 sidebar_width + C4（P2，车道 A 末段 + B 的 fs.rs，依赖 I13）

- 按 §1.3 契约落地：字段 + serde default 260 + CSS 变量 clamp + 拖拽手柄 + 设置面板项。
- **顺带 E17**（同 fs.rs，成本近零）：`build_dir` 的 `p.is_dir()` 改 `p.symlink_metadata().map(|m| m.file_type().is_dir())` 跳过符号链接，并传深度参数上限 32，防符号链接环无限递归。
- `styles.css:194-232`：`--editor-zoom` 同时作用于 `.ProseMirror` 的 `max-width: calc(860px * var(--editor-zoom))`，源码模式同步，保持视觉行长恒定。
- 验收：旧 settings.json（无字段）反序列化取 260；拖拽后重启保持；缩放后行长稳定；工作区放入自指符号链接不栈溢出；`tsc --noEmit` + `vite build` 绿。

---

### I15 — A09 文档刷新（P1，车道 D，依赖 I14/I10）

- `SPEC.md`：§8/§12/§4/§7/§5.7 标 7 项已落地、删"押后"；升 v1.6 变更记录（含 D1/E01-E09 修复、UX 地基、NSIS 结论）。
- 实测回填：重跑 `bench_10k_files`（目标全量 <1s 是否达标）+ `vite build` dist 体积（替换 2.51MB 旧值，含字体裁剪后数据）。
- `spikes/M2-CONCLUSIONS.md`：纠正 focus.ts 归类（O(1) 非全文重算）、补 NSIS blocker、分包/并行化已落地。
- `spikes/M1-CONCLUSIONS.md`：同步分包/decorations 真实状态。
- 验收：SPEC 与代码状态零矛盾；每个数字附实测命令与输出。

---

### I16 — B1 NSIS 两步构建（P1，车道 D，依赖 I15）

- 第一步：`$NODE node_modules/@tauri-apps/cli/bin.js build --no-bundle` —— 验证 Rust 发布链 + dist 集成（不依赖 NSIS，必须成功）。
- 第二步：`$NODE node_modules/@tauri-apps/cli/bin.js build` —— 尝试完整构建；若因 NSIS 工具链下载受阻中断，如实记录。
- **降级口径**：记为"配置与编译链就绪、离线不可打包"，**不得判为配置错误或 P0**；不占用工程师排查时间。
- 若遇 CLI binding 版本报错：`export NAPI_RS_ENFORCE_VERSION_CHECK=0` 后重试（期望 2.10.1、实际 2.11.4，守卫默认关闭，一般不必）。
- 验收：两步日志写入 SPEC v1.6 变更记录。

---

## 3. 并行调度建议（给 team-lead 排期）

| 车道 | 任务 | 可同时投入的人数 |
|---|---|---|
| A（App.tsx 独占） | I01→I02→I03→I04→I08→I11→I12→I13→I14 | **1 人**（严格串行） |
| B（Rust） | I05→I06→I07→I14(fs.rs 部分) | 1 人，与 A 全程并行 |
| C（编辑内核/构建） | I09、I10 | 1 人，与 A/B 并行 |
| D（文档/构建验证） | I15→I16 | 最后启动，依赖全部实测 |

- 若只有 1 名工程师：按序 I01→I02→I03→I04→I05→I06→I07→I08→I09→I10→I11→I12→I13→I14→I15→I16。
- 若有 2 名：A 道一人全程，B+C 道一人（I05/I06/I07/I09/I10 按序），最后合力 I15/I16。
- I13 的 CSS 部分（U01/U03–U07/U13/U14）可拆给第三人，与 A 道的组件属性改动（U02/U20）分开提交，仅 styles.css 独占。

---

## 4. 风险与回滚说明

### 4.1 行为改动（必须重点回归）
| 任务 | 风险点 | 回滚粒度 |
|---|---|---|
| I01 | D1/E01/E03 三条数据路径 | stashActive 函数可单独回滚；E01/E03 按函数回滚 |
| I02 | doc 同步的 onChange 回环 | 回滚 SourceMode.tsx 单文件 |
| I03/I04 | 序号误判导致状态不更新 / 快捷键漏响应 | 按函数回滚 |
| I08 | find 计数冻结、打字不刷新 | 回滚 useEditor.ts + App.tsx 传参两处 |
| I09 | 装饰等价性（跨块/重叠） | **闸门不过就不做**，回滚 cost 低 |
| I10(CM6) | 源码模式功能缺失 | 评估不过就标下一轮，只留字体裁剪 |
| I11 | 15 处弹窗替换遗漏 | 机械替换，按文件逐个回滚 |

### 4.2 纯配置/低风险（可快速回滚）
- I05 属性转义（不涉及逻辑分支）、I10 字体裁剪、I12 CSS、I13 CSS 部分、I14 serde 字段（前向兼容）、I15 文档、I16 构建验证。

### 4.3 全局回滚闸
每任务完成必须跑：typecheck + build + 相关 spike（m1ipc 15/15、m1editor 13/13、roundtrip 不动点、cargo test 18/18）。任一红灯不得进入下一任务。

---

## 5. 本轮明确不做（附理由）

| 项 | 理由 |
|---|---|
| **undo 跨标签（D13）** | 需从"单实例缓冲"改为"多实例/每标签独立历史"，架构影响大；team-lead Q3 确认继续作为已知取舍 |
| **D2 阶段二（订阅下沉）** | 涉及 App/Outline/FindReplaceBar/HistoryPanel 多组件结构改动，风险收益不匹配，留下一轮 |
| **focus.ts 装饰优化** | QA 已修正：`:29-30` 是 O(1) 单 node decoration，**不是全文重算**，无需优化 |
| **React.memo 性能优化** | App.tsx 内联 handler 会击穿 memo，需先大规模 useCallback 稳定化；本轮谓词过滤才是有效部分，不追求 memo 收益 |
| **B3 跨节点查找** | 属增强非缺陷，PRD Q2 待定；默认保留"不支持跨节点"行为 |
| **E10 图片失败反馈 / E12 mock 一致性 / E15 输入体验 / E16 大纲索引** | QA 列 P1/P2 但不在 team-lead 本轮必修清单，留下一轮。注：**E17 符号链接防护例外**——I14 改 fs.rs 时顺带加（`symlink_metadata` 跳符号链接 + 深度上限 32），因同文件顺手成本近乎零 |
| **Vitest / RTL / axe-core 引入** | 全离线未缓存，违反 §2.1；用 jsdom + tsx 手写测试替代 |
| **raw HTML 透传删除（E05 延伸）** | v1.3 为防丢内容的有意权衡，KaTeX 注入依赖它；只补属性转义，清洗开关另议 |
| **NSIS 工具链联网下载** | 离线环境不可得，如实降级，不强行突破环境边界 |

---

## 6. 验收总表（交付闸）

| 维度 | 命令/方式 | 通过标准 |
|---|---|---|
| 类型 | `$NODE node_modules/typescript/bin/tsc --noEmit` | EXIT=0 |
| 构建 | `$NODE node_modules/vite/bin/vite.js build` | EXIT=0 |
| 编辑器内核 | `$NODE node_modules/tsx/dist/cli.mjs spikes/m1-editor.ts` | 13/13 |
| IPC mock | `$NODE node_modules/tsx/dist/cli.mjs spikes/m1-ipc.ts` | 15/15 |
| 往返保真 | `$NODE node_modules/tsx/dist/cli.mjs spikes/roundtrip.ts` | 不动点 PASS |
| Rust | `cargo test --lib` | 18/18（若 0xc0000005 复现，QA 复测并记录，不预设永久故障） |
| 搜索基准 | `cargo test bench_10k_files -- --ignored --nocapture` | 实测回填 SPEC |
| 弹窗清零 | `grep -rn "window\.\(alert\|confirm\|prompt\)" src/` | 零结果 |
| 数据正确性 | QA D1/E01/E03/E04 复现用例 | 全通过 |
| 性能 | React Profiler / 渲染计数 | D2 纯 meta/装饰事务不触发 App 顶层渲染 |
| 打包 | I16 两步 | 编译链成功；NSIS 可降级记录 |

---

## 附：需求追溯矩阵

| 来源 | 任务 | 来源 | 任务 |
|---|---|---|---|
| D1（架构 A01） | I01 | E05 | I05 |
| E01 | I01 | E11/E06 | I06 |
| E03 | I01 | A10/A11 | I07 |
| E18 | I01 | D2（架构 A02） | I08 |
| E04 | I02 | A04/A05 | I09 |
| E09 | I02 | 字体裁剪 | I10 |
| E02 | I03 | A13 | I10（评估闸门） |
| E08 | I03 | C1 | I11 |
| E07 | I04 | C2/U10/U11 | I12 |
| U01–U07/U13/U14/U20 | I13 | Q6 sidebar_width + C4 + E17 | I14 |
| A09 | I15 | B1 NSIS | I16 |
