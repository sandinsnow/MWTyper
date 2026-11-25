# MWTyper 第 4 轮「敌对视角复核」报告 —— 工程师 11 项缺陷修复的独立验收

**复核人**：software-qa-engineer（Edward）
**复核对象**：software-engineer 提交的 D-1 ~ D-11 + G3-2 + Rust `set_parent` 修复
**复核方法**：独立重跑 9 项验收命令 + 自建变异脚本（15 个变异）+ 7 项目标定向攻击探针
**报告日期**：2026-11-22
**总体结论**：**11 项修复全部真实有效、无假阳性、无绕过式修复；但本轮攻击中发现 2 项此前未报告的新缺陷（P1 / P9-3），其中 P9-3 是 D-9 的引入式回归。**

---

## 一、第 1 步：9 项验收命令实测输出（全部本人亲自执行，未复用任何既有数据）

| # | 命令 | 关键输出 | 退出码 |
|---|---|---|---|
| 1 | `node_modules/tsx/dist/cli.mjs spikes/audit3.ts` | `总计 104 项，通过 100，失败 4` → 失败项：`D-13` / `D-13b` / `D-13c` / `E-13b` | 1 |
| 2 | `node_modules/tsx/dist/cli.mjs spikes/regression.ts` | `总计 66 项，通过 66，失败 0` / `== 结论：回归测试全部 PASS ==` | 0 |
| 3 | `node_modules/tsx/dist/cli.mjs spikes/m1-editor.ts` | `== M1 编辑器增强：PASS ==` | 0 |
| 4 | `node_modules/tsx/dist/cli.mjs spikes/m1-ipc.ts` | `== M1 mock IPC：15/15 PASS ==` | 0 |
| 5 | `node_modules/tsx/dist/cli.mjs spikes/roundtrip.ts` | `OK 判据1：规范化后逐行一致` / `== 结论：往返保真 PASS ==` | 0 |
| 6 | `node_modules/tsx/dist/cli.mjs spikes/nodeview-dom.ts` | `OK 真实编辑器 serialize 不动点（文本往返稳定）` / `== 结论：spike ③ PASS ==` | 0 |
| 7 | `node node_modules/typescript/bin/tsc --noEmit` | 无任何输出 | 0 |
| 8 | `node node_modules/vite/bin/vite.js build` | `✓ built in 4.09s`（构建前先清空 `dist/`，规避 vite `emptyDir` 的宿主删除保护） | 0 |
| 9 | `cd src-tauri && cargo test --lib` | `test result: ok. 27 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out` | 0 |

> **关于第 1 项的 4 项失败**：这是**故意保留**的红灯。它们是本轮我新增的断言（第 5 节），用于暴露本轮新发现的 2 项缺陷。**工程师交付的原始 95 项断言全部通过**（本次会话开始前的基线实测为 `总计 95 项，通过 95，失败 0`，exit 0）。
> 9 项命令中 8 项 exit 0，唯一非 0 的 audit3 退出码来自这 4 项新增红灯，**不是既有断言的回归**。

---

## 二、第 2 步：QA 资产零修改确认

**结论：工程师未修改任何 QA 资产 ✓（本项通过，无违规）**

| 文件 | 工程师施工期（11-22 20:20~20:29）前的指纹 | 现在 | 判定 |
|---|---|---|---|
| `spikes/regression.ts` | sha256 `77abee79…5239ef`，mtime 2026-11-20 15:44，35072 B | sha256 `77abee79…5239ef`，mtime 2026-11-20 15:44，35072 B | **字节级零修改 ✓** |
| `spikes/audit3.ts` | sha256 `6bdb2e33…2eacd05`，mtime 2026-11-20 16:30，46947 B | sha256 `9cb05ed1…92046b8`，mtime 2026-11-22 22:44，52950 B | 变化系**我本人**作为唯一所有者按第 5 步授权追加（见下） |

**关于 `spikes/audit3.ts` 的变化说明（主动披露）**：
- 我以 QA 唯一所有者身份**追加**了 9 项新断言 + 3 个辅助函数。
- 用 `diff` 严格核验：`diff backup/audit3.ts spikes/audit3.ts | grep -c '^<'` → **0**，即**未删除或弱化任何一行既有断言**（纯追加）。
- 该修改发生在**本轮攻击发现问题之后**，属于第 5 步明确授权的范围（"QA assets may be modified — I am the sole owner"）。
- 追加的新断言已用**自建变异脚本证明可被捕获**，不存在"恒真断言"。

**另外新增** `spikes/qa4-probe.ts`（121 项断言，本次新建，纯新增文件，不影响既有资产）。

---

## 三、第 3 步：变异测试（falsification）—— 自建脚本 15 个变异

脚本：`.workbuddy/qa4/mutate-qa4.cjs`（本人编写，未直接运行 team-lead 的 `mutate*.cjs`，以免把写错的变异当作有效证据）；证据：`.workbuddy/qa4/mutate-qa4-evidence.txt`。

| 变异 ID | 回退目标 | 判定 | 被哪些断言捕获 |
|---|---|---|---|
| QA-M1 | **D-1**：仅移除 `stillActive` 守卫 | **捕获 ✓** | B-5, B-6, B-7, B-8 |
| QA-M2 | **D-1 + D-2** 同时回退 | **捕获 ✓** | B-4, B-5, B-6, B-7, B-8 |
| QA-M3 | D-2 单独回退 | 未捕获 | —— 属**纵深防御**，D-1 成立时 D-2 单独回退不产生可观测差异 |
| QA-M4 | **D-5**：改为只结算队首 `splice(0,1)` | **捕获 ✓** | **D-6**（注：team-lead 的 v3 N14 写 `expect:/D-7/` 是正则误匹配，实际捕获者是 D-6；D-7 由 QA-M5 捕获） |
| QA-M5 | **D-5**：改为只结算队尾 | **捕获 ✓** | D-7 |
| QA-M6 | **D-6**：palette 恒为 `aria-modal="true"` | **捕获 ✓** | D-2 |
| QA-M7 | **D-7**：删除写盘后的身份校验 | **捕获 ✓** | H-5 |
| QA-M8 | **D-8**：移除 `promptRef.current?.resolve(null)` | 未捕获 | —— **即 N7 盲区，独立复核确认成立** |
| QA-M9 | **D-8**：移除 `key={promptState?.id}` | **捕获 ✓** | D-9 |
| QA-M10 | **D-9**：子树退回兄弟节点（真·解除嵌套） | **捕获 ✓** | E-6 |
| QA-M11 | D-9：保留嵌套但去掉 `role="group"` | 未捕获 | —— 该缺口已由我新增的 **E-12** 补上 |
| QA-M12 | **D-9**：移除 `knownDirsRef` 默认展开 | **捕获 ✓** | E-6 |
| QA-M13 | **D-10**：去掉 `id`/`aria-controls`/`aria-labelledby` | **捕获 ✓** | E-2, E-3 |
| QA-M14 | **D-11**：`--accent` 退回 `#10b981` | **捕获 ✓** | F-5, F-6, F-7, F-8, F-12 |
| QA-M15 | G3-2：`scheduleStats` 回写基线 | **捕获 ✓** | G3-2 |

### 关于 N7 盲区的独立判断

**结论：N7 确实是真实的断言盲区，但我在真实用户路径上未能观测到可观测后果。** 该修复应当保留。

探针（`spikes/qa4-probe.ts` 的 `N7/promise-settle` 组，共 7 项断言）：

```ts
// 底部测量：包装 Promise 构造器，统计 askInput 相关 Promise 的结算情况
const RealPromise = Promise;
const settledNull: unknown[] = [];
const unsettled = new Set<Promise<unknown>>();
// ... Proxy 包装后统计：settled-with-null = 1，unsettled = 0，dangling = 0

// 行为测量：连续触发「写作目标」两次
//   第 1 次输入 111 → await 后应写入 111
//   第 2 次输入 222（使第 1 次被取代）→ 222 不得写入
//   第 3 次输入 333 → 333 最终生效
// 实测：111 仍持久存在（第一次的落盘已完成），222 从未写入，333 最终生效
```

**推理**：D-8 的修复含两个正交语义 —— (a) `key={promptState?.id}` 强制重挂载（**可被 D-9 捕获**）；(b) 旧 `askInput` 请求以 `null` 结算（旧 Promise 不悬空）（**无 DOM 可观测性**）。移除 (b) 后 95 项断言仍全绿，即 QA-M8 的结论。
但 (b) 与 (a) 在行为上**等价可替代**：即使旧 Promise 悬空不结算，`key` 重挂载后旧 `PromptDialog` 已被卸载，其 `await` 挂起也不会影响新对话框工作，且 `setGoal` 等调用方在 `null` 与"永不返回"两种情况下的最终落盘结果相同。因此**未升级为缺陷**，记为**已确认的断言盲区（Known Issue）**。

### 新增断言的可变异捕获性证明

脚本：`.workbuddy/qa4/verify-new-assertions.cjs`（本轮**重写加固**）实测输出：

```
════ BASE — 基线（修复 A + 修复 B 都在） ════
── spikes/audit3.ts ──   总计 104 项，通过 104，失败 0   exit=0
── spikes/qa4-probe.ts ── 总计 121 项，通过 121，失败 0   exit=0

════ M1 — 变异 M1：撤销修复 A（settleConfirm 回到整批结算）════
── spikes/audit3.ts ──   总计 104 项，通过 101，失败 3
   期望变红：D-13, D-13b, D-13c   实际变红：D-13, D-13b, D-13c   漏网：(无)
── spikes/qa4-probe.ts ── 总计 121 项，通过 118，失败 3
   期望变红：P1-3, P1-4, P1-6   实际变红：P1-3, P1-4, P1-6   漏网：(无)

════ M2 — 变异 M2：撤销修复 B（展开状态回到组件内）════
── spikes/audit3.ts ──   总计 104 项，通过 103，失败 1
   期望变红：E-13b   实际变红：E-13b   漏网：(无)
── spikes/qa4-probe.ts ── 总计 121 项，通过 119，失败 2
   期望变红：P9-3, P9-3c   实际变红：P9-3, P9-3c   漏网：(无)

finally 还原: SRC 与 backup 字节一致 ✓
结论：新增断言全部可被变异捕获 ✓
```

---

## 四、第 4 步：7 项目标定向攻击 —— 发现 2 项新缺陷

### 【新缺陷 P1】P1 级 —— `settleConfirm` 跨语义类别连带确认，导致**未保存内容丢失**

**位置**：`src/App.tsx:199-204`

```tsx
const settleConfirm = useCallback((ok: boolean) => {
  const batch = confirmQueueRef.current.splice(0, confirmQueueRef.current.length);
  setConfirmState(null);
  for (const request of batch) request.resolve(ok);
}, []);
```

**根因**：队列里可能存在**语义类别不同**的确认请求（`ConfirmState.title` 有三种：`"关闭标签"`（closeTab `:327`）/ `"删除文件"`（treeDelete `:649`）/ `"恢复快照"`（restoreSnapshot `:724`））。`settleConfirm` 把**整个队列**用一个布尔值结算，于是"回答队首"会**连带确认用户根本没看到其对话框的队尾请求**。

**可达路径**：全局 `window.addEventListener("keydown", onKey, capture=true)` 处理器**不被模态框阻断** → 确认框之上可打开命令面板（这正是 D-6 的场景）→ 执行"关闭当前标签"即把第二个**不同标题**的请求排入队列。

**探针实测输出（`spikes/qa4-probe.ts` 的 `P1/confirm-queue` 组）**：

