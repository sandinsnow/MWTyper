const { EXE, PC } = require("./pw.cjs");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree, clickSegment } = require("./probe-util.cjs");
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await openWorkspace(p);
  await p.evaluate(() => { const r=Array.from(document.querySelectorAll(".tree-row")).find(x=>/高亮/.test(x.textContent||"")); if(r) r.click(); });
  await p.waitForTimeout(1000);
  await clickSegment(p, "源码");
  await p.waitForTimeout(1600);
  const r = await p.evaluate(() => {
    const out = { rects: {} };
    for (const sel of [".source-mode",".cm-editor",".cm-scroller",".cm-gutters",".cm-content",".cm-foldGutter",".cm-lineNumbers"]) {
      const el = document.querySelector(sel);
      if (el) { const rr = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        out.rects[sel] = { x: Math.round(rr.left), right: Math.round(rr.right), w: Math.round(rr.width),
          borderLeft: cs.borderLeftStyle+" "+cs.borderLeftWidth+" "+cs.borderLeftColor,
          borderRight: cs.borderRightStyle+" "+cs.borderRightWidth+" "+cs.borderRightColor,
          bg: cs.backgroundColor, outline: cs.outlineStyle+" "+cs.outlineWidth+" "+cs.outlineColor }; }
    }
    // 富文本正文文字宽度（用于与源码模式对齐）
    const pm = document.querySelector(".ProseMirror");
    if (pm) { const cs = getComputedStyle(pm); const rr = pm.getBoundingClientRect();
      out.rects[".ProseMirror"] = { box: Math.round(rr.width), padL: cs.paddingLeft, padR: cs.paddingRight,
        textW: Math.round(rr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) }; }
    out.gutterW = (() => { const g = document.querySelector(".cm-gutters"); return g ? Math.round(g.getBoundingClientRect().width) : null; })();
    // 找出 .cm-gutters 内部所有子元素及其 x
    out.gutterKids = Array.from(document.querySelectorAll(".cm-gutters > *")).map(el => {
      const rr = el.getBoundingClientRect();
      return { cls: el.className.toString().slice(0,40), x: Math.round(rr.left), w: Math.round(rr.width) };
    });
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
