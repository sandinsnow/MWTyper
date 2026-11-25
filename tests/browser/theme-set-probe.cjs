// 自定义主题验收：每套主题的深浅两套 + 整个应用框架是否跟随
// 运行：node tests/browser/theme-set-probe.cjs
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

/** 框架各处：类名 → 期望跟随主题的表面 */
const FRAME = [
  ["标题栏", ".titlebar", "backgroundColor"],
  ["标题栏按钮", ".tb-btn", "backgroundColor"],
  ["标签栏", ".tabbar", "backgroundColor"],
  ["侧栏", ".sidebar", "backgroundColor"],
  ["状态栏", ".statusbar", "backgroundColor"],
  ["编辑区", ".ProseMirror", "backgroundColor"],
];

const THEMES = ["warm-sample", "celadon", "dusk", "graphite", "sea-salt"];

const THEME_CSS = {
  "warm-sample": ":root{--mw-base-bg:#fbf1d8;--mw-base-fg:#4a4235;--mw-base-accent:#b58900;}[data-theme=\"dark\"]{--mw-base-bg:#241f18;--mw-base-fg:#e8dfd0;--mw-base-accent:#e0b155;}",
  celadon: ":root{--mw-base-bg:#f1f5f3;--mw-base-fg:#22322c;--mw-base-accent:#1f6f5c;}[data-theme=\"dark\"]{--mw-base-bg:#16201d;--mw-base-fg:#d6e3de;--mw-base-accent:#4fbf9f;}",
  dusk: ":root{--mw-base-bg:#f4f2f8;--mw-base-fg:#2f2a3d;--mw-base-accent:#6d4aa8;}[data-theme=\"dark\"]{--mw-base-bg:#1c1a26;--mw-base-fg:#ddd8ea;--mw-base-accent:#b39ae0;}",
  graphite: ":root{--mw-base-bg:#f4f4f5;--mw-base-fg:#27272a;--mw-base-accent:#52525b;}[data-theme=\"dark\"]{--mw-base-bg:#1a1a1c;--mw-base-fg:#d4d4d8;--mw-base-accent:#a1a1aa;}",
  "sea-salt": ":root{--mw-base-bg:#f1f5f9;--mw-base-fg:#1f2937;--mw-base-accent:#0369a1;}[data-theme=\"dark\"]{--mw-base-bg:#111c26;--mw-base-fg:#d6e3ee;--mw-base-accent:#56a8e0;}",
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const grab = async () => page.evaluate((frame) => {
    const out = {};
    for (const [name, sel, prop] of frame) {
      const el = document.querySelector(sel);
      out[name] = el ? getComputedStyle(el)[prop] : null;
    }
    const root = getComputedStyle(document.documentElement);
    out["__accent"] = root.getPropertyValue("--accent").trim();
    out["__titlebarFg"] = root.getPropertyValue("--titlebar-fg").trim();
    out["__bg"] = root.getPropertyValue("--bg").trim();
    out["__fg"] = root.getPropertyValue("--fg").trim();
    out["__theme"] = document.documentElement.dataset.theme;
    return out;
  }, FRAME);

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const setTheme = async (themeName, mode) => {
    await page.evaluate(({ t, m, css }) => {
      const themes = JSON.parse(localStorage.getItem("mwtyper-mock-themes") || "{}");
      if (t) themes[t] = css;
      else delete themes[t];
      localStorage.setItem("mwtyper-mock-themes", JSON.stringify(themes));
      const s = JSON.parse(localStorage.getItem("mwtyper-mock-settings") || "{}");
      localStorage.setItem(
        "mwtyper-mock-settings",
        JSON.stringify({
          theme: m, focus_mode: false, zoom: 100, autosave_ms: 999999,
          sidebar_open: true, sidebar_width: 240, split_ratio: 50,
          custom_theme: t || "",
        })
      );
    }, { t: themeName, m: mode, css: themeName ? THEME_CSS[themeName] : "" });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1300);
    await openWorkspace(page);
    await openFileInTree(page, "t.md");
    await page.waitForTimeout(600);
  };

  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({
      files: { "/demo/t.md": "# 标题\n\n段落 **粗体** `代码`\n\n```ts\nconst a = 1;\n```\n" },
    }));
  });

  // 基线：无自定义主题
  await setTheme("", "light");
  const baseLight = await grab();
  await setTheme("", "dark");
  const baseDark = await grab();

  console.log("\n=== T1 安装内置主题按钮 ===");
  await setTheme("", "light");
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /设置/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const hasBtn = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).some((b) => /安装内置主题/.test(b.textContent || "")));
  check("T1a 设置面板有「安装内置主题」按钮", hasBtn);
  const installed = await page.evaluate(async () => {
    const mod = await import("/src/ipc.ts");
    return mod.api.installBuiltinThemes();
  });
  check("T1b 安装命令返回 5 套主题", Array.isArray(installed) && installed.length === 5, JSON.stringify(installed));
  const listed = await page.evaluate(async () => {
    const mod = await import("/src/ipc.ts");
    return mod.api.listThemes();
  });
  check("T1c 主题列表包含 5 套内置主题", THEMES.every((t) => listed.includes(t)), JSON.stringify(listed));

  console.log("\n=== T2 每套主题：整个框架都跟随变化 ===");
  for (const t of THEMES) {
    await setTheme(t, "light");
    const l = await grab();
    const changed = FRAME.filter(([name, sel, prop]) => l[name] && l[name] !== baseLight[name]).map(([n]) => n);
    const unchangedLight = FRAME.filter(([n]) => !changed.includes(n)).map(([n]) => n);
    check(`T2-${t} 浅色下框架各处都变了`, changed.length === FRAME.length,
      `变了 ${changed.length}/${FRAME.length} 未变=${JSON.stringify(unchangedLight)}`);

    await setTheme(t, "dark");
    const d = await grab();
    const changedD = FRAME.filter(([name, sel, prop]) => d[name] && d[name] !== baseDark[name]).map(([n]) => n);
    check(`T2-${t} 深色下框架各处都变了`, changedD.length === FRAME.length,
      `变了 ${changedD.length}/${FRAME.length}：${JSON.stringify(changedD)}`);
  }

  console.log("\n=== T3 深浅两套确实是两套（不是同一套） ===");
  for (const t of THEMES) {
    await setTheme(t, "light");
    const l = await grab();
    await setTheme(t, "dark");
    const d = await grab();
    const differ = FRAME.filter(([name]) => l[name] && d[name] && l[name] !== d[name]).map(([n]) => n);
    check(`T3-${t} 深浅两套框架样式不同`, differ.length >= 4,
      `不同处 ${differ.length}/${FRAME.length}：${JSON.stringify(differ)}`);
    check(`T3-${t} 浅色底浅于深色底`, l["__bg"] !== d["__bg"], `${l["__bg"]} vs ${d["__bg"]}`);
  }

  console.log("\n=== T4 对比度（正文 / 次要 / 强调 / 标题栏文字） ===");
  const toHex = (c) => {
    const s = String(c || "").trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(s);
    if (m) return "#" + m[1];
    const r = s.match(/rgba?\(([^)]+)\)/);
    if (r) {
      const p = r[1].split(",").map((x) => parseFloat(x.trim()));
      const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
      return "#" + h(p[0]) + h(p[1]) + h(p[2]);
    }
    return null;
  };
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(toHex(hex) || "");
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); if (la === null || lb === null) return null; const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  for (const t of THEMES) {
    for (const mode of ["light", "dark"]) {
      await setTheme(t, mode);
      const g = await grab();
      const body = ratio(g["__fg"], g["__bg"]);
      const accent = ratio(g["__accent"], g["__bg"]);
      const bar = ratio(g["__titlebarFg"], g["标题栏"]);
      check(`T4-${t}-${mode} 正文对比度 ≥ 4.5:1`, (body || 0) >= 4.5, `${body?.toFixed(2)}:1`);
      check(`T4-${t}-${mode} 强调色对比度 ≥ 4.5:1`, (accent || 0) >= 4.5, `${accent?.toFixed(2)}:1`);
      check(`T4-${t}-${mode} 标题栏文字对比度 ≥ 4.5:1`, (bar || 0) >= 4.5, `${bar?.toFixed(2)}:1`);
    }
  }

  // 截图：每套主题的浅色与深色
  for (const t of THEMES) {
    await setTheme(t, "light");
    await page.screenshot({ path: path.join(OUT, `theme-${t}-light.png`) });
    await setTheme(t, "dark");
    await page.screenshot({ path: path.join(OUT, `theme-${t}-dark.png`) });
  }

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
