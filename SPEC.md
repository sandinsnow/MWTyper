# MWTyper 产品与技术规格（SPEC）

- 版本：v1.10（**「检查更新」改为真正查询远端**。用户诉求「检查更新的功能要检查的是远端是否有新的版本，参考 MWMD 项目的检查更新功能」。① **认知修正**：v1.9 的「检查更新」读本机清单文件，当时的理由「cargo 缓存里没有 HTTP 客户端、CSP 把 `connect-src` 限制在 `ipc:`」**只对 Rust 侧成立** —— 联网用 WebView2 自带的 `fetch` 即可，CSP 也可放开一个源；② 新增 `src/update.ts`，查 GitHub Releases 的最新正式版（`api.github.com`，CORS 友好），Rust 侧只保留「用 `ShellExecuteW` 调起系统浏览器打开下载页」；③ **SemVer 优先级修正**：旧版朴素切段会把 `0.1.0-beta.2` 判成比 `0.1.0` 新 → 本地跑预发布版时永远收不到正式版提示；④ 连带修复「按钮在异步期间被 `disabled` → 焦点丢失 → Escape 关不掉模态」这一既有缺陷（document 捕获阶段兜底 + 模态栈保分层语义）；⑤ 新增 `update-probe` 26 项、help-probe 改为路由拦截模拟远端；见 §12）
- 日期：2026-11-25
- 定位：Rust 技术栈的本地 Markdown 写作工具，参考 Typora 的「所见即所得」体验，以「本地快照历史 + Rust 全文搜索 + 命令面板」为差异化特色。
- 原则：本地离线优先、纯 .md 无专有格式、低资源占用、Windows 桌面先行（跨平台留待后期）。**唯一的联网行为**是用户主动触发的「检查远端更新」。

---

## 1. 产品定位

### 1.1 一句话
像 Typora 一样直接在渲染后的文档上写作，但拥有 Typora 没有的本地版本快照、跨文件全文搜索和键盘优先的命令面板；所有数据都是磁盘上的普通 Markdown 文件。

### 1.2 目标用户
- 在 Windows 上写技术文档 / 笔记 / 长文的个人用户；
- 不愿把文稿放进云端或专有格式，要求文件可直接被其他工具消费；
- 偏好键盘操作、低内存占用的桌面应用。

### 1.3 与 Typora 的关系
参考其核心交互（无缝编辑、源码模式切换、大纲侧栏、专注/打字机模式、主题），不做其付费激活体系，不追求功能全集（见 §4 对照表）。特色功能见 §5.6。

### 1.4 非目标（本期明确不做）
- 云同步、账号、协作、发布到博客平台；
- 微信公众号排版/复制（已有 MWMD 覆盖，不重复建设）；
- Mermaid 图表渲染（离线依赖不可得，见 §2.3，押后）；
- DOCX/PDF 原生导出引擎（PDF 走 WebView2 打印通道，DOCX 押后）；
- 移动端、macOS/Linux 打包（架构上不封死，见 §3.4）。

---

## 2. 环境约束与依赖盘点（2026-11-19 实测）

本机为**纯离线环境**：无网络、非 git 仓库；新增 cargo crate / npm 包只能命中本地缓存。以下清单已逐一核实，是本 spec 所有技术选型的硬边界。

### 2.1 工具链
| 项 | 状态 |
|---|---|
| Rust | 1.98（scoop 安装，无 rustup），host = x86_64-pc-windows-msvc |
| MSVC | VS2026 Build Tools（`C:\Program Files (x86)\...\18\BuildTools`），cargo 自动定位，cl/link 不在 PATH 属正常 |
| WebView2 Runtime | 已装（152.x），dev 无需 bootstrapper |
| Node / pnpm | Node v24（shell 默认 16，命令前置 nvm v24 PATH）；**pnpm 12.10.1（Rust 版）**，store v11；配置写 `pnpm-workspace.yaml`（package.json 的 pnpm 字段被忽略）：`allowBuilds: esbuild: true` + `minimumReleaseAge: 0`；平台可选依赖被静默跳过 → `spikes/materialize.py` 手工物化（重装后必重跑）。**M3 实测更新**：本机 corepack 解析 pnpm 已失效（`Cannot find module ...corepack\pnpm\12.14.0\bin\pnpm.cjs`），故全部构建/测试改用 **Node v24 直调本地 CLI**（`node_modules/typescript/bin/tsc`、`node_modules/vite/bin/vite.js`、`node_modules/tsx/dist/cli.mjs`、`node_modules/@tauri-apps/cli/tauri.js`），不依赖包管理器 |
| 图标 | 无 ImageMagick/PIL；唯一离线栅格化途径 = `pnpm tauri icon <方形透明SVG>`，生成后删除 ios/android 目录 |
| NSIS 工具链 | **M3 实测已就绪**：`%LOCALAPPDATA%/tauri/NSIS/`（含 `makensis.exe`）→ 离线环境下 NSIS 打包**可完成**（见 §12 v1.6）。**v1.7 起交付形态改为单文件**：`tauri.conf.json` 的 `bundle.active` 置 `false`，`tauri build` 跳过 bundle 阶段，**不产出安装包**；NSIS 配置保留在文件中备用（见 §12 v1.7） |
| 交付形态 | **单文件可执行程序** `release/MWTyper.exe`（8.68 MiB），**无安装包**。已实测：PE 导入表仅含 20 个 Windows 系统 DLL（**不含** `WebView2Loader.dll`，Tauri 2 在 Windows 上静态链接）；单独拷入空目录可独立启动，运行后目录内不落地附属文件。唯一外部前置是**系统级 WebView2 Runtime**（本机已装 152.x） |

### 2.2 cargo 缓存可用 crate（与本项目相关）
`tauri`/`tauri-build` 全家桶、`serde`/`serde_json`、`pulldown-cmark`(+escape)、`syntect`、`notify`、`rfd`、`walkdir`、`regex`、`chrono`、`uuid`、`dirs`、`toml`、`windows`/`winapi`、`webview2-com`、`tokio`、`anyhow`/`thiserror`。
→ Markdown 解析、导出 HTML 语法高亮、文件监听、原生对话框全部可离线落地。

### 2.3 pnpm store 可用前端包（1034 个，关键项）
- **WYSIWYG 编辑**：`@tiptap/core@3.22.1`、`@tiptap/starter-kit@3.22.1`、`@tiptap/markdown@3.22.1`、`@tiptap/pm@3.22.1`、`@tiptap/extension-code-block@3.22.1`、全套 `prosemirror-*`（含 `prosemirror-markdown`、`prosemirror-tables`）、`@tiptap/extension-mathematics@3.10.7`、`@tiptap/extension-image@3.10.7`、underline/link/task 相关扩展。
  - ⚠️ 无 `@tiptap/react`（只有 `@tiptap/vue-3@3.23.6`）→ 自写薄封装 `src/editor/useEditor.ts`（M0 已验证）。
  - ⚠️ 无 `@tiptap/extension-table` → 自定义节点接 marked GFM token（M0 spike ② 已验证往返保真，D8）。
  - tiptap 版本混存 3.22.1 / 3.23.6，**统一 pin 3.22.1 家族**（mathematics/image 为 3.10.7）；M0 安装无 peer 冲突。
- **源码模式**：`codemirror@6` + `@codemirror/lang-markdown` + `@codemirror/search` 等全套（MWMD 已验证可用）。
- **渲染/导出**：`katex@0.16.25`、`highlight.js@11.11.1`、`markdown-it@14`、`marked@16/17`、`dompurify@3.2.7`、`github-markdown-css@5.8.1`、unified/remark/rehype 全链。
- **框架**：`react@18.3.1` + `react-dom` + `@vitejs/plugin-react`、`vue@3.5.18`（备选）、`typescript`、`vite`。
- **不可得**：mermaid、`@tiptap/extension-code-block-lowlight`、`@tiptap/react`、任何未缓存包。
  - 代码块高亮替代：highlight.js + tiptap NodeView/装饰自接（常规做法，spike 验证）。
  - Mermaid：押后到联网环境（§8 路线图 M4+）。

### 2.4 验证约束
- 运行时 GUI 验证：browser-use 导航 localhost 曾被权限分类器拦截；UI 以 `tsc --noEmit` + `vite build` + 可交接的 dev 预览为准，无法自动截图时如实说明。
- **jsdom 无头实测**（M0 新增手段）：真实 Editor 实例 + 真实编辑事务可验证 DOM/装饰/NodeView 行为（spike ③ 16/16），不依赖浏览器。
- `pnpm install --offline` 必须全量命中 store；任何解析到未缓存版本即失败，锁文件版本以 §2.3 清单为准。

---

## 3. 技术架构

### 3.1 总体
```
┌────────────────────────── Tauri 2 窗口 ──────────────────────────┐
│  WebView2 前端（React 18 + TS + Vite）                            │
│  ┌────────────┐  ┌──────────────────────────┐  ┌──────────────┐  │
│  │ 侧栏        │  │ 编辑区                    │  │ 状态栏        │  │
│  │ 文件树/大纲  │  │ WYSIWYG(tiptap) ⇄ 源码(CM6)│  │ 字数/模式/保存 │  │
│  └────────────┘  └──────────────────────────┘  └──────────────┘  │
│            │ invoke / event                                      │
│  Rust 后端：文件 IO · pulldown-cmark 解析 · syntect 导出高亮        │
│            notify 文件监听 · 快照历史 · 跨文件搜索(walkdir+regex)   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 前端
- React 18 + TypeScript + Vite（与 MWMD 同栈，复用经验；Vue 为备选，见 D2）。
- 编辑双模式：
  - **所见即所得模式（默认）**：tiptap 3（vanilla core + 薄 React 封装），`@tiptap/markdown` 负责 md ⇄ 文档双向转换；
  - **源码模式**：CodeMirror 6 + lang-markdown，`Ctrl+/` 切换，两模式共享同一份文本状态，切换无损。
- 数学：KaTeX（`@tiptap/extension-mathematics`，行内 `$…$` / 块级 `$$…$$`）。
- 代码块：tiptap code-block 扩展 + **NodeView（结构与语言选择）+ highlight.js inline decorations 高亮**（D7；NodeView 内改 innerHTML 会被 PM 同步覆盖，不可行）。
- 表格：自定义节点接 marked GFM token（D8，store 无 extension-table）；M1 已接 `prosemirror-tables` 命令做可视化增删行列（光标入表时浮现工具栏；单元格须带 colspan/rowspan attrs，见 D8）。
- 样式：CSS 变量主题（亮/暗），不引 UI 组件库，控制体积。

### 3.3 Rust 后端（tauri command 清单，M1 范围）
| command | 职责 | 依赖 |
|---|---|---|
| `open_folder` / `list_tree` | 打开工作区、递归列文件树（忽略隐藏目录）；**返回前同步放行 asset scope**（A10） | walkdir |
| `read_file` / `save_file` | 读写 .md（UTF-8，保存原子写：临时文件+rename）；**读取前同步放行 asset scope**（A10） | std |
| `watch_folder` | 外部变更事件推送到前端（**300ms debounce**，A11） | notify |
| `export_html` | md → 单文件 HTML（内联 CSS + syntect 高亮 + KaTeX 服务端?否→前端渲染后导出，见 D5；**本地图片仅允许 base_dir 内**，E11） | pulldown-cmark, syntect |
| `snapshot_save` / `snapshot_list` / `snapshot_restore` / `snapshot_diff` | 本地快照历史（§5.6.1） | serde, chrono |
| `search_workspace` | 跨文件全文/正则搜索，返回 文件:行号:上下文（**并行化**，**带 truncated 标记**，E06） | walkdir, regex |
| `stats` | 字数/字符/阅读时长统计（中文按字、英文按词） | pulldown-cmark |
| `reveal_themes_dir` | 在系统文件管理器中打开主题目录（C7） | std（explorer/open/xdg-open） |
| 对话框 | 打开/保存/导出路径选择 | rfd（或 tauri-plugin-dialog，若缓存无则 rfd） |

### 3.4 跨平台预留
- 所有平台相关代码收敛在 Rust 侧（路径、对话框、快照目录）；前端无 Windows 专有 API。
- 剪贴板富文本（CF_HTML）本期不做；若后期做「复制为富文本」，按平台抽象（参考 MWMD 经验）。

### 3.5 目录结构（规划）
```
MWTyper/
├── SPEC.md                  # 本文档（活文档：变更记录+决策记录）
├── package.json / vite.config.ts / tsconfig.json / index.html
├── src/                     # React 前端
│   ├── editor/              # tiptap 封装、CM6 源码模式、扩展
│   ├── sidebar/             # 文件树、大纲、搜索面板
│   ├── statusbar/ commands/ # 状态栏、命令面板
│   └── theme/
├── src-tauri/               # Rust 后端
│   ├── src/{lib,fs,export,snapshot,search,stats}.rs
│   └── icons/               # 由 src/app-icon.svg 经 pnpm tauri icon 生成（单一源）
└── spikes/                  # M0 验证脚本与结论
```

---

## 4. Typora 功能对照表

| Typora 功能 | MWTyper 策略 | 期次 |
|---|---|---|
| 无缝所见即所得编辑 | ✅ 采纳（tiptap WYSIWYG） | M1 |
| 源码模式 ⇄ 预览切换 | ✅ 采纳（Ctrl+/，CM6） | M1 |
| Markdown 快捷输入（`# `、`- `、`> `、```` ``` ````、`**bold**` 等 input rules） | ✅ 采纳 | M1 |
| 大纲侧栏 | ✅ 采纳 | M1 |
| 文件树 / 打开文件夹 | ✅ 采纳 | M1 |
| 表格编辑（可视化增删行列） | ✅ 采纳（pm-tables） | M1 |
| 数学公式（MathJax） | ✅ 采纳（KaTeX 替代） | M1 |
| 代码块语法高亮 | ✅ 采纳（highlight.js） | M1 |
| 图片插入/拖拽/粘贴 | ✅ 采纳（本地相对路径，复制到 assets/） | M1 |
| 专注模式 / 打字机模式 | ✅ 采纳 | M2 |
| 主题（亮/暗 + 自定义 CSS） | ✅ 采纳（CSS 变量；自定义主题目录已落地，热加载 + 一键打开目录） | M1 亮暗 / M3 自定义 |
| 导出 HTML / PDF | ✅ 采纳（HTML 单文件；PDF 走打印通道） | M2 |
| 导出 DOCX / ePub 等 | ⏸ 押后（离线无依赖） | M4+ |
| Mermaid / 图表 | ⏸ 押后（离线无依赖） | M4+ |
| 查找替换（文件内） | ✅ 采纳（源码模式 CM search；WYSIWYG 内替换 M2 自接，**M3 已修复并加等价性闸门**；跨节点命中仍不支持） | M1/M2/M3 |
| 跨文件搜索 | 🔶 Typora 弱项 → **强化为特色**（Rust 全文搜索，**M3 已并行化**） | M2 |
| 版本历史 | 🔶 Typora 无 → **特色：本地快照** | M2 |
| 命令面板 | 🔶 Typora 无 → **特色** | M2 |
| 字数统计 | ✅ 采纳并强化（目标/进度） | M1 基础 / M2 目标 |
| 拼写检查 | ⏸ 不做（中文场景价值低） | — |
| 云同步/发布 | ❌ 非目标 | — |

---

## 5. 功能规格

