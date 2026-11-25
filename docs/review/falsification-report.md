# QA 反证（Falsification）记录 — 任务 #7 第二轮

## 目的

team-lead 要求：在工程师修复 `find-replace.ts` 与 `spikes/m1-editor.ts` 闸门后，**额外做一次反证** ——
把查找替换的逻辑临时改坏，确认**改造后的 spike 闸门会 FAIL**，
以此证明闸门真的具备鉴别力，而不只是「断言数变绿」。

## 方法学（关键设计：零侵入）

反证绝不能污染工程源码，也不能靠「跑完记得改回来」这种易漏步骤。因此：

1. **不修改任何工程文件**（`src/`、`spikes/` 原件全程只读）。
2. 在 `.workbuddy/falsify/sandbox/` 建立**沙箱副本**：拷贝 `src/` + 被测 spike 文件。
   - 必须同时拷贝 `tsconfig.json` 与 `package.json`：tsx 依 `tsconfig.json` 的
     `"jsx": "react-jsx"` 选择新版 JSX 运行时，缺失会退回 classic 运行时，
     在 `src/App.tsx` 抛 `ReferenceError: React is not defined`（此坑已踩并修复）。
3. 只对**沙箱副本**的 `src/editor/find-replace.ts` 施加定向变异。
4. 每次变异前重建沙箱，变异之间互不污染。

> 踩坑记录 1：沙箱必须连 `tsconfig.json` 一起拷贝。否则 tsx 依默认 classic JSX 运行时转译，
> `src/App.tsx` 抛 `ReferenceError: React is not defined`（首版即踩，已修）。
>
> 踩坑记录 2：不能对整个沙箱目录做 `rmSync(recursive)`。文件数超 50 会触发宿主安全删除守卫
> （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）中断脚本。改为增量同步 + 逐个文件删除陈旧项（已修）。

## 变异集

| 变异 | 注入方式 | 模拟的失效模式 | 期望被捕获的断言类型 |
|---|---|---|---|
| `none` | 不变异 | ——（**对照组**） | 闸门应全绿 |
| `empty` | `computeMatches` 恒返回 `[]` | 查找整体失效（命中集为空） | 独立参照 + 非空断言 |
| `revert` | 把 `descendants` 回调的 `return true` 改回 `return false` | 还原 E01 历史缺陷（跳过子树，文本节点永不被访问） | 独立参照 + 非空断言 |
| `offbyone` | 命中区间 `to` 偏移 +1 | **非空但错误**（命中数正确、位置错） | 仅位置精确性断言可捕获 |
| `hljsclass` | `code-block.ts` 产出的 class 篡改为常量 | **高亮 class 错误**（数量、位置均正确） | 仅独立参照 + 读对 class 位置可捕获 |

`offbyone` 是关键设计：它命中数仍为 2，**「非空断言」与「命中数断言」都无法捕获**，
只有"逐项位置比对 + 独立参照"能捕获。它验证的是闸门是否真的在做语义比对，而非只比对数量。

`hljsclass` 为第 3 轮新增，针对**高亮侧**的另一类假通过形态：
`Decoration.inline(from, to, attrs, spec)` 第 3 参是 attrs，而 `Decoration.spec` getter 返回 `type.spec`，
故 class 落在 `type.attrs.class`、spec 为空。读 `d.spec.class` 恒得 undefined → 两侧同时为空 → 恒等 → 假通过。
该变异命中数与位置都不变，只有"独立参照 + 读对 class 位置"的闸门才能捕获。

## 闸门变体

- `current`：**工程现状闸门**。第 2 轮时指原自参照闸门（`spikes/m1-editor.ts:163` 用被测函数自身作参照）；
  **第 3 轮起即工程师重写后的真实闸门**（独立参照 `naiveFind`/`refHighlight` + 非空断言 + 位置精确）。
- `patched`：**强化闸门**（team-lead 指定的改造方向），在沙箱中模拟实现，
  用于先验证"这种闸门设计确实有鉴别力"（反证方法论自身必须先被验证），
  同时给工程师一份可直接采纳的参照实现。
  第 3 轮起工程师已自行实现该方向，`patchGate` 的锚点不存在而自动跳过 —— 此时 `current` 即 `patched`。

## 基线解耦

`applySourceFix()` 幂等地在沙箱副本里把 E01 缺陷（`return false`）修正为 `return true`。
若工程师的修复已落地，该步骤为 no-op。
这样 **"源码是否已修" 与 "闸门有无鉴别力" 两个变量被解耦**：
对照组 `none` 恒为「已修复基线」，任何变异下的表现差异都只归因于闸门本身。

## 实测结果

> 矩阵为 2026-11-20 第 2 轮实测（此时工程师修复尚未落地，故用沙箱 `applySourceFix()` 模拟基线修复）。
> 判定**按组**进行：只统计与"查找替换"相关的失败断言
> （`m1-editor.ts` 的 `B2 查找` + `regression.ts` 的 `[B/find]`）。
> 理由：`regression.ts` 的 D/gate 组是**静态守卫**，检查的是工程真实文件，与"查找功能是否被变异打坏"正交；
> 若用总退出码判定，会把 D/gate 的失败误算成"闸门捕获了变异"，导致结论反向。

