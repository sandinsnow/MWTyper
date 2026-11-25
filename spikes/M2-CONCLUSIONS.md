# M2 特色期 — 验证结论与预览交接（2026-11-20）

对应 SPEC v1.5 §8 M2 行。范围：快照历史+diff、命令面板、跨文件搜索、专注/打字机、导出 HTML/PDF、多标签、写作目标。

## 1. 交付清单

| 模块 | 文件 | 说明 |
|---|---|---|
| 跨文件搜索（Rust） | `src-tauri/src/search.rs` | walkdir + regex::bytes 字节级匹配；大小写/全词/正则/limit（默认 500 截断）；忽略规则同文件树；返回 hits/truncated/files_scanned/elapsed_ms |
| 快照（Rust） | `src-tauri/src/snapshot.rs` | DefaultHasher 去重；保留最近 50 + 每日末条 30 天；id 字符白名单校验；存工作区 `.mwtyper/snapshots/<路径哈希>/` |
| 导出（Rust） | `src-tauri/src/export.rs` | 复用 render_md；本地图片 base64 内嵌（跳过 data:/http:）；亮暗 + 打印 CSS |
| 导出（前端） | `src/export.ts` | KaTeX renderToString 注入（围栏/行内代码保护）；katex.min.css woff2 字体 base64 内嵌；PDF = 隐藏 iframe 系统打印 |
| 行级 diff | `src/diff.ts` | LCS DP；>4M 格退化为整删整增 |
| 历史面板 | `src/sidebar/HistoryPanel.tsx` | 时间轴（自动/手动徽标）→ 居中浮层 diff/预览双页签 → 恢复（恢复前自动再快照） |
| 搜索面板 | `src/sidebar/SearchPanel.tsx` | 300ms 防抖；Aa/ab/.* 开关；按文件分组；点击直达源码模式对应行；耗时脚注 |
| 命令面板 | `src/commands/Palette.tsx` | Ctrl+Shift+P；19 命令（含最近文件）；子序列模糊打分；↑↓/Enter/Esc |
| 专注模式 | `src/editor/focus.ts` | PM 节点装饰 focus-current，兄弟块 opacity .35；F8 |
| 打字机滚动 | `src/App.tsx` effect | coordsAtPos → 编辑区垂直居中；F9 |
| 多标签 | `src/App.tsx` | 单 tiptap 实例 + 缓冲暂存（D13）；脏标签关闭确认 |
| 写作目标/会话 | `src/statusbar/StatusBar.tsx` | 目标进度条（prompt 设置，0 关闭）；本次 +N 字 · M 分钟（基线=打开/切换时） |
| 设置扩展 | `src-tauri/src/fs.rs` | goal_words / focus_mode / typewriter_mode / snapshot_keep / snapshot_days（serde 默认值兼容旧配置） |

## 2. 验证矩阵

| 项 | 结果 | 证据 |
|---|---|---|
| Rust 单元 | **18/18 PASS** | `cargo test --lib`（fs 3 / stats 4 / search 3 / snapshot 2 / export 2 / lib 4；另有 1 个 #[ignore] 万文件基准） |
| 万文件搜索基准 | 见 §3 | `cargo test bench_10k_files -- --ignored --nocapture`（生成 10000 md ≈ 20MB，跑完自清理） |
| mock IPC spike | **15/15 PASS** | `pnpm spike:m1ipc` |
| 编辑增强 spike | **13/13 PASS** | `pnpm spike:m1editor` |
| 往返保真 | **PASS（不动点）** | `pnpm spike:roundtrip` |
| tsc / build | 绿 | bundle 2.51MB（gzip 811KB），分包押 M3 |

> **M3 追记（2026-11-21）**：本表为 M2 期原始实测，**已被 §6.1 的 M3 实测更新取代**（分包与字体裁剪已落地，NSIS 打包已验证成功）。下表按 M2 当时口径保留为历史记录。
| 浏览器 mock 全链路 | 全部通过 | 见 §4 逐条 |

## 3. 搜索性能实测报数（验收项）

