// ---------------------------------------------------------------------------
// Markdown 序列化保真探针（缺陷 B1 / B2 / B3 / B4）
//
// 运行：node node_modules/tsx/dist/cli.mjs .workbuddy/review/serde-probe.ts
// 可选：加 --fast 跳过三套 spike 与 tsc 的回归检查（只跑保真断言）
//
// 环境与 spikes/*.ts 保持一致：jsdom（tiptap markdown 的 HTML 解析分支需要
// window，否则 parseHTMLToken 走的是纯文本兜底路径）。
// ---------------------------------------------------------------------------
import { JSDOM } from "jsdom";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import type { JSONContent } from "@tiptap/core";

// ---------------------------------------------------------------- jsdom 环境
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const w = dom.window as unknown as Record<string, unknown>;
for (const k of [
  "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "Element", "Node", "DocumentFragment", "MutationObserver", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "DOMParser", "XMLSerializer", "Range",
  "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent",
  "CSS", "history", "location", "localStorage", "NodeFilter", "Text",
]) {
  if (w[k] !== undefined) (globalThis as Record<string, unknown>)[k] = w[k];
}
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { markdown, extensions } = await import(pathToFileURL(resolve(ROOT, "src/editor/extensions.ts")).href);

// ---------------------------------------------------------------- 断言工具
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass += 1;
    console.log(`PASS [${name}] ${detail}`);
  } else {
    fail += 1;
    failures.push(`${name} — ${detail}`);
    console.log(`FAIL [${name}] ${detail}`);
  }
}

function show(v: unknown): string {
  return JSON.stringify(v);
}

/** 段落形态的文档（编辑器里真实存在的形态） */
function paragraphDoc(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

/** 顶层节点类型序列 */
function topTypes(json: JSONContent): string[] {
  return (json.content ?? []).map((n) => n.type);
}

/** 全文纯文本（按顺序拼接） */
function plainText(json: JSONContent): string {
  if (json.type === "text") return json.text ?? "";
  return (json.content ?? []).map(plainText).join("");
}

/** 结构指纹：类型 / 顺序 / 文本 / 标记 / attrs（用于幂等性比较） */
function fingerprint(node: JSONContent): unknown {
  const out: Record<string, unknown> = { type: node.type };
  if (node.attrs) out.attrs = JSON.parse(JSON.stringify(node.attrs));
  if (node.type === "text") out.text = node.text ?? "";
  if (node.marks && node.marks.length) out.marks = node.marks.map((m: any) => (typeof m === "string" ? m : m.type));
  if (node.content) out.content = node.content.map(fingerprint);
  return out;
}

/** 最长连续换行数（连续 4 个换行 = 3 个空行） */
function maxNewlineRun(s: string): number {
  let best = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "\n") {
      cur += 1;
      if (cur > best) best = cur;
    } else cur = 0;
  }
  return best;
}

const roundTrip = (md: string): string => markdown.serialize(markdown.parse(md));

