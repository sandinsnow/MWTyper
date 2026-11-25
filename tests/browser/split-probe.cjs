// 随航编辑（源码 ｜ 预览 并排）的真实浏览器验收
// 运行：node tests/browser/split-probe.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree, clickSegment } = require("./probe-util.cjs");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS [${name}] ${detail}`); }
  else { fail++; failures.push(name); console.log(`FAIL [${name}] ${detail}`); }
}

const LONG_TAIL = Array.from({ length: 30 }, (_, i) => `## 第 ${i + 1} 节\n\n这是第 ${i + 1} 节的正文内容，用于把文档撑到足够长，验证左右两栏的滚动联动。\n`).join("\n");
const DOC = `# 随航验证

第一段正文，用于验证左右两栏的内容与滚动联动。

## 第二章

第二段内容，带 **加粗**。

- 列表项一
- 列表项二

\`\`\`ts
const a: number = 1;
\`\`\`

${LONG_TAIL}
`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

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
  await page.waitForTimeout(1000);
  await page.evaluate((doc) => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/随航.md": doc } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await openWorkspace(page);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".tree-row"));
    const t = rows.find((r) => (r.textContent || "").includes("随航.md"));
    if (t) t.click();
  });
  await page.waitForTimeout(1200);

  console.log("\n[S1] 进入随航模式");
  const entered = await clickByText(/随航/);
  await page.waitForTimeout(1400);
  check("S1a 点到了「随航」按钮", entered === true);

  const layout = await page.evaluate(() => {
    const area = document.querySelector(".editor-area");
    const src = document.querySelector(".split-source");
    const wrap = document.querySelector(".editor-wrap");
    const cm = document.querySelector(".cm-content");
    const pm = document.querySelector(".ProseMirror");
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      isSplit: area ? area.className.includes("split") : false,
      area: r(area), src: r(src), wrap: r(wrap), cm: r(cm), pm: r(pm),
      cmText: cm ? cm.textContent.slice(0, 60) : null,
      pmText: pm ? pm.textContent.slice(0, 60) : null,
      pmEditable: pm ? pm.getAttribute("contenteditable") : null,
      pmTag: pm ? pm.tagName : null,
      pmCount: document.querySelectorAll(".ProseMirror").length,
    };
  });
  check("S1b 编辑区进入 split 布局", layout.isSplit === true, JSON.stringify(layout.area));
  check("S1c 左栏源码可见", !!layout.cm && layout.cm.w > 100, JSON.stringify(layout.cm));
  check("S1d 右栏预览可见", !!layout.pm && layout.pm.w > 100, JSON.stringify(layout.pm));
  check("S1e 左右并排（左栏在右栏左侧）", layout.cm && layout.pm && layout.cm.x < layout.pm.x,
    `cm.x=${layout.cm && layout.cm.x} pm.x=${layout.pm && layout.pm.x}`);
  check("S1f 左栏是 Markdown 源码", !!layout.cmText && layout.cmText.includes("# 随航验证"), JSON.stringify(layout.cmText));
  check("S1g 右栏是渲染后的内容（不含 # 标记）", !!layout.pmText && !layout.pmText.includes("# 随航验证"),
    JSON.stringify(layout.pmText));
  check("S1h 预览为只读", layout.pmEditable === "false" || layout.pmEditable === null,
    `contenteditable=${layout.pmEditable}`);
  await page.screenshot({ path: path.join(OUT, "13-split.png") });

  console.log("\n[S2] 源码侧输入 → 预览实时更新");
  await page.evaluate(() => {
    const cm = document.querySelector(".cm-content");
    if (cm) cm.focus();
  });
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\n## 新增小节\n\n新写的一段。");
  await page.waitForTimeout(900);
  const afterType = await page.evaluate(() => ({
    pmText: (document.querySelector(".ProseMirror") || {}).textContent || "",
    cmText: (document.querySelector(".cm-content") || {}).textContent || "",
  }));
  check("S2a 预览出现了新写的内容", afterType.pmText.includes("新增小节") && afterType.pmText.includes("新写的一段"),
    JSON.stringify(afterType.pmText.slice(-60)));
  check("S2b 源码侧保留用户原文", afterType.cmText.includes("## 新增小节"), "ok");
  // 随航下源码是事实源 → 在左栏打字必须照常把文档标记为「未保存」
  const dirty = await page.evaluate(() => ({
    dot: !!document.querySelector(".dirty-dot"),
    status: (document.querySelector(".statusbar") || {}).textContent || "",
  }));
  check("S2c 左栏输入会标记未保存（事实源归属正确）", dirty.dot === true, JSON.stringify(dirty.status.slice(-24)));

  console.log("\n[S3] 滚动联动（单向锁）");
  const scrollRes = await page.evaluate(async () => {
    const cm = document.querySelector(".cm-scroller");
    const wrap = document.querySelector(".editor-wrap");
    if (!cm || !wrap) return null;
    cm.scrollTop = 400;
    cm.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 400));
    return { cmTop: Math.round(cm.scrollTop), wrapTop: Math.round(wrap.scrollTop), wrapScrollable: wrap.scrollHeight > wrap.clientHeight };
  });
  check("S3a 源码滚动带动预览滚动", !!scrollRes && scrollRes.wrapTop > 0, JSON.stringify(scrollRes));
  const back = await page.evaluate(async () => {
    const cm = document.querySelector(".cm-scroller");
    const wrap = document.querySelector(".editor-wrap");
    wrap.scrollTop = 200;
    wrap.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 400));
    return { cmTop: Math.round(cm.scrollTop), wrapTop: Math.round(wrap.scrollTop) };
  });
  check("S3b 预览滚动能反向带动源码", !!back && back.cmTop !== 0, JSON.stringify(back));

  console.log("\n[S4] 切回所见即所得：内容不丢");
  await clickSegment(page, "所见即所得");
  const backToWysiwyg = await page.evaluate(() => ({
    mode: document.querySelector(".editor-area")?.className || "",
    pmText: (document.querySelector(".ProseMirror") || {}).textContent || "",
    pmEditable: document.querySelector(".ProseMirror")?.getAttribute("contenteditable"),
    cmVisible: (() => { const s = document.querySelector(".split-source"); return s ? getComputedStyle(s).display : null; })(),
  }));
  check("S4a 已回到所见即所得", backToWysiwyg.mode.includes("wysiwyg") || !backToWysiwyg.mode.includes("split"),
    JSON.stringify(backToWysiwyg.mode));
  check("S4b 内容保留（新增小节还在）", backToWysiwyg.pmText.includes("新增小节"),
    JSON.stringify(backToWysiwyg.pmText.slice(-40)));
  check("S4c 恢复可编辑", backToWysiwyg.pmEditable === "true", `contenteditable=${backToWysiwyg.pmEditable}`);
  check("S4d 左栏已隐藏", backToWysiwyg.cmVisible === "none", `display=${backToWysiwyg.cmVisible}`);

  console.log("\n[S5] 随航 → 源码（不应丢失用户原文）");
  await clickByText(/随航/);
  await page.waitForTimeout(1200);
  await clickSegment(page, "所见即所得");   // 随航 → 所见即所得
  await clickSegment(page, "源码");   // 所见即所得 → 源码
  // CodeMirror 对长文档做虚拟滚动，DOM 里只有可视行 ——
  // 必须先把光标移到文末，可视区才包含「新增小节」那一段。
  await page.evaluate(() => { const cm = document.querySelector(".cm-content"); if (cm) cm.focus(); });
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(500);
  const toSource = await page.evaluate(() => ({
    cmText: (document.querySelector(".cm-content") || {}).textContent || "",
  }));
  check("S5a 源码模式里原文完整", toSource.cmText.includes("新增小节"), JSON.stringify(toSource.cmText.slice(-40)));

  console.log("\n[S6] 快捷键 Ctrl+Shift+/ 进出随航");
  await page.keyboard.press("Control+Shift+/");
  await page.waitForTimeout(1200);
  const viaKey = await page.evaluate(() => document.querySelector(".editor-area")?.className || "");
  check("S6a 快捷键进入随航", viaKey.includes("split"), viaKey);
  await page.keyboard.press("Control+Shift+/");
  await page.waitForTimeout(900);
  const viaKey2 = await page.evaluate(() => document.querySelector(".editor-area")?.className || "");
  check("S6b 快捷键退出随航", !viaKey2.includes("split"), viaKey2);

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
