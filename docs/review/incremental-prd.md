# MWTyper 增量 PRD — 功能盘点与未完成任务识别

- 文档类型：增量需求（只读审查产出，本阶段不修改任何源码）
- 撰写：产品经理 许清楚（Xu）
- 日期：2026-11-21
- 依据：SPEC.md v1.5（2026-11-20）、spikes/M0~M2-CONCLUSIONS.md、src/ 与 src-tauri/src/ 实际源码、tauri.conf.json、vite.config.ts；交叉验证参考 `.workbuddy/review/architecture-review.md`、`docs/system_design.md`、`qa-ux-review.md`（E01 已纳入 T02，据 Q7 结论补 D3）
- 核心结论：**SPEC v1.5 声称「押后 M3」的 8 项功能，源码核查后 7 项已完整落地、1 项（NSIS 安装包）仅有配置无产物。项目的真实短板已从「功能缺失」转移为「文档严重滞后 + 视觉/UX 打磨 + 少量已知性能限制」。**

---

## 0. 一句话结论

M3 功能几乎全部提前落地但从未写回活文档；本轮不应盲目「补功能」，而应**先同步文档、再补 NSIS 产物验证、然后把主要精力投在视觉一致性、交互反馈、可访问性与响应式**这些用户可感知的打磨项上。此外，经与架构/QA 审查交叉验证，发现三项「已有功能的质量欠账」（D1 标签切换丢未保存编辑、D2 每事务全量重渲染、D3 自动保存定时器跨标签竞态），虽非功能缺失但影响正确性/性能，已单列 D 类。

---

## 1. 功能盘点总表（SPEC 声明 × 代码实现状态）

状态定义：**已完整**＝存在完整实现且已在主流程接线；**半成品**＝文件存在但功能有明确缺口/未接线；**缺失**＝无实现；**文档滞后**＝代码已完整但 SPEC 仍标注押后/未做；**配置就绪未验证**＝配置存在但无产物或未经实测。

### 1.1 M3「押后」清单逐项核查（本轮重点）

| # | SPEC 声明（押后 M3） | 代码实现状态 | 证据（文件:行号 / 关键代码） |
|---|---|---|---|
| 1 | 自定义主题（§5.7 / §8 / §4） | **已完整 + 文档滞后** | `src/settings/SettingsPanel.tsx:33-41` 主题下拉与目录提示；`src/App.tsx:596-615` `applyCustomTheme` 注入 `<style id="mwtyper-custom-theme">` 覆盖 CSS 变量；`src/App.tsx:634-648` 监听 `watchThemes` 热加载；后端 `src-tauri/src/themes.rs`（list_themes/read_theme/themes_dir_path）+ `lib.rs:227-230`（watch_themes 注册）。**完整闭环** |
| 2 | WYSIWYG 内查找替换（§8 / §12） | **已完整 + 文档滞后**（有 1 处限制） | `src/editor/find-replace.ts:1-136`（ProseMirror 插件：computeMatches + decorations + 导航 + replaceCurrent/replaceAll + findClose）；`src/editor/FindReplaceBar.tsx:1-72`（UI：命中计数、Aa/ab、上一个/下一个、替换/全部替换、Esc）；`src/App.tsx:320` 注册扩展、`src/App.tsx:783-797` Ctrl+F/Ctrl+H 接线。限制：`find-replace.ts:28` 注释「跨节点命中不支持」——属既定权衡，非 bug |
| 3 | HTML 粘贴（§8 / §12） | **已完整 + 文档滞后** | `src/editor/html-paste.ts:1-28`（dompurify 清洗 `USE_PROFILES.html:true` → PMDOMParser.parseSlice → 替换选区）；`src/App.tsx:318` 注册。完整 |
| 4 | 设置面板（§8） | **已完整 + 文档滞后** | `src/settings/SettingsPanel.tsx:1-94`：主题/自定义主题/自动保存/快照保留个数/天数/写作目标/编辑区缩放/专注/打字机，9 项齐全；`src/App.tsx:586-594` openSettings + `listThemes/themesDirPath`；`src/App.tsx:774-776` Ctrl+, 接线；样式 `styles.css:369-386` |
| 5 | Ctrl+P 快速打开（§7 / §8 / §12） | **已完整 + 文档滞后** | `src/App.tsx:765-767` Ctrl+P → `openPalette("files")`；`src/App.tsx:838-853` `fileCommands` 从工作区树生成文件命令；`src/commands/Palette.tsx:1-92` 模糊匹配 + 键盘导航；`src/App.tsx:1034-1040` palette 按 mode 切换数据源。完整 |
| 6 | 编辑区缩放（§7 / §8 / §12） | **已完整 + 文档滞后** | `src/App.tsx:577-579` `zoomBy`（50–200 clamp）；`src/App.tsx:768-773` Ctrl+=/Ctrl+-；`src/App.tsx:993` `--editor-zoom` CSS 变量注入；`styles.css:196/228/232` 字号 `calc(... * var(--editor-zoom))`；`SettingsPanel.tsx:73-81` +/−/重置；命令面板 `App.tsx:827-829`。完整 |
| 7 | 搜索并行化（D12 / §12 / M2 结论 §5） | **已完整 + 文档滞后** | `src-tauri/src/search.rs:68-104`：`std::thread::scope` 按 `available_parallelism().min(8)` 分块并行读取+`regex::bytes` 匹配，`AtomicUsize` 共享命中计数达 limit 停工，按 walk 顺序合并。**注**：SPEC/M2 结论仍写「并行读取列 M3」且性能数据为并行化前的 1268/1200ms（D12），数据已过时——需实测后回填 |
| 8 | 安装包 NSIS（§8） | **配置就绪未验证（存在离线 blocker）** | `src-tauri/tauri.conf.json:32-43`：`bundle.targets=["nsis"]`、installMode=currentUser、SimpChinese/English、图标齐全。**缺口**：`target/release/bundle/nsis/` 无产物，未执行过 `pnpm tauri build`。**真实 blocker（架构审查核实）**：打包由 `@tauri-apps/cli` 原生二进制驱动（非 Cargo），CLI 可用；但本机无 NSIS 工具链（makensis.exe + nsis-tauri-utils），`tauri build` 首次会联网下载该工具链，纯离线大概率失败——详见 B1 |
| 9 | bundle 2.51MB 分包（§12 / M1 结论） | **已完整 + 文档滞后** | `vite.config.ts:17-29` `manualChunks` 拆 vendor-katex/hljs/codemirror/tiptap/react；`src/App.tsx:33` `lazy(() => import("./editor/SourceMode"))` 源码模式首屏不含；`App.tsx:525-526/537` export 动态 import；`src/editor/code-block.ts:31-34` hljs 按需注册 24 语言。SPEC/M1 结论仍写「分包押 M3」 |

