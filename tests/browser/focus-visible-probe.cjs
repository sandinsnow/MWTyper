const { EXE, PC } = require("./pw.cjs");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  await p.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  await p.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/a.md": "你好\n\n世界\n" } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({ theme:"light", focus_mode:false, zoom:100, autosave_ms:999999, sidebar_open:true, sidebar_width:240, split_ratio:50 }));
  });
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(1400);
  await openWorkspace(p);
  await p.evaluate(() => { const r=Array.from(document.querySelectorAll(".tree-row")).find(x=>/a\.md/.test(x.textContent||"")); if(r) r.click(); });
  await p.waitForTimeout(1000);

  const state = async (label) => {
    const r = await p.evaluate(() => {
      const pm = document.querySelector(".ProseMirror");
      const cs = getComputedStyle(pm, "::before");
      return {
        focused: pm.matches(":focus"),
        focusVisible: pm.matches(":focus-visible"),
        beforeContent: cs.content,
        beforeLeft: cs.left,
        beforeWidth: cs.width,
        beforeBg: cs.backgroundImage.slice(0, 90),
        activeEl: document.activeElement ? document.activeElement.className : null,
      };
    });
    console.log(label + ": " + JSON.stringify(r));
    return r;
  };

  // 1) 鼠标点击进入
  const box = await p.evaluate(() => { const pm=document.querySelector(".ProseMirror"); const r=pm.getBoundingClientRect(); return {x:Math.round(r.x+60), y:Math.round(r.y+40)}; });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(500);
  const afterMouse = await state("鼠标点击后  ");

  // 2) 键盘 Tab 进入
  await p.evaluate(() => document.body.focus());
  await p.waitForTimeout(200);
  await p.keyboard.press("Tab");
  await p.waitForTimeout(400);
  const afterTab = await state("键盘 Tab 后 ");

  // 3) 再点一次（焦点已在编辑区内的移动）
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(500);
  const afterMouse2 = await state("再次鼠标点击 ");

  console.log("\n结论: 鼠标点击是否触发 :focus-visible =", afterMouse.focusVisible);
  console.log("      键盘 Tab 是否触发     =", afterTab.focusVisible);
  await b.close();
})();
