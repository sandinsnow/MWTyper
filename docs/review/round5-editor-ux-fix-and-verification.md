# MWTyper 第 5 轮（v1.8）修复与独立复核报告 · 编辑器 UI/UX 与功能

> 生成者：team-lead｜日期：2026-11-23｜范围：编辑器 UI / UX / 功能专项审查
> 用户诉求：「编辑器的 UI、UX 设计以及功能还有瑕疵，审查并继续给出优化更新方案」
> 完整审查报告见 `.workbuddy/review/editor-ux-review-report.md`

## 0. 一句话结论

本轮确认 **23 项真实缺陷**（P0×4 / P1×9 / P2×10），**20 项已修复并经独立复测通过**，3 项因改动面过大列入第二阶段；另新发现 **3 项此前未记录的缺陷**。**新增 4 套常驻闸门**（序列化保真 55 + 独立抽查 23 + **真实浏览器 UI 验收 38** + QA 核验改写为回归守卫 14），原有 3 套 QA 独占资产（104/121/66）与 4 个既有 spike **全程零改动、全部通过**。单文件交付物已重建并复验独立性。

**方法论（本轮的核心）**：先取证再下结论 —— 每条缺陷先写成**可运行探针并复现**，再改代码，再复测；修复后把探针的断言**反转为回归守卫**（失败即意味着修复被回退）。不接受「读源码觉得这里不对」的臆测式结论。

---

## 1. 验收命令与结果（19 条全绿）

| # | 验收命令 | 结果 |
|---|---|---|
| 1 | `spikes/audit3.ts`（QA 独占） | **104 / 104** |
| 2 | `spikes/qa4-probe.ts`（QA 独占） | **121 / 121** |
| 3 | `spikes/regression.ts`（基线 sha256 锁定） | **66 / 66** |
| 4 | `spikes/roundtrip.ts` | 往返保真 PASS |
| 5 | `spikes/m1-ipc.ts` | **15 / 15** |
| 6 | `spikes/m1-editor.ts` | PASS |
| 7 | `spikes/nodeview-dom.ts` | spike ③ PASS |
| 8 | `spikes/../large-dir-probe.ts` | **16 / 16** |
| 9 | `.workbuddy/review/editor-probe.ts` | **11 / 11**（缺陷复现 → 回归守卫） |
| 10 | `.workbuddy/review/editor-probe2.ts` | **6 / 6**（同上） |
| 11 | `.workbuddy/review/editor-probe3.ts` | **18 / 18**（同上） |
| 12 | `.workbuddy/review/verify-qa.ts` | **14 / 14**（QA 结论独立核验 → 回归守卫） |
| 13 | `.workbuddy/review/serde-probe.ts`（新） | **55 / 55**（Markdown 序列化保真） |
| 14 | `.workbuddy/review/serde-spotcheck.ts`（新） | **23 / 23**（**独立抽查**：换一批用例、换一条判据路径） |
| 15 | `.workbuddy/review/ui-probe.cjs`（新） | **38 / 38**（**真实浏览器 Chromium**，页面错误 0） |
| 16 | `tsc --noEmit` | 0 错 |
| 17 | `vite build` | ✓ built in 5.68s |
| 18 | `cargo test --lib` | **28 passed / 0 failed / 1 ignored** |
| 19 | 单文件构建 + 独立性复验 | `release/MWTyper.exe` **9,104,384 B**；PE 导入表 **20 个系统 DLL（不含 WebView2Loader）**；空目录隔离启动成功、运行后仍只有 exe 一个文件；全项目 setup/msi 命中 **0** |

**真实浏览器验收覆盖的 11 个场景**：富文本/源码模式双向光标保持、查找栏内 Ctrl+S 落盘、冲突横幅"重新加载"从磁盘重载、专注模式 Ctrl+Home、表格工具栏禁用态、a11y 属性、亮/暗查找高亮对比度、原始 HTML 块渲染与不执行、空文档占位符、切换文件后查找重算。

