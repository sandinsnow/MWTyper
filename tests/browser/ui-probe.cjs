// 编辑器 UI/UX 修复的**真实浏览器**验收脚本
//
// 目的：把本轮对「界面一致性 / 交互反馈 / 可访问性 / 光标保持 / 冲突恢复」
// 的每一处改动都变成可复现的断言，而不是「代码看起来对」。
//
// 运行：node tests/browser/ui-probe.cjs
// 依赖：本地 chromium（playwright-core + executablePath），vite dev 在 1421 端口
const { EXE, OUT, PC } = require("./pw.cjs");
const path = require("path");
const { chromium } = require(PC);
const { openWorkspace, openFileInTree } = require("./probe-util.cjs");

require("fs").mkdirSync(OUT, { recursive: true });

const DOC = "## 第一章\n\n这是第一段正文，用来把编辑器撑开并提供可点击的文字。\n\n## 第二章\n\n这是第二段正文，另有 **加粗** 与 `代码`。\n\n## 第三章\n\n第三段内容。\n";

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`PASS [${name}] ${detail}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`FAIL [${name}] ${detail}`);
  }
}

// 注入到页面里的通用工具
const HELPERS = `
window.__mw = {
  caretInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const node = sel.anchorNode;
    if (!node) return null;
    const offset = sel.anchorOffset;
    const el = node.nodeType === 3 ? node.parentElement : node;
    const block = el && el.closest ? el.closest("p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote") : null;
    return {
      blockText: block ? block.textContent : null,
      offset,
      nodeText: node.nodeType === 3 ? node.textContent : null,
      inEditor: !!(el && el.closest && el.closest(".ProseMirror")),
      inSource: !!(el && el.closest && el.closest(".cm-content")),
    };
  },
  lum(rgb) {
    const f = (c) => { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  },
  effectiveBg(el) {
    let node = el;
    while (node) {
      const cs = getComputedStyle(node);
      const bg = cs.backgroundColor;
      const m = bg && bg.match(/rgba?\\(([^)]+)\\)/);
      if (m) {
        const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
        const a = parts.length > 3 ? parts[3] : 1;
        if (a >= 1) return [parts[0], parts[1], parts[2]];
        if (a > 0) {
          const parent = this.effectiveBg(node.parentElement);
          return [
            parts[0] * a + parent[0] * (1 - a),
            parts[1] * a + parent[1] * (1 - a),
            parts[2] * a + parent[2] * (1 - a),
          ];
        }
      }
      node = node.parentElement;
    }
    return [255, 255, 255];
  },
  contrastAt(el) {
    const fgStr = getComputedStyle(el).color;
    const m = fgStr.match(/rgba?\\(([^)]+)\\)/);
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    const fg = [parts[0], parts[1], parts[2]];
    const bg = this.effectiveBg(el);
    const l1 = this.lum(fg), l2 = this.lum(bg);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return { ratio: (hi + 0.05) / (lo + 0.05), fg, bg };
  },
};
`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const clickByText = async (re) => {
    const ok = await page.evaluate((src) => {
      const rx = new RegExp(src);
      const b = Array.from(document.querySelectorAll("button")).find((x) => rx.test(x.textContent || ""));
      if (b) { b.click(); return true; }
      return false;
    }, re.source);
    await page.waitForTimeout(500);
    return ok;
  };
  const openFileByName = async (name) => {
    await page.evaluate((n) => {
      const rows = Array.from(document.querySelectorAll(".tree-row"));
      const t = rows.find((r) => (r.textContent || "").includes(n));
      if (t) t.click();
    }, name);
    await page.waitForTimeout(900);
  };

  await page.goto("http://localhost:1421/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate(HELPERS);

  // ---------------------------------------------------------------- 准备
  await page.evaluate((doc) => {
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify({
      files: {
        "/demo/文档.md": doc,
        "/demo/冲突.md": "原始内容\n",
        "/demo/单行表.md": "| 列A |\n| --- |\n",
        "/demo/含注释.md": "# 标题\n\n<!-- TODO: 待办 -->\n\n正文段落\n",
      },
    }));
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999, sidebar_open: true, sidebar_width: 240,
    }));
  }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(HELPERS);

  await openWorkspace(page);
  await page.waitForTimeout(600);

  // ================================================================ S1
  console.log("\n[S1] 富文本光标跨「所见即所得 → 源码 → 所见即所得」保持");
  await openFileByName("文档.md");
  const beforeCaret = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll(".ProseMirror p")).find((x) => (x.textContent || "").includes("第二段"));
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.x + 12), y: Math.round(r.y + r.height / 2) };
  });
  check("S1a 找到目标段落", !!beforeCaret, JSON.stringify(beforeCaret));
  if (beforeCaret) {
    await page.mouse.click(beforeCaret.x, beforeCaret.y);
    await page.waitForTimeout(300);
    const c1 = await page.evaluate(() => window.__mw.caretInfo());
    check("S1b 光标落在编辑器内", !!c1 && c1.inEditor, JSON.stringify(c1));

    await page.keyboard.press("Control+/");
    await page.waitForTimeout(1200);
    const inSource = await page.evaluate(() => !!document.querySelector(".cm-content"));
    check("S1c 已切到源码模式", inSource);

    await page.keyboard.press("Control+/");
    await page.waitForTimeout(900);
    const c2 = await page.evaluate(() => window.__mw.caretInfo());
    check(
      "S1d 切回后光标仍在同一段落的同一偏移",
      !!c2 && c2.inEditor && c1 && c2.blockText === c1.blockText && c2.offset === c1.offset,
      `before=${JSON.stringify(c1)} after=${JSON.stringify(c2)}`
    );
  }

  // ================================================================ S2
  console.log("\n[S2] 源码模式光标跨模式切换保持");
  await page.keyboard.press("Control+/");
  await page.waitForTimeout(1400);
  const srcBefore = await page.evaluate(() => {
    const cm = document.querySelector(".cm-content");
    if (!cm) return null;
    const r = cm.getBoundingClientRect();
    return { x: Math.round(r.x + 10), y: Math.round(r.y + 40) };
  });
  if (srcBefore) {
    await page.mouse.click(srcBefore.x, srcBefore.y);
    await page.waitForTimeout(300);
    const s1 = await page.evaluate(() => window.__mw.caretInfo());
    check("S2a 光标落在源码区", !!s1 && s1.inSource, JSON.stringify(s1));
    await page.keyboard.press("Control+/");
    await page.waitForTimeout(900);
    await page.keyboard.press("Control+/");
    await page.waitForTimeout(1400);
    const s2 = await page.evaluate(() => window.__mw.caretInfo());
    check(
      "S2b 切回源码后光标位置不变",
      !!s2 && s2.inSource && s1 && s2.offset === s1.offset && s2.nodeText === s1.nodeText,
      `before=${JSON.stringify(s1)} after=${JSON.stringify(s2)}`
    );
  } else {
    check("S2a 源码区可点击", false, "未找到 .cm-content");
  }
  await page.keyboard.press("Control+/");
  await page.waitForTimeout(900);

  // ================================================================ S3
  console.log("\n[S3] 查找栏内 Ctrl+S 不被输入框吞掉");
  await openFileByName("文档.md");
  await page.evaluate(() => document.querySelector(".ProseMirror").focus());
  await page.keyboard.type("Z");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(500);
  const inInput = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, isFind: !!(a && a.closest && a.closest(".find-bar")) };
  });
  check("S3a 焦点在查找栏输入框", inInput.tag === "INPUT" && inInput.isFind, JSON.stringify(inInput));
  await page.keyboard.type("第一段");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(900);
  const saved = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem("mwtyper-mock-fs") || "{}");
    return fs.files && fs.files["/demo/文档.md"] ? fs.files["/demo/文档.md"] : null;
  });
  check("S3b Ctrl+S 在查找栏内真的落盘", !!saved && saved.includes("Z"), `saved=${JSON.stringify(saved && saved.slice(0, 40))}`);

  // ================================================================ S4
  console.log("\n[S4] 冲突横幅「重新加载」真的从磁盘重载");
  await openFileByName("冲突.md");
  await page.evaluate(() => document.querySelector(".ProseMirror").focus());
  await page.keyboard.type("X");
  await page.waitForTimeout(400);
  // 模拟外部修改：直接改 mock 的磁盘内容，再推一个 fs-changed 事件
  await page.evaluate(async () => {
    const fs = JSON.parse(localStorage.getItem("mwtyper-mock-fs") || "{}");
    fs.files["/demo/冲突.md"] = "外部修改的内容\n";
    localStorage.setItem("mwtyper-mock-fs", JSON.stringify(fs));
    // 必须复用**应用实际加载的那个** ipc 模块实例：dev server 热更新后模块 URL 会带上
    // `?t=` 时间戳，直接 import("/src/ipc.ts") 拿到的是另一个实例，
    // 它的 mockListeners 与应用的不是同一个 Set → 事件发不出去，横幅不出现。
    const urls = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .filter((n) => n.includes("/src/ipc.ts"));
    const url = urls.length ? urls[urls.length - 1] : "/src/ipc.ts";
    const mod = await import(url);
    mod.mockEmitFileChange("/demo/冲突.md", "modify");
  });
  await page.waitForTimeout(700);
  const banner = await page.evaluate(() => {
    const b = document.querySelector(".conflict-banner");
    return b ? { text: b.textContent, hasReload: !!Array.from(b.querySelectorAll("button")).find((x) => /重新加载/.test(x.textContent || "")) } : null;
  });
  check("S4a 冲突横幅出现", !!banner, JSON.stringify(banner));
  if (banner) {
    await page.evaluate(() => {
      const b = document.querySelector(".conflict-banner");
      Array.from(b.querySelectorAll("button")).find((x) => /重新加载/.test(x.textContent || "")).click();
    });
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      text: (document.querySelector(".ProseMirror") || {}).textContent,
      dirty: !!document.querySelector(".dirty-dot"),
      banner: !!document.querySelector(".conflict-banner"),
    }));
    check("S4b 内容已换成磁盘版本", !!after.text && after.text.includes("外部修改的内容"), JSON.stringify(after));
    check("S4c 脏标记已清除", !after.dirty, JSON.stringify(after));
    check("S4d 冲突横幅已关闭", !after.banner, JSON.stringify(after));
  }

  // ================================================================ S5
  console.log("\n[S5] 专注模式：光标在文档最开头（Ctrl+Home）时仍有当前段落高亮");
  await openFileByName("文档.md");
  await page.evaluate(() => document.querySelector(".ProseMirror").focus());
  await page.keyboard.press("F8");
  await page.waitForTimeout(700);
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(600);
  const focusInfo = await page.evaluate(() => {
    const cur = document.querySelector(".ProseMirror > .focus-current");
    const kids = Array.from(document.querySelectorAll(".ProseMirror > *"));
    return {
      count: document.querySelectorAll(".ProseMirror > .focus-current").length,
      isFirst: cur ? kids.indexOf(cur) === 0 : false,
      tag: cur ? cur.tagName : null,
      text: cur ? (cur.textContent || "").slice(0, 20) : null,
    };
  });
  check("S5a Ctrl+Home 后仍有 focus-current", focusInfo.count === 1, JSON.stringify(focusInfo));
  check("S5b 高亮的是第一个顶层块", focusInfo.isFirst === true, JSON.stringify(focusInfo));

  // ================================================================ S6
  console.log("\n[S6] 表格工具栏：不可用的操作置灰 + 无障碍属性");
  await page.keyboard.press("F8");
  await page.waitForTimeout(400);
  await openFileByName("单行表.md");
  await page.evaluate(() => {
    const th = document.querySelector(".ProseMirror th, .ProseMirror td");
    if (th) {
      const r = th.getBoundingClientRect();
      th.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.x + 3, clientY: r.y + 3 }));
      th.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.x + 3, clientY: r.y + 3 }));
      th.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.x + 3, clientY: r.y + 3 }));
    }
  });
  await page.waitForTimeout(700);
  const toolbar = await page.evaluate(() => {
    const t = document.querySelector(".table-toolbar");
    if (!t) return null;
    const btns = Array.from(t.querySelectorAll("button")).map((b) => ({
      label: (b.textContent || "").trim(),
      disabled: b.disabled,
      aria: b.getAttribute("aria-label"),
    }));
    return { role: t.getAttribute("role"), aria: t.getAttribute("aria-label"), btns };
  });
  check("S6a 表格工具栏出现", !!toolbar, JSON.stringify(toolbar));
  if (toolbar) {
    check("S6b role=toolbar", toolbar.role === "toolbar", JSON.stringify(toolbar));
    check("S6c 有 aria-label", !!toolbar.aria, JSON.stringify(toolbar));
    const delRow = toolbar.btns.find((b) => b.label === "删行");
    const delCol = toolbar.btns.find((b) => b.label === "删列");
    const addRow = toolbar.btns.find((b) => b.label === "行↑");
    check("S6d 单行表格时「删行」禁用", !!delRow && delRow.disabled === true, JSON.stringify(delRow));
    check("S6e 单列表格时「删列」禁用", !!delCol && delCol.disabled === true, JSON.stringify(delCol));
    check("S6f 「行↑」仍可用", !!addRow && addRow.disabled === false, JSON.stringify(addRow));
  }

  // ================================================================ S7
  console.log("\n[S7] 可访问性属性：查找条 / 编辑区");
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(500);
  const a11y = await page.evaluate(() => {
    const bar = document.querySelector(".find-bar");
    const count = document.querySelector(".find-count");
    const pm = document.querySelector(".ProseMirror");
    return {
      barRole: bar ? bar.getAttribute("role") : null,
      barAria: bar ? bar.getAttribute("aria-label") : null,
      countRole: count ? count.getAttribute("role") : null,
      countLive: count ? count.getAttribute("aria-live") : null,
      pmRole: pm ? pm.getAttribute("role") : null,
      pmAria: pm ? pm.getAttribute("aria-label") : null,
      pmMultiline: pm ? pm.getAttribute("aria-multiline") : null,
    };
  });
  check("S7a 查找条 role=search", a11y.barRole === "search", JSON.stringify(a11y));
  check("S7b 查找条有 aria-label", !!a11y.barAria, JSON.stringify(a11y));
  check("S7c 匹配计数 role=status + aria-live=polite", a11y.countRole === "status" && a11y.countLive === "polite", JSON.stringify(a11y));
  check("S7d 编辑区 role=textbox", a11y.pmRole === "textbox", JSON.stringify(a11y));
  check("S7e 编辑区有 aria-label", !!a11y.pmAria, JSON.stringify(a11y));
  check("S7f 编辑区 aria-multiline", a11y.pmMultiline === "true", JSON.stringify(a11y));

  // ================================================================ S8
  console.log("\n[S8] 查找高亮对比度（亮色 / 暗色）");
  // S6 之后打开的是「单行表.md」，里面没有「第一段」——先切回正文文档
  await openFileByName("文档.md");
  await page.waitForTimeout(400);
  // S7 已经打开了查找栏，但里面还留着 S3 输入的旧查询词 —— 先清空再输入
  await page.evaluate(() => {
    const input = document.querySelector(".find-bar input");
    if (input) { input.focus(); }
  });
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
  await page.keyboard.type("第一段");
  await page.waitForTimeout(700);
  const lightContrast = await page.evaluate(() => {
    const el = document.querySelector(".find-match");
    if (!el) return null;
    const c = window.__mw.contrastAt(el);
    return { ratio: Math.round(c.ratio * 100) / 100, fg: c.fg, bg: c.bg };
  });
  check("S8a 亮色下命中高亮存在", !!lightContrast, JSON.stringify(lightContrast));
  if (lightContrast) {
    check("S8b 亮色对比度 ≥ 4.5:1", lightContrast.ratio >= 4.5, `ratio=${lightContrast.ratio}`);
  }
  // 切到暗色
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "dark", focus_mode: false, zoom: 100, autosave_ms: 999999, sidebar_open: true, sidebar_width: 240,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(HELPERS);
  await openWorkspace(page);
  await page.waitForTimeout(600);
  await openFileByName("文档.md");
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(400);
  await page.keyboard.type("第一段");
  await page.waitForTimeout(600);
  const darkContrast = await page.evaluate(() => {
    const el = document.querySelector(".find-match");
    if (!el) return null;
    const c = window.__mw.contrastAt(el);
    return { ratio: Math.round(c.ratio * 100) / 100, fg: c.fg, bg: c.bg };
  });
  check("S8c 暗色下命中高亮存在", !!darkContrast, JSON.stringify(darkContrast));
  if (darkContrast) {
    check("S8d 暗色对比度 ≥ 4.5:1", darkContrast.ratio >= 4.5, `ratio=${darkContrast.ratio} fg=${darkContrast.fg} bg=${darkContrast.bg}`);
  }
  await page.screenshot({ path: path.join(OUT, "11-dark-find.png") });

  // ================================================================ S9
  console.log("\n[S9] 原始 HTML 块在编辑器里可见且不被执行");
  await openFileByName("含注释.md");
  await page.waitForTimeout(600);
  const rawHtml = await page.evaluate(() => {
    const el = document.querySelector(".mw-raw-html");
    if (!el) return null;
    return { text: el.textContent, html: el.innerHTML, scripts: document.querySelectorAll(".ProseMirror script").length };
  });
  check("S9a 原始 HTML 块已渲染", !!rawHtml, JSON.stringify(rawHtml));
  if (rawHtml) {
    check("S9b 原文可见", rawHtml.text.includes("<!-- TODO: 待办 -->"), JSON.stringify(rawHtml));
    check("S9c 未被当成真实标签注入", rawHtml.scripts === 0 && !rawHtml.html.includes("<script"), JSON.stringify(rawHtml));
  }

  // ================================================================ S10
  console.log("\n[S10] 空文档占位符");
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(900);
  const ph = await page.evaluate(() => {
    const el = document.querySelector(".ProseMirror [data-placeholder]");
    if (!el) return null;
    const cs = getComputedStyle(el, "::before");
    return { attr: el.getAttribute("data-placeholder"), content: cs.content, cls: el.className };
  });
  check("S10a 空文档有占位符节点", !!ph, JSON.stringify(ph));
  if (ph) {
    check("S10b 占位符有可见文案", !!ph.content && ph.content !== "none" && ph.content.includes("开始写作"), JSON.stringify(ph));
  }
  await page.screenshot({ path: path.join(OUT, "12-placeholder.png") });

  console.log("\n页面错误: " + (errors.length ? JSON.stringify(errors.slice(0, 8)) : "无"));

  // ================================================================ S11
  console.log("\n[S11] 切换文件后查找高亮按新文档重算（不是沿用上一个文件的匹配）");
  await page.evaluate(() => {
    localStorage.setItem("mwtyper-mock-settings", JSON.stringify({
      theme: "light", focus_mode: false, zoom: 100, autosave_ms: 999999, sidebar_open: true, sidebar_width: 240,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(HELPERS);
  await openWorkspace(page);
  await page.waitForTimeout(600);
  await openFileByName("文档.md");
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(400);
  await page.keyboard.type("正文");
  await page.waitForTimeout(600);
  const inDoc = await page.evaluate(() => ({
    count: document.querySelectorAll(".find-match").length,
    label: (document.querySelector(".find-count") || {}).textContent,
  }));
  check("S11a 文档.md 里「正文」有匹配", inDoc.count > 0, JSON.stringify(inDoc));
  // 切到不含「正文」的文件：匹配必须清零
  await openFileByName("冲突.md");
  await page.waitForTimeout(700);
  const inOther = await page.evaluate(() => ({
    count: document.querySelectorAll(".find-match").length,
    label: (document.querySelector(".find-count") || {}).textContent,
    text: (document.querySelector(".ProseMirror") || {}).textContent,
  }));
  check("S11b 切到不含该词的文件后匹配清零", inOther.count === 0, JSON.stringify(inOther));
  check("S11c 计数显示 0/0", (inOther.label || "").trim() === "0/0", JSON.stringify(inOther));

  console.log("\n========== 汇总 ==========");
  console.log(`总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (failures.length) console.log("失败项: " + JSON.stringify(failures));
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
