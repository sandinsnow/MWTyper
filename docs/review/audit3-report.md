# 第 3 轮敌对视角验证报告（audit3）

> 作者：software-qa-engineer（严过关 / Yan）
> 日期：2026-11-20
> 目标：**不重复跑既有测试，而是主动寻找既有测试覆盖不到的失效路径**
> 交付物：`spikes/audit3.ts`（QA 独占，工程师不得修改）、本报告、`spikes/audit3-report.txt`（逐条 OK/!! 明细）

---

## 0. 摘要

| 项 | 值 |
|---|---|
| 新增测试文件 | `spikes/audit3.ts`（13 个分组，**95 项断言**） |
| 实测结果 | **95 项 / 通过 70 / 失败 25**（exit 1） |
| 新发现源码缺陷 | **11 项**：P0 × 4、P1 × 2、P2 × 5 |
| 验证为「已正确实现」的方向 | 4 个（D1 快照、flush 失败隔离、自动保存定时器身份、统计归属） |
| 我自己用例的缺陷（自修） | 6 项（见 §4） |
| 不可测项（如实标注） | 5 类（见 §5） |
| 路由结论 | **25 项 FAIL 全部定位到源码**，无一例是断言写错 → 全部路由给软件工程师 |

运行方式（`pnpm` 已失效，用 Node v24 直调 tsx）：

```bash
cd /d/PROJECT/MWTyper && \
/c/Users/Admin/scoop/persist/nvm/nodejs/v24.20.0/node.exe \
  node_modules/tsx/dist/cli.mjs spikes/audit3.ts
```

---

## 1. 测试设计（敌对视角的 7 个方向 → 分组映射）

| 方向（主理人指定） | 对应分组 | 断言数 | 结果 |
|---|---|---|---|
| ① D1 身份快照的边界（5 个调用点、快速连切、关 dirty 标签、重开已 dirty 文件） | `A/D1-edge` | 16 | ✅ 全通过 |
| ② flushAllDirty 的失败隔离 | `C/flush-iso` | 4 | ✅ 全通过 |
| ③ D3 定时器身份校验（自动保存定时器到期时不得写错路径） | `D/autosave-timer` | 5 | ✅ 全通过 |
| ④ E02/E08 序号防乱的边界（状态栏字数与「本次 +N 字」的归属） | `G/stats` + `G/session-base` + `G/stats-latency` | 6+4+2 | ⚠️ 1 项 FAIL |
| ⑤ T02 弹窗 Promise 模式的竞态 | `D/modal-race` | 10 | ❌ 4 项 FAIL |
| ⑥ a11y 语义的真实有效性（不止属性存在） | `E/a11y-sem` | 11 | ❌ 3 项 FAIL |
| ⑦ T01 CSS 的实际生效性（`--accent-strong` 真被用了吗？reduced-motion 覆盖全了吗？） | `F/css` | 13 | ❌ 5 项 FAIL |
| ＋ 自主追加：**await 之后的身份漂移**（保存 / 另存为 / 恢复快照 三条 await 边界） | `B/save-race`、`B/saveas-race`、`B/save-during`、`H/restore-race` | 8+4+5+7 | ❌ 14 项 FAIL |

关键手法：给 `api.saveFile` / `api.pickSaveFile` / `api.stats` 打上**人为延迟**（`slowSaveFile()` 等补丁），在 jsdom 里确定性复现真实 Tauri IPC 的竞态窗口——不靠「碰运气」，每个 FAIL 都可 100% 重现。

---

## 2. 新发现（源码缺陷，需工程师修复）

### D-1【P0】`save()` 在 await 之后无条件回写标签身份 → 跨标签污染 + 静默丢数据

* **定位**：`src/App.tsx:318–323`（`save()` 整体 `303–353`；`savingId` 在 `314`）
* **机理**：`save()` 用 `savingId` 正确护住了 `setTabs` 的更新（`324–328`），**却没有护住紧邻其前的 4 行 ref/state 回写**：

