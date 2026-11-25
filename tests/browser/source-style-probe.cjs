// 源码编辑器样式统一性验收
// 覆盖：① 去掉 CM6 默认的 dotted 焦点框；② 源码编辑器 / 预览代码块 / 行内代码
//      共用同一组字体·字号·行距令牌；③ 源码侧补齐与预览一致的结构视觉
//      （围栏代码块 / 引用 / 表格）；④ 随航左栏与源码模式完全一致
// 运行：node tests/browser/source-style-probe.cjs
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

const DOC = `# 标题

段落 **粗体** *斜体* \`行内代码\` [链接](https://example.com)

> 引用块

- 列表项

\`\`\`ts
const a: number = 1;
\`\`\`

| 列 A | 列 B |
| --- | --- |
| 值 1 | 值 2 |
`;

const pick = (m, keys) => {
  const o = {};
  for (const k of keys) o[k] = m[k];
  return o;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const grab = async () => page.evaluate(() => {
    const g = (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const o = {};
      for (const pr of props) o[pr] = cs[pr];
      return o;
    };
    return {
      cmEditor: g(".cm-editor", ["outlineStyle", "outlineWidth", "fontFamily", "fontSize", "lineHeight"]),
      cmContent: g(".cm-content", ["fontFamily", "fontSize", "lineHeight"]),
      cmLine: g(".cm-line", ["fontFamily", "fontSize", "lineHeight"]),
      cmGut: g(".cm-gutters", ["backgroundColor", "borderRightWidth", "fontVariantNumeric"]),
      codeEl: g(".code-block code.hljs", ["fontFamily", "fontSize", "lineHeight"]),
      pmCode: g(".ProseMirror code", ["fontFamily", "fontSize"]),
      // 源码侧结构装饰：按 class 统计命中的行数
      fenceLines: document.querySelectorAll(".cm-line.mw-src-fence").length,
      quoteLines: document.querySelectorAll(".cm-line.mw-src-quote").length,
      tableLines: document.querySelectorAll(".cm-line.mw-src-table").length,
      thLines: document.querySelectorAll(".cm-line.mw-src-th").length,
      // 预览侧对应结构
      pmQuote: !!document.querySelector(".ProseMirror blockquote"),
      pmTable: !!document.querySelector(".ProseMirror table"),
      pmCodeBlock: !!document.querySelector(".code-block"),
    };
  });

  // 必须先导航到同源页面，否则 about:blank 的 localStorage 访问被拒
  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const setup = async (theme) => {
    await page.evaluate(({ doc, t }) => {
      localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/s.md": doc } }));
      localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
        theme: t, focus_mode: false, zoom: 100, autosave_ms: 999999,
        sidebar_open: true, sidebar_width: 240, split_ratio: 50,
      }));
    }, { doc: DOC, t: theme });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await openWorkspace(page);
    await openFileInTree(page, "s.md");
    await page.waitForTimeout(700);
  };

  const setMode = async (label) => {
    await page.evaluate((l) => {
      const b = Array.from(document.querySelectorAll(".mode-segment")).find((x) => (x.textContent || "").trim() === l);
      if (b) b.click();
    }, label);
    await page.waitForTimeout(1400);
  };

  for (const theme of ["light", "dark"]) {
    console.log(`\n=== ${theme} 主题 ===`);
    await setup(theme);
    await setMode("源码");
    const src = await grab();

    check(`S1-${theme} 源码编辑器没有 dotted 焦点框`,
      src.cmEditor.outlineStyle !== "dotted", `outlineStyle=${src.cmEditor.outlineStyle}`);
    check(`S2-${theme} 源码正文用统一等宽字体栈`,
      src.cmContent.fontFamily.includes("Consolas") && src.cmContent.fontFamily.includes("Cascadia Mono"),
      `font=${src.cmContent.fontFamily}`);
    check(`S3-${theme} 源码行距与令牌一致`,
      Math.abs(parseFloat(src.cmContent.lineHeight) - parseFloat(src.cmLine.lineHeight)) < 0.5,
      `content=${src.cmContent.lineHeight} line=${src.cmLine.lineHeight}`);
    check(`S4-${theme} 行号列透明底 + 细分割线 + 等宽数字`,
      src.cmGut.backgroundColor === "rgba(0, 0, 0, 0)" && src.cmGut.borderRightWidth === "1px" && src.cmGut.fontVariantNumeric === "tabular-nums",
      JSON.stringify(src.cmGut));
    check(`S5-${theme} 源码侧围栏代码块有结构装饰`,
      src.fenceLines >= 3, `行数=${src.fenceLines}`);
    check(`S6-${theme} 源码侧引用块有结构装饰`,
      src.quoteLines >= 1, `行数=${src.quoteLines}`);
    check(`S7-${theme} 源码侧表格有结构装饰（含表头行）`,
      src.tableLines >= 3 && src.thLines >= 1, `表=${src.tableLines} 表头=${src.thLines}`);
    check(`S8-${theme} 预览侧三种结构都在（可对照）`,
      src.pmQuote && src.pmTable && src.pmCodeBlock, JSON.stringify({ q: src.pmQuote, t: src.pmTable, c: src.pmCodeBlock }));

    // 预览侧的字体/字号/行距 vs 源码侧
    await setMode("所见即所得");
    const prev = await grab();
    check(`S9-${theme} 预览代码块与源码同一字体栈`,
      prev.codeEl.fontFamily === src.cmContent.fontFamily,
      `预览=${prev.codeEl.fontFamily} / 源码=${src.cmContent.fontFamily}`);
    check(`S10-${theme} 预览代码块与源码同一字号`,
      prev.codeEl.fontSize === src.cmContent.fontSize,
      `预览=${prev.codeEl.fontSize} / 源码=${src.cmContent.fontSize}`);
    check(`S11-${theme} 预览代码块与源码同一行距`,
      Math.abs(parseFloat(prev.codeEl.lineHeight) - parseFloat(src.cmContent.lineHeight)) < 0.5,
      `预览=${prev.codeEl.lineHeight} / 源码=${src.cmContent.lineHeight}`);
    check(`S12-${theme} 行内代码与源码同一字体栈与字号`,
      prev.pmCode.fontFamily === src.cmContent.fontFamily && prev.pmCode.fontSize === src.cmContent.fontSize,
      `行内=${prev.pmCode.fontFamily} ${prev.pmCode.fontSize} / 源码=${src.cmContent.fontFamily} ${src.cmContent.fontSize}`);

    // 随航左栏应与源码模式完全一致
    await setMode("随航");
    const split = await grab();
    check(`S13-${theme} 随航左栏与源码模式字体一致`,
      split.cmContent.fontFamily === src.cmContent.fontFamily && split.cmContent.fontSize === src.cmContent.fontSize,
      `随航=${split.cmContent.fontFamily} ${split.cmContent.fontSize}`);
    check(`S14-${theme} 随航左栏同样没有 dotted 焦点框`,
      split.cmEditor.outlineStyle !== "dotted", `outlineStyle=${split.cmEditor.outlineStyle}`);
    check(`S15-${theme} 随航左栏同样有结构装饰`,
      split.fenceLines >= 3 && split.quoteLines >= 1 && split.tableLines >= 3,
      JSON.stringify({ f: split.fenceLines, q: split.quoteLines, t: split.tableLines }));
  }

  await page.screenshot({ path: path.join(OUT, "32-src-unified.png") });
  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