### 1.2 SPEC 声明的核心功能（M0–M2，核查是否名实相符）

| 功能 | 状态 | 证据 |
|---|---|---|
| 双模式编辑（WYSIWYG ⇄ 源码，Ctrl+/） | 已完整 | `App.tsx:328-356` toSource/toWysiwyg + 不动点保真；`SourceMode.tsx:1-58` CM6 |
| 文件树 / 打开 / 保存 / 自动保存 / 外部变更冲突 | 已完整 | `App.tsx:107-115/187-276/278-285/650-705`；后端 `fs.rs` |
| 大纲实时刷新 + 跳转 | 已完整 | `src/sidebar/Outline.tsx`（65 行）+ `App.tsx:436-451` jumpToHeading |
| 亮暗主题（随系统 + 手动） | 已完整 | `src/theme.ts:1-23` + `styles.css:4-51` CSS 变量双主题 |
| 字数统计 / 阅读时长 / 写作目标 | 已完整 | `src/statusbar/StatusBar.tsx:1-33`（进度条/会话统计）；`stats.rs` |
| 图片粘贴/拖拽 → assets | 已完整 | `src/editor/image-assets.ts:1-...`；`setImageBaseGetter` App.tsx:326 |
| 表格工具栏（增删行列） | 已完整 | `src/editor/TableToolbar.tsx:1-...` + `App.tsx:998` 光标入表浮现 |
| 本地快照历史 + diff + 恢复 | 已完整 | `src/sidebar/HistoryPanel.tsx:1-96`（时间轴/双页签 diff/恢复）；`diff.ts`；`snapshot.rs` |
| 命令面板 | 已完整（数量超前） | `src/commands/Palette.tsx`；`App.tsx:804-836` 现 25 基础命令 + 最近文件（SPEC §12 记 19 条，实际更多） |
| 跨文件搜索（含并行化） | 已完整 | `src/sidebar/SearchPanel.tsx:1-90`；`search.rs:23-113` |
| 专注 / 打字机模式 | 已完整 | `src/editor/focus.ts:1-42`；`App.tsx:718-729` 打字机滚动 |
| 导出 HTML / PDF | 已完整（PDF 待 GUI 实测） | `src/export.ts`；`App.tsx:524-543`；M2 结论 §5 标注 PDF 打印对话框需人工确认 |
| 多标签 | 已完整 | `App.tsx:35-41/117-185/914-938`（单实例缓冲 D13） |
| decorations 增量更新（性能优化） | **半成品（性能债，范围已修正）** | 真全文重算仅 2 处：`code-block.ts:98`（`highlightDecorations(tr.doc)` 含 `doc.descendants` 全文遍历）、`find-replace.ts:63-66`（`computeMatches` 全文）。`focus.ts:29-30` 仅 `doc.resolve(pos)` 后创建 1 个 node decoration，成本近似 O(1)，**不算全文重算**（SPEC/M2 结论把它并列是不精确的，经架构审查修正） |
| undo 不跨标签 | **已知限制（设计取舍 D13）** | `App.tsx:117-162` 单实例 setContent 重建栈；D13 明确记录，非缺陷 |

### 1.3 盘点结论

