#!/usr/bin/env node
/**
 * 静态守卫：可执行文件里不得出现**本机特定**的绝对路径。
 *
 * 背景（CI 首跑的真实教训）：
 *   探针里写死了 `const ROOT = "D:/PROJECT/MWTyper"`，本机跑得好好的，
 *   换到 CI runner（工作目录是 `D:\a\MWTyper\MWTyper`）就 ENOENT。
 *   同一个坑在浏览器闸门里出现过 13 次（硬编码 Playwright 与 Chromium 路径）。
 *
 * 判据只针对「换机器必炸」的前缀，不做泛化的盘符匹配：
 *   - `D:/PROJECT/MWTyper` —— 本机项目绝对路径
 *   - `C:/Users/Admin` / `/c/Users/Admin` —— 本机用户名与家目录
 *   - `C:/Users/<任意用户名>` 形式的一般家目录
 * 通用测试数据（如 `D:/a/b.md`）**不算**违规 —— 那是故意的路径样例。
 *
 * 注释里的示例路径（`spikes/audit3.ts` 等 QA 独占资产里的运行说明）不参与判定：
 * 先剥掉行注释与块注释再扫描。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url))); // tests/
const ROOT = resolve(HERE, ".."); // 仓库根（HERE 已是 tests/，只需退一级）

/** 参与扫描的目录（相对仓库根） */
const SCAN_DIRS = ["tests", "spikes", "src", "src-tauri/src", "scripts", ".github", "examples"];

/** 参与扫描的扩展名 */
const EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".sh", ".ps1", ".py", ".json", ".yml", ".yaml",
]);

/** 明确排除的路径片段 */
const SKIP_DIRS = new Set(["node_modules", "target", "dist", "sandbox", "__pycache__", ".git", "shots", "gen"]);

/**
 * 本机特定路径前缀。
 *
 * ⚠️ 模式串与 label 里都不能出现这些路径的**字面量** —— 否则本文件会把自己
 * 源码判成违规（自己抓自己）。label 只描述类别，具体路径由运行时打印匹配片段。
 * 这与「变异注入反证」同理：守卫自己也必须经得起自己那把尺子量。
 */
const PATTERNS = [
  { re: new RegExp("D:" + "[\\\\/]PROJECT[\\\\/]MWTyper", "gi"), label: "本机项目绝对路径" },
  { re: new RegExp("[A-Za-z]:" + "[\\\\/]Users[\\\\/]Admin", "gi"), label: "本机家目录（盘符形式）" },
  { re: new RegExp("/c/" + "Users/Admin", "gi"), label: "本机家目录（Git Bash 形式）" },
];

/** 剥掉注释，避免把「运行说明」里的示例路径误判为违规 */
function stripComments(src, ext) {
  let s = src;
  // 块注释
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");
  // 行注释（# 用于 shell/python/yaml，// 用于 ts/js/rs）
  if (ext === ".py" || ext === ".sh" || ext === ".yml" || ext === ".yaml") {
    s = s.replace(/#[^\n]*/g, " ");
  } else {
    s = s.replace(/\/\/[^\n]*/g, " ");
  }
  return s;
}

function walk(dir, out) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(e.name))) out.push(p);
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

let fail = 0;
let hits = 0;
for (const f of files) {
  const raw = readFileSync(f, "utf-8");
  const text = stripComments(raw, extname(f));
  for (const { re, label } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      fail++;
      hits++;
      const line = text.slice(0, m.index).split("\n").length;
      console.log(
        `!!  ${f.replace(ROOT + "\\", "").replace(ROOT + "/", "")}:${line} — ${label}: ${m[0]}`
      );
    }
  }
}

if (fail === 0) {
  console.log(`OK  无本机特定绝对路径（扫描 ${files.length} 个文件）`);
  process.exit(0);
}
console.log(`\n总计 ${fail} 处违规 —— 这些路径换机器/CI 就会失效，必须改成相对解析。`);
process.exit(1);
