# MWTyper 编辑器 UI/UX 与功能审查报告（v1.8）

- 审查对象：`D:/PROJECT/MWTyper`（Tauri 2.11.5 + React 18.3.1 + tiptap 3.22.1 + CodeMirror 6）
- 审查范围：编辑器 UI / UX / 功能（界面一致性、布局层级、交互反馈、响应式适配、可访问性）
- 审查方式：**先取证再下结论**——每条缺陷都先写成可运行的探针并复现，再改代码，再复测；不接受"读源码觉得这里不对"的臆测式结论
- 日期：2026-11-23

---

## 0. 一句话结论

本轮共确认 **23 项真实缺陷**（P0×4 / P1×9 / P2×10），其中 **20 项已修复并复测通过**，3 项因改动面过大列入第二阶段；另新发现 **3 项此前未记录的缺陷**（切换文件后查找高亮不重算、表格工具栏死按钮、原始 HTML 块无呈现样式）。

**根因集中在两类**：一是**语义层**（Markdown 在 parse → serialize 往返中静默丢语义，用户存盘后才可能察觉）；二是**交互状态层**（光标、选区、查找状态在"切换/替换/加载"这些边界动作上没有被显式维护）。

---

## 1. 审查结果与执行优先级

| 优先级 | 判定标准 | 本轮数量 | 典型项 |
|---|---|---|---|
| **P0** | 静默损坏用户数据，或让核心功能完全不可用 | 4 | 查找替换摧毁 Markdown 语义；查找条被滚出视野；HTML 注释/script/带属性 div 往返丢失；BOM 破坏 frontmatter |
| **P1** | 功能可用但结果错误/误导，或高频路径有明显断裂 | 9 | 中文全词匹配归零；表格表头被抢占；标记开头段落往返漂移；查找栏内 Ctrl+S 被吞；冲突横幅"重新加载"是空操作；切换文件后查找高亮不重算 |
| **P2** | 一致性、可访问性、视觉与体验细节 | 10 | 源码模式行宽与富文本不一致；缩放不联动行宽；专注模式对比度不达标；缺 aria-live / role=toolbar / aria-label；空文档无任何提示 |

---

## 2. 已修复项（20 项，全部有实测证据）

### 2.1 P0 —— 语义静默损坏

#### P0-1 查找替换摧毁 Markdown 语义 ✅

**现象**：在 `[链接文字](https://example.com)` 里替换"链接文字"，URL 连同整条链接一起消失，序列化成纯文本 `"新文字"`；在 `**粗体词** 和普通词` 里替换"粗体词"，加粗一起消失，序列化成 `"替换后 和普通词"`。

**根因**：替换直接用 `schema.text(replacement)` 覆盖整个匹配区间 —— 该调用**丢弃区间上的所有 mark**，并把相邻同 mark 文本合并掉。

**修复**（`src/editor/find-replace.ts`）：
- `splitByMarkBoundaries(doc, from, to)`：用 `doc.nodesBetween` 按 mark 边界把区间切成若干段，每段携带自己的 marks；
- `replacePreservingMarks(tr, doc, from, to, replacement)`：从后往前分段替换，每段用该段原有 marks 构造新文本节点（后往前保证前面各段的原始位置不被前面的替换影响）；
- `normalizeReplacement(text)`：把 `\r\n?|\n` 折叠为空格 —— `schema.text("a\nb")` 在 PM 里**不抛异常**，但会造出段落内含换行的文本节点，序列化时一个段落被拆成两个。

**复测**：`[新文字](https://example.com)` ✅ / `**替换后** 和普通词` ✅

#### P0-2 查找条被滚出视野 + 打开查找条把视图拉回顶部 ✅

**现象**：文档滚到中部（scrollTop=2500）后按 Ctrl+F，`scrollTop` 变成 **0**，查找条 `top=-2500` 完全不可见。

**根因**：`.find-bar` 与 `.table-toolbar` 都是 `.editor-area`（`overflow:auto` 滚动容器）的直接子元素。① 容器内插入流首元素会重置 `scrollTop`；② `.table-toolbar` 原本是 `position: sticky; top: 0`，而 `.find-bar` 没有定位 —— 两个 sticky 兄弟还会互相重叠。

**修复**（`src/styles.css` + `src/App.tsx`）：统一放进 `.editor-sticky-bar`（`position: sticky; top: 0; z-index: 20`），两者都不再各自定位。

**复测**：scrollTop 保持 2544 不归零，查找条 `barTop=69`、`visible=true` ✅

