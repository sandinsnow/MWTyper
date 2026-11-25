// 高亮现状取证截图：亮/暗两套主题下的源码模式 + WYSIWYG 代码块
// 运行：node tests/browser/highlight-shots.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree, clickSegment } = require("./probe-util.cjs");

require("fs").mkdirSync(OUT, { recursive: true });

const DOC = `# 高亮取证

行内 \`code\`、**粗体**、*斜体*、[链接](https://example.com)、~~删除线~~。

> 引用块里的文字。

- 列表项
- 第二项

\`\`\`ts
interface User {
  id: number;
  name: string;
  tags: string[];
}
const u: User = { id: 1, name: "MWTyper", tags: ["a"] };
function greet(user: User): string {
  return \`Hello, \${user.name}!\`;
}
\`\`\`

| 列 A | 列 B |
| --- | --- |
| 值 1 | 值 2 |

行内公式 $E = mc^2$。
`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  // 必须先导航到同源页面，否则 about:blank 的 localStorage 访问被拒绝
  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const clickByText = async (re) => {
    const ok = await page.evaluate((src) => {
      const rx = new RegExp(src);
      const b = Array.from(document.querySelectorAll("button")).find((x) => rx.test(x.textContent || ""));
      if (b) { b.click(); return true; }
      return false;
    }, re.source);
    await page.waitForTimeout(600);
    return ok;
  };

  const setup = async (theme) => {
    await page.evaluate(({ doc, theme }) => {
      localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/高亮.md": doc } }));
      localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
        theme, focus_mode: false, zoom: 100, autosave_ms: 999999, sidebar_open: true, sidebar_width: 240,
      }));
    }, { doc: DOC, theme });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await openWorkspace(page);
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".tree-row"));
      const t = rows.find((r) => (r.textContent || "").includes("高亮.md"));
      if (t) t.click();
    });
    await page.waitForTimeout(1200);
  };

  for (const theme of ["light", "dark"]) {
    console.log(`[${theme}]`);
    await setup(theme);
    await page.screenshot({ path: path.join(OUT, `hl-${theme}-wysiwyg.png`) });

    // 源码模式
    await clickSegment(page, "源码");
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(OUT, `hl-${theme}-source.png`) });

    // 统计源码模式下被着色的 token 数（说明高亮是否生效）
    const tok = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll(".cm-content span"));
      const colored = spans.filter((s) => {
        const c = getComputedStyle(s).color;
        const p = s.parentElement ? getComputedStyle(s.parentElement).color : "";
        return c !== p;
      });
      // 标记符专属 class 的分布
      const mw = {};
      for (const cls of ["mw-HeaderMark","mw-QuoteMark","mw-ListMark","mw-EmphasisMark","mw-CodeMark","mw-LinkMark"]) {
        const els = document.querySelectorAll(".cm-content ." + cls);
        mw[cls] = { n: els.length, color: els.length ? getComputedStyle(els[0]).color : null };
      }
      // 行号与代码的断裂空白
      const gut = document.querySelector(".cm-gutters");
      const content = document.querySelector(".cm-content");
      const gr = gut ? gut.getBoundingClientRect() : null;
      const cr = content ? content.getBoundingClientRect() : null;
      return {
        spans: spans.length, colored: colored.length,
        sample: colored.slice(0, 6).map((s) => s.textContent),
        mw,
        gap: gr && cr ? Math.round(cr.left - gr.right) : null,
        contentW: cr ? Math.round(cr.width) : null,
      };
    });
    console.log(`  源码模式 token: ${tok.spans} span / ${tok.colored} 有色`);
    console.log(`  标记符专属 class:`, JSON.stringify(tok.mw));
    console.log(`  行号→代码间隙: ${tok.gap}px   内容宽度: ${tok.contentW}px`);

    // 代码块底色（WYSIWYG 里的 code block）
    await clickSegment(page, "源码");
    await page.waitForTimeout(900);
    const cb = await page.evaluate(() => {
      const el = document.querySelector(".code-block");
      if (!el) return null;
      const code = el.querySelector("code.hljs");
      const cs = getComputedStyle(el);
      const ccs = code ? getComputedStyle(code) : null;
      return {
        barBg: cs.backgroundColor,
        codeBg: ccs ? ccs.backgroundColor : null,
        theme: document.documentElement.dataset.theme,
        spans: el.querySelectorAll("code span").length,
        coloredSpans: Array.from(el.querySelectorAll("code span")).filter((s) => {
          const c = getComputedStyle(s).color;
          const p = s.parentElement ? getComputedStyle(s.parentElement).color : "";
          return c !== p;
        }).length,
      };
    });
    console.log("  WYSIWYG 代码块:", JSON.stringify(cb));
    await page.screenshot({ path: path.join(OUT, `hl-${theme}-codeblock.png`) });
  }

  console.log("页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 5)) : "无"));
  await browser.close();
})();