```ts
const savingId = activeIdRef.current;   // 314：身份在 await 之前捕获
…
await api.saveFile(path, text);          // 318：await 边界
filePathRef.current = path;              // 319 ← 无条件
setFilePath(path);                       // 320 ← 无条件
lastSavedTextRef.current = text;         // 321 ← 无条件
dirtyRef.current = false;                // 322 ← 无条件
setDirty(false);                         // 323 ← 无条件
setTabs((ts) => ts.map((t) =>             // 324–328 ← 有护（savingId）
  t.id === savingId ? { ...t, path, name: savingName, text, dirty: false } : t));
```

  同一函数内两种写法并存 → 说明护栏模式团队是知道的，只是这里漏了。
* **复现步骤**（自动化：B-1..B-8）
  1. 打开 `A.md`、`B.md` 两个标签；在 B 里输入 `MARK_B_DIRTY`（B 变脏）；
  2. 切到 A 输入 `MARK_A_DIRTY`（A 变脏）；
  3. 按 `Ctrl+S`（对 A 发起保存，注入 250 ms 延迟）；
  4. 保存未完成时点击 B 标签（活动标签变成 B）；
  5. 保存完成 → 观察 → 再按一次 `Ctrl+S`。
* **期望**：保存完成后面板标题仍是 `B.md`、B 仍显示「未保存」、第二次 `Ctrl+S` 应把 B 的内容写进 `B.md`。
* **实测**：
  - 标题栏变成 `A.md`（而活动标签是 B）——**B-4 FAIL**；
  - 状态栏显示「**已保存**」，而 B 的内容其实从未落盘——**B-5 FAIL**；
  - 第二次 `Ctrl+S` 把 **B 的内容写进了 A.md**：`A.md="# MARK_B_DIRTYB\n\n"`，而 `B.md="# B\n"` 仍是旧内容——**B-6 / B-7 / B-8 FAIL**。
* **后果**：① 标题栏/路径显示错文件；② 当前标签的 dirty 被清零 → **用户以为已保存，实际未落盘（静默丢数据）**；③ 下一次保存把 A 文件的内容覆盖成 B 的内容 → **跨文件数据损坏**。
* **建议**：把 `319–323` 四行全部纳入 `savingId` 护栏，例如
  `if (activeIdRef.current === savingId) { filePathRef.current = path; setFilePath(path); dirtyRef.current = false; setDirty(false); }`；
  并补一条「保存期间产生了新输入则不得清 dirty」的比较（见 D-3）。

---

### D-2【P0】「另存为」的身份错配：结果被施加到 resolve 时刻的活动标签

* **定位**：`src/App.tsx:306–314`
* **机理**：`text` / `path` 在 `await api.pickSaveFile(...)`（`310`）**之前**捕获（`306–307`），而 `savingId` 在 `await` **之后**才捕获（`314`）——两者可能指向不同标签。
* **复现步骤**（B2-1..B2-4）：在 A 里编辑 → `Ctrl+Shift+S`（注入 250 ms 延迟）→ 对话框期间切到 B → 对话框返回 `Saved.md`。
* **实测**：`B.md` 标签被改名成 `Saved.md`（**B2-2 / B2-4 FAIL**）、B 的 dirty 态被清掉（**B2-3 FAIL**）；而真正被保存的却是 A 的文本。
* **可达性**：原生「另存为」对话框**未**挂到主窗口上——`src-tauri/src/fs.rs:294–300` 的 `rfd::FileDialog` 没有 `.set_parent_window(...)`，因此用户在对话框打开期间**可以继续操作应用**（切标签/继续输入），该竞态在真实环境可复现。
* **建议**：`savingId` 必须在 `await` 之前捕获（与 `text`/`path` 同一时刻），或改用 `id` 显式携带「本次保存属于哪个标签」。

---

### D-3【P0】保存进行中继续输入 → 新输入的 dirty 态被清零（未落盘内容丢失）

* **定位**：`src/App.tsx:318–323`
* **复现步骤**（B3-1..B3-5）：A 变脏 → `Ctrl+S`（250 ms 延迟）→ 在 await 期间继续输入 `AFTER` → 保存完成。
* **实测**：落盘内容只含保存发起时的文本（正确），但 **dirty 被清零**（`dirtyDot=false`）且状态栏显示「已保存」（**B3-4 / B3-5 FAIL**）——刚才输入的 `AFTER` 从未写进文件，却被标记为已保存。
* **建议**：await 之后比较「当前文本」与「本次保存的文本」，不一致时必须保持 dirty（可复用 `lastSavedTextRef` + `currentText()` 比对）。