#### P0-3 HTML 注释 / `<script>` / 带属性 `<div>` 往返丢失 ✅

**现象**：`"# 标题\n\n<!-- TODO -->\n\n正文"` 往返后变成 `"# 标题\n\n\n\n正文"` —— 注释整块消失，还多出两个空段落。

**根因**（已确认到源码）：tiptap markdown 的 `MarkdownManager.parseHTMLToken` 把 HTML token 交给 `generateJSON(html, baseExtensions)`，而 schema 里**没有任何节点能承载**注释 / script / 带属性 div，于是被静默丢弃。

**修复**（新增 `src/editor/raw-html.ts` + `src/editor/markdown-serde.ts`）：
- `RawHtml` 节点（`group:"block"`、`atom:true`、`content:""`），把原文存进 `attrs.html`；
- `markdownTokenName:"html"` 接管 marked 的 html token，块级 → `rawHtml` 节点，行内交回默认处理；
- 序列化时**逐字节原样输出**，不转义不改写；
- 渲染时原文以**文本**形式呈现（ProseMirror 自动转义），`<script>` 不会被浏览器执行。

**复测**：`<!-- TODO -->` / `<script>alert(1)</script>` / `<div class="note" data-k="1">提示</div>` 均逐字节保留 ✅；编辑器 DOM 中 `innerHTML` 为 `&lt;!-- TODO --&gt;`，`document.querySelectorAll(".ProseMirror script").length === 0` ✅

#### P0-4 BOM 破坏 frontmatter ✅

**现象**：带 UTF-8 BOM 的文件 `"\uFEFF---\ntitle: 我的文稿\n---\n\n正文"` 往返后变成 `"## ---\ntitle: 我的文稿\n\n正文"` —— YAML 降级为正文。

**根因**：正则的 `^---` 锚点因 BOM 失配 → frontmatter 未被剥离。

**修复**（`src/editor/extensions.ts` `splitFrontmatter`）：先剥 BOM、单独保管，序列化时回贴（部分工具依赖 BOM 判定 UTF-8，不能丢）。

**复测**：`frontmatter === "\uFEFF---\ntitle: 我的文稿\n---\n"` ✅

---

### 2.2 P1 —— 结果错误 / 高频路径断裂

| # | 缺陷 | 根因 | 修复 | 复测证据 |
|---|---|---|---|---|
| P1-1 | **中文"全词匹配"命中归零** | JS 的 `\b` 基于 ASCII `\w`，汉字属非 `\w` → `\b中文\b` 永不匹配（与 VS Code 全词搜索对中文失效同源） | 改用 lookaround：`(?<![\w\p{N}])…(?![\w\p{N}])`，**前后必须用不同断言**（把 `(?!\w)` 拼在词前会检查 query 首字符 → 必然失败）；`\p{...}` 字符类必须加 `u` flag | 普通"hello"2 处 / 全词"hello"1 处 / 全词"中文"1 处 ✅ |
| P1-2 | **表格表头行被抢占** | 表头前插行后，空行成为表头，原 `a\|b` 降级为数据行 | `src/editor/table.ts` 的 `renderMarkdown` 按 schema 里 `tableHeader` 的实际位置生成表头；GFM 只认首行做表头，故把真表头提到最前面、其前行降级为数据行（内容不丢） | 插行后输出 `\| a \| b \|\n\| --- \| --- \|\n\|  \|  \|`，再解析首行 tableHeader = `["a","b"]` ✅ |
| P1-3 | **以标记开头的段落往返结构漂移** | `- 不是列表` → 序列化 `- 不是列表` → 再解析成 bulletList | 序列化侧按 CommonMark 给行首补反斜杠（`markdown-escape.ts`），只影响**确实会被误解析**的行首；行内的 `3-5 个`、`C# 笔记` 一律不动 | `\- 不是列表` / `\# 不是标题` → 再解析仍是 paragraph，文本一字不差 ✅ |
| P1-4 | **替换文本含换行把段落拆开** | 见 P0-1 | `normalizeReplacement` | 序列化产出 `"第一行 第二行 world"`（单段）✅ |
| P1-5 | **查找导航不选中匹配** | 只放了一个折叠光标在起点 → 用户接着输入会插到匹配**前面**，与"选中→直接输入即替换"的直觉不符 | `TextSelection.create(tr.doc, m.from, m.to)` | `from=9 to=12 selected="foo"` ✅ |
| P1-6 | **查找栏内 Ctrl+S 被吞** | `inField` 早退对所有 `<input>` 一律生效 | 早退加白名单 `GLOBAL_IN_FIELD = {s,o,n,/,\,,=,+,-,p}`；Ctrl+F/Ctrl+H 留给输入框原生行为 | 查找栏内按 Ctrl+S → mock 文件系统确认内容落盘 ✅ |
| P1-7 | **冲突横幅"重新加载"是空操作** | 横幅只在该标签**脏**时出现，而 `openFile` 开头有"标签已脏 → 只激活不重载"的短路 → 永远命中短路；与"保留我的"互为死结 | 新增 `reloadFromDisk()`：绕过短路直接读盘 + `loadBuffer` + 清脏 | 模拟外部改写 → 横幅出现 → 点"重新加载" → 内容换成磁盘版本、脏标记清除、横幅关闭 ✅ |
| P1-8 | **模式切换光标丢失** | 源码模式下富文本容器 `display:none` → 浏览器选区随之消失；`setContent` 又会把选区丢到文档末尾 | 新增 `src/editor/caret.ts` 的 `restoreCaret()`（长度未变按绝对位置还原，变了按比例估算）+ 切回时 `ed.view.focus()`；源码模式侧用 `initialSelection`/`onSelectionChange` 各自保存光标 | 富文本：切换前后同一段落同一偏移 ✅；源码模式：切走再切回，光标位置不变 ✅ |
| P1-9 | **切换文件后查找高亮沿用上一个文件的匹配** | `setContent` 用 `tr.replaceWith(0, doc.content.size, …)` 整体替换文档；查找插件只做**增量映射**，旧匹配区间全落在被替换的内容上 | 新增 `isDocumentReplaced(tr)`：单个覆盖全文档的 `ReplaceStep` → 走全文重算 | 「正文」在文档.md 有 2 处 → 切到不含该词的文件 → 匹配清零、计数 0/0 ✅ |