1. **真缺失的 M3 功能只有 1 项**：NSIS 安装包产物（配置有、未构建/未验证）。
2. **7 项 M3 功能已完整落地但文档从未同步**，造成「明明做了却像没做」的认知错位——这是当前最大的项目管理风险。
3. **1 项既定取舍 + 1 项性能债**：undo 不跨标签（D13）是明确的产品取舍、非缺陷；decorations 全文重算是可优化的性能债（仅 code-block/find-replace 两处，focus.ts 已排除）。此外 D1「标签切换丢未保存编辑」是**实现层时序竞态、应修缺陷**，与 D13 是两回事，切勿混为一谈或归入「已知取舍」。
4. **视觉与 UX 是本轮最大可改进空间**：源码中大量 `window.prompt/confirm/alert`（15 处）与自绘 modal 并存、标题栏 9 个纯文字按钮拥挤、全项目无 `:focus-visible`、无 aria-label、侧栏宽度不可调、缩放不改行宽——详见第 3 节 C 类。

---

## 2. 真正的未完成任务清单（按用户价值排序）

- **A 类**：SPEC 押后但代码已落地，仅需文档同步（成本极低、价值高；team-lead 拍板统一放 T05 集中处理，改造期不改文档）。
- **B 类**：SPEC 押后且代码确实缺失/未验证，本轮应补齐。
- **C 类**：视觉设计与 UX 改进（结合真实 UI 代码的具体可落地项）。
- **D 类**：已有功能的质量欠账（正确性/性能风险，SPEC 完全未记录）——经架构审查交叉验证补充，与 QA 审查结论需对齐口径。

---

## 3. A 类 — 文档同步（仅需改 SPEC / spikes 文档）

| 编号 | 任务 | 具体改动 | 优先级 |
|---|---|---|---|
| A1 | SPEC §8 路线图 M3 行改为「大部分已落地」 | 逐项标注 7 项完成、NSIS 待构建验证；补 2026-11-21 验收结论 | P1 |
| A2 | SPEC §7 快捷键表去掉「押后 M3」 | `Ctrl+P 快速打开`、`Ctrl+=/Ctrl+- 编辑区缩放` 的「押后 M3」删除；补 `Ctrl+, 设置`（代码已实现但 §7 表缺失） | P1 |
| A3 | SPEC §4 对照表同步 | 「自定义主题目录押后」→ 已落地；「查找替换 WYSIWYG 内替换 M2 自接」保留并注「已实现（跨节点不支持）」 | P1 |
| A4 | SPEC §12 / D12 更新并行化与性能数据 | 删除「并行读取列 M3」「bundle 分包押 M3」表述；实测并行化后重填 benchmark 数据（冷/热/正则/截断） | P1 |
| A5 | spikes/M2-CONCLUSIONS.md §5 已知限制同步 | 「专注模式装饰随事务全文重算」一句**纠正为不精确**（focus.ts 实为 O(1)；真正全文重算是 hljs/find-replace 两处）；补 NSIS 离线 blocker、分包已落地 | P2 |
| A6 | SPEC §5.7 自定义主题描述 | 「自定义主题目录（M3）」→「已落地（M3 实现，热加载）」 | P2 |
| A7 | SPEC §12 新增 v1.6 变更记录 | 记录本次盘点结论 + 后续 B/C 类任务 | P2 |

> A 类用户故事/验收标准从简（纯文档），但属 P1：它是后续所有判断的事实基线。

---

## 4. B 类 — 功能补齐（本轮应做）

### B1. 完成 NSIS 安装包构建与可安装验证（P1）

- **用户故事**：作为 Windows 个人用户，我希望下载一个标准的 NSIS 安装包，双击即可安装到当前用户目录并正常启动 MWTyper，而无需配置 Rust/Node 环境。
- **现状证据**：`tauri.conf.json:32-43` 已配置 `bundle.targets=["nsis"]` 与中文安装语言、图标；但 `target/release/bundle/nsis/` 目录不存在，无任何 `.exe` 产物，SPEC §8 的 M3 验收项未达成。
- **真实 blocker（架构审查核实，修正先前假设）**：Tauri 2 打包由 `@tauri-apps/cli` 预编译原生二进制驱动（本机 CLI 2.11.4 可用，`node_modules/.pnpm/@tauri-apps+cli-win32-x64-msvc@2.11.4/.../cli.win32-x64-msvc.node`），**与工程 Cargo.lock 是否含 `tauri-bundler` 无关**（实际 Cargo.lock 无 bundler，属正常）。卡点是 **NSIS 工具链本机缺失**（`C:/Program Files (x86)/NSIS`、scoop、ProgramData、`~/.tauri`、`%LOCALAPPDATA%/tauri` 均无 makensis.exe）；`tauri build` 首次会联网下载该工具链 Zip，纯离线大概率失败。
- **验收标准（分两步，避免把环境问题误判为配置错误）**：
  1. **第一步（必须先过）**：`pnpm tauri build --no-bundle` 成功产出发布版 exe——验证 Rust 发布编译链 + 前端 dist 集成无误（不需要 NSIS）；
  2. **第二步**：尝试完整 `pnpm tauri build` 产出 `MWTyper_0.1.0_x64-setup.exe` 于 `target/release/bundle/nsis/`；若能取得工具链，验证安装包可安装到 `currentUser`、快捷方式存在、启动无 WebView2 报错（本机已装 Runtime，R3 记录）；
  3. **降级路径**：若第二步因 NSIS 工具链下载受阻而中断，如实记录为「离线环境不可完成打包，配置与编译链已就绪」，**不得判定为配置错误或 P0 缺陷**；
  4. 两步日志与结论写入 SPEC v1.6 变更记录。