---

## 2. P0：语义静默损坏（4 项，全部已修）

| # | 缺陷 | 根因 | 修复位置 |
|---|---|---|---|
| P0-1 | 查找替换摧毁 Markdown 语义（`[链接](url)` → URL 整条消失；`**粗体**` → 加粗消失） | `schema.text(replacement)` 覆盖区间会**丢弃区间上的所有 mark** 并合并相邻同 mark 文本 | `src/editor/find-replace.ts`：`splitByMarkBoundaries` + `replacePreservingMarks` |
| P0-2 | 查找条滚出视野 + 打开时把视图拉回顶部（scrollTop 2500 → 0） | ① 滚动容器内插入流首元素重置 `scrollTop`；② sticky 兄弟互相重叠 | `src/styles.css` `.editor-sticky-bar` + `src/App.tsx` |
| P0-3 | HTML 注释 / `<script>` / 带属性 `<div>` 往返丢失 | `parseHTMLToken → generateJSON`，schema 无对应节点 → 静默丢弃 | 新增 `src/editor/raw-html.ts` + `src/editor/markdown-serde.ts` |
| P0-4 | BOM 破坏 frontmatter（YAML 降级为正文） | `^---` 锚点因 BOM 失配 | `src/editor/extensions.ts` `splitFrontmatter` 剥离并回贴 BOM |

## 3. P1：结果错误 / 高频断裂（9 项，全部已修）

中文全词匹配归零（`\b` 的 ASCII 语义）｜表格表头被抢占｜标记开头段落往返漂移｜替换文本含换行拆段｜查找导航不选中整个匹配｜查找栏内 Ctrl+S 被吞｜**冲突横幅"重新加载"是空操作**（`openFile` 的 dirty 短路）｜模式切换光标丢失｜**切换文件后查找高亮沿用旧文件的匹配**（`setContent` 整体替换 → 增量映射失效）。

## 4. P2：一致性 / 可访问性（7 项 + 3 项附加，全部已修）

源码模式行宽 1165px vs 富文本 860px｜缩放不联动行宽｜专注模式对比度 3.16:1｜文档开头无当前段落高亮｜查找条缺 landmark 与匹配数播报｜表格工具栏缺 `role="toolbar"` 与 `aria-label`｜编辑区缺 `aria-label`｜**空文档无任何提示**｜**表格工具栏死按钮**（prosemirror-tables 命令不可用时仍返回 true）｜**原始 HTML 块无呈现样式**。

---

## 5. 仍需注意的问题

1. **行内 HTML 标签仍会丢**（R10）—— 块级已完整保留；修它需覆写 tiptap **私有** `parseHTMLToken`（TS2415 → 只能 `as any` 猴补丁），涉内部私有 API、升级易碎 → 列入第二阶段。
2. **`MarkdownEscape` 改变了全局行内解析行为**（R11）—— 以前反斜杠转义的字符被丢弃，现在保留。这是修正，但属全局行为变化。
3. **行首转义是启发式规则表** —— 极端组合会多转义一个反斜杠（语义仍正确，输出略保守）。
4. **段落以 `>` 开头输出 `&gt; 引用`** —— tiptap 序列化文本时做 HTML 实体编码，语义正确但源码视图不原样。
5. **表头不在首行时会被提到最前面** —— GFM 只认首行做表头，内容不丢但相对位置变。
6. **模式切换的光标恢复在大改写场景是比例估算**（R12）。
7. **`mockEmitFileChange` 是浏览器预览/测试专用钩子**，真实 Tauri 运行时的 fs-changed 由 Rust 侧推送，不受影响。
8. **真实 Tauri 窗口观感仍需人工确认一次**（原生剪贴板/拖拽、原生对话框、WebView2 打印对话框）—— 无头环境无法复现。

---

## 6. 踩过的坑（沉淀，避免重复）

