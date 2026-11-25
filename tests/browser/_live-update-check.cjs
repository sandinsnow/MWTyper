// 取证脚本（不进 test:browser 链）：在**真实网络**下验证「检查远端更新」
// 确实查的是 GitHub Releases 的最新正式版，而不是本机清单文件。
//
// 与 help-probe 的区别：help-probe 用 Playwright 路由拦截**模拟**远端响应（保证
// 闸门不依赖网络）；本脚本**不拦截**，直接连 api.github.com。
//
// 运行：node tests/browser/_live-update-check.cjs
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  // 记录真实发出的请求，验证「确实访问了 GitHub API」
  const seen = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("api.github.com")) seen.push(u);
  });

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/a.md": "# t\n" } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, typewriter_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".tb-actions button"))
      .find((x) => /帮助/.test(x.getAttribute("aria-label") || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".help-nav-item"))
      .find((x) => /检查更新/.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button"))
      .find((x) => /检查远端更新/.test(x.textContent || ""));
    if (b) b.click();
  });
  // 真实网络可能慢，等久一点
  await page.waitForTimeout(12000);

  const st = await page.evaluate(() => ({
    remoteRow: (Array.from(document.querySelectorAll(".help-update-row"))
      .find((r) => /远端最新版/.test(r.textContent || "")) || {}).textContent || "",
    ok: (document.querySelector(".help-ok") || {}).textContent || "",
    newver: !!document.querySelector(".help-newver"),
    warn: (document.querySelector(".help-warn") || {}).textContent || "",
  }));

  console.log("真实请求:", seen.length ? seen.join("\n           ") : "（无）");
  console.log("远端最新版行:", st.remoteRow);
  console.log("「已是最新」提示:", st.ok);
  console.log("「发现新版本」块:", st.newver);
  if (st.warn) console.log("警告区:", st.warn);
  console.log("页面错误:", errors.length ? errors.join("; ") : "无");
  await page.screenshot({ path: path.join(OUT, "live-update-check.png") });
  await browser.close();

  const ok = seen.length > 0 && /v?0\.1\.0/.test(st.remoteRow);
  console.log(ok ? "\n== 结论：真实网络下检查更新取到了远端版本 ==" : "\n== 结论：未取到远端版本（见上） ==");
  process.exit(ok ? 0 : 1);
})();