- **优先级**：P1（M3 唯一硬缺口），但**可交付性结论允许降级**（离线工具链不可得是环境限制，非产品缺陷）。
- **依赖/风险**：离线构建耗时（M0 记录 cargo 离线编译 ~2m46s）；NSIS 工具链需联网下载（与 SPEC §2 离线硬边界冲突）。附：若遇 CLI binding 版本报错（index.js 内嵌期望 2.10.1，实际 2.11.4），导出 `NAPI_RS_ENFORCE_VERSION_CHECK` 关闭守卫即可，无需重装。

### B2. decorations 全文重算 → 增量更新（P2）

- **用户故事**：作为写长文（数万字）的用户，我希望输入时代码高亮与查找命中装饰不随每次按键全量重算，以保持编辑流畅、不卡顿。
- **现状证据（范围已按架构审查修正）**：真正全文重算仅 2 处——`code-block.ts:98`（`tr.docChanged ? highlightDecorations(tr.doc)`，内含 `doc.descendants` 全文遍历）、`find-replace.ts:63-66`（`computeMatches(tr.doc,...)` 全文）。**`focus.ts:29-30` 已排除**：它只 `doc.resolve(pos)` 后创建 1 个 `Decoration.node`，无 descendants 遍历，成本近似 O(1)，无需优化。M1/M2 结论把它与前两处并列是不精确的，本 PRD 予以修正。
- **验收标准**：
  1. 装饰插件改为 `old.map(tr.mapping, tr.doc)` + 仅对改动范围重算（可用 `tr.changes.iterChangedRanges` 限定 block/文本节点）；
  2. jsdom 事务级实测：`pnpm spike:m1editor` 13/13、`spike:roundtrip` 不动点 PASS 无回归；
  3. 增量后 decorations 结果与原全文重算在相同文档上逐项一致（可加等价性单测）；
  4. 长文档（如 1 万行）单次输入重算范围局限于当前块，耗时降低可量化（可选报数）。
- **优先级**：P2（性能债，小文档无感；长文用户受益）。

### B3. WYSIWYG 查找支持跨节点命中（P2，可选增强）

- **用户故事**：作为在加粗/链接混排段落中查找的用户，我希望搜索词跨越格式化边界时（如「**重要**结论」中搜「重要结论」）也能命中并高亮。
- **现状证据**：`find-replace.ts:28-48` `computeMatches` 逐文本节点匹配，第 28 行注释明确「跨节点命中不支持」。
- **验收标准**：
  1. 查找/替换支持跨相邻文本节点的匹配（拼接文本节点后计算位置映射回 PM 坐标）；
  2. 大小写/全词开关在跨节点场景仍正确；
  3. 替换后文档结构不丢格式（保留节点 marks）；
  4. 现有单节点匹配行为不回归。
- **优先级**：P2（属增强而非缺陷；如排期紧张，可保留「不支持跨节点」并在 UI 提示，不下沉到 P1）。

---

## 5. C 类 — 视觉设计与 UX 改进（本轮重点，基于真实 UI 代码）

> 以下每项均来自对 `src/App.tsx`、`src/styles.css`、各面板组件的实际阅读，给出具体、可落地的改进点。

### C1. 消除原生弹窗，统一为应用内浮层（P1）

- **用户故事**：作为注重视觉一致性的用户，我希望所有确认/输入/报错都使用与应用同主题的浮层，而不是割裂的系统 `alert/confirm/prompt`（深色主题下尤其突兀）。
- **现状证据（15 处原生弹窗）**：
  - `App.tsx:168` closeTab `window.confirm`；`:228` 保存失败 alert；`:271` 打开失败 alert；`:385/402/566` 新建/重命名/目标 `window.prompt`；`:394/412/430/500/531/542` 各类失败 alert；`:421` 删除 confirm；
  - `src/editor/shortcuts.ts:22` Ctrl+K 链接 `window.prompt`；
  - `src/sidebar/HistoryPanel.tsx:36` 读取快照失败 alert。
  - 同时项目已有自绘浮层样式 `.modal-backdrop/.modal`（`styles.css:260-289`）、`.palette`（319-341），却没有复用。
- **验收标准**：
  1. 提供统一 `ConfirmDialog` / `PromptDialog` / `Toast` 组件（复用现有 modal 样式与 CSS 变量，跟随亮暗主题）；
  2. 上述 15 处全部替换，`window.alert/confirm/prompt` 在 `src/` 中零残留（可加 lint 规则约束）；
  3. 浮层支持 Esc 关闭、回车确认、焦点自动落在输入框（详见 C3）；
  4. 保存/打开/导出等失败改为非阻塞 Toast（3–5s 自动消失），确认类（删除/关闭脏标签/恢复）用 ConfirmDialog。
