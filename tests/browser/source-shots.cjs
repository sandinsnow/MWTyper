// 对比三处「源码/代码」表面：源码模式 / 随航左栏 / 富文本内的代码块
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");
const DOC = `# 标题

一段正文，带 **粗体**、*斜体*、\`行内代码\` 和 [链接](https://example.com)。

> 引用块

- 列表项
- 第二项

\`\`\`ts
interface User {
  id: number;
  name: string;
}
const u: User = { id: 1, name: "MWTyper" };
\`\`\`

| 列 A | 列 B |
| --- | --- |
| 值 1 | 值 2 |
`;
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  await p.evaluate((doc) => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/s.md": doc } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({ theme:"light", focus_mode:false, zoom:100, autosave_ms:999999, sidebar_open:true, sidebar_width:240, split_ratio:50 }));
  }, DOC);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(1400);
  await openWorkspace(p);
  await openFileInTree(p, "s.md");
  await p.waitForTimeout(800);

  // (1) 源码模式
  await p.evaluate(() => { const b=Array.from(document.querySelectorAll(".mode-segment")).find(x=>(x.textContent||"").trim()==="源码"); if(b) b.click(); });
  await p.waitForTimeout(1400);
  await p.screenshot({ path: path.join(OUT, "29-src-mode.png") });

  // (2) 随航左栏
  await p.evaluate(() => { const b=Array.from(document.querySelectorAll(".mode-segment")).find(x=>(x.textContent||"").trim()==="随航"); if(b) b.click(); });
  await p.waitForTimeout(1400);
  await p.screenshot({ path: path.join(OUT, "30-src-split.png") });

  // (3) 富文本内的代码块
  await p.evaluate(() => { const b=Array.from(document.querySelectorAll(".mode-segment")).find(x=>(x.textContent||"").trim()==="所见即所得"); if(b) b.click(); });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const c=document.querySelector(".code-block"); if(c) c.scrollIntoView({block:"center"}); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, "31-codeblock.png") });

  // 量化：两处源码编辑表面的字号/行高/等宽字体/颜色
  const metrics = await p.evaluate(() => {
    const g = (sel, props) => { const el=document.querySelector(sel); if(!el) return null;
      const cs=getComputedStyle(el); const o={}; for(const pr of props) o[pr]=cs[pr]; return o; };
    return {
      cmContent: g(".cm-content", ["fontFamily","fontSize","lineHeight","color","backgroundColor","paddingLeft","paddingRight"]),
      cmLine: g(".cm-line", ["fontFamily","fontSize","lineHeight","color"]),
      cmGutters: g(".cm-gutters", ["fontFamily","fontSize","color","backgroundColor"]),
      cmActive: g(".cm-activeLine", ["backgroundColor"]),
      cmEditor: g(".cm-editor", ["backgroundColor","fontSize"]),
      cmScroller: g(".cm-scroller", ["fontFamily","fontSize","lineHeight"]),
      codeBlock: g(".code-block", ["backgroundColor","color","fontFamily","fontSize","lineHeight"]),
      codeEl: g(".code-block code.hljs", ["fontFamily","fontSize","lineHeight","color","backgroundColor","paddingLeft"]),
      codePre: g(".code-block pre", ["fontFamily","fontSize","lineHeight"]),
      pm: g(".ProseMirror", ["fontFamily","fontSize","lineHeight","color"]),
      pmCode: g(".ProseMirror code", ["fontFamily","fontSize","backgroundColor","color"]),
    };
  });
  console.log(JSON.stringify(metrics, null, 2));
  await b.close();
})();