---

### 2.3 P2 —— 一致性 / 可访问性 / 视觉

| # | 缺陷 | 修复 | 复测 |
|---|---|---|---|
| P2-1 | 源码模式正文宽度 1165px，富文本 860px —— 切换模式时行宽突变 | `.source-mode .cm-content { max-width: calc(860px * var(--editor-zoom,1)); margin: 0 auto; }` | `cmContentW = 860` ✅ |
| P2-2 | 缩放只改字号不改行宽 → 200% 时每行字数减半，与 SPEC §7「行宽恒定」不符 | `.ProseMirror { max-width: calc(860px * var(--editor-zoom,1)) }` 同步联动 | 200% → `maxWidth: "1720px"` ✅ |
| P2-3 | 专注模式非当前段落对比度不达标（opacity .5 → 3.16:1 / 4.21:1） | opacity 提到 .65 | 4.98:1（亮）/ 6.08:1（暗），均 ≥ 4.5:1 ✅ |
| P2-4 | 光标在文档最开头时专注模式无当前段落高亮 | `focus.ts` 新增 `topLevelBlockAt()`：`$pos.depth===0` 时退化为高亮就近的顶层块 | Ctrl+Home 后 `focus-current` 存在且是第一个顶层块 ✅ |
| P2-5 | 查找条无 landmark、无匹配数播报 | `role="search"` + `aria-label`；计数 `role="status" aria-live="polite"` | ✅ |
| P2-6 | 表格工具栏无 `role="toolbar"`、按钮只有 `title` | `role="toolbar"` + `aria-label="表格操作"`；每个按钮补 `aria-label` | ✅ |
| P2-7 | 编辑区是 contenteditable 但没有名字 | `editorProps.attributes`：`role="textbox"` `aria-multiline="true"` `aria-label="Markdown 正文编辑区"` | ✅ |
| P2-8 | 空文档一片空白，没有任何提示 | 接入 `@tiptap/extensions` 的 `Placeholder`（该包本就在 package.json 里，此前未被使用） | `data-placeholder="开始写作… 输入 Markdown 语法，Ctrl+/ 切换源码模式"`，`::before` 有可见文案 ✅ |
| P2-9 | 表格工具栏存在**死按钮**：单行表格时"删行"、单列表格时"删列"点了没反应（prosemirror-tables 的 `deleteRow` 内部 guard 直接吞掉，但对调用方仍返回 true） | `TableToolbar.tsx` 用 `selectedRect` 自算可用性并置 `disabled` | 单行表格 → 删行/删列 `disabled=true`，行↑ 仍可用 ✅ |
| P2-10 | 暗色主题下查找高亮对比度 2.36:1（不合格） | 半透明前景色必须**逐通道**与背景混合后重算 —— 把整个 hex 当单通道送进亮度函数是错的（真实值 3.28:1，比 2.36 还严重）。改为不透明底色 + 深色文字 | 亮色 8.16:1 / 暗色 9.46:1 ✅ |