---

### D-4【P1】`restoreSnapshot` 在 await 之后无条件 `loadBuffer` → 覆盖另一个标签的编辑区

* **定位**：`src/App.tsx:630–654`（`path` 于 `632`、`id` 于 `636` 捕获，`await` 于 `640–641`，`loadBuffer` 于 `645`）
* **复现步骤**（H-1..H-7）：A 有改动 → 历史面板 → 快照详情 → 「恢复此版本」→ 确认弹窗点「确定」→ 在恢复流程的 await 期间切到 B。
* **实测**：恢复结束后编辑区显示的是 **A 的快照内容**（`editor=A`）而活动标签是 B；标题栏也变成 `A.md`（**H-5 / H-6 FAIL**）。
* **建议**：`loadBuffer` 前加身份校验 `if (activeIdRef.current !== id) { /* 只落盘，不改编辑区 */ }`；`setDirty(false)` 同样需要护栏。

---

### D-5【P1】模态弹窗单槽位 → 第二个请求把第一个请求的 Promise 孤儿化

* **定位**：`src/App.tsx:168–178`

```ts
const askConfirm = useCallback((message, title = "请确认", danger = false): Promise<boolean> =>
  new Promise((resolve) => setConfirmState({ message, title, danger, resolve })), []);
const askInput = useCallback((title: string, defaultValue: string): Promise<string | null> =>
  new Promise((resolve) => setPromptState({ title, defaultValue, resolve })), []);
```

  只有一个 state 槽位；第二个请求覆盖第一个的 state 对象 → **第一个 `resolve` 再也取不到** → 第一个调用方 `await` 永远挂起。
* **复现步骤**（D-0..D-9）：A、B 都变脏 → 关闭 A 弹出确认框（不回答）→ 关闭 B 再弹一次确认框。
* **实测**：
  - 第一个确认框的内容被顶掉，显示的是「「B.md」未保存，确定关闭？」——**D-4 FAIL**；
  - **A 标签的关闭流程永远不完成**（A 仍在标签栏，且没有任何提示）——**D-7 FAIL**。
* **建议**：把弹窗改为**请求队列/栈**（`pendingRequests` 数组 + 逐个出队），或为每个请求分配递增 id 并以 `key={id}` 挂载，使旧 Promise 的 `resolve` 仍可被调用。

---

### D-6【P2】模态打开期间全局快捷键未屏蔽 → 同屏两个 `aria-modal="true"`

* **定位**：`src/App.tsx:949–1029`（监听注册在 `1027`，`capture: true`）
* **复现步骤**（D-1/D-2）：打开确认框 → 按 `Ctrl+Shift+P`。
* **实测**：命令面板叠在确认框之上，**同时存在 2 个 `aria-modal="true"` 容器**（**D-2 FAIL**，`dialogs=2`）。命令面板 `.palette-backdrop` 的 z-index(100) 高于 `.modal-backdrop`(90)，视觉上完全遮住了原对话框。
* **影响**：读屏会认为有两个模态，焦点陷阱互相打架；键盘用户无法感知原来那个对话框。
* **建议**：全局 keydown 处理里先判断「是否存在活动模态/面板」，存在则直接 `return`（或仅放行 Escape/Tab）。

---

### D-7【P2】第二个输入弹窗沿用上一个弹窗已输入的文本

* **定位**：`src/ui/Modal.tsx:155`（`PromptDialogBody`：`const [value, setValue] = useState(defaultValue);`）
* **机理**：第一个 prompt 未关闭时第二个 prompt 打开 → 组件**不重新挂载** → `useState` 的初值不再生效 → 新弹窗显示的是上一次输入的文本。
* **实测**：第二个输入框的值为 `"111"`（第一个弹窗里敲的）而非自己的默认值——**D-9 FAIL**。
* **建议**：给弹窗加 `key={requestId}`（配合 D-5 的请求 id）强制重挂载，或在 `defaultValue` 变化时用 `useEffect` 重置 `value`。

---

### D-8【P2】侧栏页签与 tabpanel 之间没有程序关联