### 5.1 编辑器（M1 核心）
- **WYSIWYG 模式**：光标所在处即编辑处，渲染态直接输入；支持标题 1–6、粗体/斜体/删除线/行内代码/下划线、有序/无序/任务列表（可点击勾选）、引用、分割线、链接（Ctrl+K）、图片、代码块（语言选择 + 高亮）、表格、行内/块级公式。
- **输入规则**：行首 `#`+空格 → 标题；`-`/`*`/`1.`+空格 → 列表；`>` → 引用；`---` → 分割线；```` ``` ````+回车 → 代码块；`$…$` 闭合即渲染公式；`[ ]`/`[x]` → 任务项。
- **源码模式**：CM6，Markdown 语法高亮、行号可开关、文件内搜索（@codemirror/search）。
- **模式切换**：`Ctrl+/`；以文本为唯一事实源，切换时经 `@tiptap/markdown` 序列化/解析，**往返不丢内容**（GFM 表格、任务列表、公式、frontmatter 为 spike 必测项；若往返有损，降级策略=切换时保留原文本缓冲，仅重建视图）。源码未改动时切回不重建文档（保留光标与 undo）。往返验收判据 = **serialize 不动点**（serialize→parse→serialize 文本相等）：editor.getJSON() 含 schema 默认 attrs（如 link.target="_blank"），与 mm.parse 的稀疏输出做 JSON 深比不对称，不可用作判据。
- **模式切换的光标保持（v1.8，D16-3）**：两种模式的切换各有一次「光标丢失」，都必须显式补回：① `setContent` 会把选区丢到文档末尾；② 源码模式下富文本容器是 `display:none`，浏览器的选区随之消失（ProseMirror 内部状态还在，但用户看不到光标）。恢复规则：文档长度未变（源码没改内容）按**绝对位置**还原，变了按**比例**估算（精确反解需要把文本偏移映射回 PM 位置，代价与复杂度不划算）。两种模式**各自保存**自己的光标（源码文本没变时沿用用户上次摆在源码里的位置，不被富文本光标覆盖）。
- **Markdown 往返的语义保真（v1.8，D16-4）**：
  - **原始 HTML 块**（HTML 注释 / `<script>` / 带属性的 `<div>`）必须**逐字节原样保留**。tiptap markdown 的 `parseHTMLToken` 把 HTML token 交给 `generateJSON(html, baseExtensions)`，schema 里没有对应节点时会被**静默丢弃** → 需注册承载原文的节点（`attrs.html`）并接管 marked 的 `html` token；渲染时原文以**文本**形式呈现（ProseMirror 自动转义），绝不注入真实标签（防 XSS）。
  - **脚注定义**（`[^1]: 正文`）不是 CommonMark 语法，marked 会把它当「链接引用定义」吃掉，正文里的 `[^1]` 随即被解析成指向该定义的字面链接（往返后变成 `[^1](脚注内容)`）→ 需在送进 marked 前把脚注定义块摘出来换成占位，解析后换回。
  - **以块级标记开头的普通段落**（`- 不是列表` / `# 不是标题`）序列化后必须按 CommonMark **转义行首**，否则再解析就变成 bulletList / heading（结构漂移）。只影响**确实会被误解析**的行首；行内的 `3-5 个`、`C# 笔记` 一律不动。
  - **表格表头**按 schema 里 `tableHeader` 的实际位置生成，不能凭位置猜测。
- **随航编辑（v1.9，D17）**：第三种模式 `split` —— 左侧写原始 Markdown（CodeMirror），右侧实时渲染预览（**复用富文本实例做只读渲染**），两侧滚动联动。
  - **事实源归属**：`split` 模式下 **CodeMirror 是事实源**，富文本实例退化为只读预览（`setEditable(false)`）。`currentText()` 在 `split` 下返回 `sourceTextRef.current`；从 `split` 切到 `source` **不得**用预览内容覆盖用户正在编辑的源码。
  - **预览同步**：源码侧改动经 **160ms 防抖**后同步进富文本实例；同步事务必须带 `addToHistory: false`（否则用户按 Ctrl+Z 撤掉的是「预览同步」而不是自己的编辑）与 `preventUpdate: true`（否则文档被误标为已修改）；同步后须**恢复预览滚动位置**（`setContent` 会把视口重置到文档开头）。
  - **滚动联动**：按**滚动比例**映射，两侧各滚动一个就驱动另一个；必须带**单向锁 + 120ms 冷却**——否则两侧互相驱动会形成正反馈，表现为持续抖动甚至无限循环。
  - **布局**：用 CSS Grid（不是 flex）——grid 能让顶部工具条横跨两栏，flex 会把它变成并列的 flex item。**硬约束**：`.editor-wrap`（富文本容器的 DOM 节点）在 DOM 树里的位置三态必须完全一致 —— tiptap 实例只在挂载时创建一次并持有该节点，若 React 因分支切换重建它，编辑器会变成孤儿（状态还在、DOM 脱钩，表现为编辑器失去响应）。
  - **分栏比例**持久化在设置里（`split_ratio`，20–80，默认 50）；可在分隔条上拖拽或用方向键调整。
  - **入口**：标题栏「随航」按钮 + `Ctrl+Shift+/`（不同布局下 `e.key` 可能是 `/`（带 shiftKey）或 `?`，两种都要判）；「⇄ 源码/所见即所得」按钮在随航时归到「所见即所得」一侧。
- **粘贴**：纯文本按 Markdown 解析；HTML 粘贴经 dompurify 清洗后转 md（M2）；图片粘贴/拖拽 → 复制到工作区 `assets/` 并插入相对路径（M1）。
- **自动保存**：停止输入 1s 或失焦即存盘（原子写）；标题栏/状态栏显示未保存点；外部变更（notify）冲突时提示「重新加载 / 保留我的」，不静默覆盖。
- **撤销/重做**：编辑器内建历史；跨模式切换不丢 undo 栈（M1 尽力，若 tiptap/CM 历史无法合并则各模式独立栈并如实标注）。
- **多标签切换与关窗落盘（M3 落地，D1/D3/E01）**：切换标签时**在调用瞬间捕获** `activeId`/`dirty`/`currentText()` 的快照再写入 tab state（不在 state 更新器内读可变 ref）；切换入口 `clearTimeout` 掉旧 autosave 定时器并按新标签身份重新调度；关窗前 flush **所有有 path 的脏标签**（未命名草稿无 path 不 flush）。数据逻辑抽为可导出纯函数 `flushAllDirty(tabs, currentText, activeId, save)`，便于纯函数级回归。

### 5.2 文件与工作区（M1）
- 打开单文件或文件夹；侧栏文件树（.md/.markdown/.txt，目录折叠，右键新建/重命名/删除）。删除：trash crate 未缓存 → 移入工作区 `.mwtyper/trash/<时间戳>-<名>`（可恢复，D10；非系统回收站，属离线偏差）。
- 最近文件列表（持久化，上限 20）。
- 多标签页（M2；M1 单文档 + 快速切换）。
- 未命名草稿：启动即有可写的空文档，首次保存时命名。
- **文件树默认展开（v1.7，D15-6）**：打开工作区后文件树**默认展开全部目录**——ARIA tree 要求子节点嵌套在父 `treeitem` 内部才能表达层级关系，读屏才能获知「谁在谁里面」。为避免含上万条目的目录一次性渲染出海量 DOM 行拖慢侧栏，**单个目录的子树节点数超过 200 时不自动展开**，保持折叠并在行上标注条目数（`.tree-count` 徽标 + `title` 提示「N 项，默认折叠，点击展开」），用户仍可手动展开。阈值常量 `TREE_AUTO_EXPAND_MAX_NODES = 200` **唯一定义在 `src/sidebar/FileTree.tsx`**，App 侧只引用不复制（单一事实源）。
  - 展开状态由 **App 持有**（`FileTree` 受控组件，`expanded: Set<string>` + `onToggleDir`）：`FileTree` 位于条件渲染内（侧栏页签切换 / `Ctrl+\` 收起侧栏都会让它卸载重挂载），状态留在组件内会导致重挂载时用户手动折叠的目录被重新展开。
  - **刷新不覆盖用户意图**：只有「本次首次见到」的目录才走默认展开逻辑；已见过的目录（`knownTreeDirsRef`）保持用户当前的展开/折叠状态。
- **另存为语义修正（v1.7，D15-2）**：标题栏「另存为」**始终新建一个标签页**指向新路径，原标签保持原路径不动；**不再做「原标签就地改写路径」**。理由：就地改写在用户已有同名/同路径标签时会产生路径歧义，且与关窗落盘队列（`flushAllDirty`）存在竞态；新建标签保持「一标签一路径」的既有约定。原「另存为后就地改写路径」语义作废。

### 5.3 大纲（M1）
- 侧栏第二标签：H1–H6 树，随输入实时刷新（前端从文档状态提取，不走 Rust）；点击跳转；当前节高亮。

### 5.4 导出（M2）
- **HTML 单文件**：Rust pulldown-cmark 解析 + syntect 代码高亮 + 内联 CSS（亮/暗随当前主题）；公式由前端 KaTeX 渲染结果注入（D5）。图片可选内嵌 base64。
- **PDF**：调用 WebView2 打印到 PDF（系统通道，无新依赖）；分页样式随导出 CSS。
- 导出文件名默认同文档名，rfd 选择路径。

### 5.5 查找（M1 文件内 / M2 跨文件）
- 文件内：源码模式用 CM search；WYSIWYG 模式 M1 先提供「跳到源码模式搜索」，M2 自接 ProseMirror 搜索装饰。
- **查找替换的语义保真（v1.8，D16-1）**：替换**不得破坏区间上的 mark**——按 mark 边界把匹配区间切段、逐段以原有 marks 构造新文本节点，从后往前替换。实测 `[链接文字](url)` 替换后必须仍是 `[新文字](url)`（URL 不得丢失）、`**粗体词**` 替换后必须仍是 `**替换后**`。替换文本中的换行必须折叠为空格（`schema.text("a\nb")` 不抛异常但会造出段落内含换行的文本节点，序列化时一个段落被拆成两个）。
- **全词匹配的中文语义（v1.8，D16-2）**：JS 的 `\b` 基于 ASCII `\w`，汉字属非 `\w` → `\b中文\b` 在中文文本上永不匹配（与 VS Code 全词搜索对中文失效同源）。改用 lookaround `(?<![\w\p{N}])…(?![\w\p{N}])`，**前后必须用不同断言**（把后边界断言拼在词前会检查 query 首字符 → 必然失败）；`\p{...}` 字符类必须加 `u` flag。汉字不计入词字符，故中英文语义一致。
- **查找导航必须选中整个匹配**（v1.8）：只放折叠光标在起点会让用户接着输入时插到匹配**前面**，与「选中→直接输入即替换」的直觉不符。
- **查找状态必须跟随文档整体替换（v1.8）**：`setContent` 用 `tr.replaceWith(0, doc.content.size, …)` 整体换文档，增量映射算出的匹配全部失效 → 切换文件后查找高亮会沿用上一个文件的匹配。单个覆盖全文档的 `ReplaceStep` 必须触发**全文重算**。
- 跨文件（特色）：侧栏搜索面板 → Rust `search_workspace`（walkdir+regex，大小写/全词/正则开关），结果按文件分组显示 行号+上下文，点击直达；万文件级工作区目标 < 1s（M2 spike 实测报数）。

### 5.6 特色功能（差异点，M2）
#### 5.6.1 本地快照历史（Typora 无）
- 打开文件时、每次手动保存或每 5 分钟自动快照（内容哈希去重，相同不存）；
- 存储：工作区 `.mwtyper/snapshots/<文件相对路径哈希>/`（纯文本 md + 元数据 json，可随文件夹迁移；默认忽略树/搜索）；
- 保留策略：最近 50 个 + 每日最后一个保留 30 天，可配置；
- UI：历史面板（时间轴列表）→ 预览 / 与当前 diff（行级，前端简单 LCS diff）/ 一键恢复（恢复前自动再快照）。
#### 5.6.2 命令面板（Typora 无）
- `Ctrl+Shift+P`：模糊搜索全部命令（模式切换、导出、快照、主题、专注模式、打开最近文件…），键盘上下选择回车执行；命令注册表集中定义，快捷键提示随行显示。
#### 5.6.3 专注 / 打字机模式（对齐 Typora）
- 专注：非当前段落降透明度；打字机：光标行恒定居中；均可独立开关，状态持久化。
#### 5.6.4 写作统计与目标
- 状态栏：字数（中文按字/英文按词）、字符数、预计阅读时长；
- 可选本次写作目标（如 1000 字）+ 进度条；会话统计（本次新增字数、用时）。

### 5.6b 帮助中心（v1.9 新增）

- **入口**：标题栏「帮助」按钮 + `F1` 快捷键 + 命令面板四条命令（帮助中心 / Markdown 速查 / 快捷键一览 / 检查更新）。
- **四个分区**：
  1. **Markdown 速查**：按「基础 / 块与列表 / 链接与图片 / 表格 / 公式 / 进阶」分组，共 26 条语法；每条含语法写法、说明、**「插入」按钮**（把模板写到当前光标处，帮助中心保持打开可连续插入）。面板中如实标注本项目的真实限制（如源码模式基于 CommonMark、不认 GFM 删除线）。
  2. **快捷键**：30 条，按「文件 / 编辑 / 视图 / 查找与命令 / 其他」分组。数据源 `src/help/shortcuts.ts` 为**单一事实源**（命令面板与本分区共用，避免两处漂移）。
  3. **检查更新**：当前版本、构建时间、**远端最新版**、上次检查时间；「检查远端更新」与「打开发布页」按钮。
  4. **关于**：版本、构建时间、定位、技术栈、自定义主题写法说明。
- **更新源机制（v1.10 改为**真正查远端**）**：此前 v1.9 的「检查更新」读的是**本机清单文件** `%APPDATA%/MWTyper/update-manifest.json` —— 当时的判断是「构建环境无网络、cargo 缓存里没有 HTTP 客户端、WebView 的 CSP 把 `connect-src` 限制在 `ipc:`，真正的联网检查做不到」。**这个判断只对 Rust 侧成立，对整体是错的**：
  - 联网**不需要 Rust 侧 HTTP 客户端** —— WebView2 自带 `fetch`，在页面里发请求即可；
  - CSP 的 `connect-src` **可以按需放开**（只加 `https://api.github.com` 一个源）；
  - Rust 侧只保留「调起系统浏览器打开下载页」这一件小事（`open_external`）。
  现在的实现（`src/update.ts`）：
  - **查询远端**：读 GitHub Releases 的**最新正式版** `GET https://api.github.com/repos/sandinsnow/MWTyper/releases/latest`。
    走 REST API 而非资产直链 —— 资产直链会 302 跳 CDN，浏览器 fetch 常因缺 CORS 头失败；`api.github.com` 返回 `Access-Control-Allow-Origin: *`。
    CI 另外发布的 `latest.json` 供将来的 Rust 端自替换更新器使用（无 CORS 限制）。
  - **版本比对**：按 **SemVer 2.0** 优先级规则（核心三段按数值比 → 预发布版低于正式版 → 预发布标识逐段比 → `+build` 元数据不参与比较）。
    ⚠️ 不能用「按 `.`/`-`/`+` 切段后逐段取数字」的朴素写法：那会把 `0.1.0-beta.2` 解析成 `[0,1,0,0,2]`、`0.1.0` 解析成 `[0,1,0]`，补齐后得出「预发布版比正式版**新**」的反向结论 → 本地跑预发布版时永远收不到正式版的更新提示。
  - **失败处理**：10 秒超时（`AbortController`）+ 明确的失败原因（超时 / HTTP 错误 / 无法访问 GitHub）；失败时给出**本机清单**作为离线兜底信息。
  - **不谎报**：未检查过时既不显示「已是最新」也不显示「发现新版本」；检查失败时显示失败原因。
  - **唯一的联网行为**是用户主动点「检查远端更新」；不自动轮询、不上报任何数据（与 MWMD 的处理一致）。
- **Rust 侧命令**：`app_info`（版本/构建时间）、`read_update_manifest`（读本机清单，保留为离线兜底）、`update_manifest_path`（清单路径）、**`open_external`**（在系统默认浏览器打开链接）。构建时间由 `build.rs` 注入 `MWTYPER_BUILD_TIME`（Unix 秒，前端格式化）。
  - `open_external` 用 `ShellExecuteW` 把 URL 直接交给系统协议处理器（**不经 cmd/shell**），因此 URL 里的 `& ? = % #` 不会被解释成命令；只放行 `http/https/mailto`，拒绝控制字符与裸引号（单测覆盖）。

