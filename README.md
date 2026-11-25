# MWTyper

> 纯本地、纯 `.md` 文件的 **Markdown 写作工具**。所见即所得 / 源码 / 随航三种编辑模式，本地快照历史、跨文件全文搜索、键盘优先的命令面板。

[![Release](https://github.com/sandinsnow/MWTyper/actions/workflows/release.yml/badge.svg)](https://github.com/sandinsnow/MWTyper/actions/workflows/release.yml)

MWTyper 是一款 **Windows 桌面、以 Rust 为主**（Tauri v2 + React）的**纯本地、离线**写作应用。它**不联网、不做账号、不用专有格式**——你写的每一个字都是磁盘上的普通 Markdown 文件，随时能被别的工具读走。

交互体验参考 Typora 的「无缝编辑」：**光标落在哪里，就在哪里直接写字**，不跳出源码视图。但在此之上补了三件 Typora 没有的东西：

- **本地快照历史** —— 每次保存前自动留档，误删误改可以回滚，还能看 diff。
- **跨文件全文搜索** —— Rust 侧并行扫描整个工作区，正则 / 全词 / 大小写敏感，结果按文件分组、点击直达行号。
- **命令面板** —— `Ctrl+Shift+P` 模糊搜索全部命令，键盘上下选、回车执行。

---

## 三种编辑模式

标题栏中间是一个三分段控件，三者是**同一个编辑器的三种状态**，随时切换、文本无损。

| 模式 | 键 | 说明 |
|---|---|---|
| **所见即所得** | `Ctrl+/` | 默认。标题、粗体、表格、公式、代码块全部渲染成最终样式，光标所在处即编辑处。 |
| **源码** | `Ctrl+/` | CodeMirror 6 驱动的纯 Markdown 编辑器，带语法高亮、行号、查找栏。 |
| **随航** | `Ctrl+Shift+/` | 源码 ｜ 实时预览**并排**，滚动联动，分栏可拖拽。适合边改边校对。 |

两个模式**以文本为唯一事实源**：切换时经 `@tiptap/markdown` 序列化 / 解析，往返不丢内容（GFM 表格、任务列表、KaTeX 公式、frontmatter 均为必测项）。源码未改动时切回不重建文档，光标与 undo 栈都保留。

随航模式下 **CodeMirror 是事实源、右侧预览退化为只读**，编辑只在左边发生，滚动双向联动（单向锁 + 冷却窗口，防正反馈抖动）。

---

## 特性

- **所见即所得编辑**：标题 1–6、粗体 / 斜体 / 删除线 / 行内代码 / 下划线、有序 / 无序 / 任务列表（可勾选）、引用、分割线、链接、图片、代码块（带语言选择与语法高亮）、GFM 表格（可视化增删行列）、行内 / 块级公式（KaTeX）。
- **三种编辑模式**：所见即所得 / 源码 / 随航并排，随时无损切换。
- **本地快照历史**：保存前自动快照，保留最近 50 条 + 每日末条 30 天；时间轴浏览、**红绿行 diff**、一键恢复（恢复前自动再快照一次，绝不丢原稿）。
- **跨文件全文搜索**：Rust 侧 `walkdir + regex` **并行**扫描工作区，支持大小写 / 全词 / 正则开关，按文件分组，显示行号与上下文片段，点击直达。
- **命令面板**：`Ctrl+Shift+P` 模糊子序列打分，含最近文件、模式切换、导出、快照、主题等 19+ 条命令，↑↓ 选择、回车执行。
- **大纲 / 快速打开**：侧栏实时大纲（当前节高亮、点击跳转）；`Ctrl+P` 模糊搜索工作区文件。
- **文件内查找替换**：源码模式用 CodeMirror 原生查找栏；所见即所得内也有等价实现（中文全词匹配正确、表格表头不被抢占、替换文本含换行不拆段）。
- **主题系统**：**58 个颜色令牌的单一事实源**。内置 5 套主题（暖阳 / 青瓷 / 暮紫 / 石墨 / 海盐），**每套都含深浅两套**；切换主题时**整个应用框架**（标题栏、侧栏、状态栏、编辑区、代码块、查找高亮、标记符配色）全部跟随。
- **自定义主题**：把 `.css` 丢进用户主题目录即热加载生效。推荐用**基色写法**（只给 3 个颜色，其余 54 个令牌由系统派生，深浅自动配比），旧的「逐个令牌覆盖」写法完全兼容。
- **导出单文件 HTML / PDF**：HTML 内联全部 CSS 与图片（单文件可离线分发）；PDF 走系统 WebView2 打印通道。
- **专注模式 / 打字机模式**：`F8` 让当前段落高亮、其余段落降透明度；`F9` 让当前行始终滚动到视口中央。状态栏有明确指示。
- **无边框自定义标题栏**：菜单整合进标题栏，按钮分主次（保存是唯一实心主按钮，其余 ghost），窗口按钮用内联 SVG 绘制（字符字形在 `line-height:1` 下基线飘忽、大小对不齐）。
- **数据安全**：原子保存（临时文件 + rename）、失焦即存、自动保存定时器按标签隔离、外部变更冲突提示（可保留我的 / 重新加载）、删除走工作区 `.mwtyper/trash/` 而非直接抹除。
- **便携单文件**：免安装绿色 exe，放任意目录双击即用。

---

## 下载使用（Windows）

1. 到 [Releases](https://github.com/sandinsnow/MWTyper/releases) 下载最新的 `MWTyper.exe`（单文件，8.7 MiB）。
2. 双击运行。**唯一前置**：系统需已安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 11 与较新的 Windows 10 已内置）。
3. 首次启动点侧栏「文件」页工具栏的 **打开文件夹**，选一个包含 `.md` 的目录作为工作区。

> 程序本身**不写任何注册表、不装服务、不建快捷方式**；设置与快照都放在工作区的 `.mwtyper/` 目录里，删掉工作区就等于彻底卸载。

---

## 从源码构建

### 环境要求

- **Windows 10/11**
- **Rust**（MSVC 工具链，host `x86_64-pc-windows-msvc`）
- **Node.js 20+** 与 **pnpm 10**
- **WebView2 Runtime**（开发调试同样需要）

### 命令

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm tauri dev

# 类型检查
pnpm typecheck

# 构建便携单文件 exe（跳过安装器打包）
pnpm tauri build --no-bundle
```

构建产物：`src-tauri/target/release/mwtyper.exe`（已内嵌前端资源与图标，重命名后即可作为 `MWTyper.exe` 分发）。

> 本项目采用**单文件交付**：`tauri.conf.json` 里 `bundle.active` 置为 `false`，`tauri build` 会跳过打包阶段，**不产安装包**。NSIS 配置仍保留在文件中，改回 `true` 即可恢复安装器打包。

### 运行测试

```bash
# Rust 后端
cd src-tauri && cargo test

# 前端 / 跨层闸门（jsdom，无需浏览器）
pnpm test

# 真实浏览器闸门（需要 Chromium，见下）
pnpm test:browser
```

**前端测试没有用 Vitest / Testing Library** —— 那是本项目的硬性离线约束（依赖不可得）。改用 `jsdom@31` + `tsx` 手写挂载测试，断言数不打折：

| 闸门 | 位置 | 规模 |
|---|---|---|
| QA 独占资产（不得改动） | `spikes/audit3.ts`、`spikes/qa4-probe.ts`、`spikes/regression.ts` | 104 / 121 / 66 项 |
| 里程碑探针 | `spikes/m1-editor.ts`（73 断言）、`spikes/m1-ipc.ts`、`spikes/roundtrip.ts`、`spikes/nodeview-dom.ts` | 不动点 + 全要素 |
| 编辑器专项 | `tests/spikes/editor-probe.ts` / `2` / `3`、`verify-qa.ts`、`serde-probe.ts`、`serde-spotcheck.ts` | 11 / 6 / 18 / 14 / 55 / 23 项 |
| 真实浏览器（Chromium） | `tests/browser/*.cjs` | 263 项断言 + 若干取证脚本 |

浏览器闸门需要 Playwright 与 Chromium。脚本会自动探测本机已有的 Playwright 安装（项目 `node_modules`、环境变量 `PLAYWRIGHT_CORE_PATH` / `PLAYWRIGHT_CHROMIUM_EXE`、或 WorkBuddy 自带发行版）；都没有时执行：

```bash
npm i -D playwright && npx playwright install chromium
```

探测逻辑集中在 `tests/browser/pw.cjs`，每个探针只需 `require("./pw.cjs")`。

---

## 快捷键

| 键 | 作用 | 键 | 作用 |
|---|---|---|---|
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | 新建 / 打开 / 保存 | `Ctrl+Shift+S` | 另存为（**新建标签**，不改写当前路径） |
| `Ctrl+/` | 所见即所得 ⇄ 源码 | `Ctrl+Shift+/` | 随航（并排） |
| `Ctrl+B` / `Ctrl+I` | 粗体 / 斜体 | `Ctrl+Shift+X` / `Ctrl+E` / `Ctrl+U` | 删除线 / 行内代码 / 下划线 |
| `Ctrl+K` | 插入链接 | `Ctrl+1…6` / `Ctrl+0` | 标题级别 / 正文 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换 | `Ctrl+Shift+F` | 跨文件搜索 |
| `Ctrl+P` | 快速打开文件 | `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+Shift+H` | 快照历史面板 | `Ctrl+,` | 设置面板 |
| `Ctrl+\` | 侧栏折叠 | `Ctrl+=` / `Ctrl+-` | 编辑区缩放（行宽恒定） |
| `F8` / `F9` | 专注模式 / 打字机模式 | `Esc` | 关闭面板 / 退出浮层 |

---

## 主题系统

应用共有 **58 个颜色令牌**，全部由 CSS 变量派生。自定义主题推荐**基色写法**——只声明 3 个颜色，其余由系统推导，深浅两套自动配比：

```css
:root {
  --mw-base-bg: #fbf1d8;        /* 主底色（浅色模式） */
  --mw-base-fg: #4a4235;        /* 主文字色（不给则由底色派生） */
  --mw-base-accent: #b58900;    /* 强调色 */
}
/* 可选：显式给暗色基色；不给则由系统自动派生（压暗底色、提亮强调色） */
[data-theme="dark"] { --mw-base-bg: #241f18; --mw-base-fg: #e8dfd0; --mw-base-accent: #e0b155; }
```

系统据此推导标题栏 / 侧栏 / 状态栏 / 编辑区 / 代码块 / 查找高亮 / 标记符配色等全部令牌，并做**对比度兜底**（正文与强调色 ≥ 4.5:1，不达标自动调明度；强调色同时出现在编辑区与应用两种底色上，取更严的那个校验）。

主题文件放在 `%APPDATA%\MWTyper\themes\`（设置面板有「打开主题目录」按钮），**文件监听热加载**，写入即生效。内置 5 套主题在 `examples/themes/`，已**编译进 exe**——设置面板点「安装内置主题」即可写入用户主题目录（已存在的同名文件不覆盖）。

---

## 发布流程

推送 `v*` 标签（如 `v0.1.0`）即触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)：在 `windows-latest` 上构建便携 exe、计算 SHA256、生成 `latest.json`，并把 `MWTyper.exe`、`MWTyper.exe.sha256`、`latest.json` 发布到 GitHub Releases。

[`ci.yml`](.github/workflows/ci.yml) 负责每次 push / PR 的质量闸门：类型检查、Rust 测试、全部 jsdom 闸门、便携 exe 构建。

> **自动更新现状**：当前为「检查更新 + 提示 + 打开下载页」的 MVP。完整的「下载 → 校验 → 自替换重启」与 minisign 更新签名仍在路线图上。

---

## 项目结构

```
src/                     # React 前端
  editor/                # tiptap 封装、CodeMirror 源码模式、扩展、选区/光标工具
  sidebar/               # 文件树、大纲、搜索面板、快照历史
  statusbar/ commands/   # 状态栏、命令面板
  theme/                 # 颜色令牌派生与主题注入
  ui/                    # 无边框标题栏、模式分段控件、菜单、Modal 等 UI 原语
  help/ settings/        # 帮助中心、设置面板
src-tauri/               # Rust 后端
  src/fs.rs              # 文件树、读写、原子保存、回收站删除、图片 assets
  src/search.rs          # 跨文件并行搜索
  src/snapshot.rs        # 快照存取、去重、修剪
  src/export.rs          # md → 单文件 HTML
  src/stats.rs           # 字数、字符、阅读时长
  src/watch.rs           # 目录监听（300ms 防抖 + 噪声过滤）
  src/themes.rs          # 内置主题（编译期嵌入）与用户主题目录
  src/app.rs             # 应用信息、更新清单
tests/
  spikes/                # jsdom 闸门（无浏览器依赖）
  browser/               # 真实浏览器闸门（Playwright + Chromium）
spikes/                  # 里程碑探针与 QA 独占资产
examples/themes/         # 5 套内置主题（深浅各一套）
scripts/                 # CI 辅助（latest.json 生成）
docs/                    # 系统设计、类图/时序图、历轮审查与验收报告
SPEC.md                  # 完整产品与技术规格（活文档，含决策记录与变更记录）
```

---

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri v2（Rust + WebView2），`decorations: false` 自绘标题栏 |
| 前端 | React 18、TypeScript、Vite 6（无 UI 组件库，UI 原语自写） |
| 所见即所得编辑 | tiptap 3（vanilla core，自写薄封装，无 `@tiptap/react`） |
| 源码编辑 | CodeMirror 6 + `@codemirror/lang-markdown`（GFM 解析器） |
| 表格 | 自定义节点接 marked GFM token + `prosemirror-tables` 命令 |
| 公式 | KaTeX（woff2 字体裁剪，59 → 19 个，省 798 KB） |
| 代码高亮 | highlight.js（行内装饰增量更新） |
| 文件 IO / 搜索 / 快照 | Rust std + walkdir + regex + serde（搜索已并行化） |
| 打包 | Tauri 单文件 exe，**不产安装包** |

---

## 明确的非目标

为坚守「纯本地、离线、纯 `.md`」，以下能力**一律不做**：

- ❌ 云同步 / 账号 / 多人协作
- ❌ 专有格式（`.mwtyper` 之类）—— 文件永远是标准 Markdown
- ❌ Mermaid 图表渲染（离线依赖不可得）
- ❌ DOCX 原生导出引擎（PDF 走 WebView2 打印通道）
- ❌ 云端 AI / 在线素材库 / 图床

跨平台（macOS / Linux）打包为后期路线图，架构上已预留（平台相关代码全部收敛在 Rust 侧）。详见 [`SPEC.md`](SPEC.md)。

---

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
