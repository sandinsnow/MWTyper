# M1 核心写作 — 验证结论（2026-11-20；2026-11-21 M3 追记）

> **追记说明**：本文为 M1 期的历史结论，主体保留 M1 当时的实测数据。**§0 追记**列出 M3 打磨轮
> （2026-11-21）对这些数据的更新；标注「押后 M3」的项在 M3 已全部落地。
> M1/M2 期的完整实测数据与当时的限制分析见 `spikes/M2-CONCLUSIONS.md`。

## 0. M3 追记（2026-11-21）

| M1 原记录 | M3 实测更新 |
|---|---|
| Rust 命令 `cargo test --offline` **11/11** | **27 passed / 0 failed / 1 ignored**（含 E05/E06/E11 后端安全、A10 asset scope、C7 新增单测） |
| `pnpm spike:nodeview` **24/24** | PASS（不变）；另新增 jsdom 回归 `spikes/regression.ts` **66/66** |
| `pnpm spike:m1editor` **13/13** | PASS，**断言数 73**（B2 闸门重写后：基线自检 4 + 8 场景 × 7 + 前置表格/快捷键/链接 13；含独立参照 + 非空断言 + 逐项位置比对 + `textBetween` 复核） |
| `pnpm spike:m1ipc` **15/15** | 15/15 PASS（不变） |
| `pnpm spike:roundtrip` 不动点 PASS | PASS（不变） |
| `pnpm typecheck` / `pnpm build` 绿，**bundle 2.44MB（M3 优化）** | 绿；bundle **2,855,547 → 2,038,539 字节**（`dist/assets/`），**字体裁剪 −798KB**（KaTeX 59→19 个 woff2）、**分包已落地**（`vite.config.ts` `manualChunks`） |
| 已知限制「**decorations 每次事务全文重算**（M0 规模够用，M3 增量）」 | **已解决**：M3 把 `code-block.ts` 与 `find-replace.ts` 各一处改为增量重算，并以**独立参照**建立逐项等价性闸门（反证工具对 empty/revert/offbyone 三变异全部捕获）。注：`focus.ts` 从不属全文重算（O(1) 单 node decoration），M2 结论中的并列归类已在 M3 纠正 |
| 已知限制「**bundle 2.44MB**（hljs 全量 + katex + CM6 + tiptap）」 | **已解决**：分包 + 字体裁剪后降至 1.94 MiB |
| 已知限制「**监听单目标**」 | 仍存在（工作区优先，单文件监听其目录），本轮未改 |
| 已知限制「**表格为均匀网格**」 | 仍存在（GFM 无法表达 colspan），本轮未改 |

**M3 新增（不在 M1 范围）**：数据安全三件套（D1/D3/E01）、后端安全 E05/E06/E11、A10 asset scope 收窄 + A11 watch debounce、C7 打开主题目录、渲染谓词阶段一（D2）、UI 原语统一（15 处原生弹窗清零）、标题栏图标化、a11y 补齐、响应式与侧栏宽度可调、**NSIS 打包验证成功**（`MWTyper_0.1.0_x64-setup.exe` 3.06 MiB）。

**M3 未运行时验证项**：Tauri 原生窗口的剪贴板/拖拽 DataTransfer、原生对话框、WebView2 打印对话框实际效果、窗口整体观感——jsdom/无头环境无法复现，需真实窗口手工确认（SPEC R5）。

## 1. 自动验证矩阵（全绿）

| 项 | 命令 | 结果 |
|---|---|---|
| Rust 命令（fs/stats/watch/md_to_html） | `cargo test --offline`（src-tauri 目录） | 11/11 |
| 编辑器全要素 DOM（M0 回归） | `pnpm spike:nodeview` | 24/24 |
| md⇄tiptap 往返不动点（M0 回归） | `pnpm spike:roundtrip` | PASS |
| 表格工具栏命令 + Ctrl+1…6/0 + Ctrl+K | `pnpm spike:m1editor` | 13/13 |
| 浏览器 mock IPC 文件链路 | `pnpm spike:m1ipc` | 15/15 |
| 类型 / 产物 | `pnpm typecheck` / `pnpm build` | 绿（bundle 2.44MB，M3 优化） |

## 关键发现（已沉淀 SPEC D8 修正）

1. **extendNodeSchema 全节点污染**：tiptap 3 对每个节点调用所有扩展的 extendNodeSchema；钩子不按 `ext.name` 守卫时，最后一个钩子（TableCell 的 "cell"）覆盖全部节点 spec，连 paragraph 都带 tableRole → pm-tables 的 isInTable/selectedRect 全失效。M0 往返测试不依赖 tableRole 故未暴露；M1 接 pm-tables 命令时才炸出。
2. **单元格 attrs**：pm-tables TableMap 依赖 colspan/rowspan 计算网格，自定义单元格必须声明（default 1）。
3. **自写噪声**：自动保存触发 notify 事件 → 若静默重载会重置光标。抑制策略=事件到达时读文件与 lastSavedText 比对，相同忽略；脏状态则走冲突横幅。

## 未自动验证项（需真实窗口/浏览器手工确认）

- 代码块语言下拉的真实鼠标操作（stopEvent 已加，jsdom 无指针层）。
- 图片粘贴/拖拽的真实剪贴板与 DataTransfer（jsdom 无法构造；逻辑路径：有工作区→assets 相对路径，无→data URL）。
- rfd 原生对话框、notify 外部变更冲突横幅、WebView2 窗口整体观感。
- 亮暗主题切换的视觉效果（CSS 变量已全量替换，computed 级未截图）。

## 预览交接

- 地址：http://localhost:1421（`pnpm dev`，Node 24 PATH；浏览器模式走 localStorage mock，种子工作区 /demo）。
- Tauri 真实窗口：`pnpm tauri dev`（首次编译约 3 分钟）。
- 复现样例：打开「文件夹」→ /demo（mock）或任意真实目录 → 打开 欢迎.md → 输入触发 1s 自动保存 → Ctrl+/ 切源码 → Ctrl+F 搜索 → 光标入表浮现表格工具栏 → Ctrl+1 标题 → 粘贴图片。
- mock 限制：assets 相对路径图片在浏览器不解析（Tauri 窗口正常）；mock 统计为近似实现，真实统计走 Rust。

## 已知限制（押后）

> **M3 追记（2026-11-21）**：本节「押后」项的当前状态见 §0 追记表——**decorations 全文重算**与 **bundle 2.44MB** 两项**已在 M3 解决**（增量改造 + 分包 + 字体裁剪 −798KB）；下列原文按 M1 当时口径保留，作为历史记录。

- 监听单目标：工作区优先；打开工作区外单文件时监听切到其目录（M2 可多路）。**（M3 未改，仍在）**
- decorations 每次事务全文重算（M0 规模够用，M3 增量）。**（M3 已解决：改为增量 + 独立参照等价性闸门）**
- bundle 2.44MB：hljs 全量 + katex + CM6 + tiptap（M3 按需注册 + manualChunks）。**（M3 已解决：分包 + 字体裁剪，`dist/assets/` 降至 2,038,539 字节）**
- 表格为均匀网格：未暴露合并单元格（GFM 无法表达 colspan）。**（M3 未改，仍在）**