/**
 * 浏览器闸门的运行时定位助手。
 *
 * 背景：这些探针最初是在离线开发机上写的，Playwright 的安装位置与
 * Chromium 的可执行文件路径都是**硬编码的绝对路径**（C:/Users/<用户名>/…），
 * 换一台机器、换 CI runner 就会直接 `Cannot find module`。
 *
 * 这里把三件事收敛到一处：
 *   PC  —— playwright-core 模块的绝对路径（require 用）
 *   EXE —— Chromium 可执行文件的绝对路径（launch 用）
 *   OUT —— 截图输出目录（相对本文件解析，随仓库走）
 *
 * 探测顺序（先命中先用）：
 *   1) 环境变量 PLAYWRIGHT_CORE_PATH / PLAYWRIGHT_CHROMIUM_EXE
 *   2) 项目自身的 node_modules（npm i -D playwright 后即可用）
 *   3) WorkBuddy 自带的 node 发行版里的 @playwright/cli 依赖树
 *   4) Playwright 官方浏览器缓存目录（%LOCALAPPDATA%/ms-playwright 等）
 *
 * 三种平台各自的 Chromium 目录布局：
 *   Windows  %LOCALAPPDATA%\ms-playwright\chromium-<rev>\chrome-win64\chrome.exe
 *   Linux    ~/.cache/ms-playwright/chromium-<rev>\chrome-linux\chrome
 *   macOS    ~/Library/Caches/ms-playwright/chromium-<rev>\chrome-mac\Chromium.app/Contents/MacOS/Chromium
 */

const fs = require("node:fs");
const path = require("node:path");

/** 本文件所在目录（tests/browser/） */
const HERE = __dirname;

/** 仓库根目录（tests/browser/ 的上一级） */
const ROOT = path.resolve(HERE, "..", "..");

/** 截图输出目录：始终落在仓库内的 tests/browser/shots */
const OUT = path.resolve(HERE, "shots");

// ── playwright-core 模块定位 ───────────────────────────────────────────────

function resolveFrom(nodeModulePaths, pkg) {
  for (const base of nodeModulePaths) {
    try {
      return require.resolve(pkg, { paths: [base] });
    } catch {
      /* 继续试下一个候选路径 */
    }
  }
  return null;
}

/** 扫描 WorkBuddy 自带 node 发行版里的 @playwright/cli 依赖树 */
function scanWorkbuddyBinaries() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return null;
  const versionsDir = path.join(home, ".workbuddy", "binaries", "node", "versions");
  if (!fs.existsSync(versionsDir)) return null;
  let versions = [];
  try {
    versions = fs
      .readdirSync(versionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const v of versions) {
    const candidate = path.join(
      versionsDir,
      v,
      "node_modules",
      "@playwright",
      "cli",
      "node_modules",
      "playwright-core"
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findPlaywrightCore() {
  if (process.env.PLAYWRIGHT_CORE_PATH) {
    const p = process.env.PLAYWRIGHT_CORE_PATH;
    if (fs.existsSync(p)) return p;
    throw new Error(`PLAYWRIGHT_CORE_PATH 指向的路径不存在：${p}`);
  }
  // 2) 项目 node_modules
  const local = resolveFrom([path.join(ROOT, "node_modules"), path.join(HERE, "node_modules")], "playwright-core");
  if (local) return local;
  const localPkg = resolveFrom([path.join(ROOT, "node_modules"), path.join(HERE, "node_modules")], "playwright");
  if (localPkg) return localPkg;
  // 3) WorkBuddy 自带发行版
  const wb = scanWorkbuddyBinaries();
  if (wb) return wb;
  return null;
}

// ── Chromium 可执行文件定位 ──────────────────────────────────────────────

/** 在 dir 下找出第一个匹配 nameFilter 的文件（只看一层子目录） */
function findInCache(root, nameFilter) {
  if (!root || !fs.existsSync(root)) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return null;
  }
  // 版本号目录名形如 chromium-1234，按数字倒序取最新
  entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  for (const e of entries) {
    const dir = path.join(root, e.name);
    let found = null;
    const walk = (d, depth) => {
      if (found || depth > 3) return;
      let items = [];
      try {
        items = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        const full = path.join(d, it.name);
        if (it.isFile() && nameFilter(it.name)) {
          found = full;
          return;
        }
        if (it.isDirectory()) walk(full, depth + 1);
      }
    };
    walk(dir, 0);
    if (found) return found;
  }
  return null;
}

function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXE) {
    const p = process.env.PLAYWRIGHT_CHROMIUM_EXE;
    if (fs.existsSync(p)) return p;
    throw new Error(`PLAYWRIGHT_CHROMIUM_EXE 指向的路径不存在：${p}`);
  }
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return findInCache(path.join(local, "ms-playwright"), (n) => /^chrome\.exe$/i.test(n));
  }
  if (process.platform === "darwin") {
    return findInCache(path.join(home, "Library", "Caches", "ms-playwright"), (n) => /^Chromium$/i.test(n));
  }
  return findInCache(path.join(home, ".cache", "ms-playwright"), (n) => /^chrome$/i.test(n));
}

// ── 对外导出 ─────────────────────────────────────────────────────────────

const PC = findPlaywrightCore();
const EXE = findChromiumExecutable();

if (!PC) {
  console.error(
    [
      "pw.cjs: 找不到 playwright-core。",
      "  方案一：npm i -D playwright && npx playwright install chromium（推荐，CI 用这个）",
      "  方案二：设置环境变量 PLAYWRIGHT_CORE_PATH 指向 playwright-core 的目录",
      "  方案三：安装 WorkBuddy 的 Playwright 插件（自带发行版）",
    ].join("\n")
  );
  process.exit(1);
}
if (!EXE) {
  console.error(
    [
      "pw.cjs: 找不到 Chromium 可执行文件。",
      "  运行 `npx playwright install chromium` 下载浏览器，",
      "  或设置环境变量 PLAYWRIGHT_CHROMIUM_EXE 指向浏览器可执行文件。",
    ].join("\n")
  );
  process.exit(1);
}

module.exports = { PC, EXE, OUT, ROOT, HERE };