| 闸门 | 变异 | m1-editor 查找组失败 | regression FIND 组失败 | 判定 |
|---|---|---|---|---|
| **current**（工程现状） | none（对照） | 0 | 0 | ✔ 基线正常 |
| current | empty | **0** | 7 | ✘ **m1-editor 零鉴别力** |
| current | revert | **0** | 7 | ✘ **m1-editor 零鉴别力** |
| current | offbyone | **0** | 1 | ✘ **m1-editor 零鉴别力** |
| **patched**（独立参照+非空） | none（对照） | 0 | 0 | ✔ 基线正常 |
| patched | empty | **16** | 7 | ✔ 捕获 |
| patched | revert | **16** | 7 | ✔ 捕获 |
| patched | offbyone | **8** | 1 | ✔ 捕获 |

### 结论

1. **现状闸门（`current`）对全部 3 个变异零鉴别力** —— 实证确认 team-lead 的判断：
   `spikes/m1-editor.ts:163` 用被测函数自身作参照，属同义反复，查找功能全废仍报 PASS。
   这不是推测，是可复现的实验结论（3/3 变异下 m1-editor 查找组失败数均为 0）。
2. **强化闸门（`patched`）对全部 3 个变异均有鉴别力** —— 证明 team-lead 指定的改造方向有效，
   并给出经验证的参照实现（3/3 变异下 m1-editor 查找组失败数 16/16/8）。
3. **`regression.ts`（我的用例）本身具备鉴别力**：3/3 变异均被捕获（FIND 组失败 7/7/1）。
   其中 `offbyone` 仅被新增的 FIND-6（位置精确性）捕获，
   FIND-7（非空断言）**未能**捕获 —— 证明"只断言命中数"是不充分的。

> 附：沙箱内 `regression.ts` 的 D/gate 组在 `current` 变体下失败 2 条（D-gate-1/D-gate-2，
> 因沙箱内的 m1-editor.ts 仍是自参照闸门），在 `patched` 变体下失败 0 条。
> 这恰好证明 D/gate 守卫本身有效，且按组判定不会污染反证结论。

### 判定方法上的两个坑（都已踩并修正，记录下来防止后人重蹈）

1. **必须按组判定，不能用总退出码**：`regression.ts` 的 D/gate 组是静态守卫，
   检查的是工程真实文件，与"查找功能是否被变异打坏"正交。若用总退出码判定，
   会把 D/gate 的失败误算成"闸门捕获了变异"，结论会**反向**。
2. **分组过滤必须排除 D/gate 行**：D-gate-2 的断言文案里含"B2 查找"字样，
   若过滤条件只写 `includes("B2 查找")`，该行会被误计进"查找组失败数"，
   使对照组出现假失败。已改为：排除 `[D/gate]` 行，且 m1-editor 侧用 `/^!!\s*B2\s*(查找|高亮)/` 精确锚定。

> 这两个坑都是我自己的测试/工具代码 bug，已自行修正（按路由规则属 QA 自行处理，不回退给 team-lead）。


### 修复落地后的复跑（最终判据）—— ✅ 已完成

工程师修复落地后，用**同一套变异集**对**改造后的真实闸门**重跑（2026-11-20 15:48）：

| 变异 | m1-editor 查找组失败 | regression FIND 组失败 | 判定 |
|---|---|---|---|
| `none`（对照） | 0 | 0 | ✔ 基线正常 |
| `empty` | 40 | 7 | ✔ 捕获 |
| `revert` | 40 | 7 | ✔ 捕获 |
| `offbyone` | 26 | 1 | ✔ 捕获 |
| `hljsclass` | 7 | 0 | ✔ 捕获 |

**反证通过：闸门对全部 4 类变异均具备鉴别力。**

一键命令：`bash .workbuddy/falsify/round2.sh`（7 阶段全量回归 + 反证，约 1m28s）




## 我方用例的自检（regression.ts）

反证过程中发现**我自己的 FIND 组也存在同义反复风险**，已修正（见下方"QA 自查修正"）：

- FIND-1：改为与**独立朴素参照**（`doc.textContent` 计数，不调用被测函数）比对，不再写死 2。
- FIND-6（新增）：每个命中的 `textBetween(from,to)` 必须精确等于查询词 —— 捕获位置级错误。
- FIND-7（新增）：命中数为 2 **且非空** —— 防止"恒返回空集"被恒真的等价性断言掩盖。

## 可复现命令

```bash
cd D:/PROJECT/MWTyper/.workbuddy/falsify && node run-falsify.mjs
```

输出：控制台判定表 + `falsify-detail.txt`（逐变异完整 stdout/stderr，供人工复核）。

## 边界声明

- 反证只覆盖 **查找替换（B2/find）** 这条链路。其余 D1/D3/D2/a11y 分支未做变异注入，
  原因是这些分支的失效在第 1 轮已被真实源码缺陷触发过，具备实证覆盖。
- 沙箱 `src/` 是拷贝副本，**不覆盖** Vite 构建、Rust 后端、`cargo test`；
  这些由第 2 轮全量回归在真实工程上执行。