### 5.7 主题（M1 亮/暗；M3 自定义主题已落地）
- CSS 变量单一源；跟随系统 + 手动切换；编辑区与导出 HTML 共用排版变量。
- **自定义主题目录（已落地，M3 实现，热加载）**：用户把 `.css` 放入 `%APPDATA%/MWTyper/themes/` 即覆盖 CSS 变量（`--bg-editor` / `--fg` / `--accent` 等）；设置面板下拉选择 + 「打开主题目录」按钮（C7，Rust 命令 `reveal_themes_dir`）；文件监听热加载，切换后即时生效。
- **基色派生 + 深浅自动配比（v1.9 修订）**：应用有 **58 个颜色令牌**，而自定义主题是**裸 CSS 注入** —— 主题只声明 4 个变量时，其余 54 个仍是内置默认，视觉上就是「只改了编辑器，别的还是老样子」；且 `:root` 无条件覆盖，深色模式下也被浅色值盖掉，深浅两套配比全乱。
  现在主题文件支持**基色写法**（推荐）：
  ```css
  :root {
    --mw-base-bg: #fbf1d8;        /* 主底色（浅色模式） */
    --mw-base-fg: #4a4235;        /* 主文字色（不给则由底色派生） */
    --mw-base-accent: #b58900;    /* 强调色 */
  }
  /* 可选：显式给暗色基色；不给则由系统自动派生（压暗底色、提亮强调色） */
  [data-theme="dark"] { --mw-base-bg: #241f18; --mw-base-fg: #e8dfd0; --mw-base-accent: #e0b155; }
  ```
  系统据此推导出**全部**令牌（标题栏 / 侧栏 / 状态栏 / 编辑区 / 代码块 / 查找高亮 / 标记符配色…），深浅两套**自动配比**：同色相、按模式排明度，并对**对比度兜底**（正文 ≥ 4.5:1、次要文字 ≥ 4.5:1、强调色 ≥ 4.5:1，不达标自动调明度）。
  - 旧的「逐个令牌覆盖」写法**完全兼容**：文件里出现 `--mw-base-*` 走派生，否则原样注入；派生模式下用户显式写出的令牌**仍覆盖**派生值。
  - 注入的两条规则用 `:root:not([data-theme="dark"])` 与 `[data-theme="dark"]` —— 前者特异度更高但不匹配暗色模式，因此**不依赖样式表先后顺序**，深浅两套不会互相盖错（这是裸 `:root` 注入最常见的错位来源）。
  - **整个应用框架都跟随主题**（含标题栏）：标题栏不再固定为近黑色 —— 之前只把它的**色相**染了一下，框架本身还是黑的，用户反馈「切换后要改变整个框架的风格」。现在标题栏、标题栏按钮、标签栏、侧栏、状态栏、编辑区全部由基色的色相+明度体系推导：浅色模式标题栏比正文底色略深（有层次但不黑）、文字用派生的正文色；深色模式同理压暗一档。
  - **对比度兜底要对多个背景同时成立**：强调色同时出现在编辑区底色与应用底色上，只校验其一会漏 —— 实测暖阳浅色的强调色在编辑区上是 4.52:1（达标），换到应用底色上却掉到 4.48:1（不达标）。现在取两个背景里**更严的那个**来校正。
- **内置示例主题（5 套，每套含深浅两套）**：暖阳 `warm-sample` / 青瓷 `celadon` / 暮紫 `dusk` / 石墨 `graphite` / 海盐 `sea-salt`。主题文件在 `examples/themes/`，**编译进 exe**（`include_str!`），设置面板点「安装内置主题」即可写入用户主题目录（**已存在的同名文件不覆盖**，用户改过的不丢）。
  - 每套主题都**显式给出** `:root`（浅色）与 `[data-theme="dark"]`（深色）两组基色，而不是靠自动派生 —— 显式更可控，自动派生只作兜底。
  - Rust 单测守着：每套主题必须同时含 `:root` 与 `[data-theme="dark"]` 块、且三个基色令牌齐全；主题名必须满足 `valid_name`。
  - 实现：`src/theme/palette.ts`（颜色运算与派生）、`src/theme/apply.ts`（解析与应用）。
- **asset 协议 scope（M3 收窄）**：Tauri asset 协议只用于工作区/文件所在目录的本地图片；静态 scope 收窄为空，实际放行由 Rust 侧在 `list_tree`/`read_file` **返回内容之前**完成（消除首帧图片 403 竞态），放行范围精确等于「当前工作区根」或「当前文件所在目录」。

---

### 5.8 标题栏与菜单（v1.9 重组）

- **问题**：重组前标题栏右侧挤了 **12 个控件**（新建 / 打开 / 文件夹 / 保存 / 最近 / 主题 / 帮助 / 设置 / 源码 / 随航 + 3 个窗口键），**视觉权重完全相同、看不出层级**；且「⇄ 源码」与「⧉ 随航」两个按钮表达不清三态关系（用户看不出当前在哪一态、也不知道点哪个能到哪一态）。
- **重组后的结构**：
  ```
  [☰] 文件名 ●          [＋新建] [▣保存] [所见即所得|源码|随航]  [◷最近] [?帮助] [⋯更多] [⚙设置]   [─ □ ×]
  ```
  - **保存** 是唯一**实心主按钮**（primary）；**新建 / 最近 / 帮助 / 更多 / 设置** 是 **ghost**（透明底无边框，hover 才显形）→ 默认态标题栏很安静。
  - **编辑模式用三分段控件**（所见即所得 / 源码 / 随航），当前态高亮，**一眼可见、可直接点选**。语义用 `role="radiogroup"`（单选组，三者是同一编辑器的三种状态、不是三个面板），方向键可切换。
  - **低频操作收进「⋯ 更多」下拉菜单**，按**语义类别**分组（文件 / 视图 / 帮助），不是按控件类型 —— 用户找「另存为」时想的是「这是文件操作」。
  - 「打开文件夹」移到**侧栏「文件」页工具栏**（工作区操作，语义上不属于标题栏），且**未打开工作区时也在**（那正是最需要入口的时候）。
- **菜单可用性**：`role="menu"` + `role="menuitem"`；↑↓ 移动、Enter 执行、Esc 关闭并**归还焦点**、点击外部关闭。**不用全屏遮罩** —— 遮罩会吞掉对标题栏其它按钮的点击（浮层开着时点「⋯」只会关掉浮层、菜单不开）。
- **窗口按钮用 SVG 而非字符字形（v1.9）**：最小化/最大化/关闭原本是字符 `─` `□` `×`。字符字形**依赖字体**，在 `line-height: 1` 的按钮里垂直位置飘忽，`□` 在多数字体里还特别小 —— 三者大小与基线全对不齐（用户反馈「这三个图标的样式有错位」）。现改为内联 SVG（统一 `viewBox="0 0 12 12"`、`stroke-width: 1.3`、`stroke-linecap: round`），按钮固定 30×26 并用 flex 严格居中 → 三个图标尺寸一致、中心在同一水平线。
- **窄窗**：只隐去按钮文字、保留图标与功能（`.tb-label`）；极窄（<820px）时分段控件只显示当前态。**任何宽度下按钮都不消失**。

### 5.9b 专注模式 / 打字机模式（v1.9 修复「无效」）

用户反馈「专注模式和打字机模式无效」。实测定位到三处具体问题：

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | **从设置面板勾选专注模式 → 当前段落没有高亮**（段落变淡了，但「正在写的那段」不突出，看起来像没生效） | 「当前段落高亮」由 PM 插件在**事务**里重算，而设置面板改的是 `settings`，**不产生事务** → 插件永远不重算。F8 快捷键路径有显式 dispatch，所以只有面板路径失效 | 监听 `settings.focus_mode` 变化，补一次 meta 事务让插件重算 |
| 2 | **从设置面板勾选打字机模式 → 不滚动** | 打字机模式靠 `lastTwPos` 去重（光标位置没变就不重复滚动）；面板路径没有像 `toggleTypewriter` 那样重置它 → 开启时恰好被去重逻辑挡掉 | effect 内记录「刚开启」的沿（`twWasOnRef`），刚开启时强制滚动一次 |
| 3 | **开启后状态栏没有任何指示** | 状态栏只显示编辑模式，不显示专注/打字机 → 用户开了却「看不见开了」，进一步印证「无效」 | 状态栏新增「专注」「打字机」标记（`.mode-flag`） |

另修一处**连带缺陷**：第 1 项补的事务若不带 `preventUpdate`，会**唤醒 PM 的 `appendTransaction` 链**（trailing-node 等规范化插件会 append 一个 docChanged 事务）→ tiptap 随即 `emit('update')` → `markChanged` → **新建的空白草稿被误标为「未保存」**（被 `spikes/qa4-probe.ts` 的 P3-9/P3-12 抓到）。
修法：事务带 `preventUpdate`（tiptap 自己的 `setContent` 也是这么做的：`setMeta('preventUpdate', !emitUpdate)`）—— 这个事务只是让插件重算装饰，**不是内容变更**。

同时把专注模式的「当前段落」做得更醒目：除了恢复不透明，还加一条**左侧强调线**（`box-shadow: inset 2px 0 0 0`）—— 只靠 opacity 0.65 ↔ 1 的差别太细微，用户会以为没生效；用 box-shadow 而不是 padding，避免文字横向跳动。

### 5.9 选区安全（v1.9 修复，P0 级数据丢失）

`setContent` / `replaceWith(0, size, …)` 是**整篇替换**，ProseMirror 会把选区映射成**整个新文档**。若此时编辑器仍持有焦点（用户正在写文档时外部文件变更触发重载、快照恢复、或从随航模式切回），**用户下一个按键就会把整篇替换成那个字符** —— 实测切回标签后敲一个 "X"，文档从「标题正文内容。」变成「X」，内容直接没了。

**修复**：所有整篇替换之后必须调用 `collapseSelection(ed)`（`src/editor/caret.ts`）把选区收成**折叠的光标**。落点：① `loadBuffer`（装载缓冲 / 切标签）；② `syncPreview`（随航预览同步）；③ `toWysiwyg` 从随航切回。

### 5.10 源码编辑器的样式统一（v1.9）

「源码编辑器样式不好看」实测定位到四处具体问题，均已修复：

| 问题 | 根因 | 修复 |
|---|---|---|
| 源码区套着一圈**虚线大框** | **CM6 的 baseTheme 有意**给聚焦的编辑器画 `outline: 1px dotted #212121`（其源码注释：*"to make sure a focused editor is visually distinct"*）。它画在**编辑区外框**上而非内容上，像一张贴在纸上的表格边框 | 去掉（`outline: none`）；焦点由**当前行高亮 + 光标**表达（文本控件用光标表达焦点是 WCAG 允许的做法）；键盘聚焦时给一条极淡的强调色左边线 |
| 行距与预览里的代码**不一致** | CM 默认 `line-height: 1.4`（14px → 19.6px），预览代码块是 1.65 | 统一到 `--mw-code-line`（1.65） |
| 等宽字体栈**三处不同** | CM `Consolas, "Courier New"`／代码块 `Consolas, monospace`／行内代码 `Consolas, monospace`，`pre` 甚至是通用 `monospace` | 统一为 `--mw-mono`（`Consolas, "Cascadia Mono", "Courier New", monospace`），字号统一 `--mw-code-size`（14px）。**源码编辑器 / 预览代码块 / 行内代码三处共用同一组令牌** |
| 源码里的**结构是纯文本**，预览里有底色边框，两边不像同一个产品 | `@codemirror/lang-markdown` 不给结构节点发 class | 新增 `src/editor/cm-structure.ts`：按语法树节点类型（`FencedCode` / `Blockquote` / `Table` / `TableHeader` / `TableDelimiter`）逐行注入 line decoration，源码侧也画出围栏代码块底色+竖线、引用左侧竖线、表格行底色与表头底色。**用 `Decoration.line()` 而非 `Decoration.replace({block:true,widget})`** —— 后者会把块内容替换成静态文本 widget，源码就不能编辑了 |

**另一处关键修正**：源码模式原本用 `markdown()`（默认 **CommonMark**，**不解析表格**），导致表格在语法树里根本不是 `Table` 节点，结构装饰无从下手。改用 `markdown({ base: markdownLanguage })`（GFM 解析器）—— 表格、删除线、任务列表、自动链接**一并被正确识别**。

## 6. UI 布局

```
┌──────┬──────────────────────────────────────────────┐
│ 侧栏  │  标签/标题栏（文件名 · 未保存点 · 模式指示）      │
│ [文件]│──────────────────────────────────────────────│
│ [大纲]│                                              │
│ [搜索]│            编辑区（居中定宽，默认 860px）        │
│ [历史]│                                              │
│      │                                              │
├──────┴──────────────────────────────────────────────┤
│ 状态栏：字数 · 阅读时长 · 目标进度 · WYSIWYG/源码 · 保存态 │
└─────────────────────────────────────────────────────┘
```
- 侧栏可折叠（`Ctrl+B`）；四个标签：文件树 / 大纲 / 搜索 / 快照历史。
- 命令面板为居中浮层；历史 diff 为居中浮层（M2 已落地：diff/预览双页签 + 恢复按钮）。
- 视觉基调：浅色默认、无衬线正文 + 等宽代码，低饱和强调色；具体色值实现阶段按用户点单落地。
- **查找条与表格工具栏的定位（v1.8）**：两者都是编辑区滚动容器（`.editor-area`，`overflow:auto`）的子元素，必须**统一放进同一个 sticky 容器**（`.editor-sticky-bar`，`position: sticky; top: 0`）——① 容器内插入流首元素会重置 `scrollTop`（打开查找条会把视图拉回文档顶部）；② 各自 `position: sticky` 的兄弟元素会互相重叠。
- **源码模式与富文本模式的正文宽度必须一致（v1.8）**：两者都是 `max-width: calc(860px * var(--editor-zoom, 1))` 居中。原先源码模式铺满整个编辑区（实测 1165px vs 860px），切换模式时行宽突变、长行极难阅读。
- **编辑区缩放必须联动行宽（v1.8）**：`--editor-zoom` 同时作用于 `font-size` 与 `max-width`，保证「每行字符数」恒定（与 §7 的「缩放联动行宽恒定」一致）。
- **对比度门槛（v1.8）**：专注模式的非当前段落降透明度后仍须满足 WCAG AA 正文 **4.5:1**（opacity .65 → 4.98:1 亮 / 6.08:1 暗）。**半透明前景色必须逐通道与背景混合后重算**，不能把整个 hex 当单通道送进亮度函数。查找高亮在暗色主题下改为「亮底 + 深字」（`#ffd54f` + `#1f2328` = 9.46:1；原先的半透明黄只有 3.28:1）。
- **源码模式的语法高亮（v1.9，D18）**：亮色主题此前传入**空扩展数组**（`themeComp.of(dark ? cmDark : [])`）→ 亮色下压根没有专属高亮，落到 CodeMirror `basicSetup` 的默认 fallback，与暗色那套硬编码 GitHub Dark **完全不一致**。现改为**成对主题**（`src/editor/cm-theme.ts` 的 `cmLight` / `cmDark`），共用同一批 Markdown token 规则，各自适配底色。
- **Markdown 标记符的专属配色（v1.9，D19）**：lezer-markdown 把 `HeaderMark` / `QuoteMark` / `ListMark` / `LinkMark` / `EmphasisMark` / `CodeMark` **六种标记符全部映射到同一个 tag**（`tags.processingInstruction`），因此 `HighlightStyle` 无论怎么写它们都拿到同一个 class（实测 6 种全是 `ͼo`）——**无法分别着色**；`Tag.define({HeaderMark:true})` 也不行（节点名落在 `set` 里，`highlightTags()` 取不到）。可行路径是**走语法树按节点名找区间 + `Decoration.mark` 加稳定 class**（`.mw-HeaderMark` 等），与本项目 `code-block.ts` 已有的 Decoration 范式一致。
  - **已知限制**：`@codemirror/lang-markdown@6.5.2` 的 `markdown()` **没有 `extensions` 参数、也不导出 `GFM`** → CommonMark 不认 GFM 删除线，`~~删除线~~` 在源码模式不会被解析成 strikethrough tag，**源码侧删除线无从着色**（删除线的高亮只在所见即所得侧成立）。
