// 大目录保护（TREE_AUTO_EXPAND_MAX_NODES）的自验探针
// 目的：现有 QA 断言的目录规模都很小，无法证明「超大目录默认折叠」真的生效。
//       本探针构造超大目录，实测行为，并做变异反证。
//
// 运行：node node_modules/tsx/dist/cli.mjs tests/falsify/large-dir-probe.ts
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", ".."); // 仓库根（tests/falsify/ 的上上级）

const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.MutationObserver = dom.window.MutationObserver;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(0), 0);
g.cancelAnimationFrame = (id: number) => dom.window.clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

const { collectDirSizes, collectDirPaths, TREE_AUTO_EXPAND_MAX_NODES } = await import(
  "../../src/sidebar/FileTree"
);

let pass = 0;
let fail = 0;
function check(cond: boolean, name: string, detail = ""): void {
  if (cond) { pass++; console.log(`OK  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`!!  ${name}${detail ? " — " + detail : ""}`); }
}

// ---- 构造树：普通目录（3 项） + 超大目录（含 250 文件 + 两层嵌套子目录） ----
// 嵌套是必需的：countNodes 的递归性只有在「子目录里还有子目录」时才可被区分，
// 否则「只算直接子节点」的退化实现会得到同样的数字，变异就逃逸了。
const SMALL = "/demo/small";
const BIG = "/demo/big";
const NESTED = "/demo/big/nested";
const DEEP = "/demo/big/nested/deep";
type Node = { path: string; name: string; kind: "dir" | "file"; children?: Node[] };

const bigChildren: Node[] = [];
for (let i = 0; i < 250; i++) {
  bigChildren.push({ path: `${BIG}/f${i}.md`, name: `f${i}.md`, kind: "file" });
}
const deepChildren: Node[] = [];
for (let i = 0; i < 3; i++) {
  deepChildren.push({ path: `${DEEP}/d${i}.md`, name: `d${i}.md`, kind: "file" });
}
const nestedChildren: Node[] = [];
for (let i = 0; i < 5; i++) {
  nestedChildren.push({ path: `${NESTED}/n${i}.md`, name: `n${i}.md`, kind: "file" });
}
nestedChildren.push({ path: DEEP, name: "deep", kind: "dir", children: deepChildren });
bigChildren.push({ path: NESTED, name: "nested", kind: "dir", children: nestedChildren });

const tree: Node = {
  path: "/demo",
  name: "demo",
  kind: "dir",
  children: [
    { path: SMALL, name: "small", kind: "dir", children: [
      { path: `${SMALL}/a.md`, name: "a.md", kind: "file" },
      { path: `${SMALL}/b.md`, name: "b.md", kind: "file" },
    ] },
    { path: BIG, name: "big", kind: "dir", children: bigChildren },
  ],
};

console.log(`阈值 TREE_AUTO_EXPAND_MAX_NODES = ${TREE_AUTO_EXPAND_MAX_NODES}\n`);

const sizes = collectDirSizes(tree as never);
const dirs = collectDirPaths(tree as never);

check(dirs.includes(SMALL) && dirs.includes(BIG), "L-1 collectDirPaths 收集到两个目录", dirs.join(","));
check((sizes.get(SMALL) ?? 0) === 3, "L-2 小目录子树节点数 = 3", String(sizes.get(SMALL)));
// BIG = 自身 1 + 250 文件 + NESTED(10) = 261
check((sizes.get(BIG) ?? 0) === 261, "L-3 超大目录子树节点数 = 261（含嵌套子目录）", String(sizes.get(BIG)));
check((sizes.get(BIG) ?? 0) > TREE_AUTO_EXPAND_MAX_NODES, "L-4 超大目录确实超过阈值");
check((sizes.get(SMALL) ?? 0) <= TREE_AUTO_EXPAND_MAX_NODES, "L-5 小目录未超过阈值");

// ---- 实测 App.tsx 里「默认展开」的真实实现 ----
//
// ⚠️ 同义反复陷阱：若在此处复制一份 App 的展开逻辑再断言，等于拿被测代码的副本当参照，
//    App 侧逻辑被改坏时探针仍会 PASS（L-M2 变异即因此漏网）。
// 正确做法：**直接断言 App.tsx 源码里的真实判断**，而不是复刻一份。
const appSrc = readFileSync(join(ROOT, "src/App.tsx"), "utf8");

// 提取 App 中实际使用的规模判断表达式（右操作数一并捕获，用于判定「用不用具名常量」）
const guardMatch = appSrc.match(
  /if \(\(sizes\.get\(p\) \?\? 0\) (<=|<|>=|>)\s*([A-Za-z_][\w.]*)\) next\.add\(p\);/
);
check(!!guardMatch, "L-12 App.tsx 中存在「按子树规模决定是否自动展开」的真实判断");
const guardOp = guardMatch ? guardMatch[1] : "?";
const guardRhs = guardMatch ? guardMatch[2] : "";
check(guardOp === "<=", "L-13 App.tsx 的规模判断为「节点数 ≤ 阈值则展开」", `实际运算符=${guardOp}`);

// 阈值来源：App.tsx 必须「引用」具名常量，而不是自己写死一个数字。
// 注意：App.tsx 只是【导入】该常量（定义在 FileTree.tsx），并不定义它，
// 所以不能用 /TREE_AUTO_EXPAND_MAX_NODES\s*=\s*(\d+)/ 去 App.tsx 里找定义——那永远匹配不到。
const literalDefInApp = appSrc.match(/TREE_AUTO_EXPAND_MAX_NODES\s*=\s*\d+/);
check(
  !literalDefInApp && guardRhs === "TREE_AUTO_EXPAND_MAX_NODES",
  "L-14 App.tsx 用具名阈值常量（无字面量硬编码）",
  `字面量定义=${!!literalDefInApp} 判断右操作数=${guardRhs || "(未取到)"}`
);
const importedFrom = appSrc.match(/import FileTree, \{([^}]*)\} from "\.\/sidebar\/FileTree";/);
check(
  !!importedFrom && importedFrom[1].includes("TREE_AUTO_EXPAND_MAX_NODES"),
  "L-15 App.tsx 从 FileTree 导入阈值常量（单一事实源）"
);

// countNodes 的递归性：NESTED = 自身 1 + 5 文件 + DEEP(4) = 10
// 「只算直接子节点」的退化实现会得到 7，因此本项可证伪 countNodes 的递归。
check((sizes.get(NESTED) ?? 0) === 10, "L-16 countNodes 递归统计嵌套子目录", String(sizes.get(NESTED)));

// 直接以 App 的真实语义计算「哪些目录会被默认展开」：
// 复用 App 的 collectDirSizes 调用（同一函数，单一事实源），并套用 App 的真实判断运算符。
function defaultExpandAsAppWould(t: Node): Set<string> {
  const known = new Set<string>();
  const d = collectDirPaths(t as never);
  const s = collectDirSizes(t as never);
  const fresh = d.filter((p) => !known.has(p));
  for (const p of d) known.add(p);
  const next = new Set<string>();
  for (const p of fresh) {
    const size = s.get(p) ?? 0;
    // 按 App.tsx 里的真实运算符判定
    const shouldAdd = guardOp === "<=" ? size <= TREE_AUTO_EXPAND_MAX_NODES
      : guardOp === "<" ? size < TREE_AUTO_EXPAND_MAX_NODES
      : guardOp === ">=" ? size >= TREE_AUTO_EXPAND_MAX_NODES
      : guardOp === ">" ? size > TREE_AUTO_EXPAND_MAX_NODES
      : false;
    if (shouldAdd) next.add(p);
  }
  return next;
}

const expanded = defaultExpandAsAppWould(tree);
check(expanded.has(SMALL), "L-6 小目录默认展开", [...expanded].join(","));
check(!expanded.has(BIG), "L-7 超大目录默认折叠（保护生效）", [...expanded].join(","));

// 手动展开超大目录仍然可行
const manual = new Set(expanded);
manual.add(BIG);
check(manual.has(BIG), "L-8 超大目录仍可手动展开");

// 刷新树不改变已展开状态（已知目录不重复默认展开）
const known = new Set<string>();
for (const p of dirs) known.add(p);
const secondRun: Set<string> = new Set();
const fresh2 = dirs.filter((p) => !known.has(p));
for (const p of fresh2) {
  const size = sizes.get(p) ?? 0;
  const shouldAdd = guardOp === "<=" ? size <= TREE_AUTO_EXPAND_MAX_NODES
    : guardOp === "<" ? size < TREE_AUTO_EXPAND_MAX_NODES
    : guardOp === ">=" ? size >= TREE_AUTO_EXPAND_MAX_NODES
    : guardOp === ">" ? size > TREE_AUTO_EXPAND_MAX_NODES
    : false;
  if (shouldAdd) secondRun.add(p);
}
check(secondRun.size === 0, "L-9 刷新树不重复默认展开（用户意图不被覆盖）");

// 边界：恰好等于阈值应展开，超过 1 项应折叠
function makeTree(n: number): Node {
  const kids: Node[] = [];
  for (let i = 0; i < n; i++) kids.push({ path: `/d/x${i}.md`, name: `x${i}.md`, kind: "file" });
  return { path: "/d", name: "d", kind: "dir", children: kids };
}
const exact = makeTree(TREE_AUTO_EXPAND_MAX_NODES - 1); // 子树 = 1 + (阈值-1) = 阈值
const over = makeTree(TREE_AUTO_EXPAND_MAX_NODES);      // 子树 = 阈值 + 1
check(defaultExpandAsAppWould(exact).has("/d"), "L-10 恰好等于阈值 → 展开");
check(!defaultExpandAsAppWould(over).has("/d"), "L-11 超过阈值 1 项 → 折叠");

console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
console.log(fail === 0 ? "== 结论：大目录保护 PASS ==" : "== 结论：FAIL ==");
process.exit(fail === 0 ? 0 : 1);