- **优先级**：P1（最高频、最影响「像不像一个正经桌面应用」的观感）。

### C2. 标题栏信息架构与图标化（P1）

- **用户故事**：作为首次使用者，我希望标题栏按钮有图标和清晰分组，能一眼找到常用操作，窗口变窄时也不挤压文档标题。
- **现状证据**：`App.tsx:859-912` 标题栏含 ☰ + 文档标题 + 9 个纯文字按钮（新建/打开/文件夹/保存/最近▾/主题/设置/模式 + Tauri 窗口控制），`styles.css:69-77` 仅靠 `gap:6px` 分隔、无图标、无分组、无溢出策略；`tauri.conf.json:19` `minWidth:900` 下会把 `.doc-title` 挤到极小甚至溢出。
- **验收标准**：
  1. 常用操作改为「图标 + tooltip（title/aria-label）」：新建/打开/保存/设置/模式切换/主题；
  2. 按语义分组（文件组｜视图组｜窗口组），组间加分隔线；低频操作（文件夹、最近）可收进溢出菜单；
  3. 文档标题设 `min-width:0; overflow:hidden; text-overflow:ellipsis` 并设最小保留宽度（如 160px）；窄窗口下按钮组允许换行或折叠；
  4. 主题按钮用图标反映当前态，切换后 tooltip 同步；自定义主题生效时给出可见指示（当前 `themeLabel` 只显示浅/深/系统，忽略 custom_theme）。
- **优先级**：P1（首屏观感 + 可用性）。

### C3. 可访问性与键盘交互补齐（P2）

- **用户故事**：作为键盘用户/无障碍需求用户，我希望每个可点元素有可读名称、焦点清晰可见、所有浮层可用 Esc 关闭。
- **现状证据**：
  - `styles.css` 全文无 `:focus-visible` 规则 → 键盘 Tab 时无焦点圈；
  - 图标按钮无 `aria-label`：`App.tsx:860`（☰）、`:926-935`（×）、`FindReplaceBar.tsx:59-61`（↑/↓/×）、`SearchPanel.tsx:61-63`（Aa/ab/.*）；
  - Esc 关闭不一致：`Palette.tsx:70-73`、`FindReplaceBar.tsx:37-40` 支持 Esc；但 `SettingsPanel.tsx:17`（仅点遮罩关闭）、`HistoryPanel.tsx:55-75` diff 浮层无 Esc，`App.tsx:732-802` 全局快捷键无 Escape 分支；
  - 浮层无 `role="dialog"` / `aria-modal` / 焦点陷阱。
- **验收标准**：
  1. 全局补 `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`；
  2. 所有纯图标/符号按钮补 `aria-label`；
  3. 所有 modal/palette/find-bar 统一支持 Esc 关闭，打开时焦点落入首个可交互元素，关闭后焦点归还触发者；
  4. modal 加 `role="dialog" aria-modal="true"`，Tab 焦点限制在浮层内。
- **优先级**：P2（不阻塞功能，但体现产品成熟度，且是低成本改动）。

### C4. 布局层级与响应式打磨（P2）

- **用户故事**：作为在多任务/不同分辨率下写作的用户，我希望侧栏宽度可调、编辑区缩放时行宽同步，以获得稳定的阅读行长。
- **现状证据**：
  - `styles.css:128` 侧栏固定 `width:260px`，无拖拽分隔条、宽度不持久化（settings 有 `sidebar_open` 但无 `sidebar_width`）；
  - `styles.css:194` `.ProseMirror` 固定 `max-width:860px`，而缩放只改字号（`styles.css:196`）→ 放大字号后行长不变，每行字数骤减、阅读节奏被破坏；
  - `tauri.conf.json:19` `minWidth:900`，更小的窗口无适配策略。
- **验收标准**：
  1. 编辑区与侧栏之间加可拖拽分隔条，宽度范围 180–420px，持久化到 settings（新增 `sidebar_width`，Rust 侧 serde 默认值兼容旧配置）；
  2. `--editor-zoom` 同时作用于 `.ProseMirror` 的 `max-width`（如 `calc(860px * var(--editor-zoom))`），保持视觉行长恒定；源码模式同步；
  3. 窗口 ≤1000px 时自动收窄侧栏或折叠标签文字（CSS 媒体查询），不出现横向滚动条；
  4. 拖拽后布局无跳动，`tsc --noEmit` + `vite build` 绿。
- **优先级**：P2（体验打磨，长文/高 DPI 用户受益明显）。

### C5. 状态反馈体系（P2）

- **用户故事**：作为频繁保存的用户，我希望「保存中/已保存/未保存」和「快照已创建/导出成功」有清晰、统一的视觉反馈，而不是靠猜。
- **现状证据**：`StatusBar.tsx:16-32` 保存态为纯文字「保存中…/未保存/已保存」，无色彩/图标语义；标题栏与标签页仅有 `dirty-dot`（`styles.css:68`）；快照创建、恢复、导出成功均静默或走 alert（见 C1）。
- **验收标准**：
  1. 状态栏保存态用「图标 + 颜色」区分三态（存中=脉冲点、未保存=橙点、已保存=绿点/隐藏）；
  2. 成功类操作（快照、恢复、导出完成）用统一 Toast 轻提示，不打断编辑；
  3. 失败提示统一为 Toast 且可手动关闭（与 C1 共用组件）。