console.log("========== B1：原始 HTML 块往返保留 ==========");
{
  const src = "# 标题\n\n<!-- TODO -->\n\n正文";
  const out = roundTrip(src);
  check("B1-1a HTML 注释保留", out.includes("<!-- TODO -->"), `输出=${show(out)}`);
  const run = maxNewlineRun(out);
  check("B1-1b 无连续 3 个以上空行", run <= 3, `最长连续换行=${run} 输出=${show(out)}`);

  const json = markdown.parse(src);
  const htmlNode = (json.content ?? []).find((n) => n.type === "rawHtml");
  check("B1-1c 注释落在 rawHtml 节点", !!htmlNode, `节点=${show(htmlNode)}`);
  check(
    "B1-1d HTML 原文逐字节一致",
    htmlNode?.attrs?.html === "<!-- TODO -->",
    `attrs.html=${show(htmlNode?.attrs?.html)}`
  );

  const src2 = "a\n\n<script>alert(1)</script>\n\nb";
  const out2 = roundTrip(src2);
  check("B1-2 script 块保留", out2.includes("<script>alert(1)</script>"), `输出=${show(out2)}`);
  check("B1-2b script 未被转义", !out2.includes("&lt;script"), `输出=${show(out2)}`);

  const src3 = 'x\n\n<div class="note" data-k="1">提示</div>\n\ny';
  const out3 = roundTrip(src3);
  check("B1-3 带属性 div 保留", out3.includes('<div class="note" data-k="1">提示</div>'), `输出=${show(out3)}`);

  // 反向：html 节点进编辑器 schema 不炸
  let editorOk = "OK";
  try {
    const { Editor } = await import("@tiptap/core");
    const el = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(el);
    const ed = new Editor({ element: el, extensions: extensions as any, content: markdown.parse(src) as any });
    ed.destroy();
  } catch (e) {
    editorOk = "THROW: " + (e as Error).message;
  }
  check("B1-4 rawHtml 节点可被编辑器接受", editorOk === "OK", editorOk);
}

console.log("\n========== B2：表格表头语义 ==========");
{
  const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  const json1 = markdown.parse(src);
  const firstRow = (json1.content ?? [])[0]?.content?.[0];
  const cellTypes = (firstRow?.content ?? []).map((c: any) => c.type);
  check("B2-1 解析后首行是 tableHeader", cellTypes.every((t: string) => t === "tableHeader"), `首行单元格=${show(cellTypes)}`);

  const out1 = markdown.serialize(json1);
  const out2 = roundTrip(out1);
  check("B2-2 输出含分隔行", out1.includes("| --- | --- |"), `输出=${show(out1)}`);

  const json2 = markdown.parse(out1);
  const headerCells = (json2.content ?? [])[0]?.content?.[0]?.content ?? [];
  const headerText = headerCells.map((c: any) => plainText(c));
  check("B2-3 往返两次表头仍是 a / b", headerText[0] === "a" && headerText[1] === "b", `表头=${show(headerText)}`);
  check("B2-4 往返两次输出稳定", out1 === out2, `一次=${show(out1)} 两次=${show(out2)}`);

  // 在表头行前插入一个空 row
  const doc = JSON.parse(JSON.stringify(json1)) as JSONContent;
  const table = (doc.content ?? [])[0] as any;
  const emptyRow = {
    type: "tableRow",
    content: [
      { type: "tableCell", content: [{ type: "paragraph" }] },
      { type: "tableCell", content: [{ type: "paragraph" }] },
    ],
  };
  table.content.unshift(emptyRow);
  const out3 = markdown.serialize(doc);
  const firstLine = out3.split("\n")[0];
  check("B2-5 表头前插行后表头行仍是 a / b", firstLine.includes("a") && firstLine.includes("b"), `首行=${show(firstLine)}`);
  const secondLine = out3.split("\n")[1];
  check("B2-6 分隔行紧跟表头行", secondLine === "| --- | --- |", `次行=${show(secondLine)}`);

  // 插行后往返一次：表头内容不能丢
  const back = markdown.parse(out3);
  const backHeader = ((back.content ?? [])[0] as any)?.content?.[0]?.content ?? [];
  const backHeaderText = backHeader.map((c: any) => plainText(c));
  check("B2-7 插行后往返一次表头内容不丢", backHeaderText[0] === "a" && backHeaderText[1] === "b", `表头=${show(backHeaderText)}`);
  const backRows = ((back.content ?? [])[0] as any)?.content?.length ?? 0;
  check("B2-8 插行后往返一次行数不丢", backRows === 3, `行数=${backRows}`);
}