> **M3 追记（2026-11-21）**：本表为 M2 期（**单线程**）原始实测，已被 §6.2 的 M3 并行化实测取代——
> **M3 重跑：全量冷 635–756ms / 热 736–761ms / 正则 425–514ms / 截断 36–37ms**，
> 且「最坏全量扫描未稳定达 <1s」的旧结论**已不再成立**。下表按 M2 当时口径保留为历史记录。

基准环境：本机 Windows，temp 目录 10000 个 .md（100 子目录 × 100 文件，每文件 20 行中英混排 ≈ 2KB）。

| 场景 | 耗时 | 备注 |
|---|---|---|
| 全量扫描（稀有词，必须读完 10000 文件）冷 | **1268 ms** | 首次运行另测得 1132/1560ms，方差来自 Defender/文件缓存 |
| 全量扫描 热缓存 | **1200 ms** | |
| 正则全量扫描（10 万命中） | **853 ms** | |
| 常见词 + 默认 limit 500 | **7 ms** | 提前截断，日常交互路径 |

**结论（如实）**：默认截断路径远优于目标；最坏全量扫描 0.85–1.6s，**未稳定达到 <1s**。主因是 Windows 单线程逐文件读 + 实时扫描开销，非匹配本身。已做字节级匹配优化（D12）；并行读取列 M3。基准测试保留在仓库可复跑。

## 4. 浏览器 mock 全链路实测（隐藏视口，合成事件驱动）

1. 打开文件夹 /demo → 打开 欢迎.md → **自动快照 141B**（打开触发）。
2. 追加文本 → 保存 → **手动快照 147B**，文件内容落盘一致；状态栏「本次 +6 字」基线正确。
3. 历史面板两条记录（手动/自动徽标）→ 点开旧快照 → diff 浮层：绿「+追加验证句。」红「-」（快照独有空行）→ **恢复**：文件回退 141B、编辑器同步、浮层关闭；恢复前快照因哈希相同正确去重。
4. 搜索面板输入 MWTyper → 「2 处命中 · 2 文件 · 0ms」，按文件分组；点击第 10 行命中 → 自动切源码模式，CM 活动行 = `const hello = "MWTyper";`。
5. Ctrl+Shift+P → 面板 19 命令；输入「导出」过滤出 2 条；执行导出 HTML → `/demo/欢迎.html` 落盘 370KB（含内嵌 KaTeX 字体），面板自动关闭。
6. F8 → editor-area 加 focus-mode、当前段落带 focus-current（P 节点）；再 F8 → 复原；设置持久化 focus_mode=false。F9 → typewriter_mode=true 持久化。
7. 命令面板「设置写作目标」→ prompt 100 → 状态栏进度条 **65%**（65/100 字）。
8. 命令面板「导出 PDF」→ iframe 创建-打印-移除链路无错（隐藏浏览器 print 为空操作）。

**测试坑记录**：隐藏页定时器节流 → 300ms 防抖/120ms 跳转需等待 ≥1s 再断言；ProseMirror DOMObserver flush 同样被节流 → 合成 insertText 后须等 ~1.5s 再保存，否则序列化读到旧文档（非应用缺陷）。

## 5. 已知限制与未验证项（如实标注）

- **PDF 打印对话框**：隐藏浏览器中 print() 为空操作，代码链路验证无错；实际对话框/分页效果需 Tauri 窗口人工确认。
- **Tauri 窗口 GUI**：本期全部 UI 验证走浏览器 mock（localStorage 后端）；真实窗口文件链路 M1 已验证，M2 新增命令均为同构 IPC，未在本机 GUI 复验（离线环境 GUI 自动化受限，R3）。
- undo 栈不跨标签保留（D13，单实例代价）。
- 浏览器 mock 中 assets 相对路径图片不解析（Tauri 窗口正常，M1 已记录）。
- ~~专注模式装饰随事务全文重算（M0 规模够用，M3 优化）~~ → **该表述不精确，M3 已纠正**：真正做**全文重算**的只有 **2 处**——`code-block.ts`（`tr.docChanged ? highlightDecorations(tr.doc)`，内含 `doc.descendants` 全文遍历）与 `find-replace.ts`（`computeMatches(tr.doc, ...)`）。**`focus.ts` 不在此列**：它只 `doc.resolve(pos)` 后创建 1 个 `Decoration.node`，无 descendants 遍历，成本近似 **O(1)**，无需优化（架构师与 QA 均已确认）。**M3 已把上述 2 处改增量**（见 §7）。
- mock 的 export_html 为粗简化（pre 包裹）；真实渲染在 Rust 侧，浏览器预览的导出产物不含排版 CSS 之外的 Rust 渲染结果。