- **代码块主题跟随（v1.9，D20）**：代码块此前在**两套主题下都是硬编码深底** `atom-one-dark`（`#282c34`），亮色页面里嵌一块深色与调性冲突。现把 highlight.js 的语义 class（`.hljs-keyword` / `.hljs-string` / …）映射到项目令牌，**两套主题各自协调且不引入任何新依赖**（hljs 主题 CSS 是全局 class 样式，亮暗两套不能同时引而不加作用域限定）。
- **源码模式的行宽与行号贴合（v1.9）**：源码模式的正文宽度此前与富文本**不一致**（1165px vs 860px）且行号贴在区域最左、内容居中 → 中间空出约 120px 的断裂空白。现改为**编辑器整体居中**（`.cm-editor` 限宽 = 860px + 行号槽 `--mw-gutter-w`），行号紧贴代码；两侧正文行宽均为 **780px**（860 盒宽 − 80 内边距），切换模式文字不重排。
- **查找高亮与选区（v1.9）**：普通命中用「淡琥珀」`#fff3b0`、当前命中用「浓琥珀」`#ffb020` + 深棕描边 `#b45309`（描边是第二重视觉线索——同色系靠颜色区分不够）；暗色主题下普通命中 `#ffd54f`、当前命中改为**橙**`#f59e0b`（与普通命中拉开色相）；命中文字一律深色 `#1f2328`。选区亮色 `#cfe2ff`、暗色 `#2f5480`。
- **可访问性基线（v1.8）**：查找条 `role="search"` + `aria-label`，匹配计数 `role="status" aria-live="polite"`；表格工具栏 `role="toolbar"` + `aria-label`，每个按钮有 `aria-label`；编辑区（contenteditable）`role="textbox" aria-multiline="true" aria-label`。
- **编辑区的光标与焦点指示（v1.9 修订，2026-11-25 定稿）**：
  - **光标**：`caret-color: var(--accent)` —— 默认的深灰/系统蓝看着像「没配过」。亮色 `#0a754d` on `#ffffff` = 5.73:1、暗色 `#34d399` on `#22252b` = 7.99:1，均达 AA。源码模式（CodeMirror）同步。
  - **焦点指示**：写在**正文左缘**的 2px 渐隐强调线（伪元素 `left: 40px` = 正文左内边距，上浓下淡），且**只在键盘导航进入时显示**。
    三次修订的原因：① 整框 `inset 0 0 0 2px` 把整个写作面框成「一个输入框」；② 改成的 `inset 3px 0 0 0` 落在编辑区盒子的左缘，而正文有 40px 左内边距 —— 那条线孤零零挂在正文左侧 40px 的空白里，与内容脱节（实测线在 x=332、正文在 x=372）；③ **不能用 `:focus-visible` 判断「是否键盘进入」** —— Chrome 对 contenteditable 的 `:focus-visible` 启发式是**总是匹配**（实测鼠标点击进入时 `matches(":focus-visible") === true`），于是这条线变成画布上的**常驻元素**（用户反馈「这个绿色的边框是什么」）。
    故改为**自建输入模态追踪**（`src/editor/focus-indicator.ts`）：导航类按键标记为键盘模态、指针按下标记为指针模态，编辑区获得焦点时按当时模态决定是否显示指示线；焦点已在编辑区内时鼠标点击会立即撤掉指示线。
    效果：键盘用户有明确指示（WCAG 2.4.7 Focus Visible），鼠标用户由光标本身表达位置，画布保持干净。
- **空文档占位符（v1.9 修订）**：只在**整篇为空**时出现（`.is-editor-empty`），文档中间的空段落不冒提示。呈现分两层：主提示「开始写作…」一行，辅助提示「Markdown 语法即时渲染 · Ctrl+/ 切换源码模式」另起一行、更小更淡 —— 合成一长串会变成一堵墙、也看不出主次。**实现细节**：占位符段落必须是 `position: relative`（否则绝对定位的 `::before` 会飘到更外层祖先上），且 `left` 要**让开光标宽度**（3px），否则光标正好压住第一个字。
- **标题栏按钮（v1.9 修订，2026-11-25）**：
  - **窄窗不得让按钮消失**：旧实现在 ≤1100px 时把「打开 / 文件夹 / 最近 / 主题 / 设置」**整块隐藏** —— 用户反馈「头部的功能按钮功能有问题」，实际是这些按钮**直接不见了**，而打开文件/文件夹是主流程入口。改为只隐藏 `.tb-label` 文字、保留图标与功能；每个按钮另配稳定的 `aria-label`（可见文字会变的按钮尤其需要）。
  - **窗口命令失败必须可见**：所有 `getCurrentWindow().xxx()` 统一走 `runWinCmd()`，失败弹 toast —— 原先一律 `void promise`，rejection 被静默吞掉，权限缺失时表现为「点了没反应」，用户无从判断是应用坏了还是没点对。
- **死按钮必须禁用（v1.8）**：表格工具栏中当前不可用的操作（如单行表格的「删行」、单列表格的「删列」）必须 `disabled` —— prosemirror-tables 的命令在不可用时**仍返回 true**，不能拿返回值探测可用性，须用 `selectedRect` 自算。
- **空文档必须有提示（v1.8）**：编辑区全空白时给出占位符（`@tiptap/extensions` 的 `Placeholder`）。

## 7. 快捷键（M1/M2/M3）

| 键 | 功能 | 状态 |
|---|---|---|
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | 新建 / 打开 / 保存 / 另存为（**另存为新建标签**，见 §5.2） | M1 |
| Ctrl+/ | WYSIWYG ⇄ 源码 | M1 |
| Ctrl+B / Ctrl+I / Ctrl+Shift+X / Ctrl+E / Ctrl+U | 粗体/斜体/删除线/行内代码/下划线 | M1 |
| Ctrl+K | 插入链接 | M1 |
| Ctrl+Shift+P | 命令面板 | M2 |
| Ctrl+P | 快速打开（工作区文件模糊搜索） | **M3 已落地** |
| Ctrl+F / Ctrl+H | 查找 / 替换 | M1 源码模式 / **M3 WYSIWYG 内** |
| Ctrl+Shift+F | 跨文件搜索 | M2 |
| Ctrl+1…6 / Ctrl+0 | 标题级别 / 正文 | M1 |
| Ctrl+\ | 侧栏折叠 | M1 |
| Ctrl+, | 设置面板 | **M3 已落地** |
| Ctrl+Shift+H | 快照历史面板 | M2 |
| F1 | 帮助中心（Markdown 速查 / 快捷键 / 检查更新 / 关于） | **v1.9 新增** |
| F8 / F9 | 专注模式 / 打字机模式 | M2 |
| Ctrl+= / Ctrl+- | 编辑区缩放（缩放联动行宽恒定） | **M3 已落地** |

（Ctrl+B 冲突已按上表消解：粗体保留 Ctrl+B，侧栏折叠用 Ctrl+\。）

## 8. 里程碑与路线图

| 期次 | 内容 | 验收 |
|---|---|---|
| **M0 spike** ✅ 已通过（2026-11-19） | ① pnpm --offline 装齐 tiptap 3.22.1 家族 + React 薄封装跑通；② md⇄tiptap 往返保真（GFM 表格/任务列表/公式/frontmatter/中文）；③ highlight.js NodeView 代码高亮；④ cargo 离线建 tauri 空窗 + pulldown-cmark/syntect 编译通过 | 四项全 PASS，D1 回退未触发；证据与未验证项见 `spikes/M0-CONCLUSIONS.md` |
| **M1 核心写作** ✅ 已通过（2026-11-20） | 双模式编辑器、文件树/打开/保存/自动保存/外部变更、大纲、亮暗主题、字数统计、图片 assets 化、文件内搜索（源码模式）、表格工具栏、Ctrl+1…6/0 与 Ctrl+K | cargo test 11/11；jsdom 24/24 + M1 编辑增强 13/13 + mock IPC 15/15；往返不动点 PASS；tsc+build 绿；dev 预览交接（`spikes/M1-CONCLUSIONS.md`） |
| **M2 特色** ✅ 已通过（2026-11-20） | 快照历史+diff、命令面板、跨文件搜索、专注/打字机、导出 HTML/PDF、多标签、写作目标 | 特色四项浏览器 mock 全链路演示验证；搜索实测（M2 单线程基线）：万文件（20MB）全量扫描 冷 1268ms / 热 1200ms、正则全量 853ms、常见词+默认截断 7ms（默认 limit 500 提前终止）；Rust 18/18、spike 全 PASS、tsc+build 绿（`spikes/M2-CONCLUSIONS.md`）。**M3 已更新该性能数**：并行化后全量 635–761ms、正则 425–514ms（见 §12 v1.6） |
| **M3 打磨** ✅ 已通过（2026-11-21） | **已在本轮前落地并于本轮核验的 8 项**：自定义主题（目录 + 热加载 + 一键打开）、WYSIWYG 内查找替换（修复失效并加独立等价性闸门）、HTML 粘贴、设置面板、Ctrl+P 快速打开、编辑区缩放（联动行宽）、搜索并行化、bundle 分包（manualChunks）。**本轮实际交付**：① 数据安全三件套（D1 stash 快照 + D3/E01 autosave 定时器竞态 + 关窗 flush 全部脏标签）；② 后端安全（E05 导出属性转义/E11 图片路径穿越/E06 搜索截断标记）；③ A10 asset scope 收窄 + A11 watch debounce + C7 打开主题目录；④ 装饰增量等价化（code-block.ts + find-replace.ts 各一处）；⑤ 渲染谓词阶段一（D2 `rerenderOn`）；⑥ UI 原语统一（Modal/Toast，15 处原生弹窗清零）+ 标题栏图标化 + a11y + 响应式 + 侧栏宽度可调；⑦ 字体裁剪（KaTeX 59→19 个 woff2，−798KB）；⑧ **NSIS 安装包打包验证成功**（非降级） | `cargo test --lib` **27 passed / 0 failed / 1 ignored**；jsdom 回归 **66/66**；4 个既有 spike 全 PASS（m1editor **73 条断言全绿** / m1ipc 15/15 / roundtrip 不动点 / nodeview-dom 全要素）；`tsc --noEmit` + `vite build` 绿；反证工具对 empty/revert/offbyone/hljsclass **四类变异全部捕获**、none 对照全绿；**打包两步均成功**：`mwtyper.exe` 8.68 MiB + `MWTyper_0.1.0_x64-setup.exe` 3.06 MiB（详见 `src-tauri/BUILD-LOG.md`）；搜索基准实测回填（§12 v1.6）；验收矩阵见 `docs/review/delivery-verification.md` |
| **M3.5 审查修复期** ✅ 已通过（2026-11-23） | 对既有实现做**敌对视角源码审查**（第 3 轮 11 项缺陷 + 基线 1 项；第 4 轮新发现 2 项）并修复；收尾项：a11y 补齐、文件树大目录保护、SPEC 回填、**改为单文件交付** | `cargo test --lib` **28 passed / 0 failed / 1 ignored**；jsdom **audit3 104/104 + qa4-probe 121/121 + regression 66/66 + 大目录探针 16/16**；4 个既有 spike 全 PASS；`tsc --noEmit` 0 error 0 warning；`vite build` 绿（4.37s）；**反证 25 个变异全部被捕获**（第 3 轮 14 + 第 4 轮 6 + 大目录 5）；**单文件构建成功**：`release/MWTyper.exe` 8.68 MiB，**不产安装包**（`bundle.active: false`；全项目 `*setup*.exe`/`*.msi` 命中数 0），并经 **PE 导入表解析 + 空目录隔离启动**双重验证单文件独立性（`src-tauri/BUILD-LOG.md` §8）；详见 §12 v1.7 |
| **M4+（联网环境）** | Mermaid、DOCX 导出、macOS/Linux、自更新 | 依赖网络，本机只留接口与脚手架 |

## 9. 数据与存储
- 文稿：用户磁盘上的普通 .md，UTF-8，LF 保存（可配置 CRLF）。
- 应用配置：`%APPDATA%/MWTyper/settings.json`（主题、自动保存间隔、快照策略、最近文件、窗口状态）。
- 快照：工作区 `.mwtyper/`（见 §5.6.1），纯 md+json，无数据库。
- 不写注册表、不装服务、无遥测。

## 10. 已确认决策与剩余风险

### 10.1 已确认（2026-11-19 用户拍板）
| # | 项 | 结论 |
|---|---|---|
| Q1 | 编辑器路线 | ✅ **tiptap 真 WYSIWYG + CM6 源码**；M0 spike 先行，往返保真或离线安装不通 → 回退 CodeMirror 活预览（D1 回退条款） |
| Q2 | 前端框架 | ✅ **React 18** + 自写 tiptap 薄封装（推荐默认采纳） |
| Q3 | 特色范围 | ✅ **四件套全保留**：快照历史+diff、命令面板、跨文件全文搜索、专注/打字机+写作目标 |
| Q4 | 数学/代码高亮 | ✅ **进 M1**（KaTeX + highlight.js，M0 spike 一并验证） |
| Q5 | 快照位置 | ✅ **工作区 `.mwtyper/`**（随文件夹迁移；文件树/搜索默认忽略） |

### 10.2 剩余风险
| # | 项 | 对策 |
|---|---|---|
| R1 | ~~tiptap 往返保真未知~~ **已解除**（M0 spike ②：规范化逐行一致 + JSON 深度相等） | 回归脚本 `pnpm spike:roundtrip` 留存，M1 改动扩展时复跑 |
| R2 | ~~tiptap 混版 peer 冲突~~ **已解除**（M0 spike ①：pin 安装无冲突，build 绿） | 新增 tiptap 扩展继续 pin 3.22.1 家族 |
| R3 | 离线 GUI 自动验证受限 | **v1.7 已大幅缓解**：jsdom 回归扩至 **三套常驻闸门**——`spikes/regression.ts` **66 项**（基线，sha256 锁定为 `77abee79…239ef`，全程零改动）、`spikes/audit3.ts` **104 项**（第 3 轮审查断言）、`spikes/qa4-probe.ts` **121 项**（第 4 轮新增断言），另加 `spikes/audit3.ts` 之外的 4 个既有 spike + 大目录保护自验探针 **16 项** + `tsc`/`build`/`cargo test` 构成无头验证闭环。**仍如实标注**：真实窗口观感未自动截图 |
| R4 | pnpm 12 平台可选依赖静默跳过（根因未明） | `spikes/materialize.py` 手工物化；node_modules 重装后必重跑。**M3 实测补充**：本机 corepack 解析 pnpm 已失效（`Cannot find module ...corepack\pnpm\12.14.0\bin\pnpm.cjs`），故全部构建/测试改用 **Node v24 直调本地 CLI**（`node_modules/typescript/bin/tsc`、`node_modules/vite/bin/vite.js`、`node_modules/tsx/dist/cli.mjs`、`node_modules/@tauri-apps/cli/tauri.js`）绕开包管理器 |
| R5 | **查找替换等交互的 jsdom 回归已建立，但 Tauri 原生窗口交互仍需人工确认** | jsdom 可覆盖状态机与 DOM 契约（基线 66/66 + 第 3 轮 104/104 + 第 4 轮 121/121），但**原生剪贴板/拖拽 DataTransfer、原生对话框、WebView2 打印对话框实际效果、窗口整体观感**无法在无头环境复现 → 交付前需在真实窗口手工确认一次。此为本轮明确**未运行时验证**的项 |
| R6 | ~~M3 NSIS 打包不可完成（离线工具链缺失）~~ **已解除** | 本轮实测：NSIS 工具链已就绪（`%LOCALAPPDATA%/tauri/NSIS/` 含 `makensis.exe`），**离线环境下两步打包全部成功**，产出安装包 3.06 MiB（详见 `src-tauri/BUILD-LOG.md`） |
| R7 | identifier `dev.mwtyper.app` 以 `.app` 结尾与 macOS 应用包扩展名冲突 | **本轮不改**：改 identifier 会连带影响已安装用户的应用标识与配置目录路径（`%APPDATA%/dev.mwtyper.app`），在无用户反馈需求下属于超出本轮范围的风险动作；本轮目标平台 Windows，该冲突不显现。**待 M4+ 跨平台打包前调整** |
| R8 | **文件树「默认展开 + 200 节点规模上限」的阈值是经验值**（v1.7 新增） | 超过阈值的目录首屏保持折叠，用户需多一次手动点击。缓解：阈值集中于 `FileTree.tsx` 单一常量 `TREE_AUTO_EXPAND_MAX_NODES`，改一处即全局生效；行上有条目数徽标，用户展开前即可预判规模。**未运行时验证**：真实窗口下的首屏渲染帧率与长列表滚动流畅度（jsdom 无头环境无法测帧）。**另**：规模判断按「子树节点总数」而非「直接子节点数」，故一个含 250 个文件、其中每个文件各自再带若干子目录的工作区也会被判为超大目录——这是有意的保守取值（DOM 行数取决于子树总量而非层数） |
| R9 | **原生文件对话框的父窗口绑定依赖 rfd 0.15.4 的 `set_parent` 签名**（v1.7 新增） | 已按真实 API 落地并加**编译期断言**（`src-tauri/src/fs.rs` 单测 `file_dialogs_accept_window_as_parent` 直接调用 `FileDialog::new().set_parent(window)` 让编译器校验 trait 满足性；`rfd` 未重导出 `HasWindowHandle`/`HasDisplayHandle`，故**不能引用 trait 路径**做签名断言，只能靠实际调用）。**升级 rfd 时须重新核对该签名**。**未运行时验证**：原生对话框在真实窗口中的层级归属与位置行为（jsdom 无法复现）。**另**：`raw-window-handle` 是传递依赖，未在 `Cargo.toml` 直接声明（离线环境禁止新增依赖），故显式写 trait 路径会编译失败——这是**有意为之**而非疏漏 |
| R10 | **行内 HTML 标签在往返中仍会丢失**（v1.8 新增） | `<span>` 等未在 schema 的行内标签走 `generateJSON` → 丢标签，并产出「段落套段落」的脏 JSON（PM 不校验不崩，但结构脏）。修它必须覆写 `MarkdownManager` 的**私有** `parseHTMLToken`（TS2415 禁止子类重声明父类 private 成员，只能 `as any` 猴补丁），涉及 tiptap 内部私有 API、升级易碎 → **列入第二阶段**，本期不修。**当前用户可见影响**：块级 HTML（注释 / script / 带属性 div）已完整保留，只有行内标签仍丢 |
| R11 | **`MarkdownEscape` 改变了全局行内解析行为**（v1.8 新增） | 以前反斜杠转义的字符被**丢弃**（`"\-"` → `"-"`，字符丢失），现在**保留**。这是修正，但属全局行为变化，若外部有依赖旧行为的基线需复核。另：行首转义是**启发式规则表**，极端组合会多转义一个反斜杠（语义仍正确，输出略保守） |
| R12 | **模式切换的光标恢复在大改写场景是比例估算**（v1.8 新增） | 文档长度未变时按绝对位置精确还原；变了按比例估算。极端场景（只在文件开头改了一行）光标会有小幅偏移。精确反解需要把文本偏移映射回 PM 位置（O(n) 序列化 + 位置映射），代价与复杂度不划算 |

