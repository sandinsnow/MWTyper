// 精确定位「打开查找条导致编辑区跳回顶部」的成因
const { EXE, PC } = require("./pw.cjs");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");

const LONG = Array.from({ length: 30 }, (_, i) =>
  `## 第 ${i + 1} 节\n\n正文内容 ${i + 1}。包含 **加粗** 与 \`代码\`。\n\n`
).join("\n");

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate((c) => localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/长文档.md": c } })), LONG);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await openWorkspace(page);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".tree-row"));
    const t = rows.find((r) => (r.textContent || "").includes("长文档"));
    if (t) t.click();
  });
  await page.waitForTimeout(1200);

  const st = () => page.evaluate(() => {
    const area = document.querySelector(".editor-area");
    const bar = document.querySelector(".find-bar");
    const ar = area.getBoundingClientRect();
    const r = bar ? bar.getBoundingClientRect() : null;
    return {
      scrollTop: Math.round(area.scrollTop),
      scrollHeight: area.scrollHeight,
      clientHeight: area.clientHeight,
      findBarExists: !!bar,
      barTopInArea: r ? Math.round(r.top - ar.top) : null,
      barVisible: r ? (r.bottom > ar.top && r.top < ar.bottom) : null,
      areaChildCount: area.children.length,
      firstChild: area.children[0] ? area.children[0].className : null,
    };
  });

  console.log("A. 初始（文档已打开，滚动 0）:", JSON.stringify(await st()));

  console.log("\nB. 滚动到 2500 后:");
  await page.evaluate(() => { document.querySelector(".editor-area").scrollTop = 2500; });
  await page.waitForTimeout(300);
  console.log("   ", JSON.stringify(await st()));

  console.log("\nC. 按 Ctrl+F 后:");
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(600);
  console.log("   ", JSON.stringify(await st()));

  console.log("\nD. 查找条打开后手动再滚动到 2500（模拟用户继续阅读）:");
  await page.evaluate(() => { document.querySelector(".editor-area").scrollTop = 2500; });
  await page.waitForTimeout(400);
  console.log("   ", JSON.stringify(await st()));

  console.log("\nE. 在查找框输入关键词后:");
  await page.keyboard.type("正文");
  await page.waitForTimeout(800);
  console.log("   ", JSON.stringify(await st()));

  // F. 对照：把 find-bar 临时改成 sticky，看滚动行为是否变化
  console.log("\nF. 对照实验：给 .find-bar 加 position:sticky 后重测:");
  await page.addStyleTag({ content: ".find-bar { position: sticky; top: 0; z-index: 20; }" });
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector(".editor-area").scrollTop = 2500; });
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(600);
  console.log("    按 Ctrl+F 后:", JSON.stringify(await st()));
  await page.evaluate(() => { document.querySelector(".editor-area").scrollTop = 2500; });
  await page.waitForTimeout(400);
  console.log("    再手动滚动后:", JSON.stringify(await st()));

  await browser.close();
})();
