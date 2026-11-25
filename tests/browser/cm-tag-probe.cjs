// 决定性实验：CodeMirror 6 能否把 6 种 Markdown 标记符分别着色
// 运行：node tests/browser/cm-tag-probe.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("node:path");
const { chromium } = require(PC);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto("http://localhost:1421/tests/browser/cm-tag-probe.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__ready === true, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);

  const r = await page.evaluate(() => window.__probe || null);
  console.log("页面错误:", errors.length ? JSON.stringify(errors.slice(0, 5)) : "无");
  if (!r) { console.log("!! 探针未就绪"); await browser.close(); process.exit(1); }

  console.log(`\n实验 A（现状做法：HighlightStyle + tags.processingInstruction）`);
  console.log(`  span 总数: ${r.aSpanCount}`);
  for (const [k, v] of Object.entries(r.a)) console.log(`  标记 ${JSON.stringify(k).padEnd(6)} → class="${v}"`);

  console.log(`\n实验 B（自定义 Highlighter，按 lezer 节点名分 class）`);
  console.log(`  span 总数: ${r.bSpanCount}`);
  for (const [k, v] of Object.entries(r.b)) console.log(`  标记 ${JSON.stringify(k).padEnd(6)} → class="${v}"`);

  const aDistinct = new Set(Object.values(r.a)).size;
  const bDistinct = new Set(Object.values(r.b)).size;
  console.log(`\nA 的不同 class 数: ${aDistinct}（6 种标记共用一个 tag → 预期 1~2）`);
  console.log(`B 的不同 class 数: ${bDistinct}（按节点名分 → 预期 ≥5）`);
  console.log(`\n结论: ${bDistinct >= 5 ? "✅ 自定义 Highlighter 可行 —— 6 种 Markdown 标记符能分别着色" : "❌ 需另寻方案"}`);

  await page.screenshot({ path: path.join(OUT, "cm-tag-probe.png") });
  await browser.close();
  process.exit(bDistinct >= 5 ? 0 : 1);
})();