```
-- [P1/confirm-queue] 首个确认框文案 — 删除文件×删除「B.md」？将移入 .mwtyper/trash，可恢复。取消确定
OK  P1-1 首个确认框是「删除文件」请求
OK  P1-2 队列不顶掉队首：显示的仍是第一个请求（删除）
-- 回答「确定」之后 — A.md 标签存在=false  B.md 标签存在=false  B.md已从磁盘移除=true
              mockFS={"/demo/A.md":"# A\n","/demo/.mwtyper/trash/1795355966799-B.md":"# B\n"}
!!  P1-3 回答「删除·确定」后，正在编辑的脏标签 A 不应被连带关闭 — A 标签存在=false
!!  P1-4 回答「删除·确定」后，A 的未保存状态与内容不得丢失 — A 存在=false dirty=false
OK  P1-5 队首请求本身的语义必须照常生效（B.md 确实被删除） — B.md 已移除=true
-- 回答队首之后是否仍弹出队尾请求 — (无对话框)
!!  P1-6 队尾的「关闭 A」请求必须仍待用户单独确认 — dialog=(无)
```

**数据丢失已证实**：mock 文件系统里 `/demo/A.md` 仍是 `"# A\n"` —— A 的未保存内容 `DIRTY_A` **从未落盘**，而它的标签已被强制关闭。用户只回答了"删除「B.md」？将移入 .mwtyper/trash，可恢复。"，**从未见过任何关于丢弃 A 未保存内容的询问**。

**重要澄清（避免误伤 D-5）**：D-5 的"批量结算"在**同一语义类别**内是**正确设计**（audit3 的 D-6/D-7 正是在断言它），所以**不能简单改成"只结算队首"**。修复必须按语义类别分批。

**已验证的候选修复 A**（`.workbuddy/qa4/qa4-fixes.cjs` 中的 `PATCH_SETTLE`）：

```tsx
const settleConfirm = useCallback((ok: boolean) => {
  const head = confirmQueueRef.current[0];
  if (!head) { setConfirmState(null); return; }
  let cut = 1;
  while (cut < confirmQueueRef.current.length && confirmQueueRef.current[cut].title === head.title) cut++;
  const batch = confirmQueueRef.current.splice(0, cut);
  for (const request of batch) request.resolve(ok);
  setConfirmState(confirmQueueRef.current[0] ?? null);
}, []);
```

### 【新缺陷 P9-3】P2 级 —— 文件树重挂载丢失用户手动折叠状态（**D-9 引入式回归**）

**位置**：`src/sidebar/FileTree.tsx:104-125`（组件内 `expanded` / `knownDirsRef`）

