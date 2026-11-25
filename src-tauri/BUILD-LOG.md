# MWTyper 构建日志（B1 打包验证 · v1.7 单文件交付）

> 本文件是 **T05 回填 SPEC 的输入**：T05 需据此把「可打包性」结论写回规格文档的构建章节。
> 记录时间：**2026-11-23（v1.7，交付形态改为单文件可执行程序）**；初次记录 2026-11-20（B1）；环境：Windows / 离线（`CARGO_NET_OFFLINE=true`）。
>
> **交付形态变更（2026-11-23，用户明确要求「要做成单文件应用，不要 setup」）**：
> 本项目最终交付物是**单个可执行文件** `release/MWTyper.exe`，**不产出安装包（NSIS setup / MSI）**。
> `src-tauri/tauri.conf.json` 的 `bundle.active` 已置为 `false`，`tauri build` 默认**跳过整个 bundle 阶段**，
> 因此不会再生成任何 `*-setup.exe`；`bundle.windows.nsis` 配置保留在文件中（不删除），
> 将来若需要安装包，把 `bundle.active` 改回 `true` 即可，无需补配置。
>
> **§1–§7 是 2026-11-20 的 B1 首轮打包原始记录（保留不改，作为可追溯基线；其中的 NSIS 安装包数据已被 §8 取代）**；
> **§8 是 2026-11-23 第 3/4 轮缺陷修复后的重建记录（当前有效）**——本轮改动了 Rust 侧（`fs.rs` 的 `set_parent` 与新增单测）与前端侧（`App.tsx` / `FileTree.tsx` / `Palette.tsx` / `Modal.tsx` / `styles.css`），**旧产物不含这些修复，必须重新构建才能与源码一致**。

---

## 0. 环境与工具链

| 项 | 值 |
| --- | --- |
| 操作系统 | Windows（Git Bash / MSYS2 环境） |
| Node | **v24.20.0**（`C:\Users\Admin\scoop\persist\nvm\nodejs\v24.20.0\node.exe`） |
| pnpm | **不可用** —— corepack 报 `Cannot find module '...\corepack\pnpm\12.14.0\bin\pnpm.cjs'` |
| Cargo / rustc | 离线可用，crate 缓存于 `~/.cargo/registry/src/index.crates.io-*/` |
| tauri-cli | 2.11.4（`node_modules/@tauri-apps/cli/tauri.js`） |
| tauri (crate) | 2.11.5，`tauri-utils` 2.9.3，`tauri-build` 2.6.3 |
| NSIS 工具链 | 已就绪：`C:\Users\Admin\AppData\Local\tauri\NSIS\`（含 `makensis.exe`） |

### 离线构建的执行方式

pnpm 失效导致 `tauri.conf.json` 的 `beforeBuildCommand: "pnpm build"` 无法执行，
故两次打包均用 CLI 的 `--config` 覆盖**仅本次调用的**前置命令（**不修改仓库配置文件**）：

```bash
export CARGO_NET_OFFLINE=true
export PATH="/c/Users/Admin/scoop/persist/nvm/nodejs/v24.20.0:$PATH"
node.exe node_modules/@tauri-apps/cli/tauri.js build --no-bundle \
  --config '{"build":{"beforeBuildCommand":""}}'
```

前端产物由独立执行的 `vite build` 提供（见 §1），故置空前置命令不影响产物一致性。

---

## 1. 前置：前端构建（`vite build`）

```
$ node.exe node_modules/vite/bin/vite.js build
✓ built in 8.79s
```

产物：`dist/`，主包 `index-B3RECSCF.js` 72.03 kB；主要分块
`vendor-codemirror` 603.14 kB / `vendor-tiptap` 381.15 kB / `vendor-katex` 294.82 kB
/ `vendor-react` 142.77 kB / `vendor-hljs` 127.16 kB / `vendor` 110.20 kB。

> Rollup 提示 `vendor-codemirror` 超过 500 kB（chunk size warning，非错误，不阻断构建）。
> 类型检查 `tsc --noEmit` 同批次零错误零告警。

---

## 2. 第一步：`tauri build --no-bundle`（**通过**）

```
   Compiling mwtyper v0.1.0 (D:\PROJECT\MWTyper\src-tauri)
    Finished `release` profile [optimized] target(s) in 3m 16s
       Built application at: D:\PROJECT\MWTyper\src-tauri\target\release\mwtyper.exe
