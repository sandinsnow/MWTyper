#!/usr/bin/env node
/**
 * v0.1.1 发布产物的**端到端完整性校验**。
 *
 * 为什么需要它：本机到 github.com:443 时通时不通，`browser_download_url`
 * 常常连不上；而 assets API 即使带 `Accept: application/octet-stream`，
 * 返回的也只是元数据。→ 走 **302 的 Location 签名直链**取真实内容。
 *
 * 校验六件事：
 *   ① .sha256 资产的内容 == MWTyper.exe 的 digest
 *   ② latest.json 的 platforms.sha256 == MWTyper.exe 的 digest
 *   ③ latest.json 的 version == 标签版本
 *   ④ latest.json 的 notes == 标签附注（发布说明没退化成 commit message）
 *   ⑤ latest.json 的 url 指向本次标签的 exe 资产
 *   ⑥ latest.json 的内容哈希 == 资产元数据里的 digest（资产未被中途篡改）
 *
 * 用法：node scripts/verify-release.mjs <tag> [tag说明文件]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TAG = process.argv[2];
if (!TAG) {
  console.error("用法：node verify-release.mjs <tag> [说明文件]");
  process.exit(1);
}

function getToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error("拿不到 GitHub 凭据");
  return m[1].trim();
}
const TOKEN = getToken();
const REPO = "sandinsnow/MWTyper";
const API = `https://api.github.com/repos/${REPO}`;

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`OK  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`!!  ${name}${detail ? " — " + detail : ""}`); }
}

/** 取资产真实内容：走 302 的 Location 签名直链。 */
async function downloadAsset(asset) {
  const res = await fetch(`${API}/releases/assets/${asset.id}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/octet-stream",
      "User-Agent": "mwtyper-verify-release",
    },
    redirect: "manual",
  });
  const loc = res.headers.get("location");
  if (!loc) {
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    throw new Error(`取 ${asset.name} 的下载地址失败：HTTP ${res.status}`);
  }
  const r2 = await fetch(loc, { headers: { "User-Agent": "mwtyper-verify-release" } });
  if (!r2.ok) throw new Error(`下载 ${asset.name} 失败：HTTP ${r2.status}`);
  return Buffer.from(await r2.arrayBuffer());
}

const rel = await (
  await fetch(`${API}/releases/tags/${TAG}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
  })
).json();

if (!rel || rel.message) {
  console.error(`拿不到 ${TAG} 的 Release：${rel?.message}`);
  process.exit(1);
}
console.log(`Release ${rel.tag_name}（${rel.name}），发布于 ${rel.published_at}`);

const exe = rel.assets.find((a) => a.name === "MWTyper.exe");
const shaAsset = rel.assets.find((a) => a.name.endsWith(".sha256"));
const jsonAsset = rel.assets.find((a) => a.name === "latest.json");
if (!exe || !shaAsset || !jsonAsset) {
  console.error("资产不齐全");
  process.exit(1);
}
const exeDigest = (exe.digest || "").replace("sha256:", "");
console.log(`exe：${exe.size} B，digest ${exeDigest}`);

// ① .sha256 资产内容 == exe digest
const shaTxt = (await downloadAsset(shaAsset)).toString("utf-8").trim();
check("① .sha256 资产内容 == exe 的 digest", shaTxt.split(/\s+/)[0] === exeDigest, shaTxt);

// ②③④⑤⑥ latest.json
const jsonBuf = await downloadAsset(jsonAsset);
const latest = JSON.parse(jsonBuf.toString("utf-8"));
check("② latest.json 的 sha256 == exe 的 digest",
  latest.platforms["windows-x86_64"].sha256 === exeDigest,
  latest.platforms["windows-x86_64"].sha256);
check("③ latest.json 的 version == 标签版本",
  latest.version === TAG.replace(/^v/, ""), latest.version);
check("⑤ latest.json 的 url 指向本次标签的 exe",
  latest.platforms["windows-x86_64"].url.endsWith(`/${TAG}/MWTyper.exe`),
  latest.platforms["windows-x86_64"].url);
check("⑥ latest.json 内容哈希 == 资产元数据 digest",
  createHash("sha256").update(jsonBuf).digest("hex") === (jsonAsset.digest || "").replace("sha256:", ""));

// ④ notes == 标签附注（发布说明没退化成 commit message）
const notesFile = process.argv[3];
if (notesFile && existsSync(notesFile)) {
  const expect = readFileSync(notesFile, "utf-8").trim();
  check("④ latest.json 的 notes == 标签附注", latest.notes.trim() === expect,
    `len ${latest.notes.length} vs ${expect.length}`);
} else {
  check("④ latest.json 的 notes 非空且不是 commit message",
    latest.notes.length > 50 && !/^(feat|fix|docs|chore|test)(\(|:)/.test(latest.notes),
    `notes 首行「${latest.notes.split("\n")[0]}」`);
}

// Release 正文 == 附注
const bodyOk = rel.body && rel.body.trim().length > 200 &&
  !/^(feat|fix|docs|chore|test)(\(|:)/.test(rel.body.trim());
check("⑦ Release 正文是标签附注而非 commit message", !!bodyOk,
  `正文 ${(rel.body || "").length} 字符，首行「${(rel.body || "").split("\n")[0]}」`);

console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