---

## 6. M3 增补（2026-11-21 追记）

> 本节为 M3 打磨轮的回填，纠正 §2/§3/§5 中的过时数据。**所有数值均为本轮实测**，非估算。

### 6.1 §2 验证矩阵的 M3 更新

| 项 | 原记录 | M3 实测（2026-11-21） |
|---|---|---|
| Rust 单元 | 18/18 PASS | **27 passed / 0 failed / 1 ignored**（ignored = `search::bench_10k_files` 基准） |
| mock IPC spike | 15/15 PASS | 15/15 PASS（不变） |
| 编辑增强 spike | 13/13 PASS | **PASS，断言数 73**（基线自检 4 + 8 场景 × 7 + 前置表格/快捷键/链接 13；B2 闸门重写后） |
| 往返保真 | PASS（不动点） | PASS（不变） |
| tsc / build | 绿，bundle 2.51MB（gzip 811KB），分包押 M3 | **绿**；bundle **2.51MB → 1.94 MiB**（`dist/assets/` 2,855,547 → **2,038,539 字节**），**分包已落地**（`vite.config.ts` `manualChunks`）；字体裁剪 **−798KB** |
| jsdom 回归 | （M2 时尚无） | **新增 `spikes/regression.ts`，66/66 PASS** |
| NSIS 打包 | （M2 时尚未涉及） | **两步均成功**：`--no-bundle` → `mwtyper.exe` 8.68 MiB；完整 build → `MWTyper_0.1.0_x64-setup.exe` 3.06 MiB |

### 6.2 §3 搜索性能实测报数（M3 重跑，并行化后）

原记录（M2，单线程）：全量冷 1268ms / 热 1200ms / 正则 853ms / 截断 7ms。
**M3 重跑实测（`cargo test bench_10k_files -- --ignored --nocapture`，并行化后，两轮）**：

| 场景 | M2 实测（单线程） | **M3 实测（并行）** | 变化 |
|---|---|---|---|
| 全量扫描 冷 | 1268 ms | **635 – 756 ms** | **约 2× 提速** |
| 全量扫描 热缓存 | 1200 ms | **736 – 761 ms** | **约 1.6× 提速** |
| 正则全量扫描（10 万命中） | 853 ms | **425 – 514 ms** | **约 1.8× 提速** |
| 常见词 + 默认 limit 500 | 7 ms | **36 – 37 ms** | 略升（并行调度开销），仍远优于 1s 目标 |

**结论更新**：M2 时的「最坏全量扫描**未稳定达 <1s**」结论**已不再成立**——M3 并行化后**最坏全量扫描稳定进入 <1s**（635–761ms）。截断路径因并行调度固定开销由 7ms 升至 36–37ms，为毫秒级劣化，对日常交互无感知。并行实现见 `src-tauri/src/search.rs:70`（`available_parallelism().min(8)`）+ `:77`（`std::thread::scope` 分块）。

### 6.3 M3 交付的其他能力（对应 SPEC §8 M3 行与 §12 v1.6）

