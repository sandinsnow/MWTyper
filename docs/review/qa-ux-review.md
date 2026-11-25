# MWTyper 代码质量与 UX 审查报告

- 审查人：严过关（QA 工程师）
- 日期：2026-11-20
- 范围：`D:/PROJECT/MWTyper`，前端 `src/**`、Rust 后端 `src-tauri/src/**`、样式 `src/styles.css`、主题 `src/theme.ts`
- 方式：只读静态审查 + 关键行为逻辑推演 + 本地验证（`tsc --noEmit` 通过；`cargo test --lib` 因工具链 `STATUS_ACCESS_VIOLATION` 未能在本机复跑，非源码报错）

---

## 一句话总体评价

功能完成度与工程约束（离线依赖、往返保真、IPC mock）做得扎实、`tsc` 与已有 spike 均绿，但 **App.tsx 的状态机在「多标签 + 定时器 + 异步回调」交叠处存在多处可复现的数据正确性问题**，且 **视觉/UX 层面几乎为零的响应式与无障碍基础设施（全库无 `@media`、无 `aria-*`、无 `:focus-visible`、无 reduced-motion）**，属于「能跑通但离可交付产品还有明显打磨距离」的状态。

---

## 一、潜在错误清单

> 严重度：P0 = 会造成数据丢失/安全/核心功能失效；P1 = 明显错误行为，需修复；P2 = 边界或体验瑕疵。