**根因**：`expanded` 与 `knownDirsRef` 是 `FileTree` 的**组件内状态**，而 `App.tsx:1356-1381` 里 `<FileTree>` 是**条件渲染**的（`sidebarTab === "files" ? … : …`），整个侧栏也是条件渲染（`sidebarOpen && …`）。切换侧栏页签或用 `Ctrl+\` 折叠/展开侧栏 → **FileTree 卸载重挂载 → 状态归零 → 用户手动折叠被撤销，且 D-9 的"默认全展开"语义重新生效**。

**探针实测**：
```
!! P9-3  侧栏页签切换后手动折叠状态丢失 — expanded=true
!! P9-3c Ctrl+\ 折叠/展开侧栏后手动折叠状态丢失 — expanded=true
```

**回归已证实**（`.workbuddy/qa4/compare-prefix.cjs`，换入 D-9 修复前的 `FileTree.tsx` 做对照）：
```
修复后 P9-3 : !!  … — expanded=true
修复前 P9-3 : OK  … — expanded=false
修复后 P9-3c: !!  … — expanded=true
修复前 P9-3c: OK  … — expanded=false
```
→ **修复前不丢、修复后丢**，D-9 的修复引入了回归。

**已验证的候选修复 B**（状态提升到 `App.tsx`，`FileTree` 退化为受控组件）：
- `App.tsx` 持有 `treeExpanded`（`useState`）+ `knownTreeDirsRef`（`useRef`）+ `toggleTreeDir`（`useCallback`）与默认展开 effect；
- `FileTree` 的 `Props` 增加 `expanded: Set<string>` 与 `onToggle: (path: string) => void`，移除组件内 `expanded`/`knownDirsRef`/`toggle`；
- `collectDirPaths` 从 `FileTree` 导出供 `App` 使用。

**已被实测否决的第一版候选**：改用**模块级全局变量**保存展开状态 → 会在不同 App 实例之间串味，导致 P9-3b/P9-3c 依然失败（`validate-fix2.cjs` 实测）。

### 其余 5 项攻击目标 —— 未发现问题（附已构造的探针）

| # | 目标 | 结论 | 构造的探针 |
|---|---|---|---|
| 2 | `askInput` 的 `null` 分支处理 | **已攻击，未发现问题** | `P2/askInput-null` 组 7 项，逐个验证 `treeRename`(`:539-558`)、`setGoal`(`:720-726`)、`setLinkPrompt`(`:829-831`)、`treeNewFile`(`:515-534`) 在 `null` 时均安全返回 |
| 3 | `closeTab` 并发关闭与落地激活 | **已攻击，未发现问题** | `P3/close-tab` 组 20 项：并发关闭多标签时激活落点正确；关闭**最后一个**标签时正确新建空白草稿（dirty 与 clean 两种变体）。工程师建议 QA 补这条断言，已补 |
| 4 | `fromOwnGroup()` 键盘事件冒泡 | **已攻击，未发现问题** | `P4/tree-keyboard` 组 10 项：Enter/Space/ArrowRight(展开)/ArrowLeft(折叠) 在子树嵌套后不会冒泡到父 treeitem 造成双触发 |
| 5 | `--accent: #0a754d` 的 13 处 `var(--accent)` 引用 | **已攻击，未发现问题** | `P5/accent-contrast` 组 8 项：`goal-fill` 4.63:1（≥3 ✓）、白字复选框 5.73:1（≥4.5 ✓）、链接 5.73:1 ✓、outline 5.07:1 ✓、所有边框/焦点环 ≥5.07:1 ✓、暗色主题 7.99:1 ✓。**注：实际 13 处，任务书写 14 处，与实测不符** |
| 6 | Rust `set_parent` | **静态核验通过，但有覆盖缺口** | `tauri-2.11.5/src/window/mod.rs:1010` `HasWindowHandle`；`:1018` `HasDisplayHandle`；`rfd-0.15*/src/file_dialog.rs:96`/`:218` `set_parent<W: HasWindowHandle + HasDisplayHandle>` —— **签名匹配 ✓**。前端 `src/ipc.ts` 三处签名未变 ✓。**但 28 个 cargo 测试无一覆盖 `set_parent` —— 需补签名级断言测试** |
| 7 | `knownDirsRef` 默认展开 vs 手动折叠 | **已攻击，未发现问题** | `P7/known-dirs` 组 7 项：手动折叠后 `refreshTree` **不会**重新展开 ✓；手动展开后保持 ✓。`P9/known-dirs-workspace` 组另测 `/demo→/other→/demo`，**不跨工作区串味 ✓** |

---

## 五、新增/修改的断言清单

**未删除、未弱化任何既有断言**（`diff` 校验：删除行数 = 0）。

### `spikes/audit3.ts`（95 → 104 项，+9）

**辅助函数**（3 个）：`dialogText()`、`openCtxMenuOnFile(name)`、`clickCtxMenuItemFor(name, label)`。

**追加进既有分组 `D/modal-race`**（6 项）：`D-10` / `D-11` / `D-12` / `D-13` / `D-13b` / `D-13c`
**追加进既有分组 `E/a11y-sem`**（3 项）：`E-12`（补上 QA-M11 盲区）/ `E-13a` / `E-13b`