* **定位**：`src/App.tsx:1256–1259`（4 个 `role="tab"` 均无 `aria-controls`）、`src/App.tsx:1261`（`role="tabpanel"` 无 `aria-labelledby`）；同样问题见 `src/sidebar/HistoryPanel.tsx:85–86`（「与当前差异 / 预览」两个 tab）。
* **实测**：`aria-controls` 缺失项 `文件,大纲,搜索,历史`（**E-2 FAIL**）；tabpanel 的 `aria-labelledby=(缺失)`（**E-3 FAIL**）。
* **依据**：WCAG 4.1.2 / ARIA APG「Tab 模式」要求 tab 与 tabpanel 之间存在可编程关联。
* **建议**：给每个 tab 分配稳定 id（`id={`sidebar-tab-${k}`}` / `aria-controls={`sidebar-panel-${k}`}`），panel 加 `aria-labelledby={`sidebar-tab-${k}`}`（当前页签）。

---

### D-9【P2】文件树的层级没有暴露给辅助技术

* **定位**：`src/sidebar/FileTree.tsx:44`（`role="treeitem"`）、`:127`（`role="tree"`）
* **机理**：目录行的子节点是**父 treeitem 的兄弟节点**（既不是 DOM 后代，也没有 `role="group"` 包裹）→ 读屏无法获知「子目录属于哪个目录」。
* **实测**：`childNested=false`、`childParentRole=(none)`（**E-6 FAIL**）。
* **依据**：ARIA APG「Tree 模式」要求 treeitem 的子项位于父 treeitem 之内（或 `role="group"` 之内）。
* **建议**：把子行包进 `<div role="group">` 并作为父 treeitem 的后代渲染。
* **备注**：**已验证正确的部分**——`aria-expanded` 的真值与子树显隐严格同步（E-7 / E-8 PASS），不是空壳属性。

---

### D-10【P2】`--accent` 对比度仍不达标：4 处文字/指示器 + 6 处焦点指示器

* **定位**：`src/styles.css:79, 204, 244, 286`（文字/指示器）与 `79, 268, 370, 371, 431, 432`（焦点指示器）
* **实测**（`--accent: #10b981`）：

| 位置 | 用途 | 对比度 | 阈值 | 结果 |
|---|---|---|---|---|
| `styles.css:286` `.ProseMirror a` | 编辑区链接文字 | 2.54:1（on `#ffffff`） | 4.5:1（AA 文本） | **F-5 FAIL** |
| `styles.css:244` `.outline-item.active` | 大纲当前项文字 | 2.24:1（on `#f0f1f3`） | 4.5:1 | **F-6 FAIL** |
| `styles.css:204` `.sidebar-tabs button.active` | 页签下边框 | 2.24:1 | 3:1（WCAG 1.4.11 非文本） | **F-7 FAIL** |
| `styles.css:79` `:focus-visible` | 全局焦点环 | 2.54:1 | 3:1（WCAG 2.2 焦点指示） | **F-8 FAIL** |
| `styles.css:268` `.ProseMirror:focus-visible` | 编辑区焦点环 | 2.54:1 | 3:1 | **F-12 FAIL** |
| `styles.css:370/371` `.search-box input:focus` | 搜索框焦点边框 | 2.54:1 | 3:1 | **F-12 FAIL** |
| `styles.css:431/432` `.find-row input:focus` | 查找栏焦点边框 | 2.54:1 | 3:1 | **F-12 FAIL** |

* **说明**：T01 的对比度修复**只落在 10 处激活态选择器**上（`var(--accent-strong)` 实测使用 10 次，5.48:1 PASS），**文本与焦点指示器仍用旧色**——尤其焦点环是 WCAG 2.2 的关键项。
* **建议**：文字用途改用 `--accent-strong`（5.48:1）；非文本指示器（边框/焦点环）改用 `--accent-strong` 或新增 `--accent-border`（≥3:1 且与白底可辨）。

---

### D-11【P2】stats 响应乱序时「本次 +N 字」的基线落到了编辑之后