## 11. 决策记录

- **D1（已确认 2026-11-19）**：编辑内核选 tiptap 3 WYSIWYG 而非 CodeMirror 活预览。依据：pnpm store 实测缓存齐全（§2.3）；Typora 对标要求真 WYSIWYG。回退条款：M0 spike 往返保真或离线安装失败 → 改走 CodeMirror 活预览并更新本记录。
- **D2（已确认 2026-11-19）**：前端 React 18 + 自写 tiptap 薄封装；不引 UI 组件库。
- **D3（已定）**：纯 .md 无专有格式；快照用 md+json 明文，不用数据库。依据：本地离线优先、文件可被其他工具消费。
- **D4（已定）**：不做微信公众号复制（MWMD 已覆盖）、不做云同步/协作。依据：最简可行范围。
- **D5（已确认 2026-11-19，推荐默认采纳）**：导出 HTML 的公式渲染走「前端 KaTeX 渲染结果注入导出管道」，Rust 侧不做数学渲染（无缓存 crate）。代码高亮走 Rust syntect（导出）+ highlight.js（编辑器），两套主题色对齐。
- **D6（已定）**：图标单一源 `src/app-icon.svg` → `pnpm tauri icon`，生成后删 ios/android 目录。沿用 MWMD 验证过的离线流程。
- **D7（M0 实测 2026-11-19）**：代码块高亮 = NodeView（容器 + 语言选择器）+ **hljs 输出转 inline decorations**。不在 NodeView 内改 contentDOM 的 innerHTML：会被 ProseMirror 内容同步覆盖，且 DOM 变更被 DOMObserver 误读为用户编辑。decorations 走 PM 原生状态（init/apply），编辑事务后稳定（jsdom 16/16 含 insertText 判据）。语言别名归一化仅作用于选择器显示（ts→typescript），节点 attrs 保留原别名以保序列化保真。
- **D8（M0 实测 2026-11-19，M1 修正 2026-11-20）**：表格用自定义节点（table/tableRow/tableHeader/tableCell）接 marked GFM token（store 无 extension-table）。tiptap 3 schema 组装为字段白名单，Node.create 配置中的额外字段（tableRole）被静默丢弃 → 经 `extendNodeSchema` 钩子注入。**M1实测修正**：tiptap 对每个节点都会调用*所有*扩展的 extendNodeSchema，钩子必须按入参 `ext.name` 守卫（`ext.name === "tableCell" ? {tableRole:"cell"} : {}`），否则最后一个钩子的返回值污染全部节点（连 paragraph 都带上 tableRole，pm-tables 命令全失效）。另：单元格必须声明 `colspan/rowspan` attrs（default 1），pm-tables 的 TableMap 依赖其计算网格。M1 表格为均匀网格，未暴露合并单元格命令（GFM 无法表达 colspan）。
- **D9（M0 实测 2026-11-19）**：YAML frontmatter 剥离单独保管、序列化时回贴（marked 不解析 YAML）。属预期设计；M1 需保证编辑期间 frontmatter 不被 WYSIWYG 视图吞掉。
- **D10（M1 定 2026-11-20）**：trash crate 不在 cargo 缓存 → 删除不走系统回收站，改为移入工作区 `.mwtyper/trash/<时间戳>-<名>`（工作区外文件落父目录 `.mwtyper-trash/`），可恢复、可随文件夹迁移。与 §5.2 原「回收站」措辞的偏差，联网后可换 trash crate。
- **D11（M1 定 2026-11-20）**：store 无 `@codemirror/theme-one-dark` → 源码模式暗色自接：`EditorView.theme` 走 CSS 变量 + `@lezer/highlight` tags 自定义 HighlightStyle（`src/editor/cm-dark.ts`），经 Compartment 随主题热切换。
- **D12（M2 实测 2026-11-20）**：跨文件搜索热路径按**字节**读取+匹配（`fs::read` + `regex::bytes`，命中行才做 UTF-8 lossy 转换），省去逐文件 UTF-8 校验与 String 分配。万文件基准（`cargo test bench_10k_files -- --ignored --nocapture`，10000 个 md ≈ 20MB）：全量扫描冷 1268ms / 热 1200ms，正则全量 853ms，常见词+默认 limit 500 截断 7ms。**偏差**：最坏全量扫描未稳定达 <1s 目标（本机 Windows 单线程逐文件读 + Defender 实时扫描为主因，多次运行方差 0.85–1.6s）；默认截断路径远优于目标。并行读取（std::thread 分块）列为 M3 优化项；基准测试保留可复跑。
  - **M3 实测更新（2026-11-21，并行化已完成）**：并行读取已落地（`src-tauri/src/search.rs:70` `available_parallelism().min(8)` + `:77` `std::thread::scope` 分块）。**重跑实测（两轮）**：全量扫描冷 **635–756 ms**、热缓存 **736–761 ms**、正则全量 **425–514 ms**、截断路径 **36–37 ms** → 全量路径约 **2× 提速**，**最坏全量扫描首次稳定进入 <1s**（M2 时的「未稳定达标」结论已不再成立）；截断路径因并行调度固定开销由 7ms 升至 36–37ms（毫秒级劣化，日常交互无感知）。详见 §12 v1.6。
- **D13（M2 定 2026-11-20）**：多标签 = **单 tiptap 实例 + 缓冲暂存**（切换时 stash {path,text,dirty}，装载 setContent）。代价：undo 栈不跨标签保留（切回即新栈）；源码模式以 key={activeId} 强制重建。「本次 +N 字」会话基线 = 打开/切换标签时字数（loadBuffer 重置），非进程启动。快照触发点：打开（auto）/手动保存（manual）/5 分钟定时（auto）/恢复前（auto），哈希去重兜底。
- **D14（M3 定 2026-11-21）**：本轮 M3 打磨的决策集合，8 条：
  1. **数据安全三件套（I01）**：多标签切换时在**调用瞬间捕获** `activeId`/`dirty`/`currentText()` 快照再写 tab state（不在 `setTabs` 更新器内读可变 ref）——根因是 React 更新器延迟执行、执行时读到的 ref 已是切换后的新值（D1 数据串位）。切换入口 `clearTimeout` 旧 autosave 定时器并按新标签身份重新调度（D3/E01 竞态）。关窗 flush 全部脏标签的数据逻辑抽为**可导出纯函数** `flushAllDirty(tabs, currentText, activeId, save)`，使数据正确性可在 jsdom 中做纯函数级回归而不依赖 IPC 时序。
  2. **渲染谓词阶段一（I08/D2）**：`useEditor` 的 `rerenderOn` 谓词放行 `docChanged || selectionSet || !!tr.getMeta(findKey)`——**只有纯 meta/装饰事务的顶层渲染归零**；打字/选区/find meta 三类必须继续触发（`Outline.tsx` 当前节高亮与 `FindReplaceBar` 的 x/y 计数无自身订阅，依赖顶层重渲染，归零会导致二者冻结）。阶段二（订阅下沉）属结构性改造，留后续。
  3. **装饰增量等价性闸门（I09/B2）**：`code-block.ts` 与 `find-replace.ts` 的**全文重算各改一处为增量**（仅重算改动块，其余装饰经 `tr.mapping` 平移保留）。增量算法易产生「位置漂移但命中数不变」的缺陷，故要求**增量结果与全文重算逐项等价**方可合入——等价性断言必须由**独立参照**给出（独立朴素遍历 / 独立 DOMParser 解析路径），**严禁用被测函数自身作参照**（同义反复 → 功能整体失效时两侧同时为空 → 恒等 → 闸门假通过）。另要求命中数非空断言 + 逐项 `from/to` 比对 + 区间文本复核（`textBetween`），三者缺一则 off-by-one 类缺陷逃逸。**另附 class 比较的正确读法**：ProseMirror `Decoration.inline(from, to, attrs, spec)` 的**第 3 参是 attrs、第 4 参才是 spec**，而 `Decoration.spec` getter 返回 `type.spec`（`InlineType` 构造 `this.attrs = attrs; this.spec = spec || noSpec`）→ `code-block.ts:78` 把 class 放在 attrs 位，故 class 必须读 `d.type.attrs.class`；读 `d.spec.class` 恒为 `undefined`，**该比较会退化为空转的假通过**（QA 已用 `hljsclass` 变异实证：重建的历史闸门在此情形下仍 PASS，改造后闸门 FAIL 7 条）。
  4. **raw HTML 透传保留（M0 延续）**：Markdown 中的 raw HTML **透传**而非静默丢弃——静默丢内容属数据损失，透传由渲染层负责消毒（DOMPurify）。
  5. **asset scope 收窄（A10）**：Tauri asset 协议只服务「工作区/文件所在目录的本地图片」，主题 CSS 走 `read_theme` 命令直读不经协议。故静态 scope 收窄为空，实际放行由 Rust 侧在 `list_tree`/`read_file` **返回内容之前**完成——`Scope` 经 `Arc<ScopeInner>` 共享，运行时 `allow_directory` 对已注册协议处理器立即可见；放行若只发生在 `watch_folder`（由 React `useEffect` 触发）则晚于首帧图片请求，会 403 白图。
  6. **NSIS 打包已验证成功（B1）**：本机 NSIS 工具链已就绪，**离线环境下两步打包全部成功**（`--no-bundle` → 8.68 MiB exe；完整 build → 3.06 MiB NSIS 安装包），**不沿用「离线不可打包」的降级口径**。构建日志见 `src-tauri/BUILD-LOG.md`。**v1.7 更新（2026-11-23）**：用户明确要求「要做成单文件应用，不要 setup」→ 交付形态改为**单个可执行文件**，`bundle.active` 置 `false` 跳过 bundle 阶段；NSIS 工具链与配置**保留**（`bundle.windows.nsis` 未删），改回 `true` 即可恢复安装包。**能力未减**：离线可产出安装包这件事依然成立，只是不作为本项目的交付物。
  7. **identifier 本轮不改（R7）**：`dev.mwtyper.app` 以 `.app` 结尾与 macOS 应用包扩展名冲突，但改 identifier 会连带影响已安装用户的应用标识与配置目录路径（`%APPDATA%/dev.mwtyper.app`），本轮目标平台 Windows 该冲突不显现 → **本轮不改，记入「待后续处理」，M4+ 跨平台打包前调整**。
  8. **弹窗统一为应用内浮层（C1）**：15 处 `window.alert/confirm/prompt` 全部替换为统一 `Modal`/`Toast` 原语（跟随亮暗主题、支持 Esc/回车/焦点管理），**`src/` 中零残留**；失败类改非阻塞 Toast，确认类用 ConfirmDialog。