| 编号 | 严重度 | 位置 | 问题描述 | 复现条件 | 建议 |
|---|---|---|---|---|---|
| E01 | **P0** | `src/App.tsx:278-285`（`scheduleAutosave`）、`:130-162`（`loadBuffer`/`activateTab`） | **自动保存定时器跨标签竞态**。单一 `autoTimer` 在切换标签时未 `clearTimeout`；定时器触发时读取的是**新标签**的 `filePathRef`/`dirtyRef`/`currentText()`，旧标签的待保存编辑被跳过，且无 `beforeunload`/关窗 flush。 | 在标签 A 编辑（脏，1s 计时中）→ 立即切到干净标签 B → 计时器触发但 B 不脏故跳过 → 切回 A 仍脏 → 直接关闭窗口，A 的编辑丢失。 | `activateTab`/`loadBuffer` 开头 `clearTimeout(autoTimer.current)`；`loadBuffer` 后若 `tab.dirty` 重新调度；加 `beforeunload` + Tauri close 事件 flush 所有脏标签。 |
| E02 | **P0** | `src/App.tsx:130-151`（`loadBuffer`）、`:287-295`（`scheduleStats`） | **异步 stats 回调乱序**。`initialWordsRef=null` 后发起 `api.stats()`，无请求序号；先发后回会覆盖新标签的统计。 | 打开字数差异大的 A/B/C 三个文件，快速连续点击标签切换；状态栏字数与「本次 +N 字」基线显示成其他文件的。 | 增加 `statsSeqRef`，每次请求自增，回调内校验序号一致再 `setStats`/写基线；切标签时取消在途请求。 |
| E03 | **P0** | `src/App.tsx:400-434`（`treeRename`/`treeDelete`）、`:117-128`（`stashActive`） | **重命名/删除后 `tabs[].path` 未同步**。只改了 `filePathRef`/`filePath`，tab 内仍是旧路径；`stashActive` 回写旧路径，`loadBuffer` 再把 `filePathRef` 恢复为旧路径。 | 打开 `a.md` → 右键重命名为 `b.md` → 切到别的标签再切回 → `Ctrl+S` 重新创建 `a.md`，`b.md` 的改动丢失。删除同理（保存会复活已删文件）。 | `treeRename`/`treeDelete` 同步更新 `tabs` 中对应 tab 的 `path`（或置 null/关闭该 tab），并同步 `name`。 |
| E04 | **P0** | `src/App.tsx:130-151`、`src/editor/SourceMode.tsx:15-57` | **源码模式下同标签内容刷新失效**。`SourceMode` 只在挂载时读一次 `docRef.current`，没有 `doc` 同步 effect；App 的 `key={activeId}` 仅在**切标签**时重建。 | 停留在源码模式时：①外部修改当前文件触发静默重载；②恢复快照。`setSourceText` 更新了 state，但 CM 仍显示旧文本；继续编辑会把旧文本写回，覆盖外部变更/恢复结果。 | SourceMode 增加 `useEffect([doc])`，`doc !== view.state.doc.toString()` 时整体替换；注意用 ref 抑制 `onChange` 回环。 |
| E05 | **P0** | `src-tauri/src/lib.rs:26-28`、`:104-106`、`:154-166`、`src-tauri/src/export.rs:79-86` | **导出 HTML 属性注入/XSS**。`escape_html` 仅转义 `& < >`，但 `href`/`src`/`alt`/`title`/`language-*` 都拼在双引号属性里，`"` 未转义。 | Markdown 中写 `[x](a" onmouseover="alert(1))` 或含引号的 image title，导出 HTML 后用浏览器打开 → 属性逃逸执行脚本。另外 raw HTML 事件透传（`:194`）会让 `<script>` 原样进入导出产物。 | `escape_html` 增加 `"` → `&quot;`、`'` → `&#39;`；区分「文本上下文」与「属性上下文」分别转义；对不可信来源的 md 提供清洗开关。 |
| E06 | **P1** | `src-tauri/src/search.rs:68-110` | **并行搜索 `truncated` 判定不可靠且与文档不符**。`truncated = hits.len() > limit`，而各线程命中后 `fetch_add>=limit` 即 break，常见情况下 `hits.len()==limit` → 实际截断却报 `false`；`files_scanned` 统计的是「开工」文件数而非实际扫描数。另：SPEC D12 / M2 结论明确「并行化押 M3」，但代码已并行，属**未经本轮验证的进度外代码**。 | 单个文件含 100 处命中、`limit=10` → 返回 10 条但 `truncated=false`；文件树/搜索面板的「已截断」提示不出现。 | 用原子 `stopped` 标记是否因触顶提前停工，`truncated = stopped`；补「单文件多命中触顶」与「并行 vs 单线程结果一致」测试；更新 SPEC 记录或回退该优化。 |
| E07 | **P1** | `src/App.tsx:732-802` | **全局快捷键吞掉输入框按键**。`window.addEventListener("keydown", onKey, true)` 无 `e.target` 可编辑判断，捕获阶段先于输入框处理。 | 焦点在搜索框/查找框/设置数字框时按 `Ctrl+S`（触发保存）、`Ctrl+P`（弹面板）、`Ctrl+=`（缩放）、`Ctrl+/`（切模式）；在设置面板数字框按快捷键会误存文稿。 | 处理前判断 `e.target` 是否为 `input/textarea/select/[contenteditable]`，是则仅放行 F8/F9 或直接 return；对输入框内的查找快捷键单独处理。 |
| E08 | **P1** | `src/sidebar/SearchPanel.tsx:18-40` | **搜索结果竞态**。300ms 防抖只防抖发起，未取消在途请求，先发后回覆盖新结果。 | 大工作区中快速输入/修改查询词，旧请求慢返回，结果列表与输入框内容不符。 | 请求序号 ref 或 AbortController；回调校验序号后才 `setResult`。 |
| E09 | **P1** | `src/App.tsx:1007-1009`、`src/editor/SourceMode.tsx:45-48`、`:506-519`、`:783-797` | **CM 视图悬挂引用 + 未清理的 setTimeout**。`onReady` 写入 `cmViewRef.current`，SourceMode 卸载只清自己的 `viewRef`；`openHit` 的 120ms 与源码搜索的 60ms `setTimeout` 都没有保存 id 供清理。 | 搜索命中跳转后 120ms 内切回 WYSIWYG/切标签，或对已销毁的 `EditorView` dispatch → 异常/焦点错乱。 | 卸载时回调 `onReady(null)`；所有 `setTimeout` 存 ref 并在 effect cleanup 清除。 |
| E10 | **P1** | `src/editor/image-assets.ts:24-54` | **图片插入失败静默**。`void insert(...)` 无 try/catch，`api.saveImageAsset` 失败（权限/磁盘/路径）→ unhandled rejection，用户无提示且图片丢失；多图 drop 全部插入同一 `dropPos`。 | 工作区只读或 assets 目录不可写时粘贴图片；一次拖入多张图片。 | `try/catch` + 可见错误提示；多图用一次 `editor.chain()` 顺序插入并递增位置。 |
| E11 | **P1** | `src-tauri/src/export.rs:55-76` | **图片内嵌路径穿越**。正则提取 `src` 后直接 `Path::new(base_dir).join(decoded)`，`![x](../../secret)` 可读取 base_dir 之外的任意文件并 base64 内嵌进导出 HTML。 | 打开不可信 md 并执行「导出 HTML」→ 导出的 HTML 中含本机任意文件内容。 | `canonicalize` 后校验路径必须位于 `base_dir` 内；否则跳过内嵌。 |
| E12 | **P2** | `src/ipc.ts:231-236`、`src/editor/find-replace.ts:32` | **mock 与真实后端全词匹配语义不一致**。mock 用 JS `\b`（仅 ASCII 词边界），Rust `regex` 默认 Unicode `\b`。中文「全词匹配」在浏览器预览与真实窗口结果不同。 | 搜索中文词并勾选 `ab`：mock 命中异常/为 0。 | mock 对齐 Unicode 词边界（如 `(?<![\p{L}\p{N}_])...(?!...)` + `u`），或在 UI 标注中文全词限制。 |
| E13 | **P2** | `src/App.tsx:625-628` | **设置持久化每次变更立即写盘且错误吞掉**。数字输入逐字符触发多次 `writeSettings`；`void api.writeSettings` 无 catch。 | 在设置面板连续调整数字/复选框；磁盘不可写时用户无感知，配置丢失。 | 300ms 防抖 + 失败提示。 |
| E14 | **P2** | `src/editor/useEditor.ts:14-15` | **每次 PM transaction 全树重渲染**（含选区移动、decoration 更新），App 及所有子组件重跑；`code-block.ts:98` 的 `highlightDecorations(tr.doc)` 在每次 docChanged 全文重扫，叠加后大文档输入可能卡顿。（注：`focus.ts:29-30` 装饰经架构师核实为 O(1)，不计入此项。） | 打开长文档持续输入。 | 拆分订阅粒度，仅 `docChanged` 触发统计更新；code-block 高亮改增量。 |
| E15 | **P2** | `src/App.tsx:1023`、`src/settings/SettingsPanel.tsx:52-71` | ①`sessionMinutes` 在 render 时算 `Date.now()`，无定时器，分钟数停滞直到其他 state 变化；②数字输入每次 `onChange` clamp，清空输入立即回退默认值，无法先清空再输入。 | 静止写作数分钟观察状态栏；设置里清空数字框输入新值。 | ①每 60s 轻量 state tick；②本地 string state + `onBlur` 提交/clamp。 |
| E16 | **P2** | `src/sidebar/Outline.tsx:33-47`、`src/App.tsx:436-451` | **源码模式大纲索引与跳转错配**。`fromSource` 仅识别 ATX `#`，不处理 setext、引用/列表内标题；`jumpToHeading` 切到 WYSIWYG 后按索引取 positions，两边解析数量可能不同 → 跳错或无效。 | 文档含 setext 标题或引用内标题，在源码模式点击大纲项。 | 源码模式大纲统一走 `markdown.parse` 解析，或跳转时按标题文本匹配。 |
| E17 | **P2** | `src-tauri/src/fs.rs:24-65` | **文件树递归无符号链接/深度防护**。`p.is_dir()` 跟随符号链接，无 visited 集合；工作区含符号链接环 → 无限递归、栈溢出。 | 工作区放入指向自身父目录的符号链接后打开文件夹。 | 用 `symlink_metadata` 跳过符号链接，并设最大深度（如 32）。 |
| E18 | **P2** | `src/App.tsx:78-80`、`:278-303`、`:697-699` | **三个定时器均无卸载清理**（autoTimer/statsTimer/treeTimer）。HMR 或组件卸载后可能触发已失效 state 更新。 | 开发热更新、Tauri 窗口关闭流程。 | 加统一 cleanup effect `clearTimeout` 三者。 |

