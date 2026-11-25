/**
 * 自定义主题的应用：解析主题文件 → 提取基色 → 派生整套令牌 → 注入。
 *
 * 主题文件有两种写法，自动识别：
 *
 * **① 基色派生（推荐）** —— 只写 3~5 个基色，系统推导出全部 58 个颜色令牌，
 *    并且**深浅两套自动配比**（一套主题深浅两用）：
 *    ```css
 *    :root {
 *      --mw-base-bg: #fbf1d8;        // 主底色（浅色模式）
 *      --mw-base-accent: #b58900;    // 强调色（浅色模式）
 *    }
 *    // 可选：显式给暗色模式的基色；不给则由系统自动派生（压暗底色、提亮强调色）
 *    [data-theme="dark"] {
 *      --mw-base-bg: #241f18;
 *      --mw-base-accent: #e0b155;
 *    }
 *    ```
 *
 * **② 逐个令牌覆盖（兼容旧写法）** —— 直接写完整的 CSS 变量，行为与从前一致：
 *    ```css
 *    :root { --bg: #fbf1d8; --fg: #586e75; --accent: #b58900; }
 *    [data-theme="dark"] { --bg: #241f18; ... }
 *    ```
 *
 * 判定依据：文件里出现 `--mw-base-*` → 走 ①，否则走 ②。
 * ① 模式下，用户显式写出的令牌（②的写法）仍会**覆盖**派生值 —— 显式优先。
 */

import {
  deriveTokens,
  parseColor,
  tokensToCss,
  type BaseTokens,
  type DerivedTokens,
} from "./palette";

/** 一段 CSS 规则里的声明 */
interface Rule {
  selector: string;
  decls: string[];
}

const BASE_VAR_TO_KEY: Record<string, keyof BaseTokens> = {
  "--mw-base-bg": "bg",
  "--mw-base-surface": "surface",
  "--mw-base-fg": "fg",
  "--mw-base-accent": "accent",
};

/**
 * 粗粒度地把 CSS 拆成「选择器 + 声明列表」。
 *
 * 只处理主题文件这种简单场景（顶层选择器 + 声明），不追求完整的 CSS 解析 ——
 * 主题文件里本来就只该写变量与少量自定义规则。
 */
export function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].trim();
    const decls = m[2]
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    if (selector && decls.length) rules.push({ selector, decls });
  }
  return rules;
}

function declValue(decl: string): { name: string; value: string } | null {
  const i = decl.indexOf(":");
  if (i < 0) return null;
  return { name: decl.slice(0, i).trim(), value: decl.slice(i + 1).trim() };
}

function isRootSelector(sel: string): boolean {
  return sel === ":root" || sel === "html" || sel === ":root, html";
}

function isDarkSelector(sel: string): boolean {
  return sel.includes('[data-theme="dark"]');
}

/** 从一组规则里抽出基色与显式令牌覆盖 */
export interface ExtractedTheme {
  lightBase: BaseTokens;
  darkBase: BaseTokens;
  /** 显式覆盖的令牌（light / dark 分开） */
  lightOverrides: DerivedTokens;
  darkOverrides: DerivedTokens;
  /** 主题文件里是否存在基色声明（决定走派生还是原样注入） */
  hasBase: boolean;
}

export function extractTheme(css: string): ExtractedTheme {
  const rules = parseRules(css);
  const lightBase: BaseTokens = {};
  const darkBase: BaseTokens = {};
  const lightOverrides: DerivedTokens = {};
  const darkOverrides: DerivedTokens = {};
  let hasBase = false;

  for (const rule of rules) {
    const dark = isDarkSelector(rule.selector);
    const root = isRootSelector(rule.selector);
    for (const decl of rule.decls) {
      const d = declValue(decl);
      if (!d) continue;
      const baseKey = BASE_VAR_TO_KEY[d.name];
      if (baseKey) {
        hasBase = true;
        if (parseColor(d.value)) {
          if (dark) darkBase[baseKey] = d.value;
          else lightBase[baseKey] = d.value;
        }
        continue;
      }
      if (d.name.startsWith("--") && parseColor(d.value)) {
        // 显式令牌覆盖：dark 选择器里的算暗色覆盖，其余算亮色覆盖
        if (dark) darkOverrides[d.name] = d.value;
        else lightOverrides[d.name] = d.value;
      }
    }
    void root;
  }

  return { lightBase, darkBase, lightOverrides, darkOverrides, hasBase };
}

/**
 * 生成要注入的 CSS。
 *
 * 输出的两条规则用 `:root:not([data-theme="dark"])` 与 `[data-theme="dark"]` ——
 * 前者特异度更高但不匹配暗色模式，因此**不依赖样式表里的先后顺序**，
 * 深浅两套不会互相盖错（这是裸 `:root` 注入最常见的错位来源）。
 */
export function buildThemeCss(css: string): { derived: string; injected: string } {
  const ex = extractTheme(css);
  if (!ex.hasBase) {
    // ② 逐个令牌覆盖：原样注入，行为与从前完全一致
    return { derived: "", injected: css };
  }

  const light = { ...deriveTokens(ex.lightBase, "light"), ...ex.lightOverrides };

  // 暗色基色：主题显式给了就用（并标记为「显式」，避免再被翻转一次）；
  // 没给就沿用浅色基色，由 deriveTokens 的 dark 分支自动压暗/提亮。
  const darkHasOwn = Object.keys(ex.darkBase).length > 0;
  const darkBase: BaseTokens = darkHasOwn ? ex.darkBase : ex.lightBase;
  const darkFinal = {
    ...deriveTokens(darkBase, "dark", {
      bg: darkHasOwn && ex.darkBase.bg !== undefined,
      fg: darkHasOwn && ex.darkBase.fg !== undefined,
      accent: darkHasOwn && ex.darkBase.accent !== undefined,
    }),
    ...ex.darkOverrides,
  };

  const derived =
    `:root:not([data-theme="dark"]) ${tokensToCss(light)}\n` +
    `[data-theme="dark"] ${tokensToCss(darkFinal)}`;

  return { derived, injected: css };
}