- **优先级**：P2（与 C1 共用组件，建议同批实现）。

### C6. 查找/搜索控件一致性与能力对齐（P2）

- **用户故事**：作为同时使用文件内查找和跨文件搜索的用户，我希望两者的开关按钮长一样、行为一致，不用重新适应。
- **现状证据**：`SearchPanel.tsx:60-64` 用 `.search-flags button`（Aa/ab/.*，样式 `styles.css:299-304`）；`FindReplaceBar.tsx:57-58` 用 `.find-row button`（Aa/ab，样式 `styles.css:358-363`）——同类开关两套视觉；且查找栏无正则而搜索有正则，用户易困惑。
- **验收标准**：
  1. 抽取共享 `FlagToggle` 组件 + 统一 `.on` 激活态样式（同一 CSS 变量），两处复用；
  2. 明确能力边界：若查找不支持正则，在 tooltip/UI 标注「跨文件搜索支持正则」；若决定对齐，则 `find-replace.ts` 增加正则模式选项；
  3. 两处命中计数的措辞统一（find 为 `n/N`，search 为「n 处命中」）。
- **优先级**：P2（一致性问题，能与 C1/C3 同批处理最佳）。

### C7. 自定义主题可发现性（P2）

- **用户故事**：作为想换主题的用户，我希望在设置里一键打开主题目录、看到书写自定义 CSS 的示例，而不是读一行小字自己找路径。
- **现状证据**：`SettingsPanel.tsx:41` 仅一行 `.settings-hint` 显示路径；后端有 `themesDirPath`（`ipc.ts:354`、`themes.rs`）但无「在文件管理器中打开」命令；无示例模板。
- **验收标准**：
  1. 设置面板自定义主题项旁加「打开主题目录」按钮（新增 Rust `reveal_themes_dir` 命令，用 rfd 或 explorer 跨平台抽象）；
  2. 提供一段可复制的 CSS 变量示例（列出常用变量 `--bg-editor/--fg/--accent` 等）；
  3. 无自定义主题时下拉显示「无」并说明如何添加（与热加载 watch 联动）。
- **优先级**：P2（配合已落地的自定义主题功能，提升可用性）。

### C8. 空状态引导可操作化（P3）

- **用户故事**：作为新用户，我希望每个空面板都有一个可点击的下一步操作，而不是一段静态文字。
- **现状证据**：`App.tsx:893`「暂无最近文件」、`FileTree.tsx:100`「尚未打开文件夹 点击标题栏…」、`HistoryPanel.tsx:40/46`、`SearchPanel.tsx:42`、`Palette.tsx:88` 均为 `.panel-empty` 纯文字（`styles.css:138`）。
- **验收标准**：空状态内嵌主操作按钮（打开文件夹/新建文稿/搜索），点击直接触发对应命令；文案统一语气与层级。
- **优先级**：P3（锦上添花，可并入 C1/C2 批次）。

---

## 5b. D 类 — 已有功能的质量欠账（经架构审查交叉验证补充，需与 QA 对齐）

> 这三项 SPEC 完全未记录，不属于「功能缺失」而是「已实现功能内部的正确性/性能风险」。由 software-architect 交叉验证发现（D3 源自 QA 的 E01），产品经理核实代码后纳入，供 team-lead 与 QA 统一口径。

### D1. 多标签切换时 stash 存在时序依赖的未保存编辑丢失风险（P0，正确性）

- **用户故事**：作为在多标签间频繁切换写作的用户，我希望切换标签时当前未保存的输入被可靠暂存，绝不因快速切换而丢失。
- **现状证据**：`App.tsx:118-128` `stashActive()` 在 `setTabs` 的更新器函数内读取 `activeIdRef.current` 与 `dirtyRef.current`（ref 而非快照），而调用方（`activateTab` 153-162、`newFile` 358-366、`openFile` 237-275）在调用 `stashActive()` 后立即改写 `activeIdRef.current` 并 `loadBuffer()`（后者会改 `filePathRef`/`dirtyRef`/`frontmatterRef`）。React 的 state 更新器是延迟执行的，执行时读到的 ref 可能已是切换后的新值 → 暂存到错误标签或用新内容覆盖，导致编辑丢失。
- **验收标准**：
  1. `stashActive` 在调用瞬间即捕获 `activeId`/`dirty`/`currentText()` 的快照值，再传入 `setTabs` 更新器（不在更新器内读可变 ref）；四个调用点（activateTab/newFile/openFile/closeTab）无需改动；
  2. **QA 复现用例规格（纳入验收）**：前置 autosave 设为 0（否则 1s 定时器抢先落盘会掩盖丢失现象），浏览器 mock 或 jsdom 挂载 App，打开 A/B 两文件成两标签 → 在 A 输入独特文本 `UNIQUE_A` → 立刻切 B → 切回 A，期望 A 仍含 `UNIQUE_A` 且 dirty 点正确；补充路径：A 编辑后直接 `newFile`、A 编辑后 `openFile` 打开 C，各测一次；
  3. 现有 `pnpm tauri dev` 与浏览器 mock 两种后端下均验证通过，`m1ipc 15/15`、`m1editor 13/13` 无回归。
