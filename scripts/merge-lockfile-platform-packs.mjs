#!/usr/bin/env node
/**
 * lockfile 精准移植：把「完整解析版」里缺失的**平台原生二进制**条目
 * 移植回「保守版」，其余内容一字不动。
 *
 * 背景（CI 连环失败的共同根因）：
 *   项目的 pnpm-lock.yaml 是在**离线**环境生成的 —— store 里没有的可选依赖
 *   （rollup 的 22 个平台二进制、@tauri-apps/cli 的平台二进制…）被 pnpm
 *   整体丢弃，于是 lockfile 里这些包一个都没有。
 *   CI 上 `pnpm install --frozen-lockfile` 装不出来：
 *     Error: Cannot find module @rollup/rollup-win32-x64-msvc      → vite build 崩
 *     Error: Cannot find module @tauri-apps/cli-win32-x64-msvc    → tauri build 崩
 *
 * 为什么不用 `pnpm update --lockfile-only` 的完整产物：
 *   全量 update 会把间接依赖一起升上去 —— 实测 @tiptap/extension-* 从
 *   3.22.1 漂到 3.35.0（跨 13 个 minor），违反项目「统一 pin 3.22.1 家族」
 *   的既定决策，且本地 node_modules 与之不一致 → 本地绿灯、CI 红灯。
 *
 * 所以走「外科手术」：
 *   1) 逐个主块（如 rollup@4.52.2、@tauri-apps/cli@2.11.4）比对，
 *      若完整版里同名同版本的主块带 optionalDependencies，而保守版缺，
 *      就把**保守版的 dependencies + 完整版的 optionalDependencies** 拼起来；
 *   2) 再把这些 optionalDependencies 指向的平台包条目
 *      （packages 段 + snapshots 段）移植进保守版。
 *   版本由 pnpm-workspace.yaml 的 overrides 钉死，不随 update 漂移。
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

/** 在 blocks 里按 key 升序找插入点（返回要插入到哪个块之前） */
function insertIndex(blocks, key) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].key.localeCompare(key) > 0) return i;
  }
  return blocks.length;
}

/** 取块内 optionalDependencies 段的行（含段头） */
function optionalDepsLines(chunk) {
  const i = chunk.findIndex((l) => /^ {4}optionalDependencies:$/.test(l));
  if (i < 0) return null;
  return chunk.slice(i);
}

/**
 * 取块内 optionalDependencies 之前的所有行（块头 + dependencies 段）。
 *
 * ⚠️ 单行块（`'x@1.0.0': {}`）必须改写成块头形式（`'x@1.0.0':`）——
 * 否则后面接上缩进的 optionalDependencies 段会变成
 *   'x@1.0.0': {}
 *     optionalDependencies:
 * YAML 解析直接报错「did not find expected key」。
 */
function headLines(chunk) {
  const i = chunk.findIndex((l) => /^ {4}optionalDependencies:$/.test(l));
  const head = i < 0 ? chunk.slice() : chunk.slice(0, i);
  if (head.length && /^ {2}\S.*:\s*\{\}\s*$/.test(head[0])) {
    head[0] = head[0].replace(/:\s*\{\}\s*$/, ":");
  }
  return head;
}

/**
 * 从 optionalDependencies 段里解析出被引用的**完整 key**（含版本号）。
 *
 * ⚠️ 必须拼成 `包名@版本` 才能与 packages/snapshots 段的 key 对上 ——
 * 段里的 key 带版本（`@rollup/rollup-x64-msvc@4.52.2`），而 optionalDependencies
 * 段里是「包名: 版本」两列。只取包名会一个都匹配不上（实测补齐数为 0）。
 */
function referencedKeys(chunk) {
  const seg = optionalDepsLines(chunk);
  if (!seg) return [];
  const keys = [];
  for (const l of seg.slice(1)) {
    const m = /^ {6}'?([^']+?)'?:\s*(.+)$/.exec(l);
    if (m) keys.push(m[1] + "@" + m[2].trim());
  }
  return keys;
}

const full = readFileSync(fullPath, "utf-8").split(/\r?\n/);
const target = readFileSync(targetPath, "utf-8").split(/\r?\n/);

const fSec = splitSections(full);
const tSec = splitSections(target);

const fPkg = blocksIn(full, fSec.pkgIdx + 1, fSec.snapIdx);
const fSnap = blocksIn(full, fSec.snapIdx + 1, full.length);
const fPkgMap = new Map(fPkg.map((b) => [b.key, b]));
const fSnapMap = new Map(fSnap.map((b) => [b.key, b]));

const tPkg = blocksIn(target, tSec.pkgIdx + 1, tSec.snapIdx);
const tSnap = blocksIn(target, tSec.snapIdx + 1, target.length);
const tPkgKeys = new Set(tPkg.map((b) => b.key));
const tSnapKeys = new Set(tSnap.map((b) => b.key));

// ── 1) 找出「保守版缺平台包」的主块 ──────────────────────────────────────
const needPlatformKeys = new Set();
const patchedMain = [];

for (const tb of tSnap) {
  const fb = fSnapMap.get(tb.key);
  if (!fb) continue; // 完整版里没有同名同版本的主块 → 不动
  const fChunk = full.slice(fb.start, fb.end);
  if (!optionalDepsLines(fChunk)) continue;
  const refs = referencedKeys(fChunk);
  const missing = refs.filter((k) => !tPkgKeys.has(k) || !tSnapKeys.has(k));
  if (!missing.length) continue;
  for (const k of missing) needPlatformKeys.add(k);
  patchedMain.push({ key: tb.key, tb, fChunk, missing });
}

console.log(`需要补齐平台包的主块：${patchedMain.length} 个`);
for (const p of patchedMain) console.log(`  ${p.key}  缺 ${p.missing.length} 个平台包`);

// ── 2) 主块替换：保守版的 dependencies + 完整版的 optionalDependencies ──
const mainReplacements = new Map();
for (const p of patchedMain) {
  const tChunk = target.slice(p.tb.start, p.tb.end);
  mainReplacements.set(p.key, [...headLines(tChunk), ...optionalDepsLines(p.fChunk)]);
}

// ── 3) 移植平台包条目（packages 段 + snapshots 段）────────────────────────
const addPkg = [];
for (const k of needPlatformKeys) {
  const fb = fPkgMap.get(k);
  if (fb && !tPkgKeys.has(k)) addPkg.push({ key: k, chunk: full.slice(fb.start, fb.end) });
}
const addSnap = [];
for (const k of needPlatformKeys) {
  const fb = fSnapMap.get(k);
  if (fb && !tSnapKeys.has(k)) addSnap.push({ key: k, chunk: full.slice(fb.start, fb.end) });
}

// 插入（按 key 升序）
for (const item of addPkg) {
  const at = insertIndex(tPkg, item.key);
  tPkg.splice(at, 0, item);
}
for (const item of addSnap) {
  const at = insertIndex(tSnap, item.key);
  tSnap.splice(at, 0, item);
}
// 主块替换（在插入之后做，避免下标失效）
for (const p of patchedMain) {
  const idx = tSnap.findIndex((b) => b.key === p.key);
  if (idx >= 0) tSnap[idx] = { key: p.key, chunk: mainReplacements.get(p.key) };
}

// ── 4) 拼回 ──────────────────────────────────────────────────────────────
// 注意：pkgChunk / snapChunk 已经是各自整段的内容（含块间空行），
// 所以这里**不能再**把 target 的原段落拼进去 —— 那会造成整段重复。
const pkgChunk = tPkg.flatMap((b) => b.chunk ?? target.slice(b.start, b.end));
const snapChunk = tSnap.flatMap((b) => b.chunk ?? target.slice(b.start, b.end));

const out = [
  ...target.slice(0, tSec.pkgIdx + 1), // 到 "packages:" 行
  ...pkgChunk, // packages 段完整内容
  target[tSec.snapIdx], // "snapshots:" 行
  ...snapChunk, // snapshots 段完整内容
];
writeFileSync(targetPath, out.join("\n"), "utf-8");

// ── 5) 自检：重复 key 必须为空 ───────────────────────────────────────────
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

console.log(`已补齐 ${addPkg.length} 个 packages 条目、${addSnap.length} 个 snapshots 条目`);
console.log("自检：无重复 key");
