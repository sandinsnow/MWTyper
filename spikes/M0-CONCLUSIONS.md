# M0 Spike 结论（2026-11-19）

**总结论：①②③④ 全部 PASS。D1 回退条款未触发，按原计划进入 M1（tiptap 真 WYSIWYG + CM6 源码）。**

---

## ① 离线装齐 tiptap 3.22.1 家族 + React 薄封装 — PASS

- `pnpm install --offline` 全量命中 store；`tsc --noEmit` 与 `vite build` 绿。
- 实测 pnpm 为 **12.10.1（Rust 重写版）**，与 SPEC v1.1 假设的 pnpm 10 行为不同，踩坑与解法：
  1. 多数 store 包无注册表元数据 → 逆向 pnpm 12 元数据镜像格式（`pnpm-meta-v1` 头 + 累积偏移三元组），从 store v11 的 `index.db`（msgpackr 编码，含共享结构 ext 0x72）解码 manifest，生成 753 份元数据（`spikes/store-meta.py`，1034/1034 条目解码成功）。
  2. 平台可选依赖（esbuild/rollup/tauri-cli 的 win32-x64 二进制）元数据缺失 → 按命名推断 os/cpu 生成 stub（`spikes/platform-stubs.py`，135 份）。
  3. pnpm 12 对平台可选依赖**静默跳过**（即便 os/cpu 匹配、store 文件齐全；`minimumReleaseAge: 0`、`supportedArchitectures`、`--force` 均无效，根因未明）→ 手工物化：从 store 复制文件 + junction 链接（`spikes/materialize.py`，4 组）。**任何 node_modules 重装后必须重跑此脚本。**
  4. package.json 的 `pnpm` 字段被忽略 → 构建放行写 `pnpm-workspace.yaml`（`allowBuilds: esbuild: true`）；假发布时间需 `minimumReleaseAge: 0`。
  5. shell 默认 Node 16 → 每条命令前置 nvm v24.20.0 PATH（不改全局）。
- 无 `@tiptap/react` → 自写薄封装 `src/editor/useEditor.ts`（~30 行：实例挂 ref 容器 + transaction 触发重渲染），jsdom 与 build 均验证可用。
- 版本混存（3.22.1/3.23.6/3.10.7）按 pin 安装无 peer 冲突，R2 解除。

## ② md ⇄ tiptap 往返保真 — PASS（首跑即过）