- **优先级**：P0（数据丢失类问题，用户价值高于绝大多数 C 类打磨项；team-lead 最终拍板与 E01/D3 并列必修 P0）。
- **归属提示**：与 software-qa-engineer 的「代码质量与潜在错误审查」高度重叠，建议由 QA 主导复现确认与回归用例、架构师出修复方案、工程师落地。**修复代码 diff 见架构设计文档（不在此 PRD 重复）**；QA 用例规格如上，仅针对这两个具体场景，不扩为全面测试体系建设。

### D2. 每个编辑器事务全量重渲染整个 App（P1，性能）

- **用户故事**：作为在长文中连续输入的用户，我希望编辑操作流畅、输入延迟低，不因每次按键重渲染整个应用外壳（标题栏/侧栏/状态栏/标签栏）。
- **现状证据**：`src/editor/useEditor.ts:14-16` `ed.on("transaction", rerender)` → `setTick(t => t+1)`，而 `useEditor` 在 `App` 顶层调用（`App.tsx:314`），任何编辑器事务（包括光标移动、selection 变化、输入法组合）都会触发 App 全量重渲染。与 C 类/B2 的 decorations 全文重算叠加，长文档输入卡顿风险放大。
- **验收标准**：
  1. **定稿口径（team-lead）**：`rerenderOn` 谓词放行 `docChanged || selectionSet || !!tr.getMeta(findKey)`；**只有纯 meta/装饰事务顶层渲染归零**。打字（docChanged）、选区移动（selectionSet）、find 查询（find meta）三类**必须触发**顶层 render——因为 `Outline.tsx:25` 当前节高亮与 `FindReplaceBar.tsx:27` 的 x/y 计数均无自身订阅、依赖顶层重渲染，若把 selection/find meta 归零二者会冻结。与设计文档 `system_design.md:31/95/207` 完全一致（早期措辞曾误写为「选区/find meta 不触发」，已按 QA 反馈与 team-lead 定稿修正）；
  2. **QA 复现用例规格（纳入验收）**：React Profiler 或渲染计数 spy 挂载 App，分别触发 1 次打字、1 次纯选区移动、1 次 find 查询输入、1 次纯装饰/meta 事务，统计 App 渲染次数——前三类**应触发**顶层渲染（保证大纲高亮与 x/y 计数刷新），第四类归零；
  3. 若采用 memo 优化，须先用 `useCallback` 稳定内联 handler（`onOpenFile={(p)=>void openFile(p)}` 等），否则 memo 被新引用击穿、无效；
  4. 既有功能（大纲实时刷新、状态栏字数、自动保存、专注/打字机、FindReplaceBar 的 `x/y` 计数）不回退，`spike:m1editor 13/13`、`roundtrip` 不动点 PASS。
- **优先级**：P1（体验性性能，长文用户感知明显；架构设计已拆两阶段——阶段一低风险建议本轮做，阶段二订阅下沉为结构性改造建议后续）。
- **归属提示**：与 QA/架构师职责重叠，排在 D1 之后。**修复方案（两阶段 + rerenderOn 谓词 + find meta 放行）见架构设计文档**；QA 用例规格如上。

### D3. 自动保存定时器跨标签竞态导致保存跳过/错写（P0，正确性）

- **来源说明**：QA 审查发现的 **E01**（`qa-ux-review.md`），与 D1 是**两个独立缺陷**——D1 是 stash 更新器读可变 ref 的数据串位（无条件发生）；E01 是 autosave 定时器跨标签未清理，属于竞态。team-lead 最终拍板：**明确纳入本轮 T02、定为 P0 数据丢失、与 D1 并列必修**（非「已知未修」）。本条按此前约定「E01 纳入则补 D3 验收标准」增补。
- **用户故事**：作为在多标签间快速切换写作的用户，我希望自动保存永远写到正确的文件，且不因切换标签而跳过当前未保存内容或丢失关窗前的编辑。
- **现状证据（架构设计 §2/§契约）**：`App.tsx:278-285` `scheduleAutosave` 的 `autoTimer` 在标签切换（activateTab/loadBuffer）时未清理；切换后定时器回调触发 `saveRef.current({auto:true})`，而 save 内部读的是切换后的 `filePathRef`/`currentText()` → 用 B 的路径/内容保存，或让 A 的待存内容被跳过。根因与 D1 同族：可变 ref + 异步回调 + 缺少标签身份标识。
- **验收标准（team-lead 定稿：方案 B 强化版）**：
  1. `activateTab`/`loadBuffer` 入口先 `clearTimeout(autoTimer)`；D1 保证 tab state 完整保留离场标签的文本与 dirty 态；
  2. `loadBuffer` 后若当前标签 `dirty && path`，**立即重新调度 autosave**（不依赖失焦/手存/被动等待），确保切回的脏标签在 `autosave_ms` 后落盘到正确文件；
  3. `beforeunload` / Tauri close 事件触发时 flush **所有有 path 的脏标签**（未命名草稿无 path，不 flush）；定时器回调与 flush 均携带调用瞬间的标签身份快照，校验身份一致才保存（与 D1/E02 共用「调用瞬间捕获身份快照」契约）；
  4. **不采用同步落盘（离场即存）**：未命名草稿无 path 无法落盘、会改变现有防抖语义、违背 D13 单实例缓冲架构——切标签只取消旧定时器并暂存，切回后按第 2 条主动重新调度；核心缺陷点是旧定时器取消前会「按 B 路径/脏态错误保存」，修复后必须消除。
  5. **QA 复现用例规格（纳入验收，前置刻意与 D1 相反）**：autosave 保持默认 >0（**不要设为 0**）——A(脏、有 path) 输入 `UNIQUE_A` 且 1s 未到 → 切到干净 B → 切回 A → 等待 `autosave_ms` → **断言 A 改动已落盘到 A 文件、B 文件未被错写**；另含两个纯断言：`clearTimeout` spy 证明切标签时旧定时器被取消（未发生「用 B 路径保存」）、`flushAllDirtyTabs` 纯函数在关窗时对所有有 path 的脏标签落盘。
  6. 回归：`m1ipc 15/15`、`m1editor 13/13` 无回归，`pnpm tauri dev` 与浏览器 mock 两后端均验证。