### 本地验证备注
- `tsc --noEmit`（Node 24 直调 `node_modules/typescript/bin/tsc`）：**通过**。
- `cargo test --lib`：**未能完成**——build script 编译阶段 rustc 报 `0xc0000005 STATUS_ACCESS_VIOLATION`，为工具链/环境故障（本机 rustc 实际走 rustup toolchain，与 SPEC §2.1 记录的路径不一致），非源码编译错误。因此 E06 的 `truncated` 问题基于逻辑推演，建议修复时补可执行测试确认。
- `pnpm` via corepack 在本机解析到失效的 `pnpm.cjs`（node16 corepack + node24 PATH 冲突），spike 脚本未能复跑；已有结论引用 M0/M1/M2 文档记录。

---

## 二、视觉设计与 UX 改进清单

> 全库检索确认：`@media`、`prefers-reduced-motion`、`aria-*`、`role=`、`focus-visible` **均为 0 处**。以下为逐项、可落地清单。

| 编号 | 维度 | 位置（文件 / 选择器 / 组件） | 现状问题 | 建议改法 |
|---|---|---|---|---|
| U01 | 可访问性 | 全局 `src/styles.css`；`Palette.tsx`、`HistoryPanel.tsx`、`SettingsPanel.tsx` | 无任何焦点可见样式；4 处 `outline:none`（`:195/:298/:331/:357`）直接移除原生焦点环且无替代。键盘用户无法判断焦点在哪。 | 全局加 `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`；把 4 处 `outline:none` 改成 `:focus:not(:focus-visible){outline:none}`。 |
| U02 | 可访问性 | 同上 + `FindReplaceBar.tsx:57-58`、`SearchPanel.tsx:61-63` | 无 `role="dialog"`/`aria-modal`/`aria-label`；侧栏四页签无 `role="tab"`/`aria-selected`；开关按钮无 `aria-pressed`；文件树行是纯 `div`，键盘完全不可达。 | 浮层加 `role="dialog" aria-modal="true" aria-labelledby`；`.sidebar-tabs button` 加 `role="tab"`+`aria-selected`，`.sidebar-body` 加 `role="tabpanel"`；flag 按钮加 `aria-pressed`；`.tree-row` 改 `role="treeitem" tabIndex={0}` 并支持 Enter/方向键、`aria-expanded`。 |
| U03 | 可访问性 | `src/styles.css:244`（`.goal-fill`）、`:344-345`（`.focus-mode`） | 存在 `transition: width .3s` / `opacity .2s`，但无 reduced-motion 偏好支持。 | 加 `@media (prefers-reduced-motion: reduce){ .goal-fill,.focus-mode .ProseMirror>*,.focus-current{ transition:none !important } }`。 |
| U04 | 颜色对比度 | `src/styles.css:257` `.history-badge`、`:276` `.modal-tabs button.active`、`:304` `.search-flags button.on`、`:339` `.palette-item.active`、`:362` `.find-row button.on`、`:278` `.modal-restore` | 一律 `background:var(--accent)` + `color:#fff`。亮色 accent `#10b981` 与白对比约 **2.5:1**，远低于 WCAG AA 4.5:1，小字几乎读不清。 | 增加 `--accent-strong`（亮色 `#047857`、暗色 `#34d399` 配深色文字），激活态统一用它；或保留绿底但改深色文字。 |
| U05 | 颜色对比度 | `src/styles.css:10` `--fg-dim:#6b7280` on `--bg-side:#f0f1f3`；用于 `.statusbar:238`、`.search-stats:316`、`.tab:104`、`.tree-arrow:152`、`.search-file:307` | 对比约 **4.1:1**，低于 AA 4.5:1（12–13px 文字）。 | 亮色改 `#5b6472`（或更深），暗色 `--fg-dim` 由 `#8b929c` 提到 `#98a0ab`。 |
| U06 | 颜色对比度 | `src/styles.css:285-286` `.diff-line.add/.del`、`:317` `.search-error` | 硬编码 `#2ea043`/`#f85149` 在亮色底约 3:1，12px 不达标；且不随主题/自定义主题变化。 | 抽 `--diff-add/--diff-del` 变量，亮色 `#1a7f37`/`#cf222e`，暗色 `#3fb950`/`#f85149`。 |
| U07 | 交互反馈 | `src/styles.css:313` `.search-hit:hover` | `background:var(--bg-side)` 与侧栏底色相同 → **悬停无任何可见反馈**。 | 改为 `var(--bg-hover)`，并给 `.search-hit:focus-visible` 同款反馈。 |
| U08 | 交互反馈 | `src/styles.css:70-74` `.tb-btn`、`:132-136` `.sidebar-tabs button`、`:281` `.modal-close`、`:100-107` `.tab` | 缺 `:active`、`:disabled`；保存/导出进行中只有状态栏文字「保存中…」，按钮无 loading/禁用，可重复点击触发并发保存。 | 补 `:active{transform:translateY(1px)}`、`:disabled{opacity:.5;cursor:not-allowed}`；保存按钮绑定 `saving` 禁用并显示「保存中…」。 |
| U09 | 语义一致性 | `src/styles.css:68` `.dirty-dot`、`:12/:36` `--accent` | 「未保存」用与成功/激活相同的绿色，语义冲突；用户难与快照「手动」徽标（同为绿）区分。 | 未保存点改用琥珀/警示色（如 `--warn-fg`），与 `:24-25` 冲突横幅呼应；激活态保留绿。 |
| U10 | 视觉层级 | `src/App.tsx:859-911` `.titlebar`、`.tb-actions` | 8 个按钮全为平级文字（新建/打开/文件夹/保存/最近/主题/设置/源码），仅首位是 `☰` 符号；主操作（保存）无强调，窗口控制挤在末尾。 | Primary「保存」用 accent 实底，其余 ghost；按「文件操作 / 视图 / 窗口」分组加 1px 竖分隔；图标风格统一（全文字或统一图标字体）。 |
| U11 | 响应式 | `src/styles.css:63-76` `.titlebar`/`.doc-title`/`.tb-actions`；全库无 `@media` | 长文件名 + 窄窗口时 `.doc-title` 无 `min-width:0`/省略，按钮组不换行，窗口控制被挤出可视区。 | `.doc-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`、`.tb-actions{flex:none}`；`@media(max-width:1100px)` 隐藏次要按钮文字或折叠为图标。 |
| U12 | 响应式 | `src/styles.css:127-130` `.sidebar{width:260px}` | 宽度写死；900px 以下编辑区被挤压，而 `sidebar_open` 持久化为 true，重启仍占 260px。 | `width:clamp(200px, 22vw, 260px)`；`@media(max-width:760px)` 默认折叠侧栏并允许浮层覆盖。 |
| U13 | 响应式 | `src/styles.css:155-159` `.ctx-menu`、`FileTree.tsx:93-97/123` | 右键菜单用 `left:menu.x,top:menu.y` 直接定位，靠近右/下边缘时溢出屏幕不可点击。 | 定位时钳制：`Math.min(x, innerWidth-140)` / `Math.min(y, innerHeight-120)`，或 CSS `max-width:calc(100vw - 8px)` + 翻转。 |
| U14 | 浮层一致性 | `src/styles.css:260-268` vs `:320-328` | 遮罩透明度 `.45` vs `.35`、阴影 `24px` vs `40px` 不统一；圆角虽同为 10px 但无 token。 | 抽 `--overlay-bg`、`--shadow-modal`、`--radius-modal`，两处统一引用。 |
| U15 | 空态 | `FileTree.tsx:103-121`、`.panel-empty:138` | 文件树在「已打开但无 md 文件」时只显示工具栏 + 空白，与 Outline/Search/History 的空态不一致。 | `.tree-rows` 为空时渲染 `.panel-empty`「文件夹中没有 Markdown 文件」。 |
| U16 | 编辑区 | `src/styles.css:193-197` `.ProseMirror{outline:none}`、`:218` `.code-block{background:#282c34}` | 编辑器无焦点指示；浅色主题下代码块强制深色，反差突兀；与导出 CSS（`export.rs:21`）虽同为深色，但用户无法选择浅色代码主题。 | 给 `.ProseMirror:focus-visible` 极淡 inset ring；为代码块提供亮/暗两套 hljs token 变量并随主题切换。 |
| U17 | 专注模式 | `src/styles.css:344-345` | `.focus-mode .ProseMirror>*{opacity:.35}` 在浅色主题下非当前段落几乎不可读。 | 提升至 `.5~.6`，并用更明确的当前块背景/左边框强化层级，而非依赖极低透明度。 |
| U18 | 缩放 | `src/styles.css:196`、`:228`、`:232` | `--editor-zoom` 只改字号，行高（1.75）、表格内边距、图片、标题下划线间距不随之缩放，缩放后排版比例失衡。 | 以 `font-size` 为根，所有间距改 `em`/`rem`，让 `--editor-zoom` 通过根字号统一传导。 |
| U19 | 滚动条/字体 | `src/styles.css:28-51` 暗色变量、`:58` | 暗色主题未定制滚动条；`input/select` 未继承 `font-family`，浮层内可能回退到浏览器默认字体。 | 加 `[data-theme="dark"] ::-webkit-scrollbar{width:10px;background:var(--bg-side)}` 及 thumb；`button,input,select,textarea{font:inherit}`。 |
| U20 | 键盘可达 | `HistoryPanel.tsx:55-76`、`SettingsPanel.tsx:17-22` | 两个 modal 无 Escape 关闭（Palette 有），且无焦点陷阱，Tab 可跑到遮罩背后。 | 抽公共 `useModal()` hook：Escape 关闭 + 打开时聚焦、关闭时归还焦点 + Tab 循环约束；同时满足 U02 的 aria 要求。 |