console.log("\n========== B3：段落行首标记转义 ==========");
{
  // 判据 5/6 的核心：编辑器里的「段落形态」往返后仍是段落
  for (const [label, text] of [
    ["B3-5", "- 不是列表"],
    ["B3-6", "# 不是标题"],
  ] as const) {
    const out = markdown.serialize(paragraphDoc(text));
    const back = markdown.parse(out);
    const top = topTypes(back);
    check(
      `${label}a 序列化做了 CommonMark 转义`,
      out.startsWith("\\"),
      `输出=${show(out)}`
    );
    check(
      `${label}b 再解析仍是 paragraph`,
      top.length === 1 && top[0] === "paragraph",
      `顶层节点=${show(top)}`
    );
    check(
      `${label}c 文本内容不变`,
      plainText(back) === text,
      `文本=${show(plainText(back))} 期望=${show(text)}`
    );
  }

  // 源码形态：CommonMark 里 "- 不是列表" 必然是列表项，
  // 这里断言的是「不漂移」：往返后仍是同一结构（判据 8 的要求）
  for (const [label, text] of [
    ["B3-5-src", "- 不是列表"],
    ["B3-6-src", "# 不是标题"],
  ] as const) {
    const json1 = markdown.parse(text);
    const out = markdown.serialize(json1);
    const back = markdown.parse(out);
    check(
      `${label} 源码形态往返结构不漂移`,
      show(fingerprint(json1)) === show(fingerprint(back)),
      `一次=${show(topTypes(json1))} 输出=${show(out)} 两次=${show(topTypes(back))}`
    );
  }

  // 不过度转义：行内的 - / # 不该动
  const plain = markdown.serialize(paragraphDoc("3-5 个东西，C# 笔记"));
  check("B3-7 行内标记不转义", plain === "3-5 个东西，C# 笔记", `输出=${show(plain)}`);

  // 其它会被误解析的行首
  const cases: Array<[string, string]> = [
    ["> 引用", "> 引用"],
    ["1. 有序", "1. 有序"],
    ["1) 有序", "1) 有序"],
    ["```js", "```js"],
    ["--- ", "--- "],
    ["=== ", "=== "],
    ["*星号*", "*星号*"],
    ["_下划线_", "_下划线_"],
    ["[ref]: http://x", "[ref]: http://x"],
  ];
  for (const [input, expected] of cases) {
    const out = markdown.serialize(paragraphDoc(input));
    const back = markdown.parse(out);
    const top = topTypes(back);
    check(
      `B3-8 ${JSON.stringify(input)} 往返仍是段落且文本不变`,
      top.length === 1 && top[0] === "paragraph" && plainText(back) === expected,
      `输出=${show(out)} 顶层=${show(top)} 文本=${show(plainText(back))}`
    );
  }
}

console.log("\n========== B4：脚注往返不变成字面链接 ==========");
{
  const src = "正文[^1]\n\n[^1]: 脚注";
  const json = markdown.parse(src);
  const out = markdown.serialize(json);
  check("B4-1 脚注定义保留", out.includes("[^1]: 脚注"), `输出=${show(out)}`);
  check("B4-2 不出现 [^1]( 字面链接", !out.includes("[^1]("), `输出=${show(out)}`);
  const htmlNode = (json.content ?? []).find((n) => n.type === "rawHtml");
  check("B4-3 脚注定义落在 rawHtml 节点", !!htmlNode, `节点=${show(htmlNode)}`);
  check(
    "B4-4 脚注定义原文逐字节一致",
    htmlNode?.attrs?.html === "[^1]: 脚注",
    `attrs.html=${show(htmlNode?.attrs?.html)}`
  );
  const bodyText = plainText((json.content ?? [])[0]);
  check("B4-5 正文引用保持 [^1] 字面形态", bodyText === "正文[^1]", `正文=${show(bodyText)}`);
  const out2 = roundTrip(out);
  check("B4-6 二次往返稳定", out === out2, `一次=${show(out)} 两次=${show(out2)}`);

  // 代码块里的 "[^1]: ..." 是代码，不是脚注，不能被摘走
  const code = "```md\n[^1]: 这是代码\n```\n\n正文";
  const codeOut = roundTrip(code);
  check(
    "B4-7 代码块里的脚注样文本不被摘走",
    codeOut.includes("[^1]: 这是代码") && !codeOut.includes("mwtyper-fn"),
    `输出=${show(codeOut)}`
  );

  // 缩进代码块（4 空格）同样不是脚注定义
  const indented = "正文\n\n    [^1]: 缩进代码\n";
  const indentedOut = roundTrip(indented);
  check(
    "B4-8 缩进代码块里的脚注样文本不被摘走",
    !indentedOut.includes("mwtyper-fn"),
    `输出=${show(indentedOut)}`
  );

  // 多个脚注定义
  const multi = "正文[^1][^2]\n\n[^1]: 甲\n\n[^2]: 乙";
  const multiOut = roundTrip(multi);
  check(
    "B4-9 多个脚注定义都保留",
    multiOut.includes("[^1]: 甲") && multiOut.includes("[^2]: 乙") && !multiOut.includes("[^1]("),
    `输出=${show(multiOut)}`
  );
}

