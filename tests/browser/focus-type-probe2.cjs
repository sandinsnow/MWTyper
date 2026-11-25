// 专注/打字机模式在**真实使用场景**下的行为取证
// 覆盖：启动即开启、不聚焦编辑器按快捷键、源码模式下按、设置面板开关切换
// 运行：node tests/browser/focus-type-probe2.cjs
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

const DOC = Array.from({ length: 20 }, (_, i) => `## 第 ${i + 1} 节\n\n正文 ${i + 1}。\n`).join("\n");

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const snap = async () => page.evaluate(() => {
    const area = document.querySelector(".editor-area");
    const cur = document.querySelector(".ProseMirror > .focus-current");
    const kids = Array.from(document.querySelectorAll(".ProseMirror > *"));
    return {
      areaClass: area ? area.className : null,
      focusCurrentCount: document.querySelectorAll(".ProseMirror > .focus-current").length,
      focusCurrentText: cur ? (cur.textContent || "").slice(0, 12) : null,
      anyFaded: kids.some((k) => parseFloat(getComputedStyle(k).opacity) < 0.99),
      scrollTop: area ? Math.round(area.scrollTop) : null,
      maxScroll: area ? area.scrollHeight - area.clientHeight : null,
    };
  });

  const boot = async (opts) => {
    await page.evaluate(({ doc, o }) => {
      localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/f.md": doc } }));
      localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
        theme: "light", zoom: 100, autosave_ms: 999999,
        sidebar_open: true, sidebar_width: 240, split_ratio: 50,
        focus_mode: false, typewriter_mode: false, ...o,
      }));
    }, { doc: DOC, o: opts });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await openWorkspace(page);
    await openFileInTree(page, "f.md");
    await page.waitForTimeout(800);
  };

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  console.log("=== S1 启动即开启专注模式（重启后仍应生效） ===");
  await boot({ focus_mode: true });
  const s1 = await snap();
  console.log("  " + JSON.stringify(s1));
  check("S1a 段落被降透明（专注外观在）", s1.anyFaded, JSON.stringify(s1));
  check("S1b 当前段落被高亮（focus-current 存在）", s1.focusCurrentCount >= 1,
    `count=${s1.focusCurrentCount} text=${JSON.stringify(s1.focusCurrentText)}`);

  console.log("\n=== S2 未聚焦编辑器直接按 F8 ===");
  await boot({});
  await page.evaluate(() => document.body.focus());
  await page.waitForTimeout(200);
  await page.keyboard.press("F8");
  await page.waitForTimeout(700);
  const s2 = await snap();
  console.log("  " + JSON.stringify(s2));
  check("S2a F8 仍能开启专注模式", (s2.areaClass || "").includes("focus-mode"), `class=${s2.areaClass}`);
  check("S2b 当前段落被高亮", s2.focusCurrentCount >= 1, `count=${s2.focusCurrentCount}`);

  console.log("\n=== S3 源码模式下按 F8 / F9 ===");
  await boot({});
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".mode-segment")).find((x) => (x.textContent || "").trim() === "源码");
    if (b) b.click();
  });
  await page.waitForTimeout(1400);
  await page.keyboard.press("F8");
  await page.waitForTimeout(600);
  const s3 = await snap();
  console.log("  " + JSON.stringify(s3));
  check("S3a 源码模式下 F8 至少记录了设置（class 挂在编辑区上）",
    (s3.areaClass || "").includes("focus-mode"), `class=${s3.areaClass}`);
  const srcHasFocusCurrent = await page.evaluate(() => document.querySelectorAll(".cm-content .focus-current").length);
  check("S3b 源码模式没有 focus-current（专注是富文本侧的效果）", srcHasFocusCurrent === 0, `n=${srcHasFocusCurrent}`);

  console.log("\n=== S4 设置面板开关直接切换 ===");
  await boot({});
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /设置/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  const toggled = await page.evaluate(async () => {
    const row = Array.from(document.querySelectorAll(".settings-row")).find((r) => /专注模式/.test(r.textContent || ""));
    const cb = row?.querySelector("input[type=checkbox]");
    if (!cb) return { found: false };
    cb.click();
    await new Promise((r) => setTimeout(r, 600));
    return { found: true, checked: cb.checked };
  });
  console.log("  " + JSON.stringify(toggled));
  const s4 = await snap();
  console.log("  " + JSON.stringify(s4));
  check("S4a 设置面板勾选专注模式后立即生效", toggled.found && (s4.areaClass || "").includes("focus-mode"),
    JSON.stringify({ toggled, cls: s4.areaClass }));
  check("S4b 勾选后当前段落被高亮", s4.focusCurrentCount >= 1, `count=${s4.focusCurrentCount}`);

  console.log("\n=== S5 打字机模式：从设置面板开启后应立即滚动居中 ===");
  await boot({});
  // 先把光标放到文档中部并手动滚动，制造「光标没动过」的状态
  await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    const ps = Array.from(pm.querySelectorAll("p"));
    const t = ps[Math.floor(ps.length / 2)];
    if (!t) return;
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(t);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    t.dispatchEvent(new Event("mouseup", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelector(".editor-area").scrollTop = 0; });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /设置/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const twToggled = await page.evaluate(async () => {
    const row = Array.from(document.querySelectorAll(".settings-row")).find((r) => /打字机/.test(r.textContent || ""));
    const cb = row?.querySelector("input[type=checkbox]");
    if (!cb) return { found: false };
    cb.click();
    await new Promise((r) => setTimeout(r, 800));
    return { found: true, checked: cb.checked };
  });
  const s5 = await snap();
  console.log("  " + JSON.stringify({ twToggled, s5 }));
  check("S5a 设置面板可勾选打字机模式", twToggled.found && twToggled.checked === true, JSON.stringify(twToggled));
  check("S5b 勾选后立即滚动把光标带到中部（不是「没反应」）",
    s5.scrollTop > 0 && s5.scrollTop < s5.maxScroll * 0.8,
    `scrollTop=${s5.scrollTop} max=${s5.maxScroll}`);

  console.log("\n=== S6 状态栏显示模式标记 ===");
  const flags = await page.evaluate(() => ({
    focus: (document.querySelector(".statusbar .mode-flag") || {}).textContent || null,
    count: document.querySelectorAll(".statusbar .mode-flag").length,
  }));
  check("S6a 状态栏出现模式标记", flags.count >= 1, JSON.stringify(flags));

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
