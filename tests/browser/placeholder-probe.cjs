// 空文档占位符与编辑区焦点环的观感取证 / 复测
// 运行：node tests/browser/placeholder-probe.cjs
const { EXE, OUT, PC, ROOT } = require("./pw.cjs");
const path = require("path");
const fs = require("fs");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS [${name}] ${detail}`); }
  else { fail++; failures.push(name); console.log(`FAIL [${name}] ${detail}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: {} }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // 新建空白文稿并聚焦编辑区
  await page.evaluate(() => document.querySelector(".ProseMirror")?.focus());
  await page.waitForTimeout(500);

  const m = await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    const empty = document.querySelector(".ProseMirror .is-editor-empty");
    const cs = pm ? getComputedStyle(pm) : null;
    const ecs = empty ? getComputedStyle(empty, "::before") : null;
    const pr = pm ? pm.getBoundingClientRect() : null;
    const er = empty ? empty.getBoundingClientRect() : null;
    // 占位符伪元素的位置：用 range 量不到，改测其所在段落的盒子与光标位置
    const sel = window.getSelection();
    const caret = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    return {
      hasEmpty: !!empty,
      placeholder: empty ? empty.getAttribute("data-placeholder") : null,
      pmBoxShadow: cs ? cs.boxShadow : null,
      pmOutline: cs ? cs.outline : null,
      pmRect: pr ? { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) } : null,
      emptyRect: er ? { x: Math.round(er.x), y: Math.round(er.y), w: Math.round(er.width), h: Math.round(er.height) } : null,
      emptyPosition: empty ? getComputedStyle(empty).position : null,
      beforeContent: ecs ? ecs.content : null,
      beforePosition: ecs ? ecs.position : null,
      beforeColor: ecs ? ecs.color : null,
      beforeOpacity: ecs ? ecs.opacity : null,
      beforeLeft: ecs ? ecs.left : null,
      beforeTop: ecs ? ecs.top : null,
      // 焦点指示画在 **.ProseMirror::before**（编辑区），与段落的占位符 ::before 是两个元素
      pmBeforeLeft: pm ? getComputedStyle(pm, "::before").left : null,
      pmBeforeWidth: pm ? getComputedStyle(pm, "::before").width : null,
      pmBeforeContent: pm ? getComputedStyle(pm, "::before").content : null,
      caretRect: caret ? { x: Math.round(caret.x), y: Math.round(caret.y), w: Math.round(caret.width), h: Math.round(caret.height) } : null,
      docText: pm ? pm.textContent : null,
    };
  });
  console.log("实测: " + JSON.stringify(m, null, 2));

  console.log("\n[P1] 编辑区不应是一圈整框焦点环");
  // 计算样式的顺序是 "rgb(...) 0px 0px 0px 2px inset"（inset 在末尾）
  const fullBox = !!m.pmBoxShadow && /0px 0px 0px 2px inset/.test(m.pmBoxShadow);
  check("P1a 不存在 2px 整框 inset 焦点环", !fullBox, `boxShadow=${m.pmBoxShadow}`);
  // v1.9 修订：焦点指示改为**伪元素画的 2px 渐隐线**，画在正文左缘（left = padding-left），
  // 且**只在键盘导航进入时显示**（Chrome 对 contenteditable 的 :focus-visible 总是匹配，
  // 用它会让这条线变成画布上的常驻元素）。
  // 运行时行为由 focus-mode-probe.cjs 负责；这里做静态断言（规则本身不能被改坏）。
  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const focusRule = css.match(/\.editor-wrap\.kb-focus \.ProseMirror::before\s*\{([^}]*)\}/);
  const ruleBody = focusRule ? focusRule[1] : "";
  check("P1b 焦点指示为正文左缘的 2px 渐隐线（仅键盘导航时）",
    /left:\s*40px/.test(ruleBody) && /width:\s*2px/.test(ruleBody) && /linear-gradient/.test(ruleBody),
    `rule=${ruleBody.replace(/\s+/g, " ").trim().slice(0, 120)}`);

  console.log("\n[P2] 占位符文案与光标不重叠");
  // 光标画在段落内容起点（= 段落盒子左边），占位符 left=3px 让开它
  const phLeft = m.beforeLeft === null ? null : parseFloat(String(m.beforeLeft));
  check("P2a 占位符让开光标（left ≥ 3px）", phLeft === null || phLeft >= 3, `beforeLeft=${m.beforeLeft}`);
  check("P2c 占位符相对段落定位（段落 position=relative）", m.emptyPosition === "relative",
    `position=${m.emptyPosition}`);
  check("P2b 占位符文案不含长串提示", !m.placeholder || !m.placeholder.includes("Ctrl+/"),
    `placeholder=${JSON.stringify(m.placeholder)}`);

  await page.screenshot({ path: path.join(OUT, "14-placeholder-after.png") });

  console.log("\n[P3] 暗色主题下的同一状态");
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "dark", focus_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.evaluate(() => document.querySelector(".ProseMirror")?.focus());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "15-placeholder-dark.png") });
  const dark = await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    const empty = document.querySelector(".ProseMirror .is-editor-empty");
    const cs = pm ? getComputedStyle(pm) : null;
    const ecs = empty ? getComputedStyle(empty, "::before") : null;
    const acs = empty ? getComputedStyle(empty, "::after") : null;
    const pmEl = document.querySelector(".ProseMirror");
    return { hasEmpty: !!empty, boxShadow: cs ? cs.boxShadow : null,
      before: ecs ? ecs.content : null, beforeColor: ecs ? ecs.color : null,
      beforeLeft: ecs ? ecs.left : null,
      pmBeforeLeft: pmEl ? getComputedStyle(pmEl, "::before").left : null,
      pmBeforeWidth: pmEl ? getComputedStyle(pmEl, "::before").width : null,
      after: acs ? acs.content : null };
  });
  check("P3a 暗色主题也有占位符", dark.hasEmpty === true, JSON.stringify(dark));
  check("P3b 暗色主题下焦点线同样只在键盘导航时出现（鼠标聚焦时不显示）",
    dark.pmBeforeLeft === "auto" && dark.pmBeforeWidth === "auto",
    `pmBeforeLeft=${dark.pmBeforeLeft} pmBeforeWidth=${dark.pmBeforeWidth}`);

  console.log("\n[P4] 文档中间的空段落不应冒提示");
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({
      files: { "/demo/有内容.md": "第一段\n\n第二段\n" },
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  await openWorkspace(page);
  await page.evaluate(() => {
    const r = Array.from(document.querySelectorAll(".tree-row")).find((x) => /有内容/.test(x.textContent || ""));
    if (r) r.click();
  });
  await page.waitForTimeout(1000);
  const midEmpty = await page.evaluate(() => ({
    editorEmpty: document.querySelectorAll(".ProseMirror .is-editor-empty").length,
    anyEmpty: document.querySelectorAll(".ProseMirror .is-empty").length,
  }));
  check("P4a 非空文档不出现整篇占位提示", midEmpty.editorEmpty === 0, JSON.stringify(midEmpty));

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 5)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