---

## 三、测试覆盖现状与建议补充

### 现状
| 层 | 手段 | 覆盖 | 结论 |
|---|---|---|---|
| Rust | `cargo test --lib` | 文档记录 18/18（fs 3 / stats 4 / search 3 / snapshot 2 / export 2 / lib 4），另有 `themes.rs` 2 个测试与 1 个 `#[ignore]` 万文件基准 | 本轮本机因 rustc `STATUS_ACCESS_VIOLATION` 未能复跑，仅能引用历史结论 |
| 编辑器内核 | `pnpm spike:roundtrip` / `spike:nodeview` / `spike:m1editor` | 往返不动点、全要素 DOM 24/24、表格命令 + 快捷键 13/13 | 覆盖扎实，但均非 React 层 |
| IPC mock | `pnpm spike:m1ipc` | 15/15（树/读写/重命名/trash/图片/统计/设置/dirname） | 覆盖基础路径，缺异常与并发 |
| 前端 UI | **无** | 无 Vitest/Jest/RTL，无组件测试、无状态机测试、无 a11y 测试 | **最大缺口** |
| 纯函数 | **无** | `diff.ts`、`export.ts`、`theme.ts` 无独立测试 | E06/U 类问题无回归网 |

### 建议补充（按优先级）
1. **`App` 状态机集成测试**（jsdom + React Testing Library，新增测试基础设施）
   - 多标签：脏标签切换后文本/脏标记不丢；关闭脏标签确认分支；关闭最后一个标签自动新建。
   - 自动保存：切标签时旧标签定时器不得写新标签路径；无路径时不自动保存。
   - 外部变更：脏→冲突横幅、干净且内容不同→重载、内容相同→忽略。
   - 生命周期：卸载后无 timer/listener 残留（对应 E01/E03/E04/E18）。
