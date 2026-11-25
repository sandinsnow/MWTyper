// 高亮配色的 WCAG 对比度校验工具
//
// 用途：工程师挑配色时先跑一遍，QA 把结论固化成断言。
// 两个用途都要求「数值可复算」，不接受肉眼判断。
//
// 用法：
//   node tests/browser/contrast-check.cjs                  # 跑内置样例
//   node tests/browser/contrast-check.cjs <palette.json>    # 校验自定义配色
//
// palette.json 格式：
//   { "light": [ {"name":"标题","fg":"#24292f","bg":"#ffffff","level":"text"} ],
//     "dark":  [ {"name":"标题","fg":"#e6edf3","bg":"#22252b","level":"text"} ] }
//   level: "text"（正文 4.5:1）| "ui"（UI 组件/非文本 3:1）| "large"（大号文本 3:1）
//
// 注意：半透明色必须先与背景**逐通道**混合再算，不能把整个 hex 当单通道送进亮度函数。
const fs = require("fs");

/** #rrggbb | #rgb | rgb(...) | rgba(...) → [r,g,b,a] */
function parseColor(c) {
  if (typeof c !== "string") throw new Error(`bad color: ${c}`);
  c = c.trim();
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    if (h.length !== 6) throw new Error(`bad hex: ${c}`);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`bad color: ${c}`);
  const p = m[1].split(",").map((s) => parseFloat(s.trim()));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/** 把半透明前景逐通道混合到不透明背景上 */
function blend(fg, bg) {
  const a = fg[3];
  if (a >= 1) return [fg[0], fg[1], fg[2]];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
  ];
}

/** WCAG 相对亮度：逐通道 sRGB 线性化后加权 */
function luminance(rgb) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(fgRaw, bgRaw) {
  const bg = blend(parseColor(bgRaw), [255, 255, 255, 1]);
  const fg = blend(parseColor(fgRaw), bg);
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const THRESHOLD = { text: 4.5, ui: 3, large: 3, decorative: 0 };

function checkPalette(theme, entries) {
  console.log(`\n===== ${theme} =====`);
  let bad = 0;
  for (const e of entries) {
    const need = THRESHOLD[e.level || "text"];
    if (e.level === "decorative") {
      console.log(`SKIP [${e.name}] ${e.fg} on ${e.bg} — 纯装饰面，无对比度门槛`);
      continue;
    }
    const r = contrast(e.fg, e.bg);
    const ok = r >= need;
    if (!ok) bad += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"} [${e.name}] ${e.fg} on ${e.bg} = ${r.toFixed(2)}:1 ` +
      `(需 ≥ ${need}:1)${ok ? "" : "  ← 不达标"}`
    );
  }
  return bad;
}

// ---- 内置样例：项目现有配色的基线校验（证明工具本身可信） ----
const SAMPLES = {
  light: [
    { name: "正文", fg: "#1f2937", bg: "#ffffff", level: "text" },
    { name: "次要文字", fg: "#5b6472", bg: "#ffffff", level: "text" },
    { name: "次要文字(侧栏底)", fg: "#5b6472", bg: "#f0f1f3", level: "text" },
    { name: "强调色(编辑底)", fg: "#0a754d", bg: "#ffffff", level: "text" },
    { name: "强调色(侧栏底)", fg: "#0a754d", bg: "#f0f1f3", level: "text" },
    { name: "查找高亮文字", fg: "#1f2937", bg: "#ffecb0", level: "text" },
    { name: "查找高亮当前项", fg: "#1f2937", bg: "#ffb13f", level: "text" },
    { name: "选区", fg: "#1f2937", bg: "#d7e9ff", level: "text" },
  ],
  dark: [
    { name: "正文", fg: "#d6d9de", bg: "#22252b", level: "text" },
    { name: "次要文字", fg: "#98a0ab", bg: "#22252b", level: "text" },
    { name: "强调色", fg: "#34d399", bg: "#22252b", level: "text" },
    { name: "查找高亮文字", fg: "#1f2328", bg: "#ffd54f", level: "text" },
    { name: "查找高亮当前项", fg: "#1f2328", bg: "#fbbf24", level: "text" },
    { name: "选区", fg: "#d6d9de", bg: "#2d4a6b", level: "text" },
  ],
};

const file = process.argv[2];
const palette = file ? JSON.parse(fs.readFileSync(file, "utf8")) : SAMPLES;
console.log("高亮配色 WCAG 对比度校验" + (file ? ` —— ${file}` : " —— 内置基线样例"));
let bad = 0;
for (const [theme, entries] of Object.entries(palette)) {
  bad += checkPalette(theme, entries);
}
console.log(`\n${bad === 0 ? "全部达标" : `有 ${bad} 项不达标`}`);
process.exit(bad === 0 ? 0 : 1);
