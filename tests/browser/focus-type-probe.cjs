// 专注模式（F8）与打字机模式（F9）的行为取证
// 运行：node tests/browser/focus-type-probe.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS [${name}] ${detail}`); }
  else { fail++; failures.push(name); console.log(`FAIL [${name}] ${detail}`); }
}

const DOC = Array.from({ length: 24 }, (_, i) => `## 第 ${i + 1} 节\n\n这是第 ${i + 1} 节的正文。\n`).join("\n");

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate((doc) => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/f.md": doc } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, typewriter_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await openWorkspace(page);
  await openFileInTree(page, "f.md");
  await page.waitForTimeout(800);

  const snap = async () => page.evaluate(() => {
    const area = document.querySelector(".editor-area");
    const kids = Array.from(document.querySelectorAll(".ProseMirror > *"));
    const cur = document.querySelector(".ProseMirror > .focus-current");
    return {
      areaClass: area ? area.className : null,
      scrollTop: area ? Math.round(area.scrollTop) : null,
      scrollHeight: area ? area.scrollHeight : null,
      clientHeight: area ? area.clientHeight : null,
      focusCurrentCount: document.querySelectorAll(".ProseMirror > .focus-current").length,
      focusCurrentText: cur ? (cur.textContent || "").slice(0, 16) : null,
      opacities: kids.slice(0, 4).map((k) => getComputedStyle(k).opacity),
      settingsFocus: (() => { try { return JSON.parse(localStorage.getItem("mwtyper-mock-settings") || "{}").focus_mode; } catch { return null; } })(),
      settingsTw: (() => { try { return JSON.parse(localStorage.getItem("mwtyper-mock-settings") || "{}").typewriter_mode; } catch { return null; } })(),
    };
  });

  console.log("=== T1 专注模式（F8） ===");
  const before = await snap();
  await page.evaluate(() => document.querySelector(".ProseMirror")?.focus());
  await page.waitForTimeout(200);
  await page.keyboard.press("F8");
  await page.waitForTimeout(800);
  const afterF8 = await snap();
  console.log("  前:", JSON.stringify(before));
  console.log("  后:", JSON.stringify(afterF8));

  check("T1a F8 后编辑区带上 focus-mode 类",
    (afterF8.areaClass || "").includes("focus-mode"), `class=${afterF8.areaClass}`);
  check("T1b 非当前段落被降透明度（opacity < 1）",
    afterF8.opacities.some((o) => parseFloat(o) < 0.99), JSON.stringify(afterF8.opacities));
  check("T1c 当前段落被高亮（focus-current 存在且 opacity = 1）",
    afterF8.focusCurrentCount >= 1, `count=${afterF8.focusCurrentCount} text=${JSON.stringify(afterF8.focusCurrentText)}`);
  const curOpacity = await page.evaluate(() => {
    const cur = document.querySelector(".ProseMirror > .focus-current");
    return cur ? getComputedStyle(cur).opacity : null;
  });
  check("T1d 当前段落 opacity = 1", curOpacity === "1", `opacity=${curOpacity}`);
  check("T1e 设置被持久化", afterF8.settingsFocus === true, `focus_mode=${afterF8.settingsFocus}`);
  await page.screenshot({ path: path.join(OUT, "33-focus-mode.png") });

  // 再按一次关闭
  await page.keyboard.press("F8");
  await page.waitForTimeout(600);
  const off = await snap();
  check("T1f 再按 F8 关闭专注模式",
    !(off.areaClass || "").includes("focus-mode") && off.opacities.every((o) => parseFloat(o) > 0.99),
    `class=${off.areaClass} op=${JSON.stringify(off.opacities)}`);

  console.log("\n=== T2 打字机模式（F9） ===");
  const beforeTw = await snap();
  await page.evaluate(() => document.querySelector(".ProseMirror")?.focus());
  await page.waitForTimeout(200);
  await page.keyboard.press("F9");
  await page.waitForTimeout(800);
  const afterF9 = await snap();
  console.log("  前:", JSON.stringify(beforeTw));
  console.log("  后:", JSON.stringify(afterF9));
  check("T2a F9 后设置被持久化", afterF9.settingsTw === true, `typewriter_mode=${afterF9.settingsTw}`);

  // 把光标放到靠后的位置，看是否滚动居中
  const tw = await page.evaluate(async () => {
    const area = document.querySelector(".editor-area");
    const pm = document.querySelector(".ProseMirror");
    area.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 200));
    const paras = Array.from(pm.querySelectorAll("p"));
    const target = paras[Math.floor(paras.length / 2)];
    if (!target) return { err: "no p" };
    // 把光标放到该段落
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    target.dispatchEvent(new Event("mouseup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return {
      scrollTop: Math.round(area.scrollTop),
      scrollHeight: area.scrollHeight,
      clientHeight: area.clientHeight,
      maxScroll: area.scrollHeight - area.clientHeight,
    };
  });
  console.log("  打字机滚动实测:", JSON.stringify(tw));
  check("T2b 光标移到中部后编辑区发生滚动（居中）",
    !tw.err && tw.scrollTop > 0, JSON.stringify(tw));
  check("T2c 滚动位置接近中部（居中而非贴顶/贴底）",
    !tw.err && tw.scrollTop > tw.maxScroll * 0.2 && tw.scrollTop < tw.maxScroll * 0.8,
    `scrollTop=${tw.scrollTop} max=${tw.maxScroll}`);
  await page.screenshot({ path: path.join(OUT, "34-typewriter.png") });

  console.log("\n=== T3 设置面板里的开关 ===");
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /设置/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  const sw = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".settings-row"));
    const focusRow = labels.find((r) => /专注模式/.test(r.textContent || ""));
    const twRow = labels.find((r) => /打字机/.test(r.textContent || ""));
    return {
      hasFocus: !!focusRow,
      hasTw: !!twRow,
      focusChecked: focusRow ? !!focusRow.querySelector("input:checked") : null,
      twChecked: twRow ? !!twRow.querySelector("input:checked") : null,
    };
  });
  check("T3a 设置面板有「专注模式」开关", sw.hasFocus);
  check("T3b 设置面板有「打字机模式」开关", sw.hasTw);
  // 与**持久化状态**比对，而不是硬编码 true/false ——
  // T1 末尾按了 F8 把专注关掉了、T2 又只按了 F9，硬编码会误判。
  const persistedFocus = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("mwtyper-mock-settings") || "{}").focus_mode === true; }
    catch { return null; }
  });
  check("T3c 专注模式开关状态与持久化状态一致",
    persistedFocus === null || sw.focusChecked === persistedFocus,
    JSON.stringify({ ...sw, persistedFocus }));
  check("T3d 打字机模式开关状态与实际一致", sw.twChecked === true, JSON.stringify(sw));

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