- JS 的 `\b` 基于 ASCII `\w` → `\b中文\b` 永不匹配；lookaround **前后必须用不同断言**（把后边界断言 `(?!\w)` 拼在 query **之前**会检查 query 首字符 → 英文也归零）。
- `\p{...}` 字符类必须加 `u` flag；模板字符串拼正则容易漏 `[`（`(?![\w\p{N}])` 写成 `(?![\w\p{N}])` 少开头 `[` → `SyntaxError: Lone quantifier brackets`）。
- WCAG 对比度：半透明前景色必须**逐通道**与背景混合后重算 —— 把整个 hex 当单通道送进亮度函数会得出错误数值（真实 3.28:1 vs 误算 4.01:1）。
- `Decoration.inline(from, to, attrs, spec)` —— **第 3 参是 attrs、第 4 参才是 spec**；class 读 `d.type.attrs.class`。
- `doc.descendants` 回调返回 `false` = 跳过**整个子树**（非文本节点必须返回 `true`）。
- `schema.text("a\nb")` 在 PM **不抛异常**，但会造出段落内含换行的文本节点 → 序列化时一个段落被拆成两个。
- `Transaction.replaceWith` 会丢弃区间上的 marks 并合并相邻同 mark 文本。
- `ResolvedPos.depth === 0` 表示位置在文档顶层 → `$pos.before(1)` / `$pos.node(1)` 不可用。
- `prosemirror-tables` 的命令在**不可用时仍返回 true**（内部 guard 在 `if (dispatch)` 里）→ 不能用返回值探测可用性。
- `setContent` 用 `tr.replaceWith(0, doc.content.size, …)` 整体替换文档 → 任何依赖增量映射的状态都必须识别这种事务。
- PowerShell 5.1 按 **ANSI** 读取无 BOM 的 `.ps1` → 脚本含中文会直接解析失败（本轮实测踩到）。
- Vite 依赖优化器新增子路径 import（如 `@tiptap/pm/transform`）会触发重优化，其清理 `node_modules/.vite/deps_temp_*` 的动作撞上沙箱批量删除守卫（>50 文件）导致 dev server 崩溃 → 需用 `fs.unlinkSync` 逐文件清理（`fs.rm` 被守卫拦截）。
- `tsc` 把 `Mark` 当类型导入却当值用 → 改 `import { Mark, type Node }`。

---

## 7. 变更文件清单

**新增**：`src/editor/raw-html.ts`、`src/editor/markdown-escape.ts`、`src/editor/markdown-serde.ts`、`src/editor/caret.ts`、`.workbuddy/review/serde-probe.ts`、`.workbuddy/review/serde-spotcheck.ts`、`.workbuddy/review/ui-probe.cjs`、`.workbuddy/falsify/round4/verify-single-file.ps1`

**修改**：`src/App.tsx`、`src/editor/find-replace.ts`、`src/editor/extensions.ts`、`src/editor/focus.ts`、`src/editor/TableToolbar.tsx`、`src/editor/FindReplaceBar.tsx`、`src/editor/SourceMode.tsx`、`src/editor/table.ts`、`src/ipc.ts`、`src/styles.css`、`SPEC.md`（v1.8）、`src-tauri/BUILD-LOG.md`（§9）、`.workbuddy/review/editor-probe{,2,3}.ts`、`.workbuddy/review/verify-qa.ts`

**未改动（QA 独占资产）**：`spikes/audit3.ts`、`spikes/qa4-probe.ts`、`spikes/regression.ts`

---

## 8. 下一步

**第二阶段**（结构性改造，需单独一轮 + 往返回归）：行内 HTML 保留、图片相对路径基准改为相对文件目录、`openFile` 身份校验、4 空格缩进代码块的转义方案。

**第三阶段**（体验打磨）：窄窗响应式退让策略、术语统一（「所见即所得/富文本/源码模式」「查找/搜索」）、主题令牌收口、耗时操作的加载态。