2. **`diff.test.ts`**：LCS 正确性、空串/相同串、纯增/纯删、`>4M` 格退化分支（对应 `diff.ts:10`）。
3. **`export.test.ts`**：`injectKatex` 对围栏/行内代码保护、未闭合围栏、非法公式 `throwOnError:false`、多公式混排；`katexCssEmbedded` 字体替换完整性。
4. **Rust 补测**：`search.rs` 增加「单文件多命中触顶时 `truncated===true`」「并行 vs 单线程结果一致」「非法正则」；`lib.rs` 增加 `escape_html` 引号转义断言；`fs.rs` 符号链接环防护测试。
5. **`ipc.mock.test.ts`**：中文全词匹配、非法正则、limit 截断、快照保留策略、损坏 localStorage 降级。
6. **静态可访问性门禁**：引入 `axe-core`（或最小自定义脚本）断言 dialog role、aria-pressed、focus-visible 覆盖率，作为 `pnpm build` 前置检查（对应 U01–U03）。
7. **CI 可复现性**：修复本机 corepack/rustc 环境漂移，把「typecheck + build + 全 spike + cargo test」固化为一键脚本，避免只引用历史结论。

---

## 四、结论：必须修 vs 可选优化

### 必须修（进入下一轮前）
- **E01** 自动保存跨标签竞态 + 关窗 flush（数据丢失）
- **E02** stats 异步乱序（状态数据错乱）
- **E03** 重命名/删除后 `tabs[].path` 同步（数据丢失）
- **E04** 源码模式外部重载/恢复不刷新（数据覆盖）
- **E05** 导出 HTML 属性转义与 raw HTML（安全）
- **E06** 并行搜索 `truncated` 判定 + 与 SPEC 记录对齐（ correctness + 交付可信度）
- **E07** 全局快捷键吞输入（功能干扰）
- **E08** 搜索结果竞态（功能错误）
- **E09** CM 悬挂引用与未清理定时器（运行时异常）
- **U01 / U02 / U03** 焦点可见、aria 语义、reduced-motion（用户明确关注无障碍，且是「有无」问题而非优化）

### 可选优化（可排入 M3）
- E10–E18（图片失败反馈、路径穿越、mock 一致性、设置防抖、重渲染、会话时间、大纲索引、符号链接、定时器清理）
- U04–U20（对比度、交互反馈、语义色、视觉层级、响应式、浮层一致性、空态、编辑区、专注模式、缩放、滚动条、字体、modal 键盘）

---

## 五、给主理人的一句话建议

先集中修 **E01–E09 九个正确性问题 + U01–U03 无障碍地基**（预计 1 轮迭代可完成），再以 U04–U20 作为 M3「视觉打磨」批次；同时**补上 App 状态机测试**，否则多标签/定时器类回归无法被现有 spike 捕获。