- **搜索并行化**：✅ 已完成（`search.rs` `thread::scope` + 分块）。
- **bundle 分包**：✅ 已完成（`vite.config.ts` `manualChunks` → vendor-katex / vendor-hljs / vendor-codemirror / vendor-tiptap / vendor-react / vendor）。
- **字体裁剪**：✅ 已完成 —— KaTeX 字体 **59 → 19 个文件**（仅 woff2），**1,072,948 → 256,168 字节，省 798KB**；woff + ttf 回退源归零。实现：`vite.config.ts` 的 `katexWoff2Only` 插件（`enforce: "pre"`，剥离 `katex.min.css` 的 `url(fonts/*.woff)` / `url(fonts/*.ttf)` 回退源）。
- **NSIS 打包**：✅ **验证成功，非降级**。产物：`src-tauri/target/release/mwtyper.exe`（9,099,264 字节 = 8.68 MiB）、`src-tauri/target/release/bundle/nsis/MWTyper_0.1.0_x64-setup.exe`（3,210,555 字节 = 3.06 MiB）；NSIS `installMode: currentUser`，语言 SimpChinese + English。完整日志与结论见 `src-tauri/BUILD-LOG.md`。
- **装饰增量**：✅ `code-block.ts` 与 `find-replace.ts` 各一处全文重算改增量（§5 的 focus.ts 误归类已纠正）。
- **后端安全**：E05 导出属性转义、E11 导出图片路径穿越防护、E06 搜索截断标记，均已落地并有 Rust 单测覆盖。

### 6.4 M3 新增验证证据

| 命令 | 结果 |
|---|---|
| `cargo test --lib` | **27 passed / 0 failed / 1 ignored** |
| `spikes/regression.ts`（QA 新增 jsdom 回归） | **66/66 PASS**（D-gate-1~6 静态守卫全 OK；含 QA 新增 D-gate-5「闸门不读 d.spec.class」与 D-gate-6「code-block 的 class 必须在 attrs 位」） |
| `spikes/m1-editor.ts` | PASS，**73 条断言**全绿（基线自检 4 + 8 场景 × 7 + 前置表格/快捷键/链接 13；B2 闸门重写：独立参照 + 非空断言 + 逐项位置比对 + `textBetween` 复核） |
| `spikes/m1-ipc.ts` / `spikes/roundtrip.ts` / `spikes/nodeview-dom.ts` | 15/15 PASS / 不动点 PASS / 全要素 PASS |
| `tsc --noEmit` | 0 error / 0 warning |
| `vite build` | 绿（8.79s） |
| `.workbuddy/falsify/run-falsify.mjs`（反证） | 改造后闸门对 `empty`/`revert`/`offbyone`/`hljsclass` **四变异全部捕获**（查找组 40/40/26/7 条失败），`none` 对照 **0 失败** |
| `tauri build --no-bundle` / `tauri build` | **均成功**（见 6.3） |

### 6.5 M3 未运行时验证项（如实）

- Tauri 原生窗口的**剪贴板 / 拖拽 DataTransfer**、**原生对话框**、**WebView2 打印对话框实际效果**、**窗口整体观感**——jsdom/无头环境无法复现，**需真实窗口手工确认**（SPEC R5）。
- WYSIWYG 查找替换**仍不支持跨节点命中**（逐文本节点匹配，与多数编辑器首版一致）。

---

## 7. 预览交接

- **dev 地址**：`http://localhost:1421/`（后台运行中；重启：`pnpm dev`，需 Node 24 PATH：`/c/Users/Admin/scoop/persist/nvm/nodejs/v24.20.0`）。
- **协议**：无 Tauri 运行时自动落 localStorage mock（键 `mwtyper-mock-fs/-settings/-snaps`）；演示工作区 `/demo`（标题栏「文件夹」按钮一键进入）。真实文件操作请 `pnpm tauri dev`。
- **复现样例**（对应 §4）：
  1. 文件夹 → 欢迎.md → 改几个字 → Ctrl+S → 侧栏「历史」→ 点旧快照 → 看 diff → 恢复。
  2. 侧栏「搜索」→ 输 `MWTyper` → 点命中行（跳源码模式定位）。
  3. Ctrl+Shift+P → 输「导出」→ 导出 HTML（mock 落 `/demo/欢迎.html`）。
  4. F8 专注 / F9 打字机；面板「设置写作目标」输 100 → 状态栏进度条。
  5. 多标签：Ctrl+N 新建 → 点标签切换（脏标签关闭有确认）。
- **基准复跑**：`cd src-tauri && cargo test bench_10k_files -- --ignored --nocapture`。