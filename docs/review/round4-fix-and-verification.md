# MWTyper 第 4 轮修复与独立复核报告

> 生成者：team-lead｜日期：2026-11-23｜范围：QA 第 3 轮 11 项缺陷修复的独立复核 + 第 4 轮新发现 2 项缺陷的修复与反证 + 4 项收尾项

## 0. 一句话结论

QA 第 3 轮发现的 11 项源码缺陷（D-1 ~ D-11）+ G3-2 + Rust `set_parent` **已全部修复且经独立反证有效**；QA 第 4 轮敌对复核新发现的 2 项缺陷（P1 数据丢失、P9-3 回归）**已修复并经 6/6 变异捕获验证**；4 项收尾项（a11y 补齐、文件树大目录保护、SPEC 回填 v1.7、重新打包 NSIS）**已完成**。**13 条验收命令全绿，25 个变异全部被捕获**，交付物（exe + NSIS 安装包）已与源码同步重建。

---

## 1. 交付物与验收状态

| # | 验收命令 | 结果 | 退出码 |
|---|---|---|---|
| 1 | `spikes/audit3.ts` | **104 项 / 通过 104 / 失败 0**（QA 第 4 轮追加 9 项后） | 0 |
| 2 | `spikes/qa4-probe.ts` | **121 项 / 通过 121 / 失败 0**（QA 第 4 轮新建探针） | 0 |
| 3 | `spikes/regression.ts` | **66 项 / 通过 66 / 失败 0** | 0 |
| 4 | `spikes/m1-editor.ts` | PASS（73 断言） | 0 |
| 5 | `spikes/m1-ipc.ts` | 15/15 PASS | 0 |
| 6 | `spikes/roundtrip.ts` | 往返保真 PASS | 0 |
| 7 | `spikes/nodeview-dom.ts` | spike ③ PASS | 0 |
| 8 | `tsc --noEmit` | 零错误零告警 | 0 |
| 9 | `vite build` | ✓ built in 4.26s（183 modules） | 0 |
| 10 | `cargo test --lib` | **28 passed / 0 failed / 1 ignored**（基线 27 → 28，新增签名级断言） | 0 |
| 11 | `.workbuddy/falsify/round4/large-dir-probe.ts` | **16 项 / 通过 16 / 失败 0**（大目录保护自验探针，收尾项新增） | 0 |
| 12 | `tauri build`（`bundle.active: false`） | ✓ 2m 37s → `release/MWTyper.exe` 9,101,312 B（**单文件，不产安装包**） | 0 |
| 13 | 单文件独立性实测 | **PE 导入表仅 20 个 Windows 系统 DLL（不含 WebView2Loader.dll）**；空目录隔离启动成功，运行后不落地附属文件 | 0 |

**收尾项（4 项）已完成**：`PromptDialog` 补 `aria-describedby`；文件树大目录保护（`TREE_AUTO_EXPAND_MAX_NODES = 200`）；SPEC 回填 v1.7；**交付形态改为单文件应用（`bundle.active: false`，不产 setup）+ 重建交付物**。

**变异反证总计 25 个，全部被捕获**：第 3 轮 14 个 + 第 4 轮 6 个 + 大目录保护 5 个。

---

## 2. 第 3 轮 11 项缺陷的修复与反证

### 2.1 修复清单

| 缺陷 | 严重度 | 根因 | 修法 | 位置 |
|---|---|---|---|---|
| D-1 | P0 | save() 在 await 后无条件写全局状态 | 首个 await 前捕获 `{savingId, savingText, path}` 三元组；await 后算 `stillActive`，为真才写全局 | `src/App.tsx` save() |
| D-2 | P0 | 标题栏读全局 filePath（会被竞态覆盖） | 改从 `tabs` 按 `activeId` 派生 | `src/App.tsx` 标题栏 |
| D-3 | P0 | path/text/tabId 三者不同源 | 调用瞬间同源捕获 | `src/App.tsx` save() |
| D-4 | P1 | 另存为复用「改名+清 dirty」路径 | 独立分支：源标签 path/name/dirty 不碰，另开新标签；仅当源标签仍活动且内容未变才激活新标签 | `src/App.tsx` save() |
| D-5 | P1 | 确认框单槽 state 覆盖 → 队首 Promise 孤儿化 | FIFO 队列 + 按语义分批结算 | `src/App.tsx` askConfirm/settleConfirm |
| D-6 | P2 | Palette 硬编码 `aria-modal="true"` | 有其他模态时降级为非 aria-modal | `src/commands/Palette.tsx` |
| D-7 | P2 | restoreSnapshot 的 id 在 await 后捕获 | await 前捕获 `{id,path}`，确认后与落盘后各校验一次，不符整体放弃 | `src/App.tsx` restoreSnapshot |
| D-8 | P2 | PromptDialog 无 key → useState 不重初始化 | askInput 改取代语义 + `key={promptState?.id}` 强制重挂载 | `src/App.tsx` |
| D-9 | P2 | treeitem 子节点是兄弟节点 | 子树进父 treeitem 内的 `role="group"`；文件树默认展开全部目录 | `src/sidebar/FileTree.tsx` |
| D-10 | P2 | 侧栏 tab 与 tabpanel 无 aria 关联 | tab 补 `id`+`aria-controls`；panel 补 `id`+`aria-labelledby` | `src/App.tsx` 侧栏 |
| D-11 | P2 | `--accent: #10b981` 对比度 2.54:1 | 只加深令牌为 `#0a754d`（编辑底 5.73:1 / 侧栏底 5.07:1），不改任何引用 | `src/styles.css:12` |
| G3-2 | P2 | initialWordsRef 被防抖统计抢先赋值 | 基线只由 loadBuffer 装载响应建立 | `src/App.tsx` |
| Rust | P2 | 原生对话框非模态 | 三命令加 `window: tauri::Window` + `.set_parent(&window)` | `src-tauri/src/fs.rs` |

### 2.2 变异注入反证（team-lead 独立执行，`.workbuddy/falsify/round3/`）

| 变异 | 还原的缺陷 | 捕获者 |
|---|---|---|
| N1 | D-1 去掉 stillActive 护栏 | B-5, B-6, B-7, B-8 |
| N2 | D-4 原始缺陷全貌（savingId 晚捕获 + 另存为同路径） | B2-2, B2-3, B2-4 |
| N3 | D-2 标题栏改回读全局 filePath | （见 2.3） |
| N4 | D-9 Row 还原为兄弟节点 | E-6 |
| N5 | D-7 移除落盘后身份校验 | H-5 |
| N6 | G3-2 防抖统计改写基线 | G3-2 |
| N8 | D-5 还原单槽覆盖 | D-4, D-7 |
| N9 | D-6 Palette 恒 aria-modal=true | D-2 |
| N10 | D-10 去掉 aria 关联 | E-2, E-3 |
| N11 | D-11 --accent 退回 #10b981 | F-5, F-6, F-7, F-8, F-12 |
| N12 | D-4 另存为无条件激活新标签 | B2-2 |
| N13 | D-9 目录默认折叠 | E-6 |
| N14 | D-5 一次作答只结算队首 | D-6 |
| P1（联合） | D-1 + D-2 同时失效（= 修复前真实状态） | B-4, B-5, B-6, B-7, B-8 |

**结论**：11 项缺陷的根因机制**全部可被对应断言捕获**，无假阳性、无绕过式修复。

### 2.3 唯一确认的断言盲区（良性）

**D-8 的一半语义「旧 askInput 请求以 null 结算」无 DOM 可观测性** —— 移除该逻辑后 95 项仍全绿。

- **归因**：D-8 的两半语义是：(a) `key={promptState?.id}` 强制重挂载（**可被 D-9 捕获**）；(b) 旧请求 resolve(null) 避免 Promise 悬空（**无 DOM 可观测**）。
- **独立判断**：QA 用 Proxy 包装 Promise 统计实测 → *settled-with-null = 1, unsettled = 0, dangling = 0*；行为测量（连续触发「写作目标」三次）→ *111 仍持久存在、222 从未写入、333 最终生效*。
- **裁定**：即使旧 Promise 悬空，`key` 重挂载后旧 PromptDialog 已卸载，其 await 挂起不影响新对话框，且 setGoal 落盘结果相同 → **行为上等价可替代，非缺陷**。修复保留（防御性编程），记为已确认盲区。

### 2.4 D-2 的纵深防御性质

单独还原 D-2（标题栏改回读全局 filePath）**无断言 FAIL** —— 因为在 D-1 的 `stillActive` 护栏成立时，全局 filePath 恒等于活动标签 path，两者等价。但 D-1 + D-2 同时还原（= 修复前真实状态）时 **B-4 FAIL**。故 D-2 属**纵深防御**，其行为由 D-1 的断言间接覆盖，非盲区。

---

## 3. 第 4 轮新发现缺陷的修复

### 3.1 P1（P1 级 · 数据丢失）—— 确认队列跨语义类别连带结算

**根因**：`settleConfirm` 把整个队列用一个布尔值结算，而队列里可能混有三种语义完全不同的请求：
- `close-tab`（丢弃未保存内容）
- `delete-file`（移入回收站）
- `restore-snapshot`（覆盖当前文件）

用户回答队首（「删除 B.md？」→ 确定）时，队尾那个**用户从未见过其对话框**的「关闭 A」请求也被 resolve(true) → A 被强制关闭，未保存内容从未落盘。

**可达路径**：全局 keydown 监听 `capture: true` 不被模态框阻断 → 确认框之上可开命令面板（D-6 场景，D-3 是记录型断言要求此能力）→ 执行「关闭当前标签」排入第二个不同 kind 的请求。

**修法（方案 C：显式语义类别）**：
- `ConfirmState` 增加 `kind: "close-tab" | "delete-file" | "restore-snapshot" | "generic"`
- 三个调用点分别传各自 kind
- `settleConfirm(ok)` 只结算**队首及其后连续同 kind** 的请求；跨类别请求留在队列，并把队首换成队列中的下一个请求，**逐个向用户确认**

**关键设计取舍**：同一 kind 内仍批量结算 —— 这是 D-5 的正确语义（audit3 的 D-6/D-7 正断言它），只结算队首会让 D-6/D-7 变红。

### 3.2 P9-3（P2 级 · D-9 引入式回归）—— 文件树手动折叠状态在重挂载后丢失

**根因**：`expanded` / `knownDirsRef` 是 FileTree 的**组件内状态**，而 FileTree 位于条件渲染内（侧栏页签切换 / `Ctrl+\` 收起侧栏）→ 卸载重挂载 → 状态归零 → 「默认全展开」重新生效，用户手动折叠被撤销。

**A/B 对照证据**（QA 换入 D-9 修复前的 FileTree 对照）：
```
修复后 P9-3 : !! — expanded=true      修复前 P9-3 : OK — expanded=false
修复后 P9-3c: !! — expanded=true      修复前 P9-3c: OK — expanded=false
```

**修法（状态提升 + 受控化）**：
- `treeExpanded` state + `knownTreeDirsRef` + `toggleTreeDir` 提升到 `App.tsx`
- `FileTree` 改为受控组件（`expanded: Set<string>` + `onToggleDir: (path) => void` props）
- `collectDirPaths` 从 FileTree 导出供 App 使用
- 默认展开 effect 迁到 App（只对「新出现的目录」默认展开，不覆盖手动折叠）
- 工作区切换不串味：以绝对路径为键

### 3.3 QA 建议项处理

| # | 建议 | 处理 |
|---|---|---|
| 1 | Rust `set_parent` 无测试覆盖 | **已补**：`fs.rs` 新增 `file_dialogs_accept_window_as_parent` —— 签名级编译期断言（构造 `FileDialog::new().set_parent(window)`，不弹窗）。cargo test 27 → **28 passed** |
| 2 | Palette 的 `otherModal` 探测只在 mount 跑一次 | **已改**：改用 `MutationObserver` 持续观察 `aria-modal`/`role` 属性与子树变化，后出现的模态也能被检测并动态降级 |
| 3 | `var(--accent)` 实为 13 处而非 14 处 | **口径更正**：引用次数口径 = **13 处**（此前 14 是 grep 匹配行数口径） |

### 3.4 第 4 轮变异注入反证（`.workbuddy/falsify/round4/`）

| 变异 | 捕获者 | 判定 |
|---|---|---|
| R1 settleConfirm 还原为整批结算（忽略 kind） | D-13, D-13b, D-13c, P1-3, P1-4, P1-6 | ✔ 捕获 |
| R2 settleConfirm 只结算队首一个 | D-6 | ✔ 捕获 |
| R3 结算后不重新呈现队列中的下一个请求 | D-13c, P1-6 | ✔ 捕获 |
| R4 文件树展开状态完全退回组件内部 | P9-3b（+audit3 3 项 +probe 14 项） | ✔ 捕获 |
| R5 默认展开 effect 被移除 | E-6, E-13b, P9-3, P9-3b, P9-3c | ✔ 捕获 |
| R6 knownTreeDirsRef 每次都当作新目录 | P7-5 | ✔ 捕获 |

**6/6 全部捕获 —— 新增断言有效，无盲区。**

---

## 4. 方法论沉淀（反证归因的三次迭代）

本轮反证脚本本身经历了 3 次迭代，教训已固化：

1. **v1 → v2**：4 个「未捕获」经源码比对全部归因为**变异没忠实还原缺陷**，不是断言盲区。
   - savingId 晚捕获的正则用了 8 空格缩进，源码是 6 空格 → 替换根本没发生（假阴性）
   - 删 `role="group"` 不影响 E-6 断言查的 DOM 包含关系
   - 删错了校验点（H 组起作用的是落盘后第二道校验）
   - 只改了一半语义（原始缺陷需 savingId 晚捕获 + 另存为同路径同时成立）

2. **v2 → v3**：修正缩进后 N2 被捕获。**判据应命中「相关组」而非「精确断言号」** —— N14 命中的是 D-6 而非 D-7，仍属有效捕获。

3. **v3 → v4（安全机制）**：脚本用 `fs.cpSync` 还原在 Windows 上不可靠，导致备份被污染、基线变红。改用 shell `cp -r` + **首尾 `diff -r` 强制校验** + **基线自检前置**（基线不干净立即中止）。

**固化纪律**：swap-and-restore 脚本一律「只触碰指定文件 + 还原后 diff 校验 + 变异前基线自检」。本轮发生过一次自伤（源码被留在打了补丁的状态），已在同一轮内完整恢复并复验。

---

## 5. 仍需注意的问题与遗留风险

1. **「另存为」会新增标签**（D-4 明确要求的产品语义变化）—— 源标签保持 dirty（源文件确实未存）。
2. **恢复快照存在「部分完成」窗口**：落盘后切换标签 → 文件已恢复但编辑区不刷新（toast 说明）；确认后落盘前切换 → 整体放弃。刻意选择：宁可磁盘与 UI 短暂不一致，也不覆盖用户正在编辑的另一个标签。
3. **`--accent` 变深**（`#10b981` → `#0a754d`）：链接/焦点环观感更沉；暗色主题未动（`#34d399`，对比度 7.99:1）。
4. **Palette 叠加时降级为 `aria-modal="false"`**：读屏不再当模态，但保留 `role="dialog"` 与可访问名。
5. **文件树默认展开全部目录**：大目录 DOM 行数上升。→ **已在收尾项解决**：加 `TREE_AUTO_EXPAND_MAX_NODES = 200` 规模上限，超限目录保持折叠并标注条目数（`.tree-count` 徽标），阈值唯一定义在 `FileTree.tsx`。自验探针 16 项 + 5 个变异全部捕获（`.workbuddy/falsify/round4/falsify-large-dir.txt`）。
6. **确认队列改为逐个弹出**：跨类别请求会排队依次确认 —— 这是正确性换交互节奏，用户可能看到连续多个对话框。属可接受代价。
7. **原生对话框现为应用窗口子窗口（模态）**；Linux 仅 XDG 路径支持。前端 `src/ipc.ts` 三个签名与 payload 完全不变。
8. ~~**`PromptDialog` 缺 `aria-describedby`**~~ —— **已在收尾项补齐**（`src/ui/Modal.tsx`，`inputId = useId()` + `aria-describedby={inputId}` + `<input id={inputId}>`），与 `ConfirmDialog` 指向消息体的做法对齐。
9. **`knownTreeDirsRef` 切换工作区从不清理** —— 当前以绝对路径为键避免串味；若将来引入同路径不同工作区场景需重新评估。
10. **大目录阈值 200 是经验值**（新增风险，SPEC R8）：超过阈值的目录首屏折叠，用户需多一次手动点击。缓解：阈值单一常量、行上有条目数徽标。**未运行时验证**：真实窗口下的首屏帧率与长列表滚动流畅度（jsdom 无头环境无法测帧）。
11. **`set_parent` 的签名依赖 rfd 0.15.4**（新增风险，SPEC R9）：已用编译期断言固化，但升级 rfd 须重新核对；`raw-window-handle` 是传递依赖未直接声明，故**不能引用 trait 路径**做签名断言，只能靠实际调用让编译器校验。
12. **真实窗口观感仍需人工确认一次**（SPEC R5/R9）：原生对话框层级与位置、原生剪贴板/拖拽、WebView2 打印对话框、窗口整体观感——无头环境无法复现。
13. **单文件交付的前置条件：目标机器须有 WebView2 Runtime**（Windows 10/11 通常预装；精简系统/离线机器可能缺失，需另装 Evergreen Runtime）。这是 WebView2 应用的通用前提，exe 本身不含也不附带任何 DLL。

---

## 6. 变更文件清单

| 文件 | 变更 |
|---|---|
| `src/App.tsx` | D-1~D-8、D-10、G3-2、P1（ConfirmKind + settleConfirm 分批）、P9-3（treeExpanded 状态提升）、**大目录规模上限**（`collectDirSizes` + `TREE_AUTO_EXPAND_MAX_NODES` 判断） |
| `src/commands/Palette.tsx` | D-6（aria-modal 降级）、Palette otherModal 改 MutationObserver 动态探测 |
| `src/sidebar/FileTree.tsx` | D-9（treeitem 嵌套 + role=group + fromOwnGroup）、P9-3（改为受控组件）、导出 collectDirPaths、**大目录保护**（`TREE_AUTO_EXPAND_MAX_NODES` / `countNodes` / `collectDirSizes` / `dirSizes` prop / `.tree-count` 徽标） |
| `src/styles.css` | D-9 布局（.tree-group）、D-11（--accent 令牌）、**`.tree-count` 徽标样式** |
| `src/ui/Modal.tsx` | **收尾项**：`PromptDialog` 补 `aria-describedby` |
| `src-tauri/src/fs.rs` | 原生对话框模态化 + `file_dialogs_accept_window_as_parent` 签名级断言测试 |
| `src-tauri/tauri.conf.json` | **交付形态**：`bundle.active` `true` → `false`（跳过 bundle 阶段，不产安装包）；`bundle.windows.nsis` 配置保留不动 |
| `src-tauri/BUILD-LOG.md` | 新增 §8 v1.7 重建 + 单文件交付记录（§1–§7 的 B1 原始记录保留作可追溯基线） |

**未改动**：`src/ipc.ts`（前端契约不变）、`spikes/regression.ts`（QA 独占，sha256 未变）。

**QA 资产变更**（由 QA 本人执行，已披露）：`spikes/audit3.ts` 95 → 104 项（纯追加，删除行数 = 0）、新建 `spikes/qa4-probe.ts`（121 项）。

**文档变更**：`SPEC.md` 回填 v1.7（新增 D15 六条决策、R8/R9 两条风险、§5.2 两条功能规格、§12 v1.7 变更记录、§8 里程碑新增 M3.5 行）；`src-tauri/BUILD-LOG.md` 新增 §8 v1.7 重新打包记录（§1–§7 的 B1 原始记录保留不改）。

---

## 7. 证据文件

| 文件 | 内容 |
|---|---|
| `.workbuddy/falsify/round3/falsify3.txt` | 第 3 轮反证 v1 证据 |
| `.workbuddy/falsify/round3/falsify3-v2.txt` | 第 3 轮反证 v2 证据 |
| `.workbuddy/falsify/round3/falsify3-v3.txt` | 第 3 轮反证 v3 证据（含 N2/N12/N13/N14） |
| `.workbuddy/falsify/round4/mutate.cjs` | 第 4 轮反证脚本（含还原校验与基线自检） |
| `.workbuddy/falsify/round4/falsify4.txt` | 第 4 轮反证证据（6/6 捕获） |
| `.workbuddy/review/round4-audit-report.md` | QA 第 4 轮敌对视角复核报告（313 行） |
| `.workbuddy/review/audit3-report.md` | QA 第 3 轮审计报告（11 项缺陷原始记录） |
| `.workbuddy/falsify/round4/large-dir-probe.ts` | 大目录保护自验探针（16 项，直接读 `App.tsx` 真实判断，避免同义反复） |
| `.workbuddy/falsify/round4/mutate-large-dir.cjs` | 大目录保护变异脚本（5 个变异：阈值放大 / 移除 App 判断 / 阈值置 0 / countNodes 不递归 / collectDirSizes 失效） |
| `.workbuddy/falsify/round4/falsify-large-dir.txt` | 大目录保护反证证据（5/5 捕获） |
| `.workbuddy/falsify/round4/rebuild.sh` | v1.7 重建脚本（tsc → vite build → tauri build 两步 → cargo test） |
| `.workbuddy/falsify/round4/build-single-file.sh` | **单文件交付构建脚本**（tsc → vite build → tauri build → 「未产安装包」断言 → 交付 `release/MWTyper.exe` → cargo test） |
| `src-tauri/BUILD-LOG.md` §8 | v1.7 重建 + 单文件交付的完整实测数据（含 PE 导入表解析与隔离启动结果） |