=== NO-BUNDLE EXIT: 0 ===
```

产物：`src-tauri/target/release/mwtyper.exe` — **9,099,264 字节（8.68 MiB）**。

无 error / warning（仅一条 Tauri 自身提示，见 §4）。

---

## 3. 第二步：完整 `tauri build`（NSIS 打包，**通过**）

```
   Compiling mwtyper v0.1.0 (D:\PROJECT\MWTyper\src-tauri)
    Finished `release` profile [optimized] target(s) in 3m 04s
       Built application at: D:\PROJECT\MWTyper\src-tauri\target\release\mwtyper.exe
        Info Patching D:\PROJECT\MWTyper\src-tauri\target\release\mwtyper.exe with bundle type information: nsis
        Info Target: x64
     Running makensis to produce D:\PROJECT\MWTyper\src-tauri\target\release\bundle\nsis\MWTyper_0.1.0_x64-setup.exe
    Finished 1 bundle at:
        D:\PROJECT\MWTyper\src-tauri\target\release\bundle\nsis\MWTyper_0.1.0_x64-setup.exe
=== FULL BUILD EXIT: 0 ===
```

产物：`src-tauri/target/release/bundle/nsis/MWTyper_0.1.0_x64-setup.exe` — **3,210,555 字节（3.06 MiB）**。

NSIS 配置：`installMode: currentUser`，语言 `SimpChinese` + `English`，`displayLanguageSelector: false`。

---

## 4. 构建期告警（均不阻断，仅记录）

| 级别 | 内容 | 处置 |
| --- | --- | --- |
| Info | `Looking up installed tauri packages to check mismatched versions...` | Tauri CLI 版本探测，忽略 |
| Warn | bundle identifier `dev.mwtyper.app` 以 `.app` 结尾，与 macOS 应用包扩展名冲突 | 仅影响 macOS 打包；本轮目标平台为 Windows，**不在 T04 范围内**，留待 T05+ 视需要改为 `dev.mwtyper.desktop` 一类不以 `.app` 结尾的 id |
| Warn | `error deleting lock file for incremental compilation session directory ... 拒绝访问 (os error 5)` | 仅出现在 `cargo test` 阶段；增量编译缓存目录被其他进程占用，不影响编译结果与测试通过 |

---

## 5. 结论

**B1 打包验证通过**：配置与编译链完整就绪，**离线环境下两步打包全部成功**——
`--no-bundle` 产出可执行文件（8.68 MiB），完整 build 产出 NSIS 安装包（3.06 MiB）。
未出现「离线不可打包」的情况，无需降级记录。

---

## 6. 本轮随打包一并落地的配置修正（A10）

`src-tauri/tauri.conf.json` 的 asset 协议静态 scope 由

```json
"scope": { "allow": ["$APPDATA/MWTyper/**"], "deny": [] }
```

改为

```json
"scope": { "allow": [], "deny": [] }
```

**依据**（已核对 Tauri 2.11.5 源码）：

1. `$APPDATA` 经 `BaseDirectory::from_variable`（`tauri/src/path/mod.rs:216`）映射为
   `BaseDirectory::AppData`；桌面端 `app_data_dir()`（`tauri/src/path/desktop.rs:247`）
   = `dirs::data_dir().join(config().identifier)` = `%APPDATA%\dev.mwtyper.app`。
   故原配置 `$APPDATA/MWTyper/**` 实际展开为 `%APPDATA%\dev.mwtyper.app\MWTyper\**`
   —— **该路径不存在**，静态放行是空转。
2. 应用真实的主题目录是 `%APPDATA%\MWTyper\themes`（`themes.rs::themes_dir`），
   与 Tauri's `app_data_dir` **不是同一路径**。
3. asset 协议在本应用中的唯一用途是**工作区/文件所在目录的本地图片**
   （`src/editor/extensions.ts:26` 的 `convertFileSrc`）；主题 CSS 由
   `read_theme` 命令直接读盘，不经 asset 协议。
4. 实际放行由 Rust 侧运行时完成：`Scope` 经 `Arc<ScopeInner>` 共享
   （`tauri/src/scope/mod.rs` 的 `Scopes`，`tauri/src/app.rs:2403` 处 `app.manage`），
   协议处理器取同一 `Arc`（`tauri/src/manager/webview.rs:341`），
   故 `Scope::allow_directory` 对已注册的协议处理器立即可见。

静态 scope 收窄为空后，**唯一的放行入口是运行时**，且放行范围精确等于
「当前工作区根」或「当前文件所在目录」——比原先宽泛的静态通配更安全。

配套的运行时放行（消除首帧 403 竞态）落在 `src-tauri/src/fs.rs`：

- `list_tree(app, root)`：返回目录树**之前**递归放行工作区根；
- `read_file(app, path)`：返回文件内容**之前**放行文件所在目录（`asset_dir_for_file` 取父目录）；
- 两者均用 `#[tauri::command]` 的 `AppHandle` 自动注入，前端 IPC 契约不变
  （前端仍只传 `{ root }` / `{ path }`）。

> `src-tauri/src/watch.rs::watch_folder` 里的 `allow_directory` 保留：
> 它由 React `useEffect` 触发，晚于首帧 `asset:` 请求，是竞态来源之一；
> 现已由 `fs.rs` 的同步放行兜底，两者并存不冲突。

---

## 7. 与本日志同批通过的验证（2026-11-20）

| 命令 | 结果 |
| --- | --- |
| `tsc --noEmit` | **通过**（0 error / 0 warning） |
| `vite build` | **通过**（8.79s） |
| `spikes/m1-editor.ts`（B2 闸门） | **通过**（基线 4 条 + 8 场景 × 6 断言全绿） |
| `spikes/regression.ts` | **通过**（总计 **64 项 / 64 通过 / 0 失败**） |
| `spikes/roundtrip.ts` | **通过**（往返保真 PASS） |
| `spikes/m1-ipc.ts` | **通过**（15/15 PASS） |
| `cargo test --lib` | **通过**（**27 passed / 0 failed / 1 ignored**，ignored 为 `search::bench_10k_files`） |
| `tauri build --no-bundle` | **通过** |
| `tauri build`（NSIS） | **通过** |

---

## 8. v1.7 重建 · 单文件交付（2026-11-23，第 3/4 轮缺陷修复后）

### 8.1 交付形态：单文件可执行程序，不产安装包

用户明确要求「要做成单文件应用，不要 setup」，据此调整：

| 项 | 处理 |
|---|---|
| `src-tauri/tauri.conf.json` 的 `bundle.active` | `true` → **`false`**（`tauri build` 直接跳过 bundle 阶段） |
| `bundle.targets` / `bundle.windows.nsis` | **保留不动**（`active: false` 时不生效），将来改回 `true` 即可恢复安装包，无需补配置 |
| 交付物 | **`release/MWTyper.exe`（单文件）** |
| 构建脚本 | `.workbuddy/falsify/round4/build-single-file.sh`（含「未产安装包」断言） |

### 8.2 为什么必须重建

B1 产物（2026-11-20）**不含**本轮修复：

| 变更 | 文件 | 是否影响二进制 |
|---|---|---|
| 原生文件对话框绑定父窗口（`rfd::FileDialog::set_parent(&window)`） | `src-tauri/src/fs.rs` | ✅ 影响 exe |
| 新增编译期签名断言单测 `file_dialogs_accept_window_as_parent` | `src-tauri/src/fs.rs` | ✅ cargo test 27 → 28 |
| 确认队列按语义类别分批结算（P1，数据丢失级） | `src/App.tsx` | ✅ 影响前端产物 |
| 「另存为」新建标签 | `src/App.tsx` | ✅ |
| 文件树默认展开 + 200 节点规模上限 + 展开状态提升到 App（P9-3） | `src/App.tsx` / `src/sidebar/FileTree.tsx` | ✅ |
| 命令面板模态探测改 `MutationObserver` 动态观察 | `src/commands/Palette.tsx` | ✅ |
| `PromptDialog` 补 `aria-describedby` | `src/ui/Modal.tsx` | ✅ |
| `--accent` 令牌加深为 `#0a754d`（WCAG AA 对比度达标） | `src/styles.css` | ✅ |
| 文件树超大目录条目数徽标 `.tree-count` | `src/styles.css` | ✅ |

**结论**：交付物必须与源码同步，否则分发出去的 exe 仍带 P1 数据丢失缺陷。

### 8.3 环境与工具链（与 §0 一致）

| 项 | 值 |
|---|---|
| 操作系统 | Windows（Git Bash / MSYS2 环境） |
| Node | **v24.20.0**（`C:\Users\Admin\scoop\persist\nvm\nodejs\v24.20.0\node.exe`） |
| Cargo / rustc | **1.98.1**（797e8a9bc 2026-08-05） |
| NSIS 工具链 | `%LOCALAPPDATA%/tauri/NSIS/`（含 `makensis.exe`）——**本轮未使用**（`bundle.active: false` 跳过打包） |
| 离线约束 | `CARGO_NET_OFFLINE=true`；pnpm 仍失效 → 前置命令用 `--config` 覆盖为空 |

### 8.4 步骤与实测结果

| # | 命令 | 结果 | 耗时 |
|---|---|---|---|
| 0 | 清空 `dist/` | 规避 vite `emptyDir` 的宿主删除守卫 | < 1s |
| 1 | `node node_modules/typescript/bin/tsc --noEmit` | **通过**（0 error / 0 warning） | — |
| 2 | `node node_modules/vite/bin/vite.js build` | **通过**，183 modules transformed | **4.37s** |
| 3 | `tauri build`（`bundle.active: false`） | **通过**，**跳过 bundle 阶段** | **2m 37s** |
| 4 | 「未产出安装包」断言 | **PASS**：`src-tauri/target/release/bundle` 不存在 | — |
| 5 | 交付单文件到 `release/` | `release/MWTyper.exe` = **9,101,312 B** | < 1s |
| 6 | `cargo test --lib` | **通过**（**28 passed / 0 failed / 1 ignored**） | 0.23s |

第 3 步的完整日志：

```
        Info Looking up installed tauri packages to check mismatched versions...
        Warn The bundle identifier "dev.mwtyper.app" set in `"tauri.conf.json" identifier` ends with `.app`. This is not recommended because it conflicts with the application bundle extension on macOS.
   Compiling mwtyper v0.1.0 (D:\PROJECT\MWTyper\src-tauri)
    Finished `release` profile [optimized] target(s) in 2m 37s
       Built application at: D:\PROJECT\MWTyper\src-tauri\target\release\mwtyper.exe
=== BUILD EXIT: 0 ===
```

### 8.5 单文件独立性实测（关键验证）

**PE 导入表解析**（自写 PowerShell 脚本解析 PE header → import directory → DLL 名称表）：

```
kernel32.dll, bcryptprimitives.dll, ntdll.dll, shell32.dll, ole32.dll,
api-ms-win-core-synch-l1-2-0.dll, comctl32.dll, user32.dll, gdi32.dll,
dwmapi.dll, oleaut32.dll, shlwapi.dll, advapi32.dll,
api-ms-win-crt-{math,string,convert,runtime,stdio,locale,heap}-l1-1-0.dll
```

**共 20 个，全部是 Windows 系统 DLL / UCRT API-set** —— **不含 `WebView2Loader.dll`**。
Tauri 2 在 Windows 上把 WebView2Loader 静态链接进 exe；WebView2 **Runtime 本身是系统级组件**（本机已装 152.x），不需要随 exe 分发。

**隔离运行实测**：把 `MWTyper.exe` **单独**复制到一个空临时目录（不带任何其他文件）后启动：

```
结果: 进程存活中 (PID=18552)  -> 单文件可独立启动 ✔
工作集内存: 41.6 MB
子进程: msedgewebview2.exe
目录内文件（运行后）:
  MWTyper.exe  9101312 bytes
```

→ 运行后目录内**仍只有 exe 一个文件**（不落地任何附属文件）；子进程 `msedgewebview2.exe` 是 WebView2 Runtime 的多进程架构（系统组件，正常现象）。

### 8.6 产物实测

| 产物 | 值 |
|---|---|
| **`release/MWTyper.exe`（交付物）** | **9,101,312 字节（8.68 MiB）** |
| `src-tauri/target/release/mwtyper.exe`（构建中间产物） | 9,101,312 字节（与交付物同源） |
| `dist/` 总体积 | 2,042,695 字节（v1.6 基线 2,038,539 → **+0.20%**） |
| 安装包 | **无**（`bundle.active: false`；全项目扫描 `*setup*.exe` / `*.msi` 命中数 = 0） |

前端产物体积（`vite build` 实测）：

| 分块 | 原始 | gzip |
|---|---|---|
| `index-BI0eWdzT.js`（主包） | 74.83 kB | 25.72 kB |
| `index-C5UPVKeF.css` | 18.55 kB | 4.16 kB |
| `vendor-codemirror` | 603.14 kB | 206.15 kB |
| `vendor-tiptap` | 381.15 kB | 115.48 kB |
| `vendor-katex` | 294.82 kB | 85.99 kB |
| `vendor-react` | 142.77 kB | 45.72 kB |
| `vendor-hljs` | 127.16 kB | 42.23 kB |
| `vendor` | 110.20 kB | 40.82 kB |
| `SourceMode` / `export`（懒加载分块） | 2.47 / 2.99 kB | 1.05 / 1.20 kB |

KaTeX 字体仍为 **19 个 woff2**（M3 的字体裁剪成果未被本轮改动破坏）。主包 72.03 → 74.83 kB（+2.80 kB）来自本轮新增的文件树规模统计、确认队列分批、模态探测等逻辑——与 `dist` 总体积 +0.20% 一致。

### 8.7 构建期告警（均不阻断）

| 级别 | 内容 | 处置 |
|---|---|---|
| Info | `Looking up installed tauri packages to check mismatched versions...` | Tauri CLI 版本探测，忽略 |
| Warn | bundle identifier `dev.mwtyper.app` 以 `.app` 结尾，与 macOS 应用包扩展名冲突 | 同 §4 / R7：本轮不改，M4+ 跨平台打包前调整 |
| Warn | Rollup `vendor-codemirror` 超过 500 kB | 非错误，不阻断构建（见 §1） |

> 本轮**未出现** §4 记录的 `cargo test` 增量编译锁文件 `os error 5` 告警。

### 8.8 结论

**v1.7 单文件交付构建通过**：离线环境下 `tsc` → `vite build` → `tauri build` → `cargo test` 四步全绿，
**交付物为单个可执行文件 `release/MWTyper.exe`（8.68 MiB），不产出任何安装包**。
已用 **PE 导入表解析 + 隔离目录启动**双重验证其单文件独立性：只依赖 20 个 Windows 系统 DLL，运行后不落地附属文件。

---

## 9. v1.8 重建 · 编辑器 UI/UX 审查修复后（2026-11-23，第 5 轮）

### 9.1 为什么必须重建

v1.7 的产物（2026-11-23 上午）**不含**第 5 轮编辑器的任何修复：
新增 4 个前端模块（`raw-html.ts` / `markdown-escape.ts` / `markdown-serde.ts` / `caret.ts`）、
`extensions.ts` 改用自建 `MwtyperMarkdownManager`、`App.tsx` 的模式切换/快捷键/冲突重载逻辑重写、
`styles.css` 新增 sticky 容器与对比度令牌 —— 这些都进了前端 bundle，
**不重建 exe 就等于修复没有交付**。

### 9.2 步骤与实测结果

| # | 命令 | 结果 | 耗时 |
|---|---|---|---|
| 0 | 清空 `dist/` | 规避 vite `emptyDir` 的宿主删除守卫 | < 1s |
| 1 | `node node_modules/typescript/bin/tsc --noEmit` | **通过**（0 error） | — |
| 2 | `node node_modules/vite/bin/vite.js build` | **通过** | **5.68s** |
| 3 | `tauri build`（`bundle.active: false`） | **通过**，**跳过 bundle 阶段** | **3m 07s** |
| 4 | 「未产出安装包」断言 | **PASS**：`src-tauri/target/release/bundle` 不存在 | — |
| 5 | 交付单文件到 `release/` | `release/MWTyper.exe` = **9,104,384 B（8.68 MiB）** | < 1s |
| 6 | `cargo test --lib` | **通过**（**28 passed / 0 failed / 1 ignored**） | 0.27s |

第 3 步日志：

```
   Compiling mwtyper v0.1.0 (D:\PROJECT\MWTyper\src-tauri)
    Finished `release` profile [optimized] target(s) in 3m 07s
       Built application at: D:\PROJECT\MWTyper\src-tauri\target\release\mwtyper.exe
=== BUILD EXIT: 0 ===
```

### 9.3 单文件独立性复验（与 §8.5 同口径）

复验脚本：`.workbuddy/falsify/round4/verify-single-file.ps1`（**ASCII-only** ——
PowerShell 5.1 按 ANSI 读取无 BOM 的 `.ps1`，脚本里出现中文会直接解析失败）。

**PE 导入表**（自写脚本解析 PE header → import directory → DLL 名称表）：**共 20 个依赖**，
`kernel32 / bcryptprimitives / ntdll / shell32 / ole32 / api-ms-win-core-synch / comctl32 /
user32 / gdi32 / dwmapi / oleaut32 / shlwapi / advapi32 / api-ms-win-crt-{math,string,convert,
runtime,stdio,locale,heap}` —— **全部是 Windows 系统 DLL / UCRT API-set，不含 `WebView2Loader.dll`**。

**隔离运行**：把 exe 单独拷入空目录后启动 → **进程存活（PID=38876，工作集 41.7 MB）**，
运行后目录内**仍只有 exe 一个文件**（9,104,384 bytes），不落地任何附属文件。

**全项目安装包扫描**：`*setup*.exe` / `*.msi` 命中数 **0**。

### 9.4 产物实测

| 项 | v1.7（§8） | v1.8（本轮） | 变化 |
|---|---|---|---|
| `release/MWTyper.exe` | 9,101,312 B | **9,104,384 B** | +3,072 B（+0.03%） |
| `dist/assets/index-*.js`（主包） | 74.83 kB | **82.06 kB**（gzip 28.38 kB） | +7.23 kB |
| `dist/assets/vendor-tiptap-*.js` | 381.15 kB | 381.19 kB | +0.04 kB |
| `dist/assets/vendor-codemirror-*.js` | 603.14 kB | 603.14 kB | 0 |
| `dist/assets/vendor-katex-*.js` | 294.82 kB | 294.82 kB | 0 |
| KaTeX 字体 | 19 个 woff2 | 19 个 woff2 | 0（M3 裁剪成果未被破坏） |

主包 +7.23 kB 来自本轮新增的 4 个前端模块与逻辑（Markdown 序列化保真、光标保持、
查找重算、a11y 属性）——体积代价可接受。

### 9.5 构建期告警（均不阻断）

| 级别 | 内容 | 处置 |
|---|---|---|
| Info | `Looking up installed tauri packages to check mismatched versions...` | Tauri CLI 版本探测，忽略 |
| Warn | bundle identifier `dev.mwtyper.app` 以 `.app` 结尾，与 macOS 应用包扩展名冲突 | 同 §4 / R7：本轮不改，M4+ 跨平台打包前调整 |
| Warn | Rollup `vendor-codemirror` 超过 500 kB | 非错误，不阻断构建（见 §1） |

### 9.6 结论

**v1.8 单文件交付构建通过**：`tsc` → `vite build` → `tauri build` → `cargo test` 四步全绿，
**交付物为单个可执行文件 `release/MWTyper.exe`（9,104,384 B / 8.68 MiB），不产出任何安装包**。
单文件独立性经 PE 导入表解析 + 空目录隔离启动双重复验通过。

---

## 10. v1.9 重建 · 高亮体系重构 + 随航编辑（2026-11-24）

### 10.1 为什么必须重建
v1.8 的产物不含本轮任何改动：新增 3 个前端模块（`cm-theme.ts` / `cm-marks.ts`）、`App.tsx` 新增第三种模式与随航状态机、`styles.css` 新增整套高亮令牌与随航网格布局、`src-tauri/src/fs.rs` 新增 `split_ratio` 设置字段 —— 这些都进了前端 bundle，不重建 exe 等于修复没有交付。

### 10.2 步骤与实测结果

| # | 命令 | 结果 | 耗时 |
|---|---|---|---|
| 0 | 清空 `dist/` | 规避 vite `emptyDir` 的宿主删除守卫 | < 1s |
| 1 | `node node_modules/typescript/bin/tsc --noEmit` | **通过**（0 error） | — |
| 2 | `node node_modules/vite/bin/vite.js build` | **通过** | **3.78s** |
| 3 | `tauri build`（`bundle.active: false`） | **通过**，**跳过 bundle 阶段** | **2m 35s** |
| 4 | 「未产出安装包」断言 | **PASS**：`src-tauri/target/release/bundle` 不存在 | — |
| 5 | 交付单文件到 `release/` | `release/MWTyper.exe` = **9,107,456 B（8.68 MiB）** | < 1s |
| 6 | `cargo test --lib` | **通过**（**29 passed / 0 failed / 1 ignored**，新增 `old_settings_without_split_ratio_use_default`） | 0.25s |

> 交付拷贝曾失败一次（`cp: Device or resource busy`）—— 上一轮的隔离启动测试残留了 `MWTyper.exe` 进程占着文件锁；结束进程后重拷即成功。**这不是构建缺陷**，但值得记一笔：隔离启动测试后应主动结束被测进程，否则下一次交付会被文件锁挡住。

### 10.3 单文件独立性复验（与 §8.5 / §9.3 同口径）

复验脚本：`.workbuddy/falsify/round4/verify-single-file.ps1`（**ASCII-only** —— Windows PowerShell 5.1 按 ANSI 读取无 BOM 的 `.ps1`，脚本里出现中文会直接解析失败）。

- **PE 导入表**：**20 个依赖**，全部是 Windows 系统 DLL / UCRT API-set，**不含 `WebView2Loader.dll`**
- **隔离运行**：单独拷入空目录启动 → **进程存活（PID=43096，工作集 41.8 MB）**，运行后目录内**仍只有 exe 一个文件**（9,107,456 bytes）
- **全项目安装包扫描**：`*setup*.exe` / `*.msi` 命中数 **0**

### 10.4 产物实测

| 项 | v1.8（§9） | v1.9（本轮） | 变化 |
|---|---|---|---|
| `release/MWTyper.exe` | 9,104,384 B | **9,107,456 B** | +3,072 B（+0.03%） |
| `dist/assets/vendor-tiptap-*.js` | 381.19 kB | 381.20 kB | +0.01 kB |
| `dist/assets/vendor-codemirror-*.js` | 603.14 kB | 603.16 kB | +0.02 kB |
| KaTeX 字体 | 19 个 woff2 | 19 个 woff2 | 0（M3 裁剪成果未被破坏） |

### 10.5 结论

**v1.9 单文件交付构建通过**：`tsc` → `vite build` → `tauri build` → `cargo test` 四步全绿，
**交付物为单个可执行文件 `release/MWTyper.exe`（9,107,456 B / 8.68 MiB），不产出任何安装包**。
单文件独立性经 PE 导入表解析 + 空目录隔离启动双重复验通过。