---

## 3. 本轮新发现的缺陷（此前未记录）

1. **切换文件后查找高亮沿用旧文件的匹配**（P1-9）—— 由 S11 用例暴露。
2. **表格工具栏的死按钮**（P2-9）—— prosemirror-tables 的可用性返回值不可用于探测。
3. **原始 HTML 块需要专门的呈现样式** —— 新增的 `RawHtml` 节点若不配样式，会以普通正文的形式出现在文档流里，用户分不清"这是原文"还是"这是正文"。

---

## 4. 未修复项与理由（三阶段优化路线图）

### 第一阶段（本轮已完成）—— 静默损坏与高频断裂
见 §2，共 20 项。原则：**不改变既有架构，只补边界状态与语义保真**。

### 第二阶段（下一轮）—— 结构性改造

| 项 | 现状 | 计划 | 风险 |
|---|---|---|---|
| 行内 HTML 仍会丢 | `<span>` 等未在 schema 的标签走 `generateJSON` → 丢标签，并产出"段落套段落"的脏 JSON | 覆写父类私有 `parseHTMLToken`（TS2415 禁止子类重声明父类 private 成员，只能猴补丁） | 高：涉及 tiptap 内部私有 API，升级易碎 |
| 图片相对路径基准不统一 | 图片落盘用工作区根，Markdown 里应相对**文件所在目录** | `getBaseDir()` 优先 `dirname(filePath)` | 中：会改变已落盘图片的解析行为 |
| 打开文件无身份校验 | `openFile` 只按 path 匹配标签 | 补 inode/mtime 校验 | 低 |
| 4 空格缩进代码块无法用反斜杠转义 | 空格不是 ASCII 标点 | 序列化时改用 4 空格缩进代码块承载 | 中：会改变输出形态 |

### 第三阶段（体验打磨）—— 响应式与一致性

| 项 | 说明 |
|---|---|
| 窄窗适配 | < 1100px 时侧栏与编辑区的退让策略；< 900px 时状态栏信息折叠 |
| 术语统一 | "所见即所得 / 富文本 / 源码模式"三处叫法混用；"查找 / 搜索"混用 |
| 主题令牌收口 | 颜色/圆角/间距散落在 CSS 里，应逐步收敛为 design token |
| 加载态 | 打开大文件、导出、搜索全库时的进度反馈 |

---

## 5. 验证结果

### 5.1 自动化测试（全部实跑）

| 套件 | 断言数 | 结果 | 说明 |
|---|---|---|---|
| `spikes/audit3.ts` | 104 | **104/104 PASS** | 第 3 轮敌对视角审计（QA 独占资产，未改） |
| `spikes/qa4-probe.ts` | 121 | **121/121 PASS** | 第 4 轮 Step-4 敌对探针（QA 独占资产，未改） |
| `spikes/regression.ts` | 66 | **66/66 PASS** | 回归基线 sha256 `77abee79…239ef`（未改） |
| `spikes/roundtrip.ts` | — | PASS | 往返保真 |
| `spikes/m1-ipc.ts` | 15 | **15/15 PASS** | mock IPC |
| `spikes/m1-editor.ts` | — | PASS | 编辑器增强 |
| `spikes/nodeview-dom.ts` | — | PASS | NodeView DOM |
| `.workbuddy/review/editor-probe.ts` | 11 | **11/11 PASS** | 已从"缺陷复现"改写为回归守卫 |
| `.workbuddy/review/editor-probe2.ts` | 6 | **6/6 PASS** | 同上 |
| `.workbuddy/review/editor-probe3.ts` | 18 | **18/18 PASS** | 同上 |
| `.workbuddy/review/verify-qa.ts` | 14 | **14/14 PASS** | QA 结论独立核验 → 回归守卫 |
| `.workbuddy/review/serde-probe.ts` | 55 | **55/55 PASS** | Markdown 序列化保真（新增） |
| `.workbuddy/review/serde-spotcheck.ts` | 23 | **23/23 PASS** | 我方独立抽查（换一批用例、换一条判据路径） |
| `.workbuddy/review/ui-probe.cjs` | 38 | **38/38 PASS** | **真实浏览器**（Chromium）端到端验收（新增） |

### 5.2 构建与类型

- `tsc --noEmit` → **0 错**
- `vite build` → **成功**（10.83s）
- `cargo test --offline` → 见 §5.4

### 5.3 真实浏览器验收（`.workbuddy/review/ui-probe.cjs`）

用本地 Chromium 跑完整交互，覆盖 11 个场景：光标保持（富文本/源码双向）、查找栏内 Ctrl+S 落盘、冲突横幅重载、专注模式 Ctrl+Home、表格工具栏禁用态、a11y 属性、亮/暗查找高亮对比度、原始 HTML 块渲染与不执行、空文档占位符、切换文件后查找重算。**38 项全部通过，页面错误 0。**

### 5.4 单文件交付物

见 `src-tauri/BUILD-LOG.md` §9。

---

## 6. 变更清单

### 新增文件
| 文件 | 作用 |
|---|---|
| `src/editor/raw-html.ts` | 承载原始 HTML 块的节点 |
| `src/editor/markdown-escape.ts` | 段落行首 CommonMark 转义 + `escape` token 处理器 |
| `src/editor/markdown-serde.ts` | `MwtyperMarkdownManager`：脚注定义保留、段落转义 |
| `src/editor/caret.ts` | `pmPosToTextOffset` / `restoreCaret`（模式切换的光标保持） |
| `.workbuddy/review/serde-probe.ts` | Markdown 序列化保真探针（55 项） |
| `.workbuddy/review/serde-spotcheck.ts` | 独立抽查（23 项） |
| `.workbuddy/review/ui-probe.cjs` | 真实浏览器 UI 验收（38 项） |

### 修改文件
| 文件 | 改动 |
|---|---|
| `src/App.tsx` | 模式切换光标保持；查找栏内全局快捷键白名单；冲突横幅"重新加载"改为绕过 dirty 短路；编辑区 a11y 属性；源码模式光标保存/恢复 |
| `src/editor/find-replace.ts` | 保留 mark 的区间替换；替换文本换行归一；导航选中整个匹配；中文全词边界；`isDocumentReplaced` 触发全文重算 |
| `src/editor/extensions.ts` | BOM 剥离与回贴；注册 `RawHtml` / `MarkdownEscape` / `Placeholder`；改用 `MwtyperMarkdownManager` |
| `src/editor/focus.ts` | 顶层块定位，修复文档开头无高亮 |
| `src/editor/TableToolbar.tsx` | `role="toolbar"` + `aria-label`；按钮 `aria-label`；死按钮置 `disabled` |
| `src/editor/FindReplaceBar.tsx` | `role="search"` + `aria-live` 播报匹配数 |
| `src/editor/SourceMode.tsx` | 光标保存/恢复（`initialSelection` / `onSelectionChange`） |
| `src/editor/table.ts` | 表头语义按 schema 实际位置生成 |
| `src/ipc.ts` | 新增 mock 专用 `mockEmitFileChange`（仅浏览器预览/测试用，Tauri 路径不受影响） |
| `src/styles.css` | sticky 容器；专注模式对比度；缩放联动行宽；源码模式宽度对齐；查找高亮对比度；`.mw-raw-html` 样式；占位符样式；禁用按钮样式 |

---

## 7. 仍需注意的问题

1. **`MarkdownEscape` 改变了全局行内解析行为**：以前反斜杠转义的字符被丢弃，现在保留（`"\-"` 旧行为输出 `"-"` 且字符丢失，新行为保留字符）。这是修正，但属全局行为变化，若外部有依赖旧行为的基线需复核。
2. **脚注占位用 HTML 注释**（`<!--mwtyper-fn-N:M-->`），仅在 `MwtyperMarkdownManager.parse` 内部换回；若将来有流程绕过该入口直调 marked，占位会漏进用户文件。
3. **行首转义是启发式规则表**，覆盖判据全部标记；极端组合会多转义一个反斜杠（语义仍正确，输出略保守）。
4. **段落以 `>` 开头输出 `&gt; 引用`**：tiptap 序列化文本时做 HTML 实体编码，语义正确但源码视图不如原样好看。
5. **表头不在首行时会被提到最前面**（GFM 只认首行做表头），内容不丢但相对位置变。
6. **`restoreCaret` 在源码被大幅改写时按比例估算**，不是精确映射 —— 常见场景已足够接近，极端情况（只改了文件开头一行）会有偏移。
7. **mock 的 `mockEmitFileChange` 是测试钩子**，仅在浏览器预览模式生效，真实 Tauri 运行时的 fs-changed 由 Rust 侧推送，不受影响。