- **D15（v1.7 定 2026-11-23）**：第 3/4 轮源码审查修复期的决策集合，6 条：
  1. **确认队列按语义类别分批结算（P1，数据丢失级）**：`askConfirm` 维护 **FIFO 队列**，队首可见；一次作答**只结算「队首及其后连续同 `kind`」的请求**，跨语义类别必须逐个向用户确认。`kind` 取值：`close-tab` / `delete-file` / `restore-snapshot` / `generic`。**依据**：原实现一次作答结算**整批队列**，导致用户只回答了「删除 B.md？」，从未见过确认框的「关闭 A」被连带执行——A 的未保存内容从未落盘即被丢弃（数据丢失）。**代价**：同类别请求仍是批量确认（保留 D-6/D-7 的批量体验），跨类别时用户需逐个作答。**约束**：`kind` 必须由调用点显式声明，不得依赖默认值掩盖语义差异。
  2. **「另存为」始终新建标签页**：见 §5.2。**依据**：就地改写路径在多标签同名场景产生路径歧义，且与 `flushAllDirty` 关窗落盘队列存在竞态；新建标签保持「一标签一路径」约定。
  3. **命令面板的模态探测改用 `MutationObserver` 动态观察**：命令面板挂载时**静态探测一次** DOM 中是否已有其他 `role="dialog" aria-modal="true"`，会漏掉「面板打开之后才出现的模态」→ 同屏出现两个 `aria-modal`，破坏 ARIA 语义（读屏只会把焦点限制在其中之一）。改为监听 `document.body` 的 `childList`/`subtree`/`attributes`（`attributeFilter: ["aria-modal", "role"]`）持续探测，检测到其他模态时把自身降级为 `aria-modal="false"`。
  4. **原生文件对话框绑定父窗口（`rfd::FileDialog::set_parent`）**：三个 `#[tauri::command]`（`pick_folder` / `pick_open_file` / `pick_save_file`）以 `window: tauri::Window` 为参数，由 Tauri 的 `CommandArg` 实现自动注入；`rfd` 侧调用 `set_parent(&window)`。**依据**：rfd 0.15.4 的实际 API 是 `set_parent<W: HasWindowHandle + HasDisplayHandle>(mut self, parent: &W) -> Self`，**不存在** `set_parent_window`；`tauri::Window<R>` 同时实现了 `HasWindowHandle` 与 `HasDisplayHandle`。**验证手段**：因 `rfd` **未重导出**这两个 trait（引用 `rfd::HasWindowHandle` 编译失败），且 `raw-window-handle` 是传递依赖未在 `Cargo.toml` 声明（离线环境禁止新增依赖），故签名正确性改由**实际调用 + 编译期类型检查**保证，并在 `fs.rs` 中固化为单测 `file_dialogs_accept_window_as_parent`。**前端 IPC 契约不变**（`src/ipc.ts` 三个签名与 payload 均未改）。
  5. **`--accent` 令牌加深，而不是改 `.ProseMirror a` 的引用**：正文链接色对白底与浅灰底的对比度不足 WCAG AA 的 4.5:1 → **加深 `--accent` 令牌值本身**（`#0a754d`），使全部 13 处 `var(--accent)` 引用一并达标，**不修改任何引用点**。**依据**：改引用点会造成「一处漏改」的风险，而令牌是单一事实源。**实测**：`#0a754d` on `#ffffff` = **5.73:1**、on `#f0f1f3` = **5.07:1**（均 PASS）；暗色主题 `--accent` 未动（`#34d399` on `#22252b` = 7.99、on `#25282e` = 7.68）。
  6. **文件树默认展开 + 规模上限 + 状态提升**：见 §5.2。**依据**：ARIA tree 要求子节点嵌套在父 `treeitem` 内（读屏才能获知层级），故不能只渲染扁平列表；而「全部默认展开」在含上万条目的工作区会一次性渲染出海量 DOM 行 → 加 **200 节点子树规模上限**，超出则保持折叠并标注条目数。**展开状态必须由 App 持有**：`FileTree` 位于条件渲染内（侧栏页签切换 / `Ctrl+\` 收起侧栏都会卸载重挂载），状态留在组件内会导致重挂载时用户手动折叠的目录被重新展开（该回归由第 4 轮审查发现，记为 P9-3）。**刷新不覆盖用户意图**：只有「本次首次见到」的目录才走默认展开逻辑。**单一事实源**：阈值常量唯一定义在 `FileTree.tsx`，App 侧只引用不复制。

- **D16（v1.8 定 2026-11-23）**：第 5 轮编辑器 UI/UX 审查的决策集合，5 条：
  1. **查找替换必须保留 mark（语义保真优先于实现简洁）**：见 §5.5。**依据**：静默丢失 Markdown 语义是**数据损坏级**问题（用户存盘后才发现），而保留 mark 的代价只是多一次区间切分。**取舍**：替换文本**不解析 Markdown 语法**（与 VS Code / 浏览器查找替换一致）。
  2. **中文全词匹配改用 lookaround 而非修 `\b`**：见 §5.5。**依据**：JS 的 `\b` 基于 ASCII `\w`，这是语言层面的设计而非 bug，改不动；只能绕开它。**约束**：lookaround 的**前后必须用不同断言**——把后边界断言 `(?!\w)` 拼在 query **之前**会检查 query 首字符，导致英文也归零（这是实现中真实踩过的坑）。
  3. **模式切换的光标必须显式保持，且两种模式各自保存**：见 §5.1。**依据**：光标丢失有**两个独立成因**（`setContent` 重置选区 / `display:none` 使浏览器选区消失），只补一个仍会复现。**取舍**：文档被大改时按**比例**估算而非精确反解（R12）。
  4. **原始 HTML 块用「承载原文的节点」而不是「改写序列化器」**：见 §5.1。**依据**：根因在 **schema 缺节点**（`generateJSON` 静默丢弃），不补节点就无从谈起；序列化器改写只能治标。**约束**：原文以**文本**形式呈现（ProseMirror 自动转义），绝不注入真实标签——否则 `<script>` 会被浏览器执行。
  5. **可访问性缺口按「语义 + 播报 + 名字」三件套补齐**：见 §6。**依据**：查找条缺 `role="search"` → 读屏无法跳转到该区域；匹配数缺 `aria-live` → 用户不知道找到了几处；contenteditable 缺 `aria-label` → 控件没有名字。**同时**：不可用的操作必须 `disabled`（死按钮比没有按钮更糟），但**不能靠命令的返回值探测可用性**（prosemirror-tables 在不可用时仍返回 true），须用 `selectedRect` 自算。

- **D17（v1.9 定 2026-11-24）**：**随航编辑 = 源码 ｜ 预览 并排**，作为第三种模式 `split`。**依据**：WYSIWYG 看不到原始 Markdown 语法，纯源码又看不到渲染结果，两头不兼顾；并排是 Markdown 编辑器的经典形态（VS Code + Markdown Preview / Obsidian）。**关键决策**：① **复用现有富文本实例做只读预览**（不新建 Editor）——与所见即所得**像素级一致**、零新渲染代码、复用全部插件（代码块高亮 / KaTeX / 表格）；代价是同一实例在不同模式下角色不同（编辑者 ↔ 只读预览），故必须显式管理 `setEditable`。② **CodeMirror 在 split 下是事实源**——用户正在写的是源码，保存的必须是源码；预览只是它的投影。③ **滚动联动必须带单向锁 + 冷却**——两侧互驱会形成正反馈（持续抖动 / 无限循环），这是这类功能最常见的体验缺陷。④ **`.editor-wrap` 在 DOM 树里的位置三态必须一致**——tiptap 实例只在挂载时创建一次并持有该 DOM 节点，React 若因分支切换重建它，编辑器会变成孤儿。
- **D18（v1.9 定 2026-11-24）**：源码模式改为**成对的亮/暗主题**（`cm-theme.ts`），不再出现「亮色传空数组 → 落到默认 fallback」的情况。**依据**：两套主题的观感必须一致，这是「样式不好看」的直接来源。
- **D19（v1.9 定 2026-11-24）**：Markdown 标记符的专属配色走 **`syntaxTree` + `Decoration.mark`**，不走 `HighlightStyle`。**依据**：六种标记符共用一个 tag，`HighlightStyle` 在原理上就无法区分（已实测：6 种标记符 class 全是 `ͼo`）；`Decoration` 路径实测可行，且与本项目 `code-block.ts` 的既有范式一致，不引入新机制。**约束**：class 名必须是稳定契约（`.mw-HeaderMark` 等），**不得依赖 CodeMirror 的匿名 class**（`ͼN`，不稳定）。
- **D20（v1.9 定 2026-11-24）**：代码块主题改为**把 highlight.js 的语义 class 映射到项目令牌**，不引入 hljs 官方主题 CSS。**依据**：hljs 主题是**全局 class 样式**，亮暗两套不能同时引入而不加作用域限定；官方主题的配色也不与应用令牌同源。自建映射后两套主题各自协调，且**零新增依赖**。

- **D21（v1.9 定 2026-11-25）**：**关窗流程改为幂等的「二次 close」**，并补 `core:window:allow-destroy` 权限。**起因**：用户反馈「关闭按钮的功能无法使用」。**根因**：能力配置只声明了 `core:window:allow-close`，而关闭流程走的是 `close()` → 触发 closeRequested → `preventDefault` → flush → **`destroy()`**；`destroy` 未授权被 ACL 拒绝，而 `void promise` 把 rejection 吞掉 → 窗口永不关闭（且因 `decorations: false`，自绘标题栏的 × 是唯一的关闭入口，等于完全无法退出）。**改法**：① 第一次请求拦截并 flush，随后**再次 close**（此时不再拦截，走正常关闭）→ 正常路径只依赖已授权的 `allow-close`；② `destroy` 仅作兜底并补授权；③ flush 期间再次点关闭必须继续拦截（否则会在落盘前就关窗，丢未保存内容）。**配套**：所有窗口命令改走 `runWinCmd`，失败弹 toast 而非静默。

## 12. 变更记录
- **v1.10（2026-11-25）**：**「检查更新」改为真正查询远端**。用户诉求：「检查更新的功能要检查的是远端是否有新的版本，参考 MWMD 项目的检查更新功能」。
  **① 根因与认知修正**：v1.9 的「检查更新」读的是**本机清单文件** `%APPDATA%/MWTyper/update-manifest.json`，当时的理由是「构建环境无网络、cargo 缓存里没有 HTTP 客户端、WebView 的 CSP 把 `connect-src` 限制在 `ipc:`，真正的联网检查做不到」。**这个判断只对 Rust 侧成立** —— 联网并不需要 Rust 侧 HTTP 客户端（WebView2 自带 `fetch`），CSP 也可按需放开一个源，Rust 侧只需保留「调起系统浏览器打开下载页」。
  **② 实现**：新增 `src/update.ts` —— `fetchLatest()` 读 `GET https://api.github.com/repos/sandinsnow/MWTyper/releases/latest`（走 REST API 而非资产直链：后者 302 跳 CDN，浏览器 fetch 常因缺 CORS 头失败；`api.github.com` 返回 `Access-Control-Allow-Origin: *`），解析出 `tag_name → version`、`assets[MWTyper.exe].browser_download_url → url`、`body → notes`、`published_at → publishedAt`。CSP 的 `connect-src` 放开 `https://api.github.com`。
  **③ SemVer 优先级修正（探针暴露的真实缺陷）**：旧 `compareVersions` 用「按 `.`/`-`/`+` 切段后逐段取数字」的朴素写法 → `0.1.0-beta.2` 解析成 `[0,1,0,0,2]`、`0.1.0` 解析成 `[0,1,0]`，补齐后得出「预发布版比正式版**新**」的反向结论 → **本地跑预发布版时永远收不到正式版的更新提示**。改为 SemVer 2.0 优先级规则（核心三段按数值比 → 预发布版低于正式版 → 预发布标识逐段比 → `+build` 元数据不参与比较）。
  **④ Rust 侧新增 `open_external`**：`ShellExecuteW` 把 URL 直接交给系统协议处理器（**不经 cmd/shell** → URL 里的 `& ? = % #` 不会被解释成命令）；只放行 `http/https/mailto`，拒绝控制字符与裸引号（**3 个单测**覆盖）。新增依赖 `winapi 0.3`（MWMD 同款，离线 cargo 缓存已有）。
  **⑤ UI 改造**：检查更新分区新增「远端最新版」行与「打开发布页」按钮；按钮文案「立即检查」→「检查远端更新」；未检查过时**既不显示「已是最新」也不显示「发现新版本」**；检查失败时给出失败原因（10 秒超时 / HTTP 错误 / 无法访问）并回落到本机清单信息；打开下载页改用 `open_external`（不用 `<a target="_blank">` —— Tauri 里会在应用内开新窗口）。
  **⑥ 连带修复（浏览器闸门抓到的既有缺陷）**：帮助中心「检查远端更新」按钮在检查期间被 `disabled` → 浏览器把焦点移到 body → React 合成事件不再冒泡到模态容器 → **Escape 关不掉帮助中心**。修法：`useModal` 增加 **document 捕获阶段**的 Escape 兜底（焦点在哪都能关）。⚠️ 直接这么做会破坏**分层模态**语义（命令面板叠在确认框之上时一次 Escape 把两层都关掉，被 QA 独占资产 P6-10 抓到）→ 补**模态栈**（后挂载的在上层，Escape 只关栈顶）。
  **⑦ 新增闸门**：`tests/spikes/update-probe.ts` **26 项**（版本比对 10 项：v 前缀 / 数值序 / 位数补齐 / 预发布低于正式版 / 预发布标识数值与字典序 / build 元数据不参与；响应解析 16 项：字段映射 / 空白正文 / 缺 `tag_name` / HTTP 错误抛出 / `AbortSignal` 透传）；`tests/browser/help-probe.cjs` 的 H5/H6 段改为**用 Playwright 路由拦截模拟 GitHub 返回**（闸门因此不依赖真实网络），H5 断言 5 项、H6 断言 6 项。
  **验证**：`cargo test --lib` **37 passed / 0 failed / 1 ignored**（新增 3 项）；jsdom 闸门 14 套全 PASS（`audit3` 104/104、`qa4-probe` 121/121、`regression` 66/66、`update-probe` 26/26、`serde-spotcheck` 23/23、`editor-probe` 11、`editor-probe2` 6、`editor-probe3` 18、`verify-qa` 14、`m1-editor` 73 断言、`m1-ipc` 15/15、`roundtrip` 不动点、`nodeview-dom` 全要素）；**真实浏览器闸门 12 套 266 项断言全绿**；`tsc --noEmit` **0 error**；`vite build` 绿（6.03s）；`pnpm tauri build --no-bundle` 绿（**winapi 0.3.9 离线编译通过**，Rust release 3m00s → `mwtyper.exe` **9,157,120 B / 8.73 MiB**，PE 导入表仍**全为 Windows 系统 DLL、不含 `WebView2Loader.dll`**）。
  **已知限制**：① 仍是「提示 + 打开下载页」，**没有**下载 / 校验 / 自替换 / 重启的完整自更新链；② 未签名（无代码签名，用户需自行判断来源）；③ GitHub API 有速率限制（未认证 60 次/小时）——本应用每次检查只发 1 个请求，且完全由用户手动触发，不会触碰配额；④ 分层模态的 Escape 语义现为「只关栈顶」，但**非栈顶模态**内的焦点仍可能落在栈顶模态之外（不影响关闭行为）。

- **v1.9（2026-11-25）**：**编辑体验专项 + 仓库公开化交付**。用户诉求依次为：① 「编辑器高亮模式的样式不好看，要做随航编辑」；② 「自定义主题应改变整个软件，且按深浅配比」；③ 「重新整合菜单栏」；④ 「两处源码编辑样式统一」；⑤ 「增加几套主题，各含深浅」；⑥ 「主题切换后整个框架跟随」；⑦ 「专注模式和打字机模式无效」；⑧ 「标题栏右上角三个图标错位」；⑨ 「提交项目到 GitHub，撰写 README，参考 MWMD 配置 CI」。
  **① 随航编辑（第三种模式）**：新增 `Mode = "wysiwyg" | "source" | "split"`；`split` 下 **CodeMirror 是事实源、tiptap 退化为只读预览**；改造 `currentText()` / `toSource()` / `toWysiwyg()` / `loadBuffer()` 四处归属；滚动联动用**单向锁 + 120ms 冷却**防正反馈。
  **② 高亮四块（根因多为「压根没生效」）**：亮色此前传空数组 `of(dark ? cmDark : [])` → 亮色完全没高亮，改为成对双主题；6 种 Markdown 标记符（HeaderMark/QuoteMark/ListMark/EmphasisMark/CodeMark/LinkMark）lezer 全映射到同一 tag，`HighlightStyle` 原理上无法区分 → 改用 `Decoration.mark({ class })`（`src/editor/cm-marks.ts`）；`markdown()` 默认 `commonmarkLanguage` **不解析表格** → 改 `markdown({ base: markdownLanguage })`；源码侧结构视觉**必须用 `Decoration.line()`**（用 `Decoration.replace({block:true,widget})` 会把块内容替换成静态 widget → 源码不能编辑）；代码块主题此前两套都硬编码 atom-one-dark 深底 → 改为跟随亮暗。
  **③ 主题体系**：应用共 **58 个颜色令牌**；新增 `src/theme/palette.ts`（基色 → 整套令牌派生）与 `src/theme/apply.ts`（注入规则，`:root:not([data-theme="dark"])` + `[data-theme="dark"]` → **不依赖样式表先后顺序**）；对比度兜底**必须对多个背景同时成立**（强调色同时出现在编辑区与应用底色上，实测 4.52:1 达标 / 4.48:1 不达标 → 取更严者校正）；标题栏此前固定近黑（只染色相）→ 改为按基色色相+明度推导；**5 套内置主题**（暖阳/青瓷/暮紫/石墨/海盐），每套**显式给出 `:root` 与 `[data-theme="dark"]` 两组基色**，`include_str!` 编译进 exe，Rust 单测守着「必须同时含深浅两块与三个基色令牌」。
  **④ 专注 / 打字机「无效」三根因**：① 设置面板改 `settings` **不产生事务** → PM 插件不重算「当前段落高亮」→ 补一次带 `preventUpdate` 的 meta 事务；② 打字机靠 `lastTwPos` 去重，面板路径未重置 → 用「刚开启」标记强制滚动；③ 状态栏无指示 → 补「专注」「打字机」标记。**连带缺陷**：补的事务若不带 `preventUpdate` 会唤醒 PM `appendTransaction` 链（trailing-node 追加 docChanged）→ tiptap emit update → `markChanged` → **新建空白草稿被误标「未保存」**（被 `qa4-probe` 的 P3-9/P3-12 抓到）。
  **⑤ 标题栏重组**：重组前右侧挤 **12 个控件**且权重相同 → 保存为唯一实心主按钮、其余 ghost；编辑模式改三分段控件（`role="radiogroup"`）；低频操作收进「⋯更多」（按**语义类别**分组，不按控件类型）；菜单**不用全屏遮罩**（会吞掉标题栏其它按钮的点击）；窗口按钮改内联 SVG（字符 `─ □ ×` 依赖字体、`line-height:1` 下基线飘忽、`□` 特别小）→ `viewBox="0 0 12 12"`、`stroke-width:1.3`、按钮 30×26 flex 居中；「打开文件夹」移到侧栏「文件」页工具栏（工作区操作不属于标题栏）。
  **⑥ P0 数据丢失**：`setContent` / `replaceWith(0,size,…)` 整篇替换 → 选区被映射成整个新文档，编辑器仍持焦时用户下一个按键抹掉全文（实测「标题正文内容。」→「X」）→ 新增 `src/editor/caret.ts`（`pmPosToTextOffset` / `restoreCaret` / `collapseSelection`），三处落地。
  **⑦ 仓库整理与公开化交付**：① **仓库布局受 QA 独占资产 sha256 锁定约束** —— `spikes/` 原地保留（`regression.ts` sha256 `77abee79…239ef`，其内部 `new URL("../src/...")` + `new URL("./m1-editor.ts")` 决定其不可移动）；`.workbuddy/review/*.ts` → `tests/spikes/`（`../../src` 不变）、`*.cjs` → `tests/browser/`（`require("./probe-util.cjs")` 同目录）、`*.md` → `docs/review/`。② **消除硬编码绝对路径** —— 13 套浏览器闸门原写死 Playwright 与 Chromium 路径 → 新增 `tests/browser/pw.cjs` 统一探测（环境变量 → 项目 node_modules → WorkBuddy 发行版 → Playwright 缓存目录）；并把该类缺陷固化为静态守卫 `tests/check-hardcoded-paths.mjs`（剥注释后扫描，模式串写成拼接形式以免守卫抓自己）。③ **README.md** 依据本文档与 `docs/` 撰写；④ **CI**：`release.yml`（参照 MWMD：标签 `v*` 触发 + workflow_dispatch、windows-latest、pnpm / node / rust stable / rust-cache、`pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc`、exe + sha256 + latest.json、`softprops/action-gh-release@v2`）+ `ci.yml`（push/PR 质量闸门）。⑤ **GitHub 推送通道**：本机 `github.com:443` 时通时不通 → 备 `scripts/push-to-github.mjs`（Git Data API，一次 commit）；⚠️ blob 必须用 `git cat-file blob <sha>` 从**对象库**导出（工作区 CRLF vs index LF，否则两端 SHA 不一致）；⚠️ 高并发建 blob 触发 **403 次级速率限制** → 并发 3 + 120ms 节流 + 退避重试 + 断点续传缓存。
  **⑧ CI 连环失败的根因与修复（全部已修，CI 13 步全绿）**：① **Node 版本** —— `jsdom@31` 传递依赖 `undici@8.12.4`，后者加载即调用 `zlib.createZstdDecompress`（**自 Node 22.15 才提供**），Node 20 上一 require jsdom 就抛 `TypeError: Cannot read properties of undefined (reading 'bind')` → 改 `node-version: 24`；② **探针写死本机绝对路径** → `tests/spikes/editor-probe3.ts` 的 `const ROOT = "D:/PROJECT/MWTyper"` 在 CI 上 ENOENT → 改相对解析 + 加静态守卫；③ **离线生成的 lockfile 缺平台原生二进制** —— store 里没有的可选依赖（`@rollup/rollup-*` 22 个、`@tauri-apps/cli-*` 11 个）被 pnpm 整体丢弃 → CI 上 `vite build` / `tauri build` 分别崩 `Cannot find module @rollup/rollup-win32-x64-msvc` / `@tauri-apps/cli-win32-x64-msvc` → 新增 `scripts/merge-lockfile-platform-packs.mjs` 做**外科手术式移植**（逐主块比对，只搬平台包条目，不动其它版本）；**不用 `pnpm update --lockfile-only` 的完整产物**，因它会把 `@tiptap/extension-*` 从 3.22.1 漂到 3.35.0（跨 13 个 minor），违反「统一 pin 3.22.1 家族」的既定决策 → 配套 `pnpm-workspace.yaml` 加 `overrides: rollup 4.52.2` 钉版本、`package.json` 的 dompurify 改精确 `3.4.18`、CI 的 pnpm 10 → 12（lockfile 顶层有 `overrides` 段）。④ **`cargo test` 必须排在 `pnpm build` 之后** —— `tauri-build` 在编译期校验 `frontendDist`（`../dist`），缺 dist 会在 build.rs 阶段失败。
  **验证汇总**：CI **13 步全绿**（run 45550745674）；`cargo test --lib` **34 passed / 0 failed / 1 ignored**；jsdom 闸门 15 套全 PASS（`audit3` **104/104**、`qa4-probe` **121/121**、`regression` **66/66**、`m1-editor` **73 断言**、`m1-ipc` 15/15、`roundtrip` 不动点、`nodeview-dom` 全要素、`editor-probe` 11、`editor-probe2` 6、`editor-probe3` 18、`verify-qa` 14、`serde-probe` 55、`serde-spotcheck` 23）；**真实浏览器闸门 12 套 263 项断言全绿**（source-style 30 / theme-set 53 / titlebar 25 / menubar 24 / help 24 / split 20 / focus-type 13 / focus-type2 11 / focus-mode 4 / placeholder 8 / winbtn 13 / ui 38）；变异注入反证 **5 类变异全部被捕获**；大目录探针 **16/16**；路径守卫扫描 107 个文件 **0 违规**（变异注入自检：代码里的硬编码被抓出、注释里的示例不误报）；`tsc --noEmit` **0 error**；`vite build` 绿（3.96s）；`pnpm tauri build --no-bundle` 绿（Rust release **2m12s** → `mwtyper.exe` **9,137,664 B / 8.72 MiB**，PE 导入表 24 个 DLL **全为 Windows 系统 DLL、不含 `WebView2Loader.dll`**）。
  **交付**：远端 `https://github.com/sandinsnow/MWTyper` —— **182 文件、5 个 commit**（本地 HEAD 与 `origin/main` 的 tree SHA 完全一致 `92350cf4…` → 逐字节相同）；仓库元信息已补 description / 10 个 topics / homepage；CI 徽章见 README 首部。**未发 Release**：发布需推送 `v*` 标签触发 `release.yml`（对外可见动作，留给用户决定）。
  **已知限制与未运行时验证项**：① 随航模式下专注 / 打字机模式不生效（设计如此：随航的编辑只发生在源码侧）；② 源码侧删除线无独立着色（CommonMark 限制）；③ 行内 HTML 仍丢；④ 图片相对路径基准不统一；⑤ 原生窗口观感、原生对话框父窗口层级、PDF 打印实际效果仍需真实窗口手工确认一次（R5 / R9）。下一步：M4+（联网环境：Mermaid / DOCX 导出 / macOS·Linux 打包 / 自更新 / 推送 v0.1.0 标签发首个 Release）。

