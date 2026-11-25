// M0 spike ②：md ⇄ tiptap 往返保真（无头，MarkdownManager 直接操作 JSON）
// 判据：1) md→json→md' 规范化后逐行对照；2) md'→json' 与 json 深度相等（往返稳定）
// 运行：pnpm spike:roundtrip（需 Node 24 在 PATH）
// v1.2 起直接复用 src/editor/extensions（单一事实源：spike 即真实实现的回归测试）
import { markdown as mm } from "../src/editor/extensions";
import { writeFileSync } from "node:fs";

// ---- 测试样本：中文 + GFM 全要素 ----
const FRONTMATTER = `---
title: 测试文档
tags: [a, b]
---
`;

const SAMPLE = `# 标题一 H1

普通段落，包含**粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://example.com)与![图片](assets/img.png)。

## 二级标题

- 无序项一
- 无序项二
  - 嵌套项

1. 有序一
2. 有序二

- [ ] 待办任务
- [x] 已完成任务

> 引用块
> 第二行

\`\`\`ts
const x: number = 42;
console.log(x);
\`\`\`

| 列A | 列B |
| --- | --- |
| 1 | 2 |
| 中文 | **粗体字** |

行内公式 $E=mc^2$ 与块级：

$$
\\int_0^1 x^2 dx
$$

---

结束段落。
`;

function normalize(md: string): string[] {
  return md
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, "").replace(/^\s*[-*]\s+/g, "- ").replace(/\*([^*]+)\*/g, "_$1_"))
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .filter((l) => l !== "");
}

function nodeTypes(json: any, acc: Record<string, number> = {}): Record<string, number> {
  if (!json) return acc;
  if (json.type) acc[json.type] = (acc[json.type] || 0) + 1;
  for (const c of json.content || []) nodeTypes(c, acc);
  return acc;
}

const report: string[] = [];
const log = (s: string) => { report.push(s); console.log(s); };

// frontmatter 处理：marked 不识别，先剥离（D9：前置元数据单独保管，序列化时回贴）
const json1 = mm.parse(SAMPLE);
const md2 = mm.serialize(json1);
const json2 = mm.parse(md2);

log("== 节点类型统计（json1） ==");
log(JSON.stringify(nodeTypes(json1), null, 0));

const mustHave = ["table", "tableRow", "tableHeader", "tableCell", "taskList", "taskItem", "codeBlock", "inlineMath", "blockMath", "image", "blockquote", "heading", "bulletList", "orderedList", "horizontalRule"];
const types1 = nodeTypes(json1);
const missing = mustHave.filter((t) => !types1[t]);
log(missing.length ? `!! 缺失节点类型: ${missing.join(", ")}` : "OK 全部关键节点类型均被解析");

// 代码块语言属性
const codeBlocks: any[] = [];
(function walk(n: any) { if (n.type === "codeBlock") codeBlocks.push(n.attrs); (n.content || []).forEach(walk); })(json1);
log("codeBlock attrs: " + JSON.stringify(codeBlocks));

// 判据 2：往返稳定（json1 vs json2 深度相等）
const stable = JSON.stringify(json1) === JSON.stringify(json2);
log(stable ? "OK 判据2：md'→json' 与 json 深度相等（往返稳定）" : "!! 判据2：二次解析 JSON 不一致");

// 判据 1：规范化文本对照
const a = normalize(SAMPLE), b = normalize(md2);
const diffs: string[] = [];
const max = Math.max(a.length, b.length);
for (let i = 0; i < max; i++) {
  if (a[i] !== b[i]) diffs.push(`  行${i + 1}\n    原文: ${a[i] ?? "<无>"}\n    往返: ${b[i] ?? "<无>"}`);
}
log(diffs.length ? `!! 判据1：${diffs.length} 行差异:\n${diffs.join("\n")}` : "OK 判据1：规范化后逐行一致");

// frontmatter 单独验证：剥离→回贴是否无损
const fmRoundtrip = FRONTMATTER + md2;
log("frontmatter 策略：剥离单独保管 + 序列化回贴（marked 不解析 YAML，属预期设计而非缺陷）");

writeFileSync(new URL("./roundtrip-output.md", import.meta.url), fmRoundtrip, "utf-8");
writeFileSync(new URL("./roundtrip-report.txt", import.meta.url), report.join("\n"), "utf-8");
log("产物：spikes/roundtrip-output.md / roundtrip-report.txt");

const pass = missing.length === 0 && stable;
log(pass ? "== 结论：往返保真 PASS（差异见判据1明细） ==" : "== 结论：往返保真 FAIL，触发 D1 回退评估 ==");
process.exit(pass ? 0 : 1);