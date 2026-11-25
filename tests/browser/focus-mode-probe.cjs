// 焦点指示的显示时机：鼠标进入不应出现，键盘导航进入才出现
// 运行：node tests/browser/focus-mode-probe.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const { chromium } = require(PC);
const path = require("path");
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS [${name}] ${detail}`); }
  else { fail++; failures.push(name); console.log(`FAIL [${name}] ${detail}`); }
}
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

  const info = async () => p.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    const cs = getComputedStyle(pm, "::before");
    return {
      focused: pm.matches(":focus"),
      kbFocus: (document.querySelector(".editor-wrap") || {}).classList?.contains("kb-focus") || false,
      lineShown: cs.content !== "none" && cs.width !== "auto",
      left: cs.left, width: cs.width,
    };
  });

  // 1) 鼠标点击进入 → 不该有指示线
  const box = await p.evaluate(() => { const pm=document.querySelector(".ProseMirror"); const r=pm.getBoundingClientRect(); return {x:Math.round(r.x+60), y:Math.round(r.y+40)}; });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(400);
  const mouse = await info();
  await p.screenshot({ path: path.join(OUT, "18-focus-mouse.png") });
  check("U1 鼠标点击进入编辑区：无焦点指示线", mouse.focused && !mouse.kbFocus && !mouse.lineShown, JSON.stringify(mouse));

  // 2) 键盘导航进入 → 应有指示线
  await p.evaluate(() => { const el=document.querySelector(".ProseMirror"); if(el) el.blur(); document.body.focus(); });
  await p.waitForTimeout(300);
  // 反复 Tab 直到焦点落在编辑区
  let kb = null;
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press("Tab");
    await p.waitForTimeout(120);
    const st = await info();
    if (st.focused) { kb = st; break; }
  }
  check("U2 键盘 Tab 进入编辑区：出现焦点指示线", !!kb && kb.kbFocus && kb.lineShown, JSON.stringify(kb));
  if (kb) await p.screenshot({ path: path.join(OUT, "19-focus-keyboard.png") });
  check("U3 指示线画在正文左缘（left=40px，2px 宽）", !!kb && kb.left === "40px" && kb.width === "2px", JSON.stringify(kb));

  // 3) 再用鼠标点一下 → 指示线应消失
  if (kb) {
    await p.mouse.click(box.x, box.y);
    await p.waitForTimeout(400);
    const again = await info();
    check("U4 焦点已在编辑区时改用鼠标：指示线消失", !again.kbFocus && !again.lineShown, JSON.stringify(again));
  }

  console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await b.close();
  process.exit(fail > 0 ? 1 : 0);
})();