### `spikes/qa4-probe.ts`（新建，121 项）
`P1/confirm-queue`(6) · `P1c/confirm-cancel`(2) · `P1b/confirm-batch`(2) · `P2/askInput-null`(7) · `P3/close-tab`(20) · `P4/tree-keyboard`(10) · `P5/accent-contrast`(8) · `P6/palette-aria`(16) · `P7/known-dirs`(7) · `P8/saveas-tab`(14) · `P9/known-dirs-workspace`(7) · `N7/promise-settle`(7)

### 本轮加固的 QA 工具
- `.workbuddy/qa4/qa4-fixes.cjs`（新增，补丁定义单一来源）
- `.workbuddy/qa4/verify-new-assertions.cjs`（**重写**：只触碰 2 个文件 + `finally` 必还原 + 首尾 `diff -r` 校验）
- `.workbuddy/qa4/validate-fix{2,3,4}.cjs`、`.workbuddy/qa4/compare-prefix.cjs`、`.workbuddy/qa4/mutate-qa4.cjs`

---

## 六、遗留关注点与残余风险

1. **Palette 的 `otherModal` DOM 探测只在 mount 时跑一次**（依赖数组 `[]`）—— 后出现的模态框不会被检测到。建议 MutationObserver 或每次打开时探测。
2. **`knownDirsRef` 切换工作区时从不清理** —— 当前靠绝对路径为键避免串味（P9 组已验证）。
3. **`PromptDialog` 缺少 `aria-describedby`**（`src/ui/Modal.tsx`），只有 `aria-label`。
4. **`var(--accent)` 实为 13 处，任务书写 14 处** —— 建议统一口径。
5. **D-9「默认全展开」使大目录 DOM 行数显著上升** —— 工程师明示的取舍，可接受；建议未来加「目录节点 > N 不默认展开」的上限保护。
6. **Rust `set_parent` 无测试覆盖** —— 建议补签名级断言，防止 tauri/rfd 升级时编译期才暴露。
7. **swap-and-restore 脚本必须强制 `try/finally`** —— 本轮发生过一次自伤事故（第九节），纪律已固化进脚本模板。

---

## 七、对工程师修复方案的评价与替代建议

### 7.1 11 项修复：方案均可接受，无「绕过式修复」嫌疑
- D-1/D-3：await 前捕获身份快照 + await 后校验，`stillActive` 是真判断 ✓
- D-2：标题栏真从 `tabs` 派生，未回退读全局 `filePath` ✓
- D-4：Save-As 独立分支，源标签 path/name/dirty 未被触碰 ✓
- D-5：FIFO 队列 + 一次性 splice + 逐个 resolve，逻辑真实（问题在「整批」跨语义类别）✓
- D-6：`deferModal` prop + DOM 兜底探测都是真实现 ✓（探测时机有残留风险）
- D-7：写盘前后各校验一次身份 ✓
- D-8：`key` 强制重挂载 + 旧请求以 null 结算，两机制都真实存在 ✓
- D-9：真嵌套 + `role="group"` + `fromOwnGroup()` + `knownDirsRef` ✓（但引入 P9-3 回归）
- D-10：`id`/`aria-controls`/`aria-labelledby` 齐备 ✓
- D-11：只加深 `--accent` 一个 token，未改任何引用 ✓
- G3-2：基线只由 `loadBuffer` 建立，`scheduleStats` 不回写 ✓

**唯一需要工程师返工的是 D-9（引入 P9-3）与 D-5（引入 P1）。**

### 7.2 P1 的替代方案比较
| 方案 | 评价 |
|---|---|
| **A（推荐，已实测通过）**：按 `title` 分批，只结算队首同标题段，再重新呈现队尾 | ✓ audit3 104/104 + qa4-probe 121/121 + tsc 0 error。保留 D-5 正确语义，又切断跨类别连带 |
| B：完全只结算队首 | ✗ 破坏 D-5 既有语义，audit3 的 D-6/D-7 变红，**不可采用** |
| C：给 `ConfirmState` 加显式 `kind` 枚举字段 | 更稳健（`title` 是展示文案，改文案会静默破坏分批逻辑）。**若工程师愿意建议采用 C**，改动面更大 |

