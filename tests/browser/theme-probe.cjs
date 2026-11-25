// 自定义主题验收：基色派生是否覆盖整个软件 + 深浅两套是否配比正确
// 运行：node tests/browser/theme-probe.cjs
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

const THEME = `:root {
  --mw-base-bg: #fbf1d8;
  --mw-base-fg: #4a4235;
  --mw-base-accent: #b58900;
}`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  // 必须先导航到同源页面，否则 about:blank 的 localStorage 访问被拒
  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const applyTheme = async (themeCss, themePref) => {
    await page.evaluate(({ css, pref }) => {
      localStorage.setItem("mwtyper-mock-themes", JSON.stringify({ "probe-theme": css }));
      localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
        theme: pref, focus_mode: false, zoom: 100, autosave_ms: 999999,
        sidebar_open: true, sidebar_width: 240, split_ratio: 50, custom_theme: "probe-theme",
      }));
      localStorage.setItem("mwtyper-mock-fs", JSON.stringify({
        files: { "/demo/t.md": "# 标题\n\n正文 **加粗** `代码`\n\n```ts\nconst a: number = 1;\n```\n" },
      }));
    }, { css: themeCss, pref: themePref });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1300);
    await openWorkspace(page);
    await page.evaluate(() => {
      const r = Array.from(document.querySelectorAll(".tree-row")).find((x) => /t\.md/.test(x.textContent || ""));
      if (r) r.click();
    });
    await page.waitForTimeout(1000);
  };

  // 采样整个软件各处的主要表面
  const sample = async () => page.evaluate(() => {
    const cs = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const root = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme,
      titlebarBg: cs(".titlebar", "backgroundColor"),
      titlebarFg: cs(".titlebar", "color"),
      sidebarBg: cs(".sidebar", "backgroundColor"),
      statusbarBg: cs(".statusbar", "backgroundColor"),
      editorBg: cs(".ProseMirror", "backgroundColor"),
      editorFg: cs(".ProseMirror", "color"),
      tbBtnBg: cs(".tb-btn", "backgroundColor"),
      treeRowBg: cs(".tree-row", "backgroundColor"),
      codeBg: cs(".code-block", "backgroundColor"),
      inlineCodeBg: cs(".ProseMirror code", "backgroundColor"),
      linkColor: cs(".ProseMirror a", "color"),
      // 令牌本身
      tokBg: root.getPropertyValue("--bg").trim(),
      tokBgSide: root.getPropertyValue("--bg-side").trim(),
      tokBgEditor: root.getPropertyValue("--bg-editor").trim(),
      tokFg: root.getPropertyValue("--fg").trim(),
      tokFgDim: root.getPropertyValue("--fg-dim").trim(),
      tokAccent: root.getPropertyValue("--accent").trim(),
      tokAccentStrong: root.getPropertyValue("--accent-strong").trim(),
      tokTitlebar: root.getPropertyValue("--titlebar-bg").trim(),
      tokBorder: root.getPropertyValue("--border").trim(),
      tokCodeBg: root.getPropertyValue("--code-bg").trim(),
      injected: (document.getElementById("mwtyper-custom-theme") || {}).textContent?.length || 0,
      hasDerived: ((document.getElementById("mwtyper-custom-theme") || {}).textContent || "").includes("mw-base-bg"),
    };
  });

  console.log("=== T1 无主题时的基线 ===");
  await applyTheme("", "light");
  const base = await sample();
  console.log("  " + JSON.stringify(base));

  console.log("\n=== T2 应用基色主题（浅色模式） ===");
  await applyTheme(THEME, "light");
  const light = await sample();
  console.log("  " + JSON.stringify(light));

  check("T2a 主题已注入", light.injected > 0 && light.hasDerived, `len=${light.injected} derived=${light.hasDerived}`);
  check("T2b 底色令牌按基色派生", light.tokBg !== base.tokBg, `${base.tokBg} → ${light.tokBg}`);
  check("T2c 编辑区底色随之改变", light.editorBg !== base.editorBg, `${base.editorBg} → ${light.editorBg}`);
  check("T2d 标题栏随之改变", light.titlebarBg !== base.titlebarBg, `${base.titlebarBg} → ${light.titlebarBg}`);
  check("T2e 侧栏随之改变", light.sidebarBg !== base.sidebarBg, `${base.sidebarBg} → ${light.sidebarBg}`);
  check("T2f 状态栏随之改变", light.statusbarBg !== base.statusbarBg, `${base.statusbarBg} → ${light.statusbarBg}`);
  check("T2g 标题栏按钮随之改变", light.tbBtnBg !== base.tbBtnBg, `${base.tbBtnBg} → ${light.tbBtnBg}`);
  check("T2h 代码块底色随之改变", light.codeBg !== base.codeBg, `${base.codeBg} → ${light.codeBg}`);
  check("T2i 行内代码底色随之改变", light.inlineCodeBg !== base.inlineCodeBg, `${base.inlineCodeBg} → ${light.inlineCodeBg}`);
  check("T2j 强调色令牌按基色派生", light.tokAccent !== base.tokAccent, `${base.tokAccent} → ${light.tokAccent}`);

  console.log("\n=== T3 同一主题在深色模式下的配比 ===");
  await applyTheme(THEME, "dark");
  const dark = await sample();
  console.log("  " + JSON.stringify(dark));

  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const L = lum(light.tokBgEditor);
  const D = lum(dark.tokBgEditor);
  check("T3a 暗色模式底色确实更暗", D !== null && L !== null && D < L,
    `light=${light.tokBgEditor}(L=${L?.toFixed(3)}) dark=${dark.tokBgEditor}(L=${D?.toFixed(3)})`);
  check("T3b 暗色模式文字更亮", lum(dark.tokFg) > lum(light.tokFg),
    `${light.tokFg} → ${dark.tokFg}`);
  check("T3c 暗色模式强调色更亮", lum(dark.tokAccent) > lum(light.tokAccent),
    `${light.tokAccent} → ${dark.tokAccent}`);
  check("T3d 深色下标题栏也变暗", dark.titlebarBg !== light.titlebarBg,
    `${light.titlebarBg} → ${dark.titlebarBg}`);
  check("T3e 深色下侧栏/状态栏/代码块都变", dark.sidebarBg !== light.sidebarBg && dark.statusbarBg !== light.statusbarBg && dark.codeBg !== light.codeBg,
    `side ${light.sidebarBg}→${dark.sidebarBg} / status ${light.statusbarBg}→${dark.statusbarBg} / code ${light.codeBg}→${dark.codeBg}`);

  // 对比度
  const hexToRgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const ratio = (a, b) => {
    const ra = hexToRgb(a), rb = hexToRgb(b);
    if (!ra || !rb) return null;
    const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };
  console.log("\n=== T4 对比度 ===");
  const rl = ratio(light.tokFg, light.tokBgEditor);
  const rd = ratio(dark.tokFg, dark.tokBgEditor);
  const al = ratio(light.tokAccent, light.tokBgEditor);
  const ad = ratio(dark.tokAccent, dark.tokBgEditor);
  const dl = ratio(light.tokFgDim, light.tokBgSide);
  const dd = ratio(dark.tokFgDim, dark.tokBgSide);
  console.log(`  浅色：正文 ${rl?.toFixed(2)}:1  次要 ${dl?.toFixed(2)}:1 强调 ${al?.toFixed(2)}:1`);
  console.log(`  暗色：正文 ${rd?.toFixed(2)}:1  次要 ${dd?.toFixed(2)}:1 强调 ${ad?.toFixed(2)}:1`);
  check("T4a 浅色正文 ≥ 4.5:1", (rl || 0) >= 4.5, `${rl?.toFixed(2)}:1`);
  check("T4b 暗色正文 ≥ 4.5:1", (rd || 0) >= 4.5, `${rd?.toFixed(2)}:1`);
  check("T4c 浅色次要文字 ≥ 4.5:1", (dl || 0) >= 4.5, `${dl?.toFixed(2)}:1`);
  check("T4d 暗色次要文字 ≥ 4.5:1", (dd || 0) >= 4.5, `${dd?.toFixed(2)}:1`);
  check("T4e 浅色强调色 ≥ 4.5:1", (al || 0) >= 4.5, `${al?.toFixed(2)}:1`);
  check("T4f 暗色强调色 ≥ 4.5:1", (ad || 0) >= 4.5, `${ad?.toFixed(2)}:1`);

  // 浅色截图：在浅色主题下拍（T2 之后）
  await applyTheme(THEME, "light");
  await page.screenshot({ path: path.join(OUT, "21-theme-light.png") });
  // 暗色截图：在暗色主题下拍
  await applyTheme(THEME, "dark");
  await page.screenshot({ path: path.join(OUT, "22-theme-dark.png") });

  console.log("\n=== T5 兼容旧的「逐个令牌覆盖」写法 ===");
  const LEGACY = `:root { --bg: #eef6ff; --fg: #123456; }\n[data-theme="dark"] { --bg: #0d1117; --fg: #c9d1d9; }`;
  await applyTheme(LEGACY, "light");
  const legacy = await sample();
  check("T5a 旧写法仍生效（底色被覆盖）", legacy.tokBg === "#eef6ff" && legacy.hasDerived === false,
    `bg=${legacy.tokBg} derived=${legacy.hasDerived}`);
  // 旧写法的暗色块必须能盖过应用内置的 [data-theme="dark"]（同特异度、注入更靠后）
  await applyTheme(LEGACY, "dark");
  const legacyDark = await sample();
  check("T5b 旧写法的暗色块也生效", legacyDark.tokBg === "#0d1117" && legacyDark.tokFg === "#c9d1d9",
    `bg=${legacyDark.tokBg} fg=${legacyDark.tokFg}`);

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