- **v1.8（2026-11-23）**：**第 5 轮 · 编辑器 UI/UX 与功能专项审查**。用户诉求为「编辑器的 UI、UX 设计以及功能还有瑕疵，审查并继续给出优化更新方案」。本轮**先取证再下结论**：每条缺陷先写成可运行的探针并复现，再改代码，再复测；不接受「读源码觉得这里不对」的臆测式结论。共确认 **23 项真实缺陷**（P0×4 / P1×9 / P2×10），**20 项已修复并复测通过**，3 项因改动面过大列入第二阶段；另新发现 **3 项此前未记录的缺陷**。
  **① P0 语义静默损坏（4 项，全部已修）**：
  - **查找替换摧毁 Markdown 语义**：直接 `schema.text(replacement)` 覆盖匹配区间会**丢弃区间上的所有 mark** 并合并相邻同 mark 文本 → `[链接文字](url)` 替换后 URL 整条消失、`**粗体词**` 替换后加粗消失。修复：按 mark 边界切段 + 逐段继承原 marks + 从后往前替换（`src/editor/find-replace.ts`）。
  - **查找条被滚出视野 + 打开查找条把视图拉回顶部**：scrollTop 2500 → Ctrl+F → **0**，查找条 `top=-2500` 完全不可见。根因：两者都是滚动容器的子元素，① 容器内插入流首元素重置 `scrollTop`；② sticky 兄弟互相重叠。修复：统一进 `.editor-sticky-bar`。
  - **HTML 注释 / `<script>` / 带属性 `<div>` 往返丢失**：`parseHTMLToken → generateJSON` 因 schema 无对应节点而**静默丢弃**。修复：新增 `RawHtml` 节点承载原文（`attrs.html`）+ 接管 marked 的 `html` token；渲染时原文以文本形式呈现（防 XSS）。
  - **BOM 破坏 frontmatter**：`^---` 锚点因 BOM 失配 → YAML 降级为正文。修复：剥离并回贴 BOM。
  **② P1 结果错误 / 高频断裂（9 项，全部已修）**：中文全词匹配归零（`\b` 的 ASCII 语义 → lookaround + `\w\p{N}`）；表格表头被抢占（按 schema 实际位置生成）；标记开头段落往返漂移（行首 CommonMark 转义）；替换文本含换行拆段；查找导航不选中整个匹配；查找栏内 Ctrl+S 被吞（早退白名单）；**冲突横幅「重新加载」是空操作**（`openFile` 的 dirty 短路让按钮永远命中短路，与「保留我的」互为死结 → 新增绕过短路的 `reloadFromDisk`）；模式切换光标丢失（两处成因，分别补回）；**切换文件后查找高亮沿用旧文件的匹配**（`setContent` 整体替换文档，增量映射失效 → 整体替换必须触发全文重算）。
  **③ P2 一致性 / 可访问性（7 项，全部已修）**：源码模式行宽 1165px vs 富文本 860px；缩放不联动行宽；专注模式对比度 3.16:1；光标在文档最开头无当前段落高亮；查找条缺 landmark 与匹配数播报；表格工具栏缺 `role="toolbar"` 与 `aria-label`；编辑区缺 `aria-label`。另修 **空文档无任何提示**（接入 `@tiptap/extensions` 的 `Placeholder`，该包本就在 package.json 里此前未被使用）、**表格工具栏死按钮**（prosemirror-tables 命令不可用时仍返回 true，须用 `selectedRect` 自算并置 `disabled`）、**原始 HTML 块无呈现样式**（新增 `.mw-raw-html` 等宽 + 左侧竖线样式）。
  **④ 新增 4 套常驻闸门**：`tests/spikes/serde-probe.ts` **55 项**（Markdown 序列化保真）；`tests/spikes/serde-spotcheck.ts` **23 项**（**我方独立抽查**——换一批用例、换一条判据路径，不复述前者）；`tests/browser/ui-probe.cjs` **38 项**（**真实浏览器 Chromium** 端到端验收，覆盖光标保持/查找栏快捷键/冲突重载/专注模式/死按钮/a11y/对比度/占位符/原始 HTML 渲染）；`tests/spikes/verify-qa.ts` **14 项**（QA 结论的独立核验脚本 → 相关缺陷修复后**改写为回归守卫**）。原有 3 套 QA 独占资产（104/121/66）与 4 个既有 spike 保持零改动。
  **⑤ 验证汇总**：`audit3` **104/104**、`qa4-probe` **121/121**、`regression` **66/66**；4 个既有 spike 全 PASS；`editor-probe` **11/11**、`editor-probe2` **6/6**、`editor-probe3` **18/18**、`verify-qa` **14/14**、`serde-probe` **55/55**、`serde-spotcheck` **23/23**、**`ui-probe` 38/38（真实浏览器，页面错误 0）**；`tsc --noEmit` 0 错；`vite build` 绿（10.83s）；`cargo test --lib` **28 passed / 0 failed / 1 ignored**。完整审查报告见 `docs/review/editor-ux-review-report.md`。
  **⑥ 文档同步**：§5.1 补「模式切换的光标保持」「Markdown 往返的语义保真」两条功能规格；§5.5 补查找替换的语义保真/中文全词语义/导航选中/整体替换重算四条；§6 补 sticky 容器、行宽一致、缩放联动、对比度门槛、可访问性基线、死按钮禁用、空文档提示七条；新增 **R10**（行内 HTML 仍丢，涉 tiptap 私有 API，押后）、**R11**（`MarkdownEscape` 改变全局行内解析行为）、**R12**（光标恢复在大改写场景是比例估算）。
  **已知限制与未运行时验证项**：① **行内 HTML 标签仍会丢**（R10，块级已完整保留）；② `MarkdownEscape` 改变了全局行内解析行为（R11）；③ 行首转义是启发式规则表，极端组合会多转义一个反斜杠；④ 段落以 `>` 开头输出 `&gt; 引用`（tiptap 序列化文本时做 HTML 实体编码，语义正确但源码视图不原样）；⑤ 表头不在首行时会被提到最前面（GFM 只认首行做表头），内容不丢但相对位置变；⑥ 模式切换的光标恢复在大改写场景是比例估算（R12）；⑦ `mockEmitFileChange` 是浏览器预览/测试专用钩子，真实 Tauri 运行时由 Rust 侧推送 fs-changed，不受影响；⑧ **真实 Tauri 窗口观感仍需人工确认一次**（原生剪贴板/拖拽、原生对话框、WebView2 打印对话框）。

- **v1.7（2026-11-23）**：**第 3/4 轮源码审查与修复**。本轮交付 **17 项源码修复 + 1 项收尾保护 + 单文件交付形态改造**，并新增 2 项决策、2 项风险、1 组验证闸门。
  **① 第 3 轮修复的 11 项缺陷 + 1 项基线缺陷（D-1 ~ D-11、G3-2）**：
  - **数据正确性（D-1/D-2/D-3，根因在 `setState` 更新器内读 ref）**：`save()` 在**首个 `await` 之前**捕获 `{savingId, savingText, path}` 三元组，await 之后用 `stillActive = activeIdRef.current === savingId` 校验「保存期间用户是否已切换标签」，用 `unchanged = latestText === savingText` 校验「保存期间内容是否已变」；标题栏改由 `tabs` 按 `activeId` **派生**（不再持有独立的可变标题 state）。
  - **另存为（D-4）**：改为**新建标签**指向新路径，原标签不动（详见 §5.2 / D15-2）。
  - **确认框 FIFO 队列（D-5）**：新请求入队而非顶掉队首，避免先到的 Promise 被孤儿化、永不结算。
  - **命令面板模态化（D-6）**：面板在检测到其他 `aria-modal` 浮层时降级为 `aria-modal="false"`（详见 D15-3）。
  - **快照恢复（D-7）**：确认后、落盘后**各校验一次**标签身份，防止恢复到已被切换/关闭的文档上。
  - **输入弹窗（D-8）**：`askInput` 取代旧请求（`resolve(null)`）+ 单调递增 `id` + 渲染 `key={promptState?.id}`，杜绝旧请求的 Promise 泄漏。
  - **文件树 ARIA（D-9）**：子节点嵌套在父 `treeitem` 内的 `role="group"` 容器中，读屏才能获知层级（详见 §5.2 / D15-6）。
  - **侧栏页签 ARIA（D-10）**：4 个页签补 `id="sb-tab-*"` + `aria-controls="sb-panel"`，面板补 `id="sb-panel"` + `aria-labelledby`。
  - **对比度（D-11）**：`--accent` 令牌加深为 `#0a754d`（详见 D15-5）。
  - **统计基线（G3-2）**：会话基线字数**只由 `loadBuffer` 装载响应建立**，`scheduleStats` 只更新当前统计——消除慢响应把基线推到编辑之后的偏差。
  **② Rust 侧（D-7 同批）**：三个原生对话框命令（`pick_folder` / `pick_open_file` / `pick_save_file`）以 `window: tauri::Window` 为参数并调用 `rfd::FileDialog::set_parent(&window)`，使原生对话框归属应用主窗口；**前端 IPC 契约不变**（`src/ipc.ts` 三个签名与 payload 零改动）。新增编译期签名断言单测 `file_dialogs_accept_window_as_parent`（`cargo test` **27 → 28 passed**），详见 D15-4 / R9。
  **③ 第 4 轮新发现的 2 项缺陷**：
  - **P1（数据丢失级）**：原 `settleConfirm` 一次作答**结算整批队列** → 用户只回答了「删除 B.md？」，从未见过确认框的「关闭 A」被连带执行，A 的未保存内容从未落盘即被丢弃。修复：加显式 `kind` 字段（`close-tab`/`delete-file`/`restore-snapshot`/`generic`），**一次作答只结算「队首及其后连续同 kind」**，跨类别留下逐个确认（详见 D15-1）。
  - **P9-3（D-9 引入式回归）**：文件树展开状态原在组件内，而 `FileTree` 位于条件渲染内（侧栏页签切换 / `Ctrl+\` 收起侧栏都会卸载重挂载）→ 重挂载会丢失用户手动折叠。修复：状态提升到 `App`，`FileTree` 改**受控组件**（`expanded: Set<string>` + `onToggleDir`）。
  **④ 收尾项**：**`PromptDialog` 补 `aria-describedby`**（指向输入框，与 `ConfirmDialog` 指向消息体的做法对齐）；**文件树大目录保护**——`TREE_AUTO_EXPAND_MAX_NODES = 200`，子树节点数超限的目录不自动展开、保持折叠并在行上标注条目数（`.tree-count` 徽标 + `title` 提示），阈值唯一定义在 `FileTree.tsx`（详见 §5.2 / D15-6 / R8）。
  **⑤ 验证闸门（新增 2 套 + 1 套自验探针）**：`spikes/audit3.ts` **104 项**（第 3 轮断言）、`spikes/qa4-probe.ts` **121 项**（第 4 轮新增断言，QA 独占资产）、`.workbuddy/falsify/round4/large-dir-probe.ts` **16 项**（大目录保护自验，含嵌套目录以证明 `countNodes` 递归性）。基线 `spikes/regression.ts` **66 项**全程零改动（sha256 `77abee79…239ef` 校验一致）。
  **⑥ 反证自证（证明闸门有鉴别力，而非恒真通过）**：**25 个变异全部被对应断言捕获**——第 3 轮 14 个、第 4 轮 6 个、大目录保护 5 个（`L-M1` 放大阈值 / `L-M2` 移除 App 侧规模判断 / `L-M3` 阈值置 0 / `L-M4` `countNodes` 不递归 / `L-M5` `collectDirSizes` 失效）。**方法论沉淀**：① 参照实现必须**独立于**被测代码（探针曾复制了一份 App 的展开逻辑做参照 → L-M2 漏网，改为直接读取 `App.tsx` 源码里的真实判断表达式后捕获）；② 变异脚本必须**强制还原 + 首尾 `diff -r` 校验 + 变异前基线自检**（`fs.cpSync` 在 Windows 上还原不可靠，曾污染备份使基线变红，改用 shell `cp -r`）；③ 判据应命中**相关组**而非精确断言号。
  **⑦ 重建 + 改为单文件交付**：本轮改了 Rust 侧与前端侧，B1 产物（2026-11-20）**不含**这些修复 → 必须重建。**同时按用户要求把交付形态从「安装包」改为「单文件应用，不产 setup」**：`src-tauri/tauri.conf.json` 的 `bundle.active` 由 `true` 置为 **`false`**（`tauri build` 直接跳过 bundle 阶段；`bundle.windows.nsis` 配置保留在文件中不删，将来改回 `true` 即可恢复安装包），交付物为 **`release/MWTyper.exe`**。实测：`tsc --noEmit` 0 error 0 warning；`vite build` **4.37s**；`tauri build` **2m 37s** → **9,101,312 B（8.68 MiB）**；`cargo test --lib` **28 passed / 0 failed / 1 ignored**。`dist/` 总体积 2,038,539 → **2,042,695 B（+0.20%）**，主包 72.03 → **74.83 kB**；KaTeX 字体仍为 19 个 woff2（M3 裁剪成果未被破坏）。**单文件独立性双重实测**：① **PE 导入表解析**（自写脚本解析 import directory）→ 共 20 个依赖**全部是 Windows 系统 DLL / UCRT API-set**，**不含 `WebView2Loader.dll`**（Tauri 2 在 Windows 上静态链接它；WebView2 Runtime 是系统组件，本机已装 152.x）；② **空目录隔离启动** → 把 exe 单独拷入空目录后启动成功，进程存活 41.6 MB，运行后目录内**仍只有 exe 一个文件**（不落地附属文件），子进程 `msedgewebview2.exe` 属 WebView2 Runtime 的正常多进程架构。全项目 `*setup*.exe` / `*.msi` 扫描命中数 **0**。详见 `src-tauri/BUILD-LOG.md` §8。
  **⑧ 文档同步**：新增 **D15**（6 条决策）、**R8**（大目录规模阈值是经验值 + 未运行时验证帧率）、**R9**（`set_parent` 签名依赖 rfd 版本 + 升级须重新核对）；§5.2 补「文件树默认展开 + 规模上限 + 状态提升」与「另存为新建标签」两条功能规格；§7 快捷键表标注「另存为新建标签」；R3/R5 更新为三套常驻闸门（66 + 104 + 121）。
  **验证汇总**：`audit3` **104/104**、`qa4-probe` **121/121**、`regression` **66/66**、`large-dir-probe` **16/16**；`m1-editor` / `m1-ipc`（15/15）/ `roundtrip`（不动点）/ `nodeview-dom` 全 PASS；`tsc --noEmit` 0 error 0 warning；`vite build` 绿；`cargo test --lib` **28 passed**；**单文件构建绿（不产安装包）**。
  **已知限制与未运行时验证项**：① 原生对话框的**父窗口层级归属与位置行为**、原生剪贴板/拖拽、WebView2 打印对话框、窗口整体观感——无头环境无法复现，**需真实窗口手工确认一次**（R5 / R9）；② **大目录阈值 200 为经验值**，超出阈值的目录首屏折叠，真实窗口下的首屏帧率与长列表滚动流畅度**未运行时验证**（R8）；③ undo 栈仍不跨标签保留（D13）；④ `vendor-codemirror` 603 kB 仍有 >500 kB 提示（非错误）；⑤ identifier 命名规范待 M4+ 跨平台打包前调整（R7）；⑥ **单文件交付的前置条件**：目标机器须有 **WebView2 Runtime**（Windows 10/11 通常预装；离线/精简系统可能缺失，需微软官网安装 Evergreen Runtime）——这是 WebView2 应用的通用前提，非本项目引入的新依赖；exe 本身不含也不附带任何 DLL。下一步：M4+（联网环境：Mermaid / DOCX 导出 / macOS·Linux 打包 / 自更新）。

- **v1.6（2026-11-21）**：M3 打磨落地 + 文档与代码对齐。本轮实际交付 8 组：① **数据安全三件套**（D1 多标签 stash 快照、E01/D3 autosave 定时器跨标签竞态、关窗 flush 全部脏标签；数据逻辑抽为可导出纯函数 `flushAllDirty(tabs, currentText, activeId, save)`）；② **后端安全**（E05 导出 HTML 属性转义/XSS、E11 导出图片路径穿越防护、E06 搜索结果截断标记）；③ **A10 asset scope 收窄**（静态 scope 收窄为空，实际放行改由 `list_tree`/`read_file` 在返回内容前同步完成，消除首帧图片 403 竞态）+ **A11 watch debounce**（300ms 到期判定）+ **C7 打开主题目录**（Rust `reveal_themes_dir`）；④ **装饰增量等价化**（`code-block.ts` 与 `find-replace.ts` 各一处全文重算改增量，并以**独立参照**建立逐项等价性闸门）；⑤ **渲染谓词阶段一**（`useEditor` 的 `rerenderOn` 放行 `docChanged || selectionSet || find meta`，仅纯 meta 事务顶层渲染归零）；⑥ **UI 打磨**（15 处原生弹窗清零改统一 Modal/Toast、标题栏图标化 + aria-label、`:focus-visible` 焦点环、浮层 `role=dialog`/`aria-modal`、响应式断点、侧栏宽度可调 180–420px 且持久化、编辑区缩放联动行宽）；⑦ **字体裁剪**（KaTeX 字体 **59 → 19 个文件**（仅 woff2），**1,072,948 → 256,168 字节，省 798KB**；woff + ttf 回退源归零）；⑧ **NSIS 安装包打包验证成功**（非降级）。**验证**：`cargo test --lib` **27 passed / 0 failed / 1 ignored**；jsdom 回归 `spikes/regression.ts` **66/66**（D-gate-1~6 静态守卫全 OK）；4 个既有 spike 全 PASS（m1editor **73 条断言全绿** / m1ipc 15/15 / roundtrip 不动点 / nodeview-dom 全要素）；`tsc --noEmit` 0 error 0 warning；`vite build` 绿（8.79s）。**反证自证**：改造后的 B2 闸门对 `empty`/`revert`/`offbyone`/`hljsclass` **四类变异全部捕获**（查找组分别失败 40/40/26/7 条），`none` 对照 **0 失败**——证明闸门具备鉴别力而非恒真通过。其中 `hljsclass` 变异针对「高亮 class 读错位置（`d.spec.class` vs `d.type.attrs.class`）会导致 class 比较退化为空转假通过」这一失效模式，由 QA 补充；QA 已用重建的历史闸门实证该假通过（历史闸门在此变异下仍 PASS），证明本轮改造是**必要修复而非锦上添花**。QA 另将其固化为两条常驻静态守卫（D-gate-5「闸门不得读 `d.spec.class`」、D-gate-6「`code-block.ts` 的 class 必须在 attrs 位」），`spikes/regression.ts` 由此 64 → **66 项**。
  **性能实测回填（本轮重跑，旧值全为优化前）**：
  - **搜索基准**（`cargo test bench_10k_files -- --ignored --nocapture`，10000 个 md ≈ 20MB，**并行化后**）：全量扫描冷 **635–756 ms**、热缓存 **736–761 ms**（两轮实测区间）、正则全量 **425–514 ms**、常见词 + 默认 limit 500 截断 **36–37 ms**。对比 v1.5（D12，单线程）：冷 1268 / 热 1200 / 正则 853 / 截断 7 ms → **全量路径提速约 2 倍**，截断路径因并行调度开销略升 7→36ms（仍远优于 1s 目标）。**最坏全量扫描本次已稳定进入 <1s**（v1.5 未稳定达标）。
  - **bundle 体积**（`vite build` 实测）：`dist/assets/` 总体积 **2,855,547 → 2,038,539 字节**（主包 `index` 72.03 kB、`vendor-codemirror` 603.14 kB、`vendor-tiptap` 381.15 kB、`vendor-katex` 294.82 kB、`vendor-react` 142.77 kB、`vendor-hljs` 127.16 kB、`vendor` 110.20 kB）；KaTeX 字体 **59 → 19 个文件、1,072,948 → 256,168 字节（−798KB）**；`vendor-codemirror` 603 kB 仍有 Rollup >500 kB 提示（非错误，不阻断）。
  - **打包产物**：`mwtyper.exe` **9,099,264 字节（8.68 MiB）**；`MWTyper_0.1.0_x64-setup.exe` **3,210,555 字节（3.06 MiB）**；NSIS `installMode: currentUser`，语言 SimpChinese + English。
  **文档同步（本次审查的核心价值）**：修正 SPEC 与代码的严重不符——§8 M3 行把 8 项「早已落地但文档滞后」的功能标注为已完成、M3 剩余项改为本轮实际交付内容；§4 Typora 对照表更新期次标注；§7 快捷键表去掉 `Ctrl+P`/`Ctrl+=`/`Ctrl+-` 的「押后 M3」并补 `Ctrl+,`（设置）与 `Ctrl+\`（侧栏折叠）；新增 **D14**（本轮 8 条决策）；新增 **R5**（jsdom 回归已建立但原生窗口交互仍需人工确认）、**R6**（NSIS 打包不可完成的旧风险解除）、**R7**（identifier 命名规范待 M4+ 调整）；`spikes/M2-CONCLUSIONS.md` §5 删除「focus.ts 属全文重算」的错误归类（focus.ts 实为 O(1) 单 node decoration，真正全文重算的是 code-block.ts 与 find-replace.ts 两处），并补搜索并行化 / bundle 分包 / 字体裁剪 / NSIS 打包成功的实测数据。
  **已知限制与未运行时验证项**：① Tauri 原生窗口的剪贴板/拖拽 DataTransfer、原生对话框、WebView2 打印对话框实际效果、窗口整体观感——**jsdom/无头环境无法复现，需真实窗口手工确认**（R5）；② WYSIWYG 查找替换**仍不支持跨节点命中**（逐文本节点匹配，与多数编辑器首版一致，已在代码注释与本记录标注）；③ undo 栈不跨标签保留（D13 单实例代价）；④ `vendor-codemirror` 603 kB 仍有 >500 kB 提示；⑤ identifier 命名规范待 M4+ 跨平台打包前调整（R7）。下一步：M4+（联网环境：Mermaid / DOCX 导出 / macOS·Linux 打包 / 自更新）。

- **v1.5（2026-11-20）**：M2 特色落地。Rust 新增 search（walkdir+regex 字节级匹配，大小写/全词/正则/limit 截断，忽略规则同文件树）、snapshot（DefaultHasher 去重，最近 50 + 每日末条 30 天保留，id 字符白名单校验）、export（render_md 复用 + 本地图片 base64 内嵌 + 亮暗打印 CSS）共 5 命令，测试 18/18（万文件基准另置 #[ignore]）。前端：多标签（单实例缓冲暂存，D13）；侧栏四页签（文件/大纲/搜索/历史）；HistoryPanel（时间轴 + 居中浮层 diff/预览 + 恢复前自动再快照）；SearchPanel（300ms 防抖 + Aa/ab/.* 开关 + 按文件分组 + 行号直达源码模式 + 耗时统计脚注）；Palette（Ctrl+Shift+P，19 命令含最近文件，模糊子序列打分，键盘导航）；专注模式（PM 节点装饰 focus-current + 兄弟降透明度，F8）/打字机滚动（coordsAtPos 居中，F9）；导出 HTML（前端 KaTeX 注入 + woff2 base64 内嵌 → Rust 渲染，单文件 370KB 级）/PDF（隐藏 iframe 系统打印通道）；状态栏目标进度条 + 会话统计（基线=打开时字数）；设置扩展 goal_words/focus_mode/typewriter_mode/snapshot_keep/snapshot_days。**验证**：浏览器 mock 全链路实测（打开/保存双快照、diff 红绿行、恢复回退、搜索命中跳转、面板过滤执行、HTML 产物落盘、F8/F9 开关持久化、目标 65% 进度）；Rust 18/18；m1ipc 15/15、m1editor 13/13、往返不动点 PASS；tsc+build 绿。**性能报数（D12）**：万文件全量扫描冷 1268/热 1200ms、正则 853ms、截断路径 7ms——最坏全量未稳定 <1s，如实记录，并行化押 M3。**押后 M3**：WYSIWYG 内查找替换、HTML 粘贴、Ctrl+P 快速打开、编辑区缩放、bundle 2.51MB 分包。已知限制：undo 不跨标签（D13）；PDF 实际打印对话框需 Tauri 窗口人工确认（隐藏浏览器中 print 为空操作，代码链路已验证无错）。下一步：M3 打磨。

- **v1.4（2026-11-20）**：M1 核心写作落地。Rust：fs（树/读写/原子保存/重命名/trash 删除/图片 assets/设置/rfd 对话框）、stats（中英混排字数/阅读时长）、watch（notify 防抖 + 自写噪声过滤）共 15 命令，测试 11/11。前端：ipc 统一层（Tauri + 浏览器 localStorage mock，预览可跑全文件链路）；App 外壳（标题栏/侧栏文件树+大纲/状态栏/冲突横幅/最近文件）；CSS 变量亮暗主题（随系统+手动，持久化）；1s 防抖自动保存+失焦即存；外部变更脏则冲突提示、干净且内容确异则静默重载（自写事件按内容比对抑制，避免光标重置）；大纲实时刷新/跳转/当前节高亮；图片粘贴拖拽→assets 相对路径（无工作区退化 data URL）；Ctrl+1…6/0、Ctrl+K、Ctrl+F/H 跳源码 CM 搜索；表格工具栏（pm-tables 增删行列删表）。**关键修复**：extendNodeSchema 全节点污染（D8 修正）+ 单元格 colspan/rowspan attrs。验证：jsdom 24/24、M1 编辑增强 13/13、mock IPC 15/15、往返不动点 PASS、tsc+build 绿。已知限制：监听单目标（工作区优先，单文件监听其目录）；浏览器 mock 中 assets 相对路径图片不解析（Tauri 窗口正常）；decorations 全文重算与 bundle 2.44MB 仍押后 M3。下一步：M2 特色四件套。
- **v1.3（2026-11-20）**：M0 成果审查 + 修复。P0：Rust 导出图片 alt 泄漏为正文（改为收集子文本、End(Image) 时输出）；代码块 NodeView 补 stopEvent（否则真实浏览器中语言下拉被 PM 劫持）。P1：导出保留 GFM 表格对齐；关闭未处理的 FOOTNOTES 选项、raw HTML 改为透传（消除静默丢内容）；块级公式补 displayMode:true、KaTeX 全族 throwOnError:false（未完成公式不再抛错）；浏览器往返自检改 serialize 不动点判据且源码模式检查当前文本；模式切换源码未变不重建文档。P2：roundtrip spike 改 import src 实现（单一事实源）；jsdom 实测扩至全要素 24/24（表格/任务/公式/图片）。Rust 测试 4/4。已知未修：decorations 全文重算（M0 规模够用）、bundle 2.42MB（M3）。
- **v1.2（2026-11-19）**：M0 spike 四项全 PASS（① 离线安装含 pnpm 12 元数据逆向/平台二进制物化管线；② 往返保真首跑即过；③ jsdom 实测 16/16，确立 decorations 高亮机制；④ cargo 离线编译 2m46s + 测试 2/2）。D1 回退条款未触发；R1/R2 解除，新增 R4（pnpm 12 平台依赖跳过）；新增 D7–D9；§2.1 修正 pnpm 实为 12.10.1；spike 代码沉淀为 src/editor/* 与 src-tauri/ 真实实现。已知优化项：bundle 2.42MB（hljs 全量+katex+CM6+tiptap）→ M3 按需注册与分包。下一步：M1 核心写作。
- **v1.1（2026-11-19）**：Q1–Q5 全部拍板（tiptap WYSIWYG / React 18 / 特色四件套全保留 / KaTeX+高亮进 M1 / 快照存工作区 `.mwtyper/`）；D1、D2、D5 转已确认；§10 改为「已确认决策与剩余风险」。下一步：M0 spike。
- **v1.0（2026-11-19）**：初版。完成本机离线依赖实测盘点（cargo 缓存 + pnpm store 1034 包），确立 Tauri 2 + React + tiptap/CM6 双模式架构、Typora 对照表、四项特色、M0–M4 里程碑；Q1–Q5 待用户拍板。