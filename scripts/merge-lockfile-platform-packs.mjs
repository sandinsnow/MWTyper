#!/usr/bin/env node
/**
 * lockfile 精准移植：把「完整解析版」里的 @rollup/rollup-* 平台可选依赖条目
 * 移植回「保守版」，其余内容一字不动。
 *
 * 背景：
 *   项目的 pnpm-lock.yaml 是在**离线**环境生成的 —— store 里没有的
 *   可选依赖（rollup 的 22 个平台原生二进制）被 pnpm 整体丢弃，
 *   于是 CI 上 `pnpm install --frozen-lockfile` 装不出
 *   @rollup/rollup-win32-x64-msvc，`vite build` 直接崩：
 *     Error: Cannot find module @rollup/rollup-win32-x64-msvc
 *
 * 为什么不用 `pnpm update --lockfile-only` 的完整产物：
 *   全量 update 会把间接依赖一起升上去 —— 实测 @tiptap/extension-* 从
 *   3.22.1 漂到 3.35.0（跨 13 个 minor），违反项目「统一 pin 3.22.1 家族」
 *   的既定决策，且本地 node_modules 与之不一致 → 本地绿灯、CI 红灯。
 *
 * 所以走「外科手术」：只搬 rollup 平台包，版本由 pnpm-workspace.yaml 的
 * overrides 钉死在 4.52.2（与本地实测一致）。
 *
 * 用法：node scripts/merge-lockfile-platform-packs.mjs <full.lock> <target.lock>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [fullPath, targetPath] = process.argv.slice(2);
if (!fullPath || !targetPath) {
  console.error("用法：node merge-lockfile-platform-packs.mjs <full.lock> <target.lock>");
  process.exit(1);
}

/**
 * 条目行（缩进 2）的匹配。
 *
 * ⚠️ 必须同时覆盖两种写法，否则块边界会算错：
 *   'foo@1.0.0':            ← 带属性行
 *   'foo@1.0.0': {}         ← 同行有值
 * 早先用 /^ {2}(\S.*):$/ 只匹配前者 → `'foo@1.0.0': {}` 会被当成上一个块的
 * 延续，于是同一个块被计入两次，合并后出现重复 key
 * （pnpm 会报 ERR_PNPM_BROKEN_LOCKFILE: duplicate mapping key）。
 */
const KEY_RE = /^ {2}(\S.*?):(?: .*)?$/;

function splitSections(lines) {
  const pkgIdx = lines.findIndex((l) => l === "packages:");
  const snapIdx = lines.findIndex((l) => l === "snapshots:");
  if (pkgIdx < 0 || snapIdx < 0) throw new Error("lockfile 结构异常：找不到 packages/snapshots 段");
  return { pkgIdx, snapIdx };
}

/** 把 [start,end) 区间切成若干块，每块从一条 indent=2 的条目行开始 */
function blocksIn(lines, start, end) {
  const out = [];
  let cur = null;
  for (let i = start; i < end; i++) {
    const L = lines[i];
    if (KEY_RE.test(L)) {
      if (cur) { cur.end = i; out.push(cur); }
      cur = { start: i, end: i + 1, key: L.trim().replace(/:\s*(\{\})?$/, "").replace(/^'|'$/g, "") };
    } else if (cur) {
      cur.end = i + 1;
    }
  }
  if (cur) { cur.end = end; out.push(cur); }
  return out;
}

function findBlock(blocks, key) {
  return blocks.find((b) => b.key === key);
}

/** 在 blocks 里按 key 升序找插入点（返回要插入到哪个块之前） */
function insertIndex(blocks, key) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].key.localeCompare(key) > 0) return i;
  }
  return blocks.length;
}

const full = readFileSync(fullPath, "utf-8").split("\n");
const target = readFileSync(targetPath, "utf-8").split("\n");

const fSec = splitSections(full);
const tSec = splitSections(target);

const fPkg = blocksIn(full, fSec.pkgIdx + 1, fSec.snapIdx);
const fSnap = blocksIn(full, fSec.snapIdx + 1, full.length);

const ROLLUP_PKG = fPkg.filter((b) => b.key.startsWith("@rollup/rollup-"));
const ROLLUP_SNAP = fSnap.filter((b) => b.key.startsWith("@rollup/rollup-"));
const ROLLUP_SNAP_MAIN = findBlock(fSnap, "rollup@4.52.2");

if (!ROLLUP_PKG.length) {
  console.error("完整版 lockfile 里没有 @rollup/rollup-* 条目 —— 源文件不对");
  process.exit(1);
}
if (!ROLLUP_SNAP_MAIN) {
  console.error("完整版 lockfile 里没有 rollup@4.52.2 的 snapshots 块");
  process.exit(1);
}

console.log(`完整版中：packages 段 ${ROLLUP_PKG.length} 个平台包，snapshots 段 ${ROLLUP_SNAP.length} 个`);

// ── 1) packages 段：插入平台包条目 ──────────────────────────────────────
let tPkg = blocksIn(target, tSec.pkgIdx + 1, tSec.snapIdx);
const added = [];
for (const b of ROLLUP_PKG) {
  if (findBlock(tPkg, b.key)) continue; // 已有
  const at = insertIndex(tPkg, b.key);
  const chunk = full.slice(b.start, b.end);
  tPkg.splice(at, 0, { key: b.key, chunk });
  added.push(b.key);
}
// 重建 packages 段文本
const pkgChunk = tPkg.flatMap((b) => b.chunk ?? target.slice(b.start, b.end));

// ── 2) snapshots 段：插入平台包 + 替换 rollup 主块 ──────────────────────
let tSnap = blocksIn(target, tSec.snapIdx + 1, target.length);
for (const b of ROLLUP_SNAP) {
  if (findBlock(tSnap, b.key)) continue;
  const at = insertIndex(tSnap, b.key);
  tSnap.splice(at, 0, { key: b.key, chunk: full.slice(b.start, b.end) });
}
// 替换 rollup@4.52.2 主块（把完整的 optionalDependencies 换上）
const mainIdx = tSnap.findIndex((b) => b.key === "rollup@4.52.2");
if (mainIdx >= 0) {
  tSnap[mainIdx] = { key: "rollup@4.52.2", chunk: full.slice(ROLLUP_SNAP_MAIN.start, ROLLUP_SNAP_MAIN.end) };
}
const snapChunk = tSnap.flatMap((b) => b.chunk ?? target.slice(b.start, b.end));

// ── 3) 拼回 ──────────────────────────────────────────────────────────────
// 注意：pkgChunk / snapChunk 已经是各自整段的内容（含块间空行），
// 所以这里**不能再**把 target 的原段落拼进去 —— 那会造成整段重复。
const out = [
  ...target.slice(0, tSec.pkgIdx + 1), // 到 "packages:" 行
  ...pkgChunk, // packages 段完整内容
  target[tSec.snapIdx], // "snapshots:" 行
  ...snapChunk, // snapshots 段完整内容
];
writeFileSync(targetPath, out.join("\n"), "utf-8");

// 自检：重复 key 必须为空（YAML 映射不允许重复键，pnpm 会直接报
// ERR_PNPM_BROKEN_LOCKFILE）
const pkgStart = tSec.pkgIdx + 1;
const snapStart = pkgStart + pkgChunk.length + 1;
const seen = new Set();
const dupes = [];
for (let i = 0; i < out.length; i++) {
  const m = KEY_RE.exec(out[i]);
  if (!m) continue;
  const key = m[1].replace(/^'|'$/g, "");
  const id = (i < snapStart ? "packages" : "snapshots") + "|" + key;
  if (seen.has(id)) dupes.push(id);
  seen.add(id);
}
if (dupes.length) {
  console.error(`合并后存在 ${dupes.length} 个重复 key：`);
  for (const d of dupes.slice(0, 10)) console.error("  " + d);
  process.exit(1);
}

console.log(`已插入 ${added.length} 个平台包条目到 packages 段；rollup 主块的 optionalDependencies 已更新`);
console.log("自检：无重复 key");