* **定位**：`src/App.tsx:253–260`（`loadBuffer` 建立基线）与 `409–424`（`scheduleStats` 防抖 300 ms 后再取一次）
* **机理**：会话基线 `initialWordsRef` 的赋值条件是「**第一个返回的 stats 响应**」，而不是「装载缓冲那次响应」。当装载响应比防抖后的响应更晚到达（IPC 延迟 > 300 ms）时：
  - 防抖响应先回 → `initialWordsRef === null` → **把基线设成编辑后的字数**；
  - 装载响应后回 → 被 `seq !== statsSeqRef.current` 丢弃，**无法纠正**。
* **复现步骤**（G3-1 / G3-2）：给「装载 A 缓冲」那一次 `api.stats` 注入 600 ms 延迟 → 打开 `A.md` → 立刻输入 1 个词 → 等待。
* **实测**：字数正确为 2（G3-1 PASS），但「本次」显示 **+0 字**（应为 **+1 字**）——**G3-2 FAIL**。调用序列实测为 `["# A\n", "#  ONE A\n\n"]`，即基线取自第二次（编辑之后）。
* **建议**：基线必须绑定「装载缓冲」这一次请求（如用独立的 `baselineSeqRef`/`baselineWordsRef`，或装载时直接用 `tab.text` 计算并落库），不得由「先到先得」的响应决定。

---

## 3. 本轮验证为「已正确实现」的方向（关闭项，可归档）

| 方向 | 断言 | 结论 |
|---|---|---|
| **D1 身份快照的 5 个调用点**（`activateTab`/`openFile`/`newFile`/`closeTab`/`restoreSnapshot→loadBuffer`） | A-0..A-15 全通过 | 3 个标签快速连切两轮（A→B→C→A→B→C）无串位；关闭 dirty 标签的取消/确认两条路径正确；**重开已 dirty 的文件不会丢内容、不会被当作干净文件重载** ✅ |
| **flushAllDirty 失败隔离** | C-1..C-4 全通过 | 单个标签保存抛错时 Promise **不 reject**，出错点之后的脏标签**仍被落盘**，无 path 的草稿仍被跳过 ✅（`App.tsx:74–89` 的 per-tab `try/catch` 已正确） |
| **D3 定时器身份校验** | D-1..D-5 全通过 | 自动保存定时器到期不会跨标签误存；切回脏标签会**重新排程**自动保存并最终落盘 ✅ |
| **E02/E08 统计归属** | G-1..G-6、G2-1a/1b/2/3 全通过 | 快速连切后状态栏字数与「本次 +N 字」基线**始终属于当前标签** ✅（唯一例外是 D-11 的响应乱序场景） |
| **a11y 语义（部分）** | E-7..E-11、F-1..F-3、F-9..F-11 通过 | `aria-expanded` 真值与子树显隐同步；`role="dialog"` 落在**真实容器**上（含标题与按钮）；模态有可访问名；`prefers-reduced-motion` 用通配兜底覆盖了全部 3 处 transition + 1 处 animation；`--accent-strong` 5.48:1、`--fg-dim` 5.29:1 ✅ |
| **另一处确认** | — | `PromptDialog` 缺少 `aria-describedby`（`Modal.tsx` 的 `PromptDialogBody`）——影响很小，**不单列**，仅提示 |

---

## 4. 我自己用例的缺陷（自修记录，共 6 项）

按「断言写错 = QA 自己修」的规则，以下 6 处是我在编写/复核过程中发现并修正的**测试侧**问题，均已重跑验证：

| # | 问题 | 现象 | 修正 |
|---|---|---|---|
| 1 | A-0 假设标签数恰为 3 | 应用恒定保留首个「未命名」草稿标签，实测 `未命名,A.md,B.md,C.md` | 改为断言「三个命名文件各自成为标签」并在用例名中注明草稿标签共存 |
| 2 | E-7/E-8 假设「子目录」初始为展开 | 实际初始为 `aria-expanded=false` | 先记录初值，断言**值翻转且子树同步出现/消失**，再断言回到初值 |
| 3 | G-4/G-5 等待时间不足 + 期望值算错 | 只 `flush(120)` < 统计防抖 300 ms，统计值是陈的；且「+2 字」的期望与实际词数算法不符 | 新增 `flushStats()`（450 ms）；改用 A=1 词 / B=4 词的可区分文档，并插入带尾随空格的 `" ALPHA BETA "` 使增量确定 |
| 4 | D-4/D-7 断言极性写反 | 我最初断言「弹窗不含 A.md」，而缺陷存在时恰好满足 → 形成同义反复 | 改为断言「第一个确认框必须仍显示 A.md」且「A 的关闭请求必须完成」，缺陷才被真实暴露 |
| 5 | G2-1/G2-3 插入文本粘连成同一 token | 插入 `" ONE"`（无尾随空格）会与既有词 `A` 粘成 `ONEA` → 词数本就该是 1，断言「+1 字」不成立 | 改为插入 `" ONE "`（带尾随空格），并补 `G2-1a` 断言词数=2，使用例不再空转 |
| 6 | `getClientRents` 拼写错误 | jsdom stub 里写错函数名 | 删除该行，保留 `getClientRects` + `getBoundingClientRect` |

