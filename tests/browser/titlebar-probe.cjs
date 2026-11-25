// 标题栏功能按钮的全量体检 + 光标/焦点指示样式验收
// 运行：node tests/browser/titlebar-probe.cjs
const { EXE, OUT, PC, ROOT } = require("./pw.cjs");
const path = require("path");
const fs = require("fs");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree, clickSegment } = require("./probe-util.cjs");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS [${name}] ${detail}`); }
  else { fail++; failures.push(name); console.log(`FAIL [${name}] ${detail}`); }
}

const DOC = "# 标题\n\n正文内容。\n";

(async () => {
  // ---------- 静态部分：权限与「不得静默吞异常」守卫 ----------
  console.log("=== 静态检查：Tauri 窗口命令的权限与错误可见性 ===");
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri/capabilities/default.json"), "utf8"));
  const perms = cap.permissions || [];
  for (const need of ["core:window:allow-close", "core:window:allow-destroy",
                      "core:window:allow-minimize", "core:window:allow-toggle-maximize"]) {
    check(`权限已声明 ${need}`, perms.includes(need), `permissions=${JSON.stringify(perms)}`);
  }
  const appSrc = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const rawWinCalls = [...appSrc.matchAll(/getCurrentWindow\(\)\s*\.\s*(minimize|toggleMaximize|close|destroy)\s*\(/g)];
  const unwrapped = rawWinCalls.filter((m) => {
    const idx = m.index;
    // .catch( 可能出现在调用点之后（如 destroy().catch(...)），窗口要前后都看
    const around = appSrc.slice(Math.max(0, idx - 140), idx + 160);
    return !/runWinCmd\(|\.catch\(|\.finally\(/.test(around);
  });
  check("所有窗口命令都被 runWinCmd 包裹（失败可见）", unwrapped.length === 0,
    `未包裹 ${unwrapped.length} 处：${unwrapped.map((m) => m[1]).join(",")}`);
  const destroyAfterClose = /allow-destroy/.test(fs.readFileSync(path.join(ROOT, "src-tauri/capabilities/default.json"), "utf8"));
  check("关闭流程的 destroy 兜底已获授权", destroyAfterClose);

  // ---------- 浏览器部分：逐个点击按钮 ----------
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const clickBtn = async (textRe) => {
    const ok = await page.evaluate((src) => {
      const rx = new RegExp(src);
      const b = Array.from(document.querySelectorAll(".tb-actions button, .titlebar > button"))
        .find((x) =>
          rx.test(x.textContent || "") ||
          rx.test(x.getAttribute("aria-label") || "") ||
          rx.test(x.getAttribute("title") || "")
        );
      if (b) { b.click(); return true; }
      return false;
    }, textRe.source);
    await page.waitForTimeout(700);
    return ok;
  };
  /** v1.9 标题栏重组后：低频操作收进「⋯ 更多」菜单，需经菜单执行 */
  const menuClick = async (label) => {
    await page.evaluate(() => {
      const b = document.querySelector(".title-menu-wrap .tb-btn");
      if (b) b.click();
    });
    await page.waitForTimeout(450);
    const ok = await page.evaluate((l) => {
      const it = Array.from(document.querySelectorAll(".title-menu-item")).find((i) => (i.textContent || "").includes(l));
      if (it) { it.click(); return true; }
      return false;
    }, label);
    await page.waitForTimeout(800);
    return ok;
  };
  const visibleBtnCount = () => page.evaluate(() =>
    Array.from(document.querySelectorAll(".tb-actions button")).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(b).display !== "none";
    }).length
  );

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate((doc) => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: { "/demo/标题.md": doc } }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999,
      sidebar_open: true, sidebar_width: 240, split_ratio: 50,
    }));
  }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  // v1.9 标题栏重组后「打开文件夹」收进了「⋯ 更多」菜单 —— 探针的搭建步骤要跟着改，
  // 否则工作区根本没打开、树里没有文件，后续断言全部错位（曾一度误判成应用 bug）。
  await openWorkspace(page);
  await page.evaluate(() => {
    const r = Array.from(document.querySelectorAll(".tree-row")).find((x) => /标题/.test(x.textContent || ""));
    if (r) r.click();
  });
  await page.waitForTimeout(1000);

  console.log("\n=== T1 新建 ===");
  const tabsBefore = await page.evaluate(() => document.querySelectorAll(".tab").length);
  // v1.9 重组后「新建文稿」是标题栏上的独立按钮（文档级高频动作），
  // 不在「⋯ 更多」菜单里。
  const c1 = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".tb-actions button")).find(
      (x) => (x.getAttribute("aria-label") || "") === "新建文稿"
    );
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(800);
  const tabsAfter = await page.evaluate(() => document.querySelectorAll(".tab").length);
  check("T1a 点到标题栏的「新建文稿」", c1);
  check("T1b 新建后标签页 +1", tabsAfter === tabsBefore + 1, `${tabsBefore} → ${tabsAfter}`);
  // 切回原文档
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll(".tab")).find((x) => /标题/.test(x.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(800);

  console.log("\n=== T2 保存 ===");
  await page.evaluate(() => document.querySelector(".ProseMirror")?.focus());
  await page.keyboard.type("X");
  await page.waitForTimeout(300);
  const c2 = await page.evaluate(() => {
    const b = document.querySelector(".tb-actions .tb-btn-primary");
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => {
    const fsx = JSON.parse(localStorage.getItem("mwtyper-mock-fs") || "{}");
    return fsx.files && fsx.files["/demo/标题.md"];
  });
  check("T2a 点到了「保存」", c2);
  // 断言要够严：整篇被替换成 "X" 也「包含 X」，
  // 只查 includes 会放过「setContent 整篇替换 → 选区扩成全文 → 首个按键抹掉全文」
  // 这个数据丢失缺陷。必须同时确认**原文还在**。
  check("T2b 保存后文件内容已落盘（含新输入且原文未丢）",
    !!saved && saved.includes("X") && saved.includes("正文内容"), JSON.stringify(saved));

  console.log("\n=== T3 最近文件 ===");
  const c3 = await clickBtn(/最近/);
  const pop = await page.evaluate(() => !!document.querySelector(".recent-popover"));
  check("T3a 点到了「最近」", c3);
  check("T3b 最近面板弹出", pop);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".recent-popover button"))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(700);

  console.log("\n=== T4 主题切换 ===");
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  const c4 = await menuClick("切换主题");
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  check("T4a 通过「更多」菜单执行「切换主题」", c4);
  check("T4b 主题发生切换", themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);

  console.log("\n=== T5 设置面板 ===");
  const c5 = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".tb-actions > button")).find((x) => (x.getAttribute("aria-label") || "") === "设置");
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(700);
  const modal = await page.evaluate(() => !!document.querySelector(".settings-modal"));
  check("T5a 点到了「设置」", c5);
  check("T5b 设置面板打开", modal);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  console.log("\n=== T6 源码 / 所见即所得 / 随航 ===");
  // SourceMode 是 React.lazy：首次切到源码模式要现加载 chunk，必须轮询等待，
  // 固定 sleep 会把「还没挂载」误判成「模式没切」。
  const waitMode = async (want, ms = 8000) => {
    try {
      await page.waitForFunction((w) => {
        const cm = !!document.querySelector(".cm-content");
        const split = (document.querySelector(".editor-area")?.className || "").includes("split");
        return w === "source" ? cm && !split : w === "split" ? split : !cm && !split;
      }, want, { timeout: ms });
      return true;
    } catch { return false; }
  };
  const clickSegment = async (label) => {
    const ok = await page.evaluate((l) => {
      const b = Array.from(document.querySelectorAll(".mode-segment")).find((x) => (x.textContent || "").trim() === l);
      if (b) { b.click(); return true; }
      return false;
    }, label);
    await page.waitForTimeout(900);
    return ok;
  };
  const c6 = await clickSegment("源码");
  const okSource = await waitMode("source");
  check("T6a 分段控件点「源码」进入源码模式", c6 && okSource, `waited=${okSource}`);
  const c6b = await clickSegment("所见即所得");
  const okBack = await waitMode("wysiwyg");
  check("T6b 分段控件点「所见即所得」回到富文本", c6b && okBack, `waited=${okBack}`);
  const c6c = await clickBtn(/随航/);
  const mode3 = await page.evaluate(() => document.querySelector(".editor-area")?.className || "");
  check("T6c 「随航」进入并排模式", c6c && mode3.includes("split"), `class=${mode3}`);
  await clickBtn(/随航/);

  console.log("\n=== T7 窄窗（900px）：按钮不得消失 ===");
  const wideCount = await visibleBtnCount();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(700);
  const narrowCount = await visibleBtnCount();
  const narrowLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".tb-actions button")).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).map((b) => ({ label: (b.getAttribute("aria-label") || b.title || b.textContent || "").trim(),
                     text: (b.textContent || "").trim() }))
  );
  check("T7a 窄窗下按钮数量没有减少", narrowCount >= wideCount - 1, `宽窗 ${wideCount} → 窄窗 ${narrowCount}`);
  check("T7b 窄窗下按钮仍有可访问名（aria-label/title）",
    narrowLabels.every((b) => b.label.length > 0), JSON.stringify(narrowLabels.map((b) => b.label)));
  await page.screenshot({ path: path.join(OUT, "16-narrow-titlebar.png") });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.waitForTimeout(500);

  console.log("\n=== T8 光标与焦点指示 ===");
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({ files: {} }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  await page.evaluate(() => document.querySelector(".ProseMirror")?.focus());
  await page.waitForTimeout(500);
  const caret = await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    const par = document.querySelector(".ProseMirror p");
    const cs = pm ? getComputedStyle(pm) : null;
    const pmb = pm ? pm.getBoundingClientRect() : null;
    const pb = par ? par.getBoundingClientRect() : null;
    const before = pm ? getComputedStyle(pm, "::before") : null;
    return {
      caretColor: cs ? cs.caretColor : null,
      accent: cs ? cs.getPropertyValue("--accent").trim() : null,
      boxShadow: cs ? cs.boxShadow : null,
      beforeLeft: before ? before.left : null,
      beforeWidth: before ? before.width : null,
      pmX: pmb ? Math.round(pmb.x) : null,
      parX: pb ? Math.round(pb.x) : null,
    };
  });
  console.log("  实测: " + JSON.stringify(caret));
  const hexToRgb = (hex) => {
    const h = String(hex || "").trim().replace("#", "");
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  check("T8a 光标色 = 主题强调色", caret.caretColor === hexToRgb(caret.accent),
    `caret=${caret.caretColor} accent=${caret.accent} → ${hexToRgb(caret.accent)}`);
  check("T8b 焦点指示不是整框 box-shadow", !/inset/.test(caret.boxShadow || ""), `boxShadow=${caret.boxShadow}`);
  // 焦点线只在**键盘导航**进入时显示（鼠标聚焦不显示）——
  // 运行时行为见 focus-mode-probe.cjs，这里断言规则本身没被改坏。
  const cssTxt = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const fr = cssTxt.match(/\.editor-wrap\.kb-focus \.ProseMirror::before\s*\{([^}]*)\}/);
  const rb = fr ? fr[1] : "";
  check("T8c 焦点线规则画在正文左缘（left=40px）", /left:\s*40px/.test(rb), `rule=${rb.replace(/\s+/g," ").trim().slice(0,90)}`);
  check("T8d 焦点线宽 2px 且为渐隐线", /width:\s*2px/.test(rb) && /linear-gradient/.test(rb), `rule=${rb.replace(/\s+/g," ").trim().slice(0,90)}`);
  await page.screenshot({ path: path.join(OUT, "17-caret-focus.png") });

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 6)) : "无"));
  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
