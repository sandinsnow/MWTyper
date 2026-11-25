// 窗口按钮（最小化 / 最大化 / 关闭）的图标对齐验收
//
// 窗口按钮只在 Tauri 里渲染（`isTauri` 取决于 window.__TAURI_INTERNALS__），
// 所以这里用 page.addInitScript 注入一个**桩**，让按钮在浏览器里渲染出来，
// 然后测量 SVG 图标相对按钮的几何居中情况。
//
// 运行：node tests/browser/winbtn-probe.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS [${name}] ${detail}`); }
  else { fail++; failures.push(name); console.log(`FAIL [${name}] ${detail}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  // 注入 Tauri 桩：只为了让 isTauri 为 true、窗口按钮渲染出来
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (cb) => { const t = Math.random(); Object.defineProperty(window, `_${t}`, { value: cb, configurable: true }); return t; },
      invoke: () => Promise.reject(new Error("stub")),
      convertFileSrc: (p) => p,
    };
  });

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const btns = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll(".win-btn"));
    return list.map((b) => {
      const r = b.getBoundingClientRect();
      const svg = b.querySelector("svg");
      const sr = svg ? svg.getBoundingClientRect() : null;
      return {
        label: b.getAttribute("aria-label"),
        hasSvg: !!svg,
        btn: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        svg: sr ? { x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width), h: Math.round(sr.height) } : null,
      };
    });
  });
  console.log("  窗口按钮: " + JSON.stringify(btns, null, 1));

  check("W1a 渲染出 3 个窗口按钮", btns.length === 3, `数量=${btns.length}`);
  check("W1b 每个按钮都用 SVG 图标（不再是字符字形）", btns.every((b) => b.hasSvg),
    JSON.stringify(btns.map((b) => b.hasSvg)));
  check("W1c 按钮尺寸一致", new Set(btns.map((b) => `${b.btn.w}x${b.btn.h}`)).size === 1,
    JSON.stringify(btns.map((b) => `${b.btn.w}x${b.btn.h}`)));

  for (const b of btns) {
    if (!b.svg) continue;
    const dx = Math.abs((b.svg.x + b.svg.w / 2) - (b.btn.x + b.btn.w / 2));
    const dy = Math.abs((b.svg.y + b.svg.h / 2) - (b.btn.y + b.btn.h / 2));
    check(`W2 ${b.label} 图标水平居中（偏差 ≤ 0.6px）`, dx <= 0.6, `dx=${dx.toFixed(2)}`);
    check(`W3 ${b.label} 图标垂直居中（偏差 ≤ 0.6px）`, dy <= 0.6, `dy=${dy.toFixed(2)}`);
    check(`W4 ${b.label} 图标尺寸一致（12×12）`, Math.round(b.svg.w) === 12 && Math.round(b.svg.h) === 12,
      `${b.svg.w}x${b.svg.h}`);
  }

  // 三个图标的几何中心应在同一水平线上（视觉基线一致）
  if (btns.length === 3 && btns.every((b) => b.svg)) {
    const centers = btns.map((b) => b.svg.y + b.svg.h / 2);
    const spread = Math.max(...centers) - Math.min(...centers);
    check("W5 三个图标的中心在同一水平线（偏差 ≤ 0.6px）", spread <= 0.6, `spread=${spread.toFixed(2)}`);
  }

  // 放大截图便于肉眼核对
  const clip = await page.evaluate(() => {
    const g = document.querySelector(".win-controls");
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
  });
  if (clip) {
    await page.screenshot({ path: path.join(OUT, "35-win-buttons.png"), clip });
  }

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 5)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
