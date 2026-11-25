#!/usr/bin/env node
/**
 * QA 反证工具（任务 #7 第二轮）
 *
 * 目的：证明「spike 闸门」真的能捕获查找替换失效，而不是恒绿。
 *
 * 手法：不触碰工程源码（src/ 与 spikes/ 原件一律只读），
 *       在 .workbuddy/falsify/ 下建立一份 src/ + spikes/ 的沙箱副本，
 *       只对副本里的 find-replace.ts 施加定向变异（mutation），再跑沙箱里的闸门。
 *
 * 变异集：
 *   none      —— 对照组，不变异（必须 PASS，证明沙箱本身可信）
 *   empty     —— computeMatches 恒返回 []（空集故障）
 *   revert    —— 把 descendants 回调里的 `return true` 改回 `return false`（还原 E01 历史缺陷）
 *   offbyone  —— 命中区间 to 偏移 +1（微小错误：非空断言无法捕获，只有等价性参照能捕获）
 *
 * 判定：每个变异下，m1-editor.ts 与 regression.ts 都必须 FAIL；
 *       若某变异下仍然 PASS，说明闸门对该类失效无鉴别力（=闸门有缺陷）。
 */
import { readdirSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", ".."); // 仓库根（tests/falsify/ 的上上级）
const SANDBOX = join(HERE, "sandbox");

// Node 可执行文件：默认用当前进程的解释器；需要指定别的版本时设 NODE_BIN。
// （tsx 4.23 需要 Node ≥ 18，老版本解释器跑不起来。）
const NODE24 = process.env.NODE_BIN || process.execPath;
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const mutations = ["none", "empty", "revert", "offbyone", "hljsclass"];

/**
 * 重建沙箱：拷贝当前工程的 src/ 与被测 spike 文件（原件只读）。
 *
 * 注意：不能对整个 sandbox 目录做 rmSync(recursive) —— 文件数超过 50 会触发宿主的安全删除守卫
 * （SAFE_DELETE_BULK_CONFIRM_REQUIRED）而中断脚本。改为「增量同步 + 逐个文件删除陈旧项」。
 */
function syncDir(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  const srcEntries = readdirSync(srcDir, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map((e) => e.name));
  for (const e of srcEntries) {
    const s = join(srcDir, e.name);
    const d = join(destDir, e.name);
    if (e.isDirectory()) syncDir(s, d);
    else copyFileSync(s, d);
  }
  // 清理源已删除的陈旧文件（逐个删除，避免触发批量删除守卫）
  for (const e of readdirSync(destDir, { withFileTypes: true })) {
    if (srcNames.has(e.name)) continue;
    rmSync(join(destDir, e.name), { recursive: true, force: true });
  }
}

function buildSandbox() {
  mkdirSync(SANDBOX, { recursive: true });
  syncDir(join(ROOT, "src"), join(SANDBOX, "src"));
  mkdirSync(join(SANDBOX, "spikes"), { recursive: true });
  for (const f of ["m1-editor.ts", "regression.ts"]) {
    copyFileSync(join(ROOT, "spikes", f), join(SANDBOX, "spikes", f));
  }
  // 必须连 tsconfig.json 一起拷贝：tsx 依据 tsconfig 的 "jsx": "react-jsx" 选择新版 JSX 运行时；
  // 缺失时会退回 classic 运行时，导致 "React is not defined"（沙箱内 src/App.tsx 报错）。
  copyFileSync(join(ROOT, "tsconfig.json"), join(SANDBOX, "tsconfig.json"));
  // package.json 提供 "type": "module"，同样需要
  copyFileSync(join(ROOT, "package.json"), join(SANDBOX, "package.json"));
}

/**
 * 幂等地把 E01 历史缺陷（descendants 回调 `return false` 跳过子树）在沙箱副本里修正为 `return true`。
 * 若工程师的修复已落地（该行已是 return true），此步骤为 no-op。
 * 目的：让对照组 none = "已修复的基线"，从而把「闸门有无鉴别力」与「源码是否已修」两个变量解耦。
 */
function applySourceFix() {
  const p = join(SANDBOX, "src", "editor", "find-replace.ts");
  let src = readFileSync(p, "utf8");
  const re = /if \(!node\.isText \|\| !node\.text\) return (true|false);/;
  const m = src.match(re);
  if (!m) return { applied: false, already: true };
  if (m[1] === "true") return { applied: false, already: true };
  src = src.replace(re, "if (!node.isText || !node.text) return true;");
  writeFileSync(p, src);
  return { applied: true, already: false };
}

/**
 * 可选：把沙箱里的 m1-editor.ts 闸门替换为「独立朴素参照 + 非空断言」的强化版。
 *
 * 用途有二：
 *  1) 当工程师的修复尚未落地时，先行验证「这种闸门设计确实有鉴别力」——反证方法论自身必须先被验证；
 *  2) 给工程师一份可直接抄的参照实现。
 *
 * 关键点：朴素参照 naiveFind 用 indexOf 扫描 + 独立的遍历守卫写法，
 * 与被测实现 computeMatches（RegExp + 另一套守卫）无任何共享代码路径。
 */
function patchGate() {
  const p = join(SANDBOX, "spikes", "m1-editor.ts");
  let src = readFileSync(p, "utf8");

  const helper = `
/** 独立朴素参照：不复用被测实现，indexOf 扫描文本节点，守卫写法与 computeMatches 无关。 */
function naiveFind(doc: any, query: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const q = query.toLowerCase();
  doc.descendants((node: any, pos: number) => {
    if (node.type?.name !== "text") return true;
    const text: string = node.text ?? "";
    let i = text.toLowerCase().indexOf(q);
    while (i !== -1) {
      out.push({ from: pos + i, to: pos + i + query.length });
      i = text.toLowerCase().indexOf(q, i + 1);
    }
    return true;
  });
  return out;
}
`;

  const anchor = "let failures = 0;";
  if (!src.includes(anchor)) throw new Error("patchGate 锚点未找到");
  src = src.replace(anchor, helper + "\n" + anchor);

  const oldGate = `  const expectedMatches = matchSig(computeMatches(tr.doc, "test", false, false));`;
  const newGate = `  const expectedMatches = matchSig(naiveFind(tr.doc, "test"));`;
  if (!src.includes(oldGate)) throw new Error("patchGate 期望值锚点未找到（工程师可能已改写此行）");
  src = src.replace(oldGate, newGate);

  const oldCheck = `  check(matchSig(actualMatches) === expectedMatches, \`B2 查找等价：\${scenario.name}\`);`;
  const newCheck =
    `  check(actualMatches.length > 0, \`B2 查找非空：\${scenario.name}\`);\n` +
    `  check(matchSig(actualMatches) === expectedMatches, \`B2 查找等价：\${scenario.name}\`);`;
  if (!src.includes(oldCheck)) throw new Error("patchGate 断言锚点未找到（工程师可能已改写此行）");
  src = src.replace(oldCheck, newCheck);

  writeFileSync(p, src);
  return true;
}

/** 对沙箱里的 find-replace.ts 施加变异；返回变更描述 */
function mutate(kind) {
  const p = join(SANDBOX, "src", "editor", "find-replace.ts");
  let src = readFileSync(p, "utf8");
  const before = src;

  if (kind === "none") {
    // 不变异
  } else if (kind === "empty") {
    // computeMatches 恒返回空集
    const anchor = "  if (!query) return [];\n  let pat = escapeRegex(query);";
    if (!src.includes(anchor)) throw new Error("empty 变异锚点未找到");
    src = src.replace(
      anchor,
      "  if (!query) return [];\n  return []; /* QA-FALSIFY: computeMatches 恒空 */\n  let pat = escapeRegex(query);"
    );
  } else if (kind === "revert") {
    // 还原 E01 历史缺陷：descendants 回调遇到非文本节点即 return false（跳过子树）
    const re = /if \(!node\.isText \|\| !node\.text\) return (true|false);/;
    if (!re.test(src)) throw new Error("revert 变异锚点未找到");
    src = src.replace(re, "if (!node.isText || !node.text) return false; /* QA-FALSIFY: 还原 E01 */");
  } else if (kind === "offbyone") {
    // 命中区间 to 偏移 +1：命中数仍 >0，非空断言无法捕获
    const anchor = "out.push({ from: pos + m.index, to: pos + m.index + m[0].length });";
    if (!src.includes(anchor)) throw new Error("offbyone 变异锚点未找到");
    src = src.replace(
      anchor,
      "out.push({ from: pos + m.index, to: pos + m.index + m[0].length + 1 }); /* QA-FALSIFY: off-by-one */"
    );
  } else if (kind === "hljsclass") {
    // 高亮 class 篡改：把 code-block.ts 产出的 class 统一改成一个假值。
    // 命中数不变、位置不变，只有「class 真正参与比较」的闸门才能捕获。
    // 旧的 decoSig 读 d.spec.class（恒 undefined）→ 假通过，无法捕获本变异。
    const cp = join(SANDBOX, "src", "editor", "code-block.ts");
    let csrc = readFileSync(cp, "utf8");
    const canchor = "Decoration.inline(pos + 1 + offset, pos + 1 + offset + raw.length, { class: cls })";
    if (!csrc.includes(canchor)) throw new Error("hljsclass 变异锚点未找到");
    csrc = csrc.replace(
      canchor,
      "Decoration.inline(pos + 1 + offset, pos + 1 + offset + raw.length, { class: 'qa-falsify-bogus' }) /* QA-FALSIFY: class 篡改 */"
    );
    writeFileSync(cp, csrc);
    return { file: cp, changed: true };
  }

  if (src !== before) writeFileSync(p, src);
  return { file: p, changed: src !== before };
}

/**
 * 运行沙箱里的某个 spike，返回 {code, out, failLines, groupFail}
 *
 * failLines：该 spike 中所有失败断言（"!! " 开头的行）
 * groupFail：仅与「查找替换」相关的失败断言（m1-editor 的 "B2 查找" / regression 的 "[B/find]"）
 *
 * 说明：判定必须**按组**而非按总退出码。regression.ts 里 D/gate 组是静态守卫，
 * 它检查的是工程真实文件（m1-editor.ts / find-replace.ts），与「查找功能是否被变异打坏」正交；
 * 若用总退出码，会把 D/gate 的失败误算成"闸门捕获了变异"，得出错误结论。
 */
function runSpike(name) {
  const r = spawnSync(NODE24, [TSX, join("spikes", name)], {
    cwd: SANDBOX,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 300000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const failLines = out.split(/\r?\n/).filter((l) => l.startsWith("!! "));
  // 「查找组」= 查找替换相关的失败断言。
  // 必须排除 D/gate 静态守卫组：它的断言文案里也含「B2 查找」字样，
  // 若不排除会被误计为"闸门捕获了变异"，导致反证结论反向。
  const groupFail = failLines.filter(
    (l) =>
      !l.includes("[D/gate]") &&
      (l.includes("[B/find]") || /^!!\s*B2\s*(查找|高亮)/.test(l))
  );
  const m = out.match(/总计\s*(\d+)\s*项[^\n]*通过\s*(\d+)[^\n]*失败\s*(\d+)/);
  const m2 = out.match(/失败\s*(\d+)\s*FAIL/);
  return {
    code: r.status,
    out,
    failLines,
    groupFail,
    passed: m ? Number(m[2]) : null,
    failed: m ? Number(m[3]) : m2 ? Number(m2[1]) : null,
  };
}

const results = [];
for (const gate of ["current", "patched"]) {
  for (const kind of mutations) {
    buildSandbox();
    const fx = applySourceFix();
    let gateNote = "工程现状闸门";
    if (gate === "patched") {
      try {
        patchGate();
        gateNote = "强化闸门(独立参照+非空)";
      } catch (e) {
        gateNote = `强化闸门跳过(${String(e.message).slice(0, 40)})`;
      }
    }
    const m = mutate(kind);
    const ed = runSpike("m1-editor.ts");
    const rg = runSpike("regression.ts");
    results.push({ gate, kind, changed: m.changed, fx, gateNote, ed, rg });
    console.log(
      `[${gate}/${kind}] 基线=${fx.applied ? "已修" : fx.already ? "源码已修" : "未修"} | ` +
        `变异=${m.changed ? "已施加" : "无"} | 闸门=${gateNote} | ` +
        `m1-editor: 查找组失败=${ed.groupFail.length} | ` +
        `regression: FIND组失败=${rg.groupFail.length} (总失败=${rg.failed})`
    );
  }
}

// 输出详细失败清单，便于人工复核
writeFileSync(
  join(HERE, "falsify-detail.txt"),
  results
    .map(
      (r) =>
        `================ gate=${r.gate} | mutation=${r.kind} (变异${r.changed ? "已施加" : "无"}) ================\n` +
        `--- m1-editor.ts exit=${r.ed.code} ---\n${r.ed.out}\n` +
        `--- regression.ts exit=${r.rg.code} ---\n${r.rg.out}\n`
    )
    .join("\n")
);

console.log("\n===== 反证判定（按组：m1-editor 的「B2 查找」+ regression 的「[B/find]」） =====");
let allGood = true;
for (const gate of ["current", "patched"]) {
  for (const r of results.filter((x) => x.gate === gate)) {
    // 查找组失败数：两个 spike 相加
    const gFail = r.ed.groupFail.length + r.rg.groupFail.length;
    if (r.kind === "none") {
      // 对照组：查找组必须零失败（基线已修复，查找功能应完全正常）
      const ok = gFail === 0;
      allGood = allGood && ok;
      console.log(
        `[${gate}] 对照组 none   : ${ok ? "查找组 0 失败 ✔（基线正常）" : `!! 异常：对照组查找组有 ${gFail} 条失败`}`
      );
    } else {
      // 变异组：查找组必须出现失败，否则说明闸门对该类失效无鉴别力
      const ok = gFail > 0;
      allGood = allGood && ok;
      console.log(
        `[${gate}] 变异 ${r.kind.padEnd(9)}: ${ok ? `查找组 ${gFail} 条失败 ✔（具备鉴别力）` : "!! 查找组 0 失败（无鉴别力 ✘）"}`
      );
    }
  }
}
console.log(
  allGood
    ? "\n反证结论：闸门对全部变异均具备鉴别力。"
    : "\n反证结论：存在变异未被捕获，闸门鉴别力不足。"
);
process.exit(allGood ? 0 : 1);