### 7.3 P9-3 的替代方案比较
| 方案 | 评价 |
|---|---|
| **B（推荐，已实测通过）**：状态提升到 `App.tsx`，FileTree 受控化 | ✓ audit3 104/104 + qa4-probe 121/121 + tsc 0 error |
| B'：模块级全局变量缓存 | ✗ 实测被否决：跨 App 实例串味 |
| C：侧栏折叠改用 CSS 隐藏 | 不解决页签切换路径，且改渲染结构，风险更大 |
| D：给 FileTree 加 `key` | 无效 —— 页签切换时组件类型就变了 |

---

## 八、需要工程师处理的事项（源码属工程师所有，QA 未擅自修改）

> **未修改任何 `src/` 文件。** 以下补丁已备好并经实测验证，等待确认后落地。

1. **待修 1 —— P1（P1 级，数据丢失）**：`src/App.tsx:199-204` `settleConfirm` 改为按语义类别分批（`qa4-fixes.cjs` 的 `PATCH_SETTLE`）。建议优先考虑方案 C。
2. **待修 2 —— P9-3（P2 级，D-9 回归）**：`src/sidebar/FileTree.tsx` 展开状态提升到 `src/App.tsx`（`FILETREE_PATCHES` + `APP_B_PATCHES`）。
3. **待补 3 —— Rust `set_parent` 测试覆盖缺口**：补一条签名级断言测试。

---

## 九、需要主动披露的一次自伤事故

本轮早期，我编写的一版 `verify-new-assertions.cjs` 在应用补丁时因「基线文本不匹配」报 `MUTATION-ERROR` 并 `process.exit(2)` 退出，而还原逻辑写在流程末尾、**没有 `finally` 保护**，导致 `src/App.tsx` 与 `src/sidebar/FileTree.tsx` 被留在「打了补丁 + 多一行残留 mutation 代码」的状态。

- **发现方式**：`diff -r .workbuddy/qa4/backup/src src` 校验发现不一致（`validate-fix4` 报告 "RESTORED OK" 之后仍检出差异，本身说明还原不彻底）。
- **修复**：从 backup 字节级拷贝回两个文件。
- **当前状态（多次校验）**：`diff -r .workbuddy/qa4/backup/src src` → **完全一致**，`src/` 与工程师交付版本**字节级相同**。第 1 步的 9 项验收命令全部在**还原后的干净源码**上实测。
- **已固化纪律**：本轮所有 swap-and-restore 脚本一律采用「只触碰 2 个文件 + `finally` 必还原 + 首尾 `diff -r` 校验」模板。

**该事故未影响任何交付物的正确性，也未污染最终源码状态。**

---

## 十、最终状态确认

```
src/ 与工程师交付版本字节一致：diff -r .workbuddy/qa4/backup/src src  → 无差异 ✓
spikes/regression.ts  sha256 77abee79…5239ef  （与工程师施工前完全相同）✓
spikes/audit3.ts      sha256 9cb05ed1…92046b8  （本人纯追加，删除行数 = 0）✓
spikes/qa4-probe.ts   sha256 683a0ee9…18612   （本人新建）✓
临时目录残留：0 ✓
```

**最终判定**：工程师的 11 项修复**真实有效、无假阳性、无绕过式修复**，且断言体系能捕获其中每一项的关键机制（QA-M1/M2/M4/M5/M6/M7/M9/M10/M12/M13/M14/M15 均被捕获）。但**D-5 与 D-9 各自引入了一个新缺陷（P1 与 P9-3）**，其中 P1 属**数据丢失级别**。请工程师按第七节方案处理后，我再跑一轮回归确认。
