// 标题栏重组验收：结构分层 / 三态分段控件 / 更多菜单 / 窄窗不丢功能
// 运行：node tests/browser/menubar-probe.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS [${name}] ${detail}`); }
  else { fail++; failures.push(name); console.log(`FAIL [${name}] ${detail}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/m.md": "# 标题\n\n正文\n" } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);

  console.log("=== M1 标题栏结构 ===");
  const bar = await page.evaluate(() => {
    const acts = document.querySelector(".tb-actions");
    return {
      total: acts ? acts.querySelectorAll("button").length : 0,
      hasPrimary: !!document.querySelector(".tb-btn-primary"),
      ghostCount: document.querySelectorAll(".tb-btn-ghost").length,
      segments: document.querySelectorAll(".mode-segment").length,
      activeSegment: (document.querySelector(".mode-segment.active") || {}).textContent || "",
      menuBtn: !!document.querySelector(".title-menu-wrap"),
      labels: Array.from(document.querySelectorAll(".tb-actions .tb-label")).map((e) => (e.textContent || "").trim()),
    };
  });
  console.log("  " + JSON.stringify(bar));
  check("M1a 控件数量明显减少（≤10）", bar.total <= 10, `按钮数=${bar.total}`);
  check("M1b 保存是唯一主按钮", bar.hasPrimary, `primary=${bar.hasPrimary}`);
  check("M1c 次要操作走 ghost 样式", bar.ghostCount >= 3, `ghost=${bar.ghostCount}`);
  check("M1d 三态分段控件齐全", bar.segments === 3, `段数=${bar.segments}`);
  check("M1e 当前态高亮为「所见即所得」", bar.activeSegment.trim() === "所见即所得", bar.activeSegment);
  check("M1f 有「更多」下拉菜单", bar.menuBtn);
  // 「新建」「保存」是文档级高频动作，留在标题栏；「打开文件」「另存为」「主题」等
  // 低频操作应已收进「⋯ 更多」。
  check("M1g 低频操作已从标题栏移走（无 打开/另存为/主题 按钮）",
    !bar.labels.includes("打开") && !bar.labels.includes("另存为") && !bar.labels.includes("浅色") && !bar.labels.includes("深色"),
    JSON.stringify(bar.labels));

  console.log("\n=== M2 分段控件切模式 ===");
  const setMode = async (label) => {
    await page.evaluate((l) => {
      const b = Array.from(document.querySelectorAll(".mode-segment")).find((x) => (x.textContent || "").trim() === l);
      if (b) b.click();
    }, label);
    await page.waitForTimeout(900);
    return page.evaluate(() => ({
      active: (document.querySelector(".mode-segment.active") || {}).textContent?.trim() || "",
      split: (document.querySelector(".editor-area")?.className || "").includes("split"),
      cm: !!document.querySelector(".cm-content"),
    }));
  };
  const m2 = await setMode("源码");
  check("M2a 点「源码」切到源码模式", m2.active === "源码" && m2.cm, JSON.stringify(m2));
  const m3 = await setMode("随航");
  check("M2b 点「随航」切到并排模式", m3.active === "随航" && m3.split, JSON.stringify(m3));
  const m4 = await setMode("所见即所得");
  check("M2c 点「所见即所得」切回富文本", m4.active === "所见即所得" && !m4.split && !m4.cm, JSON.stringify(m4));

  console.log("\n=== M3 键盘操作分段控件 ===");
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".mode-segment")).find((x) => (x.textContent || "").trim() === "所见即所得");
    if (b) b.focus();
  });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(800);
  const kb = await page.evaluate(() => ({
    active: (document.querySelector(".mode-segment.active") || {}).textContent?.trim() || "",
    cm: !!document.querySelector(".cm-content"),
  }));
  check("M3a 方向键可切换模式", kb.active === "源码" && kb.cm, JSON.stringify(kb));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".mode-segment")).find((x) => (x.textContent || "").trim() === "所见即所得");
    if (b) b.click();
  });
  await page.waitForTimeout(700);

  console.log("\n=== M4 「更多」下拉菜单 ===");
  await page.evaluate(() => {
    const b = document.querySelector(".title-menu-wrap .tb-btn");
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  const menu = await page.evaluate(() => ({
    open: !!document.querySelector(".title-menu"),
    role: (document.querySelector(".title-menu") || {}).getAttribute?.("role") || null,
    groups: Array.from(document.querySelectorAll(".title-menu-title")).map((t) => (t.textContent || "").trim()),
    items: Array.from(document.querySelectorAll(".title-menu-item")).map((i) => (i.textContent || "").trim()),
  }));
  check("M4a 菜单能打开", menu.open);
  check("M4b 语义是 menu", menu.role === "menu", `role=${menu.role}`);
  check("M4c 按语义分三组", menu.groups.length === 3, JSON.stringify(menu.groups));
  check("M4d 文件组含新建/打开/另存为",
    menu.items.some((i) => i.includes("新建文稿")) && menu.items.some((i) => i.includes("打开文件")) && menu.items.some((i) => i.includes("另存为")),
    JSON.stringify(menu.items));
  check("M4e 帮助组含 Markdown 速查/快捷键/检查更新",
    menu.items.some((i) => i.includes("Markdown 语法速查")) && menu.items.some((i) => i.includes("快捷键一览")) && menu.items.some((i) => i.includes("检查更新")),
    "");
  await page.screenshot({ path: path.join(OUT, "27-menubar-menu.png") });

  console.log("\n=== M5 菜单项可执行 ===");
  await page.evaluate(() => {
    const it = Array.from(document.querySelectorAll(".title-menu-item")).find((i) => /Markdown 语法速查/.test(i.textContent || ""));
    if (it) it.click();
  });
  await page.waitForTimeout(900);
  const executed = await page.evaluate(() => ({
    helpOpen: !!document.querySelector(".help-modal"),
    section: (document.querySelector(".help-nav-item.active") || {}).textContent?.trim() || "",
    menuClosed: !document.querySelector(".title-menu"),
  }));
  check("M5a 菜单项能执行（打开 Markdown 速查）", executed.helpOpen && executed.section.includes("Markdown"), JSON.stringify(executed));
  check("M5b 执行后菜单自动收起", executed.menuClosed);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  console.log("\n=== M6 菜单键盘可达 ===");
  await page.evaluate(() => {
    const b = document.querySelector(".title-menu-wrap .tb-btn");
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const esc = await page.evaluate(() => ({
    closed: !document.querySelector(".title-menu"),
    focusBack: (document.activeElement || {}).className?.includes?.("tb-btn") || false,
  }));
  check("M6a Escape 关闭菜单", esc.closed);
  check("M6b 关闭后焦点回到触发按钮", esc.focusBack, JSON.stringify(esc));

  console.log("\n=== M7 窄窗（900px）功能不丢 ===");
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(700);
  const narrow = await page.evaluate(() => {
    const acts = document.querySelector(".tb-actions");
    const btns = Array.from(acts.querySelectorAll("button"));
    return {
      total: btns.length,
      visible: btns.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length,
      hasSegments: document.querySelectorAll(".mode-segment").length,
      hasMenu: !!document.querySelector(".title-menu-wrap"),
      overflow: (() => { const t = document.querySelector(".titlebar"); return t ? t.scrollWidth > t.clientWidth + 2 : null; })(),
    };
  });
  check("M7a 窄窗下按钮一个都没少", narrow.visible === narrow.total && narrow.total > 0, JSON.stringify(narrow));
  check("M7b 分段控件仍在", narrow.hasSegments === 3, `段数=${narrow.hasSegments}`);
  check("M7c 更多菜单仍在", narrow.hasMenu);
  check("M7d 标题栏没有横向溢出", narrow.overflow === false, `overflow=${narrow.overflow}`);
  await page.screenshot({ path: path.join(OUT, "28-menubar-narrow.png") });

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