- 脚本：`pnpm spike:roundtrip`（无头，MarkdownManager 直接操作 JSON）。
- 样本：中文 + GFM 全要素（H1/H2、粗斜删/行内代码/链接/图片、嵌套无序/有序/任务列表、引用、```ts 代码块、GFM 表格含粗体单元格、$E=mc^2$ 行内 + $$\int$$ 块级公式、hr、YAML frontmatter）。
- 判据 1：md→json→md' 规范化后**逐行一致**；判据 2：md'→json' 与 json **深度相等**（往返稳定）。
- 全部关键节点类型均被解析：table/tableRow/tableHeader/tableCell/taskList/taskItem/codeBlock/inlineMath/blockMath/image/blockquote/heading/bulletList/orderedList/horizontalRule。
- store 无 `@tiptap/extension-table` → 自定义节点接 marked 的 GFM table token（预案生效，见 D8）。
- frontmatter：marked 不解析 YAML → 剥离单独保管、序列化回贴，属预期设计（D9），非缺陷。
- 证据：`spikes/roundtrip-report.txt`、`spikes/roundtrip-output.md`（与输入逐行一致）。

## ③ highlight.js 代码块高亮 NodeView — PASS（jsdom 实测 16/16）

- 脚本：`pnpm spike:nodeview`（jsdom + 真实 Editor 实例 + 真实编辑事务）。
- **机制决策（D7）**：NodeView 负责结构与语言选择器；高亮走 **hljs 输出 → ProseMirror inline decorations**。原因：NodeView 内直接改 contentDOM 的 innerHTML 会被 PM 内容同步覆盖，且 DOM 变更会被 DOMObserver 误读为用户编辑。decorations 由 PM 原生管理（CodeBlockLowlight 同款机制，换用 hljs）。
- 实测覆盖：
  - NodeView 渲染 .code-block 容器 + 语言下拉；
  - **编辑事务（insertText）后高亮 decoration 仍在**、原文本不丢、新插入注释即时高亮为 hljs-comment（核心判据）；
  - select 真实 change 事件 → setNodeMarkup 更新 language → 高亮重建、选择器值同步；
  - 语言别名归一化（hljs listLanguages 只列注册名：ts → typescript；节点 attrs 保留原别名，序列化保真）；
  - language=null → 无高亮 span、文本完整；
  - 真实扩展集（含 CodeBlockHljs）serialize→parse JSON 深度相等。
- 另一发现：tiptap 3 schema 组装是**字段白名单**，Node.create 配置里的任意字段（如 tableRole）会被静默丢弃 → 经 `extendNodeSchema` 钩子注入（D8）。
- `tsc --noEmit` 绿；`vite build` 绿（bundle 2.42 MB / gzip 783 kB：hljs 全量 + katex + CM6 + tiptap，M3 做按需注册与分包）。
- 证据：`spikes/nodeview-report.txt`。

## ④ cargo 离线编译 tauri 空窗 + 解析/高亮 crate — PASS

- `cargo build --offline` 成功（2m46s）：tauri 2.11.5、tauri-build 2.6.3、pulldown-cmark 0.13.4、syntect 5.3.0、notify 6.1.1、chrono 0.4.45、walkdir 2.5.0、regex 1.13.1、rfd 0.15.4 全部离线编译通过。
- Cargo.lock 复制自 MWMD 以锁定传递依赖的缓存版本；新增 walkdir/regex/chrono 直接解析到缓存版本，无缺口。
- `cargo test --offline`：**2/2 通过**（md_to_html：GFM 表格/任务列表/粗体 + syntect 内联配色 span；无语言代码块转义纯文本回退）。渲染模式复用 MWMD 已验证的 pulldown-cmark 事件流 + syntect HighlightLines 管线。
- 图标按 D6 流程：`src/app-icon.svg` → `pnpm tauri icon` → 删 ios/android；tauri.conf.json devUrl=1421、decorations:false、bundle active:false（M3 再开打包）。

## 未验证项（如实标注，R3）

- **GUI 实际观感与真实鼠标/键盘交互未自动验证**（离线环境 browser-use localhost 受限）。已验证到：jsdom 真实编辑事务层 + tsc + vite build + cargo test。
- 预览交接：`pnpm dev` → **http://localhost:1421**（已启动，HTTP 200 确认）。
  - 复现样例：启动即载入中文 GFM 样本（含 frontmatter）；`Ctrl+/` 或顶栏按钮切换 WYSIWYG ⇄ CM6 源码；「往返自检」按钮在浏览器内做 serialize→parse JSON 深度比对；代码块右上角下拉切换语言即时重高亮。
- Tauri 窗口未启动验证（GUI 不可自动核验）；交接命令：`pnpm tauri dev`（需 Node 24 PATH；cargo 侧已验证可编译）。

## 产物索引

| 文件 | 用途 |
|---|---|
| spikes/store-meta.py / platform-stubs.py / materialize.py | 离线安装管线（重装后重跑 materialize.py） |
| spikes/roundtrip.ts / roundtrip-report.txt / roundtrip-output.md | spike ② 脚本与证据（v1.3 起 import src 实现，即真实代码回归测试） |
| spikes/nodeview-dom.ts / nodeview-report.txt | spike ③ 脚本与证据（v1.3 扩至全要素 24/24） |
| src/editor/{extensions,table,code-block,useEditor,SourceMode}.ts(x) | spike 沉淀的真实实现（M1 直接复用） |
| src-tauri/ | spike ④ 脚手架（md_to_html 命令 + 测试 4/4） |

---

## 审查修复补记（2026-11-20，SPEC v1.3）

| 级别 | 问题 | 修复 | 验证 |
|---|---|---|---|
| P0 | Rust 导出 `![alt](src)` 的 alt 子文本泄漏为正文（img 的 alt 误取 title） | 收集 in_image 期间子文本，End(Image) 时输出 img | 新增测试 image_alt_from_children_not_leaked |
| P0 | 代码块 NodeView 无 stopEvent，真实浏览器中语言下拉 mousedown 会被 PM 当成节点选择 | stopEvent 拦截 bar 内事件 | jsdom 无法覆盖真实指针交互，交接人工预览核验 |
| P1 | 导出丢弃 GFM 表格对齐 | Tag::Table(aligns) → th/td text-align | 新增测试 table_alignment_preserved |
| P1 | ENABLE_FOOTNOTES 开启但事件未处理 / raw HTML 静默丢弃 | 关闭 footnotes 选项；Html/InlineHtml 透传 | cargo test 4/4 |
| P1 | 块级公式按行内模式渲染（katexOptions 未传 displayMode）；未完成公式致 NodeView 抛错 | BlockMath displayMode:true；Inline/Block 均 throwOnError:false | jsdom 断言 .katex-display 存在 |
| P1 | 浏览器往返自检用 JSON 深比：getJSON 含 schema 默认 attrs（link.target="_blank"）与 mm.parse 稀疏输出不对称 → 假 FAIL | 判据改 serialize 不动点（文本事实源，§5.1）；源码模式检查当前文本 | 探针证实 serialize 输出与输入逐字一致 |
| P1 | 模式切换无条件 setContent，源码未改也重置光标/undo | lastMdRef 比对，未变跳过重建 | typecheck + build |
| P2 | roundtrip spike 自带表格节点副本，与 src 实现分叉 | 改 import src/editor/extensions | spike ② 复跑 PASS |
| P2 | jsdom 实测仅覆盖代码块 | 增全要素样本：表格 2th/4td、任务 li[data-checked]、KaTeX 行内/块级、图片、serialize 不动点 | 24/24 PASS |

审查中确认的 tiptap 3 行为（非缺陷，断言据此修正）：任务勾选状态渲染在 `li[data-checked]`（input 的 checked 由 NodeView 设 DOM property，不反映为 attribute）；BlockMath 容器为 `.block-math-inner`。

未修（已知项）：decorations 每事务全文重算（M0 文档规模无感，M1 视性能改增量）；bundle 2.42MB（M3 按需注册 hljs + 分包）；frontmatter 起始 `---` 与 hr 的固有歧义（业界惯例同 gray-matter）。

---

## M3 追记（2026-11-21）

| M0 记录的「未修（已知项）」 | M3 实测状态 |
|---|---|
| decorations 每事务全文重算 | **已解决**：M3 把 `code-block.ts` 与 `find-replace.ts` 各一处改为增量重算（仅重算改动块，其余经 `tr.mapping` 平移保留），并以**独立参照**建立逐项等价性闸门（反证工具对 empty/revert/offbyone 三变异全部捕获、none 对照全绿）。注：`focus.ts` 从不属全文重算（O(1) 单 node decoration），M2 结论中的并列归类已在 M3 纠正 |
| bundle 2.42MB（按需注册 hljs + 分包） | **已解决**：`dist/assets/` **2,855,547 → 2,038,539 字节**；**分包已落地**（`vite.config.ts` `manualChunks`）；**KaTeX 字体裁剪 59 → 19 个 woff2、1,072,948 → 256,168 字节（−798KB）**，woff + ttf 回退源归零（`vite.config.ts` 的 `katexWoff2Only` 插件） |
| frontmatter 起始 `---` 与 hr 的固有歧义 | 仍存在（业界惯例同 gray-matter），本轮未改 |

**M0 其余数据的状态**：`cargo test --offline` 2/2 → **M3 已 27 passed / 0 failed / 1 ignored**；jsdom spike ③ 16/16 → 24/24 → **M3 新增 `spikes/regression.ts` 66/66**；bundle gzip 783 kB → 分包后各 vendor 独立分块。

**M3 未运行时验证项**：Tauri 原生窗口 GUI 观感与真实鼠标/键盘交互仍未自动验证（jsdom/无头环境限制，SPEC R5）；**NSIS 打包已验证成功**（`MWTyper_0.1.0_x64-setup.exe` 3.06 MiB，见 `src-tauri/BUILD-LOG.md`）。