/**
 * 浏览器探针的共用助手。
 *
 * 「打开工作区」在 v1.9 标题栏重组后不再是一个独立按钮，而是收进了
 * 「⋯ 更多」菜单 —— 所有探针的搭建步骤都得跟着改。与其在十三个文件里
 * 各写一遍易错的行内逻辑，不如收敛到这里一处。
 */

/**
 * 打开工作区（浏览器 mock 的 pickFolder 返回 /demo）。
 * @param {import("playwright-core").Page} page
 */
async function openWorkspace(page) {
  // 「打开文件夹」在 v1.9 里移到了**侧栏「文件」页工具栏**（工作区操作，语义上
  // 不属于标题栏），选择器与 QA spike 用的完全一致。
  await page.evaluate(() => {
    const b = document.querySelector('button[title^="打开文件夹"]');
    if (b) b.click();
  });
  await page.waitForTimeout(900);
}

/**
 * 在文件树里点开某个文件（按文件名子串匹配）。
 * @param {import("playwright-core").Page} page
 * @param {string} name 文件名子串
 */
async function openFileInTree(page, name) {
  await page.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll(".tree-row"));
    const t = rows.find((r) => (r.textContent || "").includes(n));
    if (t) t.click();
  }, name);
  await page.waitForTimeout(1000);
}

/**
 * 点击标题栏的**编辑模式分段控件**（所见即所得 / 源码 / 随航）。
 *
 * v1.9 标题栏重组后，模式切换从「⇄ 源码」一个按钮变成了三态分段控件；
 * 用「包含 源码 或 所见即所得」的模糊匹配会永远点到第一个（所见即所得），
 * 导致「点两次切到源码」这类流程走不通 —— 必须按**精确文本**匹配。
 * @param {import("playwright-core").Page} page
 * @param {"所见即所得"|"源码"|"随航"} label
 */
async function clickSegment(page, label) {
  const ok = await page.evaluate((l) => {
    const b = Array.from(document.querySelectorAll(".mode-segment")).find(
      (x) => (x.textContent || "").trim() === l
    );
    if (b) { b.click(); return true; }
    return false;
  }, label);
  await page.waitForTimeout(900);
  return ok;
}

module.exports = { openWorkspace, openFileInTree, clickSegment };
