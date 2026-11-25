const { EXE, PC } = require("./pw.cjs");
const { chromium } = require(PC);
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  await p.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: {} }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({ theme:"light", focus_mode:false, zoom:100, autosave_ms:999999, sidebar_open:true, sidebar_width:240, split_ratio:50 }));
  });
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(1400);
  await p.evaluate(() => document.querySelector(".ProseMirror")?.focus());
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null;
      const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { x: Math.round(b.x), w: Math.round(b.width), padL: cs.paddingLeft, padT: cs.paddingTop, pos: cs.position, caret: cs.caretColor }; };
    const pm = document.querySelector(".ProseMirror");
    const par = document.querySelector(".ProseMirror p");
    const sel = window.getSelection();
    let caret = null;
    if (sel && sel.rangeCount) {
      const node = sel.getRangeAt(0).startContainer;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      caret = { x: Math.round(rect.x), y: Math.round(rect.y), nodeType: node.nodeType, nodeName: node.nodeName };
    }
    return { pm: box(".ProseMirror"), par: box(".ProseMirror p"), caret,
      pmStyle: (() => { const cs = getComputedStyle(pm); return { caretColor: cs.caretColor, boxShadow: cs.boxShadow, position: cs.position, maxWidth: cs.maxWidth }; })() };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