> 经验：本次 5 处真实缺陷里有 2 处（D-1/D-2）如果我用了「同义反复」的断言就会漏检——再次印证「断言必须能区分正确与错误实现」。

---

## 5. 不可测项（jsdom 硬边界，如实标注，不强行造结论）

| 项 | 原因 | 能测到的替代证据 |
|---|---|---|
| 原生「另存为」对话框在 Windows/macOS/Linux 上的**模态性** | 需要真实 OS 窗口；jsdom 无原生对话框 | 已验证**代码层**：`fs.rs:294–300` 未调用 `set_parent_window` → 对话框不挂主窗口，竞态可达 |
| 真实 Tauri 的 `beforeunload` / `onCloseRequested` 关窗 flush 时机与系统级「是否保存」提示 | 需要真实 Tauri 窗口 | 已验证 `flushAllDirty` 的**纯函数契约**（不 reject、逐标签隔离） |
| 读屏（NVDA / JAWS / VoiceOver）对文件树层级、tab↔tabpanel 关联的**实际播报** | 需要真实 AT | 已验证 DOM/ARIA **结构**层面的正确性（嵌套、`aria-controls`、`aria-labelledby`） |
| `:focus-visible` 焦点环的**真实渲染**、以及深色/自定义主题下的实际对比度 | jsdom 无真实渲染；`styles.css` 变量为静态值 | 已用 WCAG 相对亮度公式在测试内计算浅色主题下的比值并逐条定位到行号 |
| Rust 侧行为（T04）与 NSIS 安装包 | 与前端回归正交，属主理人范围 | 本轮未涉及 |

---

## 6. 路由结论（智能路由判断）

* **25 项 FAIL 全部属于「源码缺陷」**：每一条断言期望都直接来自 SPEC/PRD 的既定行为（D1 身份快照契约、E02/E08 序号防乱、WCAG 对比度阈值、ARIA APG 模式），而实测输出与之相悖；断言本身经 §4 自修后已全部复核，**不存在「断言写错」的情形**。
* **路由对象**：软件工程师（software-engineer）。建议派单顺序：**D-1 / D-2 / D-3（P0，数据正确性）→ D-4 / D-5（P1）→ D-6..D-11（P2）**。
* **测试资产归属**：`spikes/audit3.ts`（本轮新增）与 `spikes/regression.ts`（66 项）**均由 QA 独占维护，工程师不得修改**；工程师如需新增断言请另开文件，避免污染闸门。
* **回归要求**：工程师修复后请以 `spikes/audit3.ts`（95 项）+ `spikes/regression.ts`（66 项）+ 4 个既有 spike + `tsc --noEmit` + `vite build` + `cargo test --lib` 全绿为准；其中 **D-1/D-2/D-3 必须由我这 3 组断言真正翻转**（而非仅让断言消失）。
* **建议工程师新增防回归闸门**：把「保存/另存为/恢复快照三条 await 边界的身份校验」做成统一的 `withTabIdentity(id, fn)` 包装，避免同类问题在别处复发。

---

## 7. 附：本轮新增断言明细（95 项）

`A/D1-edge` 16 · `B/save-race` 8 · `B/saveas-race` 4 · `B/save-during` 5 · `H/restore-race` 7 · `D/autosave-timer` 5 · `C/flush-iso` 4 · `D/modal-race` 10 · `E/a11y-sem` 11 · `F/css` 13 · `G/stats` 6 · `G/session-base` 4 · `G/stats-latency` 2
逐条 OK/!! 结果见 `spikes/audit3-report.txt`。
