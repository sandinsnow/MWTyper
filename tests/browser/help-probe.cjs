// 帮助中心验收：Markdown 速查 / 插入模板 / 快捷键 / 检查更新 / 关于
// 运行：node tests/browser/help-probe.cjs
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

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({
      files: { "/demo/h.md": "# 标题\n\n正文\n" },
    }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  await openWorkspace(page);
  await page.evaluate(() => {
    const r = Array.from(document.querySelectorAll(".tree-row")).find((x) => /h\.md/.test(x.textContent || ""));
    if (r) r.click();
  });
  await page.waitForTimeout(1000);

  console.log("=== H1 入口 ===");
  const hasBtn = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".tb-actions button")).some((b) => /帮助/.test(b.getAttribute("aria-label") || "")));
  check("H1a 标题栏有「帮助」按钮", hasBtn);

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".tb-actions button")).find((x) => /帮助/.test(x.getAttribute("aria-label") || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  const opened = await page.evaluate(() => !!document.querySelector(".help-modal"));
  check("H1b 点击后帮助中心打开", opened);
  const nav = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".help-nav-item")).map((b) => (b.textContent || "").trim()));
  check("H1c 四个分区齐全", nav.length === 4, JSON.stringify(nav));
  await page.screenshot({ path: path.join(OUT, "23-help-markdown.png") });

  console.log("\n=== H2 Markdown 速查 ===");
  const md = await page.evaluate(() => {
    const rows = document.querySelectorAll(".help-table tr");
    const syntaxes = Array.from(document.querySelectorAll(".help-syntax code")).map((c) => c.textContent || "");
    return {
      rowCount: rows.length,
      hasHeading: syntaxes.some((s) => s.includes("# 一级标题")),
      hasBold: syntaxes.some((s) => s.includes("**粗体**")),
      hasTable: syntaxes.some((s) => s.includes("| --- |")),
      hasMath: syntaxes.some((s) => s.includes("$E = mc^2$")),
      hasFootnote: syntaxes.some((s) => s.includes("[^1]")),
      insertBtns: document.querySelectorAll(".help-action button").length,
    };
  });
  check("H2a 速查表有内容", md.rowCount > 15, `行数=${md.rowCount}`);
  check("H2b 覆盖标题/粗体/表格/公式/脚注",
    md.hasHeading && md.hasBold && md.hasTable && md.hasMath && md.hasFootnote, JSON.stringify(md));
  check("H2c 有「插入」按钮", md.insertBtns > 0, `按钮数=${md.insertBtns}`);

  console.log("\n=== H3 插入模板 ===");
  const before = await page.evaluate(() => document.querySelector(".ProseMirror")?.textContent || "");
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".help-table tr"));
    const row = rows.find((r) => (r.querySelector(".help-syntax code") || {}).textContent?.includes("**粗体**"));
    const btn = row?.querySelector(".help-action button");
    if (btn) btn.click();
  });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => document.querySelector(".ProseMirror")?.textContent || "");
  check("H3a 点「插入」把模板写进文档", after.includes("**粗体**") && after !== before,
    `before=${JSON.stringify(before.slice(0, 20))} after=${JSON.stringify(after.slice(-24))}`);
  const stillOpen = await page.evaluate(() => !!document.querySelector(".help-modal"));
  check("H3b 插入后帮助中心仍打开（可连续插入）", stillOpen);

  console.log("\n=== H4 快捷键分区 ===");
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".help-nav-item")).find((x) => /快捷键/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  const sc = await page.evaluate(() => ({
    kbdCount: document.querySelectorAll(".help-keys kbd").length,
    groups: Array.from(document.querySelectorAll(".help-group-title")).map((h) => (h.textContent || "").trim()),
    hasF1: Array.from(document.querySelectorAll(".help-keys kbd")).some((k) => k.textContent?.includes("F1")),
    hasCtrlSlash: Array.from(document.querySelectorAll(".help-keys kbd")).some((k) => k.textContent?.includes("Ctrl+/")),
  }));
  check("H4a 快捷键表有条目", sc.kbdCount > 20, `条目=${sc.kbdCount}`);
  check("H4b 有分组", sc.groups.length >= 4, JSON.stringify(sc.groups));
  check("H4c 含 F1 与 Ctrl+/", sc.hasF1 && sc.hasCtrlSlash, JSON.stringify(sc));
  await page.screenshot({ path: path.join(OUT, "24-help-shortcuts.png") });

  console.log("\n=== H5 检查更新分区 ===");
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".help-nav-item")).find((x) => /检查更新/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  const up = await page.evaluate(() => ({
    text: (document.querySelector(".help-content") || {}).textContent || "",
    rows: document.querySelectorAll(".help-update-row").length,
    hasPath: !!document.querySelector(".help-path"),
    hasRecheck: Array.from(document.querySelectorAll("button")).some((b) => /立即检查/.test(b.textContent || "")),
    ok: !!document.querySelector(".help-ok"),
    newver: !!document.querySelector(".help-newver"),
  }));
  check("H5a 展示当前版本/构建时间/上次检查", up.rows >= 3, JSON.stringify(up.rows));
  check("H5b 无更新源时说明本地清单路径", up.hasPath, `path=${up.hasPath}`);
  check("H5c 有「立即检查」按钮", up.hasRecheck);
  // 没有更新清单 ≠ 已是最新版本：此时必须**如实说明**「未内置在线更新源 + 清单路径」，
  // 绝不能谎称「当前已是最新版本」。
  check("H5d 无更新源时如实说明（不谎称已是最新）",
    up.ok === false && up.hasPath === true, `ok=${up.ok} path=${up.hasPath}`);
  await page.screenshot({ path: path.join(OUT, "25-help-update.png") });

  console.log("\n=== H6 模拟有新版 ===");
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-themes", JSON.stringify({
      "__update_manifest": JSON.stringify({
        version: "9.9.9", url: "https://example.com/MWTyper-9.9.9-setup.exe",
        notes: "测试更新说明", publishedAt: "2026-11-25",
      }),
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".tb-actions button")).find((x) => /帮助/.test(x.getAttribute("aria-label") || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".help-nav-item")).find((x) => /检查更新/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const newer = await page.evaluate(() => ({
    newver: !!document.querySelector(".help-newver"),
    head: (document.querySelector(".help-newver-head") || {}).textContent || "",
    notes: (document.querySelector(".help-notes") || {}).textContent || "",
    hasCopy: Array.from(document.querySelectorAll("button")).some((b) => /复制下载链接/.test(b.textContent || "")),
  }));
  check("H6a 发现新版本时高亮提示", newer.newver, JSON.stringify(newer));
  check("H6b 显示新版本号", newer.head.includes("9.9.9"), newer.head);
  check("H6c 显示更新说明", newer.notes.includes("测试更新说明"), newer.notes);
  check("H6d 有复制下载链接按钮", newer.hasCopy);
  await page.screenshot({ path: path.join(OUT, "26-help-update-new.png") });

  console.log("\n=== H7 关于分区 ===");
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".help-nav-item")).find((x) => /关于/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  const ab = await page.evaluate(() => ({
    text: (document.querySelector(".help-content") || {}).textContent || "",
    rows: document.querySelectorAll(".help-update-row").length,
  }));
  check("H7a 关于分区有内容", ab.rows >= 2 && ab.text.includes("Markdown"), JSON.stringify(ab.rows));

  console.log("\n=== H8 键盘可达与关闭 ===");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => !document.querySelector(".help-modal"));
  check("H8a Escape 关闭帮助中心", closed);

  await page.keyboard.press("F1");
  await page.waitForTimeout(700);
  const byKey = await page.evaluate(() => !!document.querySelector(".help-modal"));
  check("H8b F1 打开帮助中心", byKey);
  await page.keyboard.press("Escape");

  console.log("\n=== H9 命令面板直达 ===");
  await page.keyboard.press("Control+Shift+p");
  await page.waitForTimeout(600);
  await page.keyboard.type("检查更新");
  await page.waitForTimeout(500);
  const found = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".palette-item")).some((i) => /检查更新/.test(i.textContent || "")));
  check("H9a 命令面板能搜到「检查更新」", found);
  if (found) {
    await page.evaluate(() => {
      const it = Array.from(document.querySelectorAll(".palette-item")).find((i) => /检查更新/.test(i.textContent || ""));
      if (it) it.click();
    });
    await page.waitForTimeout(800);
    const onUpdate = await page.evaluate(() => ({
      open: !!document.querySelector(".help-modal"),
      section: (document.querySelector(".help-nav-item.active") || {}).textContent || "",
    }));
    check("H9b 直达「检查更新」分区", onUpdate.open && onUpdate.section.includes("检查更新"), JSON.stringify(onUpdate));
  }

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
