/**
 * 主题调色板：从少量**基色**推导出整套界面令牌，并按深/浅色模式自动配比。
 *
 * 背景：自定义主题以前是**裸 CSS 注入**（主题文件写什么就覆盖什么），而应用有
 * 58 个颜色令牌 —— 主题只声明 4 个时，其余 54 个仍是内置默认，视觉上就是
 * 「只改了编辑器，别的还是老样子」；而且 `:root` 无条件覆盖，深色模式下也被
 * 浅色值盖掉，深浅两套配比全乱。
 *
 * 现在的约定：
 * - 主题文件**只需声明基色**（`--mw-base-bg` / `--mw-base-accent` 等），
 *   系统据此推导出**全部**令牌，深浅两套都给出 —— 一套主题深浅两用。
 * - 主题文件仍可**逐个令牌覆盖**（兼容以前的写法），显式声明优先于派生值。
 */

// ---------------------------------------------------------------------------
// 颜色基础运算
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number; // 0–360
  s: number; // 0–100
  l: number; // 0–100
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 解析 #rgb / #rrggbb / rgb() / rgba() */
export function parseColor(input: string): Rgb | null {
  const s = String(input || "").trim();
  if (!s) return null;
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(",").map((x) => parseFloat(x.trim()));
  if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
  return { r: p[0], g: p[1], b: p[2] };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const ss = s / 100;
  const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rp = 0, gp = 0, bp = 0;
  if (hp < 1) [rp, gp, bp] = [c, x, 0];
  else if (hp < 2) [rp, gp, bp] = [x, c, 0];
  else if (hp < 3) [rp, gp, bp] = [0, c, x];
  else if (hp < 4) [rp, gp, bp] = [0, x, c];
  else if (hp < 5) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const m = ll - c / 2;
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

export function hsl({ h, s, l }: Hsl): string {
  return toHex(hslToRgb({ h, s, l }));
}

/** WCAG 相对亮度 */
export function relLuminance({ r, g, b }: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 对比度 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relLuminance(a);
  const l2 = relLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 调整明度直到满足对比度要求（可对**多个背景**同时校验）。
 *
 * 方向由 `direction` 决定：往「更亮」还是「更暗」走。
 * 这是「配比」的核心 —— 主题作者给的基色不必自己保证对比度，系统来兜底。
 *
 * 为什么要「多个背景」：强调色会同时出现在**编辑区底色**与**应用底色**上，
 * 只对其中一个校验会漏 —— 实测暖阳浅色的强调色在编辑区上是 4.52:1（达标），
 * 换到应用底色上却掉到 4.48:1（不达标）。取两个背景里**更严的那个**来校正。
 */
export function ensureContrast(
  color: Hsl,
  against: Rgb | Rgb[],
  need: number,
  direction: "lighter" | "darker"
): Hsl {
  const backgrounds = Array.isArray(against) ? against : [against];
  const worst = (c: Hsl) => Math.min(...backgrounds.map((b) => contrastRatio(hslToRgb(c), b)));
  let best = color;
  let bestRatio = worst(color);
  if (bestRatio >= need) return color;
  for (let step = 1; step <= 100; step++) {
    const next: Hsl = {
      ...color,
      l: clamp(color.l + (direction === "lighter" ? step : -step), 0, 100),
    };
    const ratio = worst(next);
    if (ratio > bestRatio) {
      best = next;
      bestRatio = ratio;
    }
    if (ratio >= need) return next;
    if ((direction === "lighter" && next.l >= 100) || (direction === "darker" && next.l <= 0)) break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 基色与派生
// ---------------------------------------------------------------------------

/** 主题文件里声明的基色 */
export interface BaseTokens {
  /** 主底色（应用背景） */
  bg?: string;
  /** 面板/侧栏底色（不给则由 bg 派生） */
  surface?: string;
  /** 主文字色（不给则由 bg 派生） */
  fg?: string;
  /** 强调色 */
  accent?: string;
}

export const BASE_TOKEN_NAMES = ["bg", "surface", "fg", "accent"] as const;

const BASE_VARS: Record<string, string> = {
  bg: "--mw-base-bg",
  surface: "--mw-base-surface",
  fg: "--mw-base-fg",
  accent: "--mw-base-accent",
};

/** 一套派生出来的界面令牌 */
export type DerivedTokens = Record<string, string>;

/**
 * 从基色推导出整套令牌。
 *
 * 规则（深浅两套）：
 * - **中性色**（表面/边框/文字）取自 `bg` 的**色相**，饱和度压低，明度按模式排布；
 * - **强调色**取自 `accent`，在浅色模式压暗、深色模式提亮，并**自动保证**与正文底色的
 *   对比度 ≥ 4.5:1；
 * - **语义色**（危险/警告/差异/删除线等）保留内置值 —— 它们承载语义，强行同色相会丢失区分度，
 *   主题文件仍可显式覆盖。
 */
export function deriveTokens(
  base: BaseTokens,
  mode: "light" | "dark",
  /**
   * 哪些基色是**作者显式指定**的。
   *
   * 这个区分是必需的：显式给的暗色底色要**按给定值用**（不能再被翻转一次 ——
   * 否则 `#241f18` 会被当成浅色底色翻成近白）；而没显式给时，暗色底色
   * 应当由浅色底色**自动压暗**得到，两套自然协调。
   */
  explicit: { bg?: boolean; fg?: boolean; accent?: boolean } = {}
): DerivedTokens {
  const bgRgb = parseColor(base.bg || "#f6f7f9")!;
  const accentRgb = parseColor(base.accent || "#0a754d")!;
  const bg = rgbToHsl(bgRgb);
  const accent = rgbToHsl(accentRgb);
  const surfaceRgb = base.surface ? parseColor(base.surface) : null;
  const fgRgb = base.fg ? parseColor(base.fg) : null;

  const dark = mode === "dark";

  // —— 中性色阶 ——
  // 浅色：底色接近主题给的 bg；深色：同色相、压到低明度（100 - L + 10，落在 10–20）。
  // 显式给了暗色底色就按给定值用，不再翻转。
  const bgL = explicit.bg
    ? dark
      ? clamp(bg.l, 8, 24)
      : clamp(bg.l, 88, 99)
    : dark
      ? clamp(100 - bg.l + 10, 10, 20)
      : clamp(bg.l, 88, 99);
  const neutralS = Math.min(bg.s, dark ? 14 : 12);
  const n = (l: number, s = neutralS) => hsl({ h: bg.h, s, l });

  const bgSideL = dark ? bgL + 3 : bgL - 4;
  const bgEditorL = dark ? bgL + 4 : clamp(bgL + 3, 0, 100);
  const bgHoverL = dark ? bgL + 8 : bgL - 7;
  const borderL = dark ? bgL + 12 : bgL - 12;

  const bgOut = n(bgL);
  const bgSideOut = n(bgSideL);
  const bgEditorOut = n(bgEditorL);
  const bgHoverOut = n(bgHoverL);
  const borderOut = n(borderL);

  // —— 文字 ——
  // 浅色：暗端文字；深色：亮端文字。都按与编辑底色的对比度兜底。
  let fg = fgRgb
    ? rgbToHsl(fgRgb)
    : { h: bg.h, s: Math.min(bg.s, 18), l: dark ? 86 : 22 };
  void explicit.fg;
  fg = ensureContrast(fg, [parseColor(bgOut)!, parseColor(bgEditorOut)!], 7, dark ? "lighter" : "darker");
  const fgOut = hsl(fg);
  let fgDim = { ...fg, l: dark ? clamp(fg.l - 24, 45, 75) : clamp(fg.l + 22, 32, 55) };
  fgDim = ensureContrast(fgDim, [parseColor(bgOut)!, parseColor(bgSideOut)!], 4.5, dark ? "lighter" : "darker");
  const fgDimOut = hsl(fgDim);

  // —— 强调色 ——
  let acc = { ...accent };
  if (dark && !explicit.accent) {
    // 浅色强调色在深底上会糊掉 → 提亮并略提饱和（作者显式给了暗色强调色就不动）
    acc = { h: acc.h, s: clamp(acc.s + 6, 0, 100), l: clamp(acc.l + (100 - acc.l) * 0.55, 0, 100) };
  }
  // 强调色同时出现在编辑区底色与应用底色上 —— 两个背景都要兜底（见 ensureContrast 注释）
  const accentBgs = [parseColor(bgOut)!, parseColor(bgEditorOut)!];
  acc = ensureContrast(acc, accentBgs, 4.5, dark ? "lighter" : "darker");
  const accentOut = hsl(acc);
  let accStrong = { ...acc, l: dark ? acc.l + 6 : clamp(acc.l - 7, 0, 100) };
  accStrong = ensureContrast(accStrong, accentBgs, 4.5, dark ? "lighter" : "darker");
  const accentStrongOut = hsl(accStrong);

  // 强调色上的文字：取对比更高的一端（黑或白）
  const onAccent = contrastRatio({ r: 255, g: 255, b: 255 }, hslToRgb(accStrong)) >=
    contrastRatio({ r: 0, g: 0, b: 0 }, hslToRgb(accStrong))
    ? "#ffffff"
    : "#000000";

  // —— 标题栏与标题栏按钮 ——
  // **必须跟随主题**：之前这里固定成近黑（L=11/13），于是「切换自定义主题」只把
  // 标题栏的色相染了一下，框架本身还是黑的 —— 用户反馈「切换后要改变整个框架的风格」。
  // 现在标题栏由基色的**色相 + 明度体系**推导：
  //   浅色模式：比正文底色略深（有层次但不黑），文字用派生的正文色
  //   深色模式：比正文底色略深，文字用浅色
  const titlebarBg = hsl({
    h: bg.h,
    s: Math.min(bg.s, dark ? 16 : 20),
    l: dark ? Math.max(6, bgL - 3) : Math.max(28, bgL - 13),
  });
  const titlebarFg = dark ? hsl({ h: bg.h, s: 6, l: 92 }) : hsl({ h: bg.h, s: Math.min(bg.s, 18), l: 22 });
  const tbBtn = hsl({ h: bg.h, s: Math.min(bg.s, dark ? 12 : 16), l: dark ? bgL + 6 : Math.max(24, bgL - 18) });
  const tbBtnHover = hsl({ h: bg.h, s: Math.min(bg.s, 18), l: dark ? bgL + 13 : Math.max(18, bgL - 24) });

  // —— 其它表面 ——
  const inlineCodeBg = n(dark ? bgL + 7 : bgL - 6);
  const thBg = inlineCodeBg;
  const quoteBg = hsl({ h: accent.h, s: Math.min(accent.s, 30), l: dark ? bgL + 7 : clamp(bgL - 4, 0, 100) });
  const quoteBorder = hsl({ h: accent.h, s: clamp(accent.s, 40, 90), l: dark ? clamp(accent.l - 12, 30, 60) : clamp(accent.l, 35, 70) });
  const warnBg = dark ? hsl({ h: 40, s: 55, l: bgL + 10 }) : hsl({ h: 40, s: 85, l: 95 });
  const warnFg = dark ? hsl({ h: 45, s: 90, l: 78 }) : hsl({ h: 30, s: 90, l: 38 });

  // 查找高亮：浅色下用暖黄底 + 深字；深色下用琥珀底 + 深字（保持 ≥ 4.5:1）
  const findBg = "#ffd54f";
  const findBgCurrent = dark ? "#f59e0b" : "#ffb020";
  const findFg = "#1f2328";

  const sel = dark ? hsl({ h: bg.h, s: 45, l: bgL + 16 }) : hsl({ h: bg.h, s: 85, l: 93 });

  const t: DerivedTokens = {
    "--bg": bgOut,
    "--bg-side": bgSideOut,
    "--bg-editor": bgEditorOut,
    "--bg-hover": bgHoverOut,
    "--fg": fgOut,
    "--fg-dim": fgDimOut,
    "--border": borderOut,
    "--accent": accentOut,
    "--accent-strong": accentStrongOut,
    "--on-accent-strong": onAccent,
    "--on-danger": "#ffffff",
    "--diff-add": dark ? "#3fb950" : "#1a7f37",
    "--diff-del": dark ? "#f85149" : "#cf222e",
    "--dirty": dark ? "#fbbf24" : "#f59e0b",
    "--overlay-bg": "rgba(0,0,0,.45)",
    "--shadow-modal": dark ? "0 12px 40px rgba(0,0,0,.5)" : "0 12px 40px rgba(0,0,0,.35)",
    "--radius-modal": "10px",
    "--sel": sel,
    "--titlebar-bg": titlebarBg,
    "--titlebar-fg": titlebarFg,
    "--tb-btn": tbBtn,
    "--tb-btn-hover": tbBtnHover,
    "--tb-border": hsl({
      h: bg.h,
      s: Math.min(bg.s, 14),
      l: dark ? Math.max(18, bgL + 9) : Math.max(12, bgL - 22),
    }),
    "--quote-bg": quoteBg,
    "--quote-border": quoteBorder,
    "--inline-code-bg": inlineCodeBg,
    "--th-bg": thBg,
    "--cell-border": borderOut,
    "--warn-bg": warnBg,
    "--warn-fg": warnFg,
    "--danger": dark ? "#f87171" : "#dc2626",
    "--find-bg": findBg,
    "--find-bg-current": findBgCurrent,
    "--find-fg": findFg,
    "--find-outline": "#7a3b00",
    "--raw-html-bg": dark ? hsl({ h: bg.h, s: 10, l: bgL + 6 }) : hsl({ h: bg.h, s: 14, l: 97 }),
    "--raw-html-border": borderOut,
    "--raw-html-fg": fgDimOut,
    "--code-bg": dark ? hsl({ h: bg.h, s: 10, l: clamp(bgL - 2, 6, 16) }) : hsl({ h: bg.h, s: 16, l: 97 }),
    "--code-bar-bg": dark ? hsl({ h: bg.h, s: 10, l: bgL + 6 }) : hsl({ h: bg.h, s: 16, l: 94 }),
    "--code-fg": fgOut,
    "--code-border": borderOut,
  };
  return t;
}

/** 把令牌渲染成一段 CSS */
export function tokensToCss(tokens: DerivedTokens): string {
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `{\n${body}\n}`;
}
