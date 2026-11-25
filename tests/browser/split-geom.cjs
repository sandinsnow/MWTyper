const { EXE, PC } = require("./pw.cjs");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const LONG = Array.from({length:40},(_,i)=>`## 第 ${i+1} 节\n\n正文 ${i+1}\n`).join("\n");
  await p.evaluate((doc) => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/长.md": doc } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({ theme:"light", focus_mode:false, zoom:100, autosave_ms:999999, sidebar_open:true, sidebar_width:240, split_ratio:50 }));
  }, LONG);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await openWorkspace(p);
  await p.evaluate(() => { const r=Array.from(document.querySelectorAll(".tree-row"))[0]; if(r) r.click(); });
  await p.waitForTimeout(1000);
  await p.evaluate(() => { const a=Array.from(document.querySelectorAll("button")).find(x=>/随航/.test(x.textContent||"")); if(a) a.click(); });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const info = (sel) => { const el = document.querySelector(sel); if (!el) return null;
      const cs = getComputedStyle(el); const rr = el.getBoundingClientRect();
      return { h: Math.round(rr.height), w: Math.round(rr.width), display: cs.display, overflow: cs.overflow,
        gridRow: cs.gridRowStart + "/" + cs.gridRowEnd, gridCol: cs.gridColumnStart + "/" + cs.gridColumnEnd,
        clientH: el.clientHeight, scrollH: el.scrollHeight, minH: cs.minHeight, position: cs.position }; };
    return { area: info(".editor-area"), src: info(".split-source"), wrap: info(".editor-wrap"), divider: info(".split-divider"),
      cmScroller: info(".cm-scroller"), pm: info(".ProseMirror") };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