- **优先级**：P0（team-lead 最终拍板：数据丢失，与 D1 并列必修）。
- **归属提示**：QA 主导复现与回归用例、架构师出修复方案、工程师落地；修复代码契约见架构设计文档 §T02/§契约，QA 用例规格如上。

---

## 6. 执行顺序（已按 team-lead 最终拍板收口）

**实施唯一依据：`docs/system_design.md` 的 T01–T05 任务分解与依赖**（按文件归属/依赖聚合，避免多处任务抢同一文件）。本 PRD 的 A/B/C/D 分类仅表示需求来源与用户价值，不直接作为排期顺序。

- **T01 基础设施与共享原语层**：CSS 地基、ipc/fs 的 `sidebar_width` 前向兼容字段、共享 Modal/Toast 原语（C1/C3/C6/C7 的底层）。
- **T02 App 状态机与交互正确性（P0）**：**D1 标签切换丢编辑 + D3 autosave 跨标签竞态（并列 P0 必修，QA 主导复现）**，以及 E01–E09 等正确性修复、C1 弹窗统一、C2 标题栏、C4 侧栏宽度、C5 状态反馈、C8 空状态。
- **T03 编辑器内核与性能（P1）**：D2 全量重渲染（仅阶段一）、B2 decorations 增量、B3 跨节点查找（条件性，默认不做）。
- **T04 Rust 后端正确性与打包（P0/P1）**：C7 `reveal_themes_dir`、B1 两步打包验证、E05/E06/E11 后端修复与基准刷新。
- **T05 文档同步与交付验证（P1）**：**A1–A7 全部集中在此**（team-lead 最终拍板：不做折中拆分，改造期统一维护文档单一状态、代码冻结后回填实测数据），含 v1.6 变更记录、全量验收矩阵。

**A 类顺序拍板结论**：采纳架构师方案，**A1–A7 全放 T05，不做拆分**。理由：分散到 T01 会让工程师在改造期同时维护代码与文档两处状态，且 T01 已是最重的基础层，集中 T05 更快更一致——工程效率优先。

原则：**每批改完即跑 `tsc --noEmit` + `vite build` + 现有 spike（m1ipc 15/15、m1editor 13/13、roundtrip 不动点、cargo test 18/18）**，确保「不破坏已有功能」。

---

## 7. 待确认问题 — 全部已由 team-lead 拍板（2026-11-21）

| 编号 | 问题 | 最终结论 |
|---|---|---|
| Q1 | NSIS 离线降级口径 | **接受**「编译链已验证 + 如实标注离线不可打包」，不判 P0 缺陷 |
| Q2 | B3 跨节点查找 | **本轮不做**，保留代码位置；确需则在 T03 追加 |
| Q3 | undo 不跨标签（D13） | **维持已知取舍**，不改架构 |
| Q4/Q8 | 性能基准与 bundle 体积回填 | **本轮实跑** `bench_10k_files` 与 `vite build`，数据写入 T05 |
| Q5 | C 类范围 | **全量覆盖 C1–C8**，工期不足优先 C1/C2/C3，C7/C8 可降级 |
| Q6 | `sidebar_width` 持久化 | **采纳**，排入 T01（fs/ipc）+ T02（App/Settings） |
| Q7 | D1/D2/D3 归属 | **D1、D3（E01）并列 P0 必修、QA 主导复现**；D2 仅阶段一谓词过滤 |
| — | A 类顺序（分歧点） | **全放 T05，不做折中拆分**：工程效率优先，改造期单一文档状态，代码冻结后回填 |
| — | E01 归属 | **明确纳入本轮 T02**（P0 数据丢失，非已知未修），已补 D3 闭环 |

> 全部待确认项已收口，PM 侧无悬而未决问题。
