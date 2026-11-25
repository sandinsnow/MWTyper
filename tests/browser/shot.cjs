// 用本地 chromium 打开 MWTyper（vite dev + 浏览器 mock），做真实界面审查
// 运行：node tests/browser/shot.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree, clickSegment } = require("./probe-util.cjs");

require("fs").mkdirSync(OUT, { recursive: true });

const LONG = Array.from({ length: 30 }, (_, i) =>
  `## 第 ${i + 1} 节\n\n这是第 ${i + 1} 节的正文内容，用于把编辑器撑到足够长，验证滚动行为。` +
  `包含 **加粗**、\`行内代码\` 与 [链接](https://example.com)。\n\n`
).join("\n");

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name + ".png") });
    console.log("  saved " + name + ".png");
  };
  const clickByText = async (re) => {
    const ok = await page.evaluate((src) => {
      const rx = new RegExp(src);
      const b = Array.from(document.querySelectorAll("button")).find((x) => rx.test(x.textContent || ""));
      if (b) { b.click(); return true; }
      return false;
    }, re.source);
    await page.waitForTimeout(600);
    return ok;
  };

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // 注入 mock 文件系统
  await page.evaluate((content) => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({
      files: {
        "/demo/长文档.md": content,
        "/demo/表格.md": "| 列 A | 列 B |\n| --- | --- |\n| 值 1 | 值 2 |\n| 值 3 | 值 4 |\n",
      },
    }));
    localStorage.removeItem("mwtyper-mock-settings");
  }, LONG);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  console.log("[1] 打开文件夹");
  await openWorkspace(page);
  await page.waitForTimeout(800);
  const treeRows = await page.evaluate(() => document.querySelectorAll(".tree-row").length);
  console.log("  文件树行数: " + treeRows);

  console.log("[2] 打开长文档");
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".tree-row"));
    const target = rows.find((r) => (r.textContent || "").includes("长文档"));
    if (target) target.click();
  });
  await page.waitForTimeout(1200);
  await shot("01-wysiwyg");

  const geom = await page.evaluate(() => {
    const area = document.querySelector(".editor-area");
    const pm = document.querySelector(".ProseMirror");
    const ar = area.getBoundingClientRect();
    const pr = pm.getBoundingClientRect();
    return {
      area: { w: Math.round(ar.width), h: Math.round(ar.height), top: Math.round(ar.top) },
      pm: { w: Math.round(pr.width), left: Math.round(pr.left - ar.left) },
      scrollHeight: area.scrollHeight, clientHeight: area.clientHeight,
    };
  });
  console.log("  编辑区几何: " + JSON.stringify(geom));

  console.log("[3] 滚到中部后 Ctrl+F（验证查找条是否滚出视野）");
  await page.evaluate(() => { document.querySelector(".editor-area").scrollTop = 2500; });
  await page.waitForTimeout(300);
  const scrollBefore = await page.evaluate(() => document.querySelector(".editor-area").scrollTop);
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(500);
  await shot("02-find-scrolled");
  const findRect = await page.evaluate(() => {
    const bar = document.querySelector(".find-bar");
    const area = document.querySelector(".editor-area");
    if (!bar) return { found: false, scrollTop: area.scrollTop };
    const r = bar.getBoundingClientRect();
    const ar = area.getBoundingClientRect();
    return {
      found: true, scrollTop: area.scrollTop,
      barTop: Math.round(r.top), barBottom: Math.round(r.bottom),
      areaTop: Math.round(ar.top), areaBottom: Math.round(ar.bottom),
      visible: r.bottom > ar.top && r.top < ar.bottom,
      position: getComputedStyle(bar).position,
    };
  });
  console.log("  滚动量=" + scrollBefore + " 查找条几何: " + JSON.stringify(findRect));

  console.log("[4] 表格文档");
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".tree-row"));
    const t = rows.find((r) => (r.textContent || "").includes("表格"));
    if (t) t.click();
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const cell = document.querySelector(".ProseMirror td");
    if (cell) {
      const r = cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
    }
  });
  await page.waitForTimeout(700);
  await shot("03-table");

  console.log("[5] 源码模式");
  await clickSegment(page, "源码");
  await page.waitForTimeout(1500);
  await shot("04-source");
  const srcGeom = await page.evaluate(() => {
    const area = document.querySelector(".editor-area");
    const cm = document.querySelector(".source-mode .cm-content");
    const scroller = document.querySelector(".source-mode .cm-scroller");
    const ar = area.getBoundingClientRect();
    return {
      areaW: Math.round(ar.width),
      cmContentW: cm ? Math.round(cm.getBoundingClientRect().width) : null,
      outerScrollable: area.scrollHeight > area.clientHeight + 2,
      innerScrollable: scroller ? scroller.scrollHeight > scroller.clientHeight + 2 : null,
      cmHasMaxWidth: cm ? getComputedStyle(cm).maxWidth : null,
    };
  });
  console.log("  源码模式几何: " + JSON.stringify(srcGeom));

  console.log("[6] 回到 WYSIWYG + 深色 + 专注");
  await clickSegment(page, "源码");
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({ theme: "dark", focus_mode: false, zoom: 100 }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await openWorkspace(page);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".tree-row"));
    const t = rows.find((r) => (r.textContent || "").includes("长文档"));
    if (t) t.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.querySelector(".ProseMirror").focus(); });
  await page.waitForTimeout(400);
  await shot("05-dark-wysiwyg");

  console.log("[7] 专注模式");
  await page.keyboard.press("F8");
  await page.waitForTimeout(800);
  await shot("06-dark-focus");

  console.log("[8] 200% 缩放");
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({ theme: "dark", focus_mode: false, zoom: 200 }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await openWorkspace(page);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".tree-row"));
    const t = rows.find((r) => (r.textContent || "").includes("长文档"));
    if (t) t.click();
  });
  await page.waitForTimeout(1200);
  const zoomGeom = await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    const cs = getComputedStyle(pm);
    return { width: Math.round(pm.getBoundingClientRect().width), fontSize: cs.fontSize, maxWidth: cs.maxWidth };
  });
  console.log("  200% 缩放几何: " + JSON.stringify(zoomGeom));
  await shot("07-zoom200");

  console.log("页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  await browser.close();
})();