console.log("\n========== 判据 8：往返幂等性 ==========");
{
  const sources = [
    "# 标题\n\n<!-- TODO -->\n\n正文",
    "a\n\n<script>alert(1)</script>\n\nb",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    "- 不是列表",
    "# 不是标题",
    "正文[^1]\n\n[^1]: 脚注",
    "> 引用\n\n- 列表项\n\n```js\nconst a = 1\n```\n\n普通段落，3-5 个",
    "## 二级标题\n\n正文 **加粗** 与 `代码`\n\n- [ ] 待办\n- [x] 完成",
  ];
  for (const src of sources) {
    const json1 = markdown.parse(src);
    const out = markdown.serialize(json1);
    const json2 = markdown.parse(out);
    const same = show(fingerprint(json1)) === show(fingerprint(json2));
    check(
      `幂等 ${show(src.slice(0, 28))}`,
      same,
      same ? `输出=${show(out)}` : `一次=${show(fingerprint(json1))} 两次=${show(fingerprint(json2))}`
    );
  }
}

console.log("\n========== 判据 9/10：既有 spike 回归 + 类型检查 ==========");
const fast = process.argv.includes("--fast");
if (fast) {
  console.log("SKIP [9/10] --fast：跳过 spike 与 tsc");
} else {
  const node = process.execPath;
  const tsx = resolve(ROOT, "node_modules/tsx/dist/cli.mjs");
  const spikes: Array<[string, number]> = [
    ["spikes/audit3.ts", 104],
    ["spikes/qa4-probe.ts", 121],
    ["spikes/regression.ts", 66],
  ];
  for (const [file, expected] of spikes) {
    const r = spawnSync(node, [tsx, resolve(ROOT, file)], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const output = (r.stdout ?? "") + (r.stderr ?? "");
    const m = /总计 (\d+) 项，通过 (\d+)，失败 (\d+)/.exec(output);
    const ok =
      r.status === 0 &&
      !!m &&
      Number(m[1]) === expected &&
      Number(m[2]) === expected &&
      Number(m[3]) === 0;
    check(
      `9 ${file}`,
      ok,
      ok ? `${m![1]} 项全部 PASS` : `exit=${r.status} 统计=${m ? show([m[1], m[2], m[3]]) : "无"} 输出尾部=${show(output.slice(-300))}`
    );
  }

  const tsc = spawnSync(node, [resolve(ROOT, "node_modules/typescript/bin/tsc"), "--noEmit"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600000,
  });
  check("10 tsc --noEmit", tsc.status === 0, tsc.status === 0 ? "0 错" : show((tsc.stdout ?? "") + (tsc.stderr ?? "").slice(0, 800)));
}

console.log("\n========== 汇总 ==========");
console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
if (fail > 0) {
  console.log("失败明细：");
  for (const f of failures) console.log("  - " + f);
}
process.exit(fail > 0 ? 1 : 0);
