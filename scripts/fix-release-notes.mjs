#!/usr/bin/env node
/**
 * 用标签附注修正已发布的 Release：更新正文 + 重传 latest.json。
 *
 * 背景：v0.1.0 首次发布时，`actions/checkout` 未把 annotated tag 的 tag 对象
 * 落地到本地仓库 → release.yml 里的 `git tag -l --format='%(contents)'`
 * 取到的是 **commit message** 而不是标签附注 → Release 正文与 latest.json
 * 的 notes 都变成了最后一条 commit 的标题。
 *
 * release.yml 已修（多级回退：本地引用 → GitHub API → 标签名）；
 * 本脚本把已发布的那一个 Release 就地修正到与新逻辑一致。
 *
 * 用法：node scripts/fix-release-notes.mjs <tag>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TAG = process.argv[2];
if (!TAG) {
  console.error("用法：node fix-release-notes.mjs <tag>");
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

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mwtyper-fix-release-notes",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${json?.message || text.slice(0, 200)}`);
  return json;
}

/**
 * 下载资产的**实际内容**。
 *
 * ⚠️ 两条弯路都踩过：
 *   ① `GET /repos/{o}/{r}/releases/assets/{id}` 即使带
 *      `Accept: application/octet-stream`，返回的仍是**元数据 JSON**
 *      （于是 latest.json 的 sha256 字段被写成了一整段 JSON）；
 *   ② 换成 uploads.github.com 上传时，资产 endpoint 也只在
 *      **uploads.github.com** 上（不是 api.github.com），否则 404。
 * → 结论：**直接用公开下载地址** `browser_download_url` 取内容，最省事最可靠。
 */
async function downloadAsset(asset) {
  const res = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "mwtyper-fix-release-notes" },
  });
  if (!res.ok) throw new Error(`下载资产 ${asset.name} 失败：HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 1) 标签附注（本地 git 对象，最权威）
const notes = execFileSync("git", ["for-each-ref", `refs/tags/${TAG}`, "--format=%(contents)"], {
  cwd: ROOT,
  encoding: "utf8",
}).trim();
if (!notes) throw new Error(`本地拿不到标签 ${TAG} 的附注`);
console.log(`标签附注：${notes.length} 字符，首行「${notes.split("\n")[0]}」`);

// 2) 找到 Release
const releases = await api("GET", "/releases");
const rel = releases.find((r) => r.tag_name === TAG);
if (!rel) throw new Error(`找不到 tag ${TAG} 对应的 Release`);
console.log(`Release id=${rel.id}`);

// 3) 更新正文
await api("PATCH", `/releases/${rel.id}`, { body: notes });
console.log("已更新 Release 正文");

// 4) 替换 latest.json
//    ⚠️ sha256 **始终**以 .sha256 资产的内容为准，不信任已有的 latest.json
//    （首次修正时 latest.json 里的 sha256 已被写成元数据 JSON，
//      若走「只换 notes」分支，坏值会被原样保留下来）。
const latestAsset = rel.assets.find((a) => a.name === "latest.json");
const shaAsset = rel.assets.find((a) => a.name.endsWith(".sha256"));
if (!shaAsset) throw new Error("没有 .sha256 资产，无法确定校验和");

const shaBuf = await downloadAsset(shaAsset);
const sha = shaBuf.toString("utf-8").trim().split(/\s+/)[0];
if (!/^[0-9a-f]{64}$/.test(sha)) {
  throw new Error(`从 ${shaAsset.name} 读到的校验和格式不对：${sha.slice(0, 80)}`);
}
const exeName = shaAsset.name.replace(/\.sha256$/, "");
const version = TAG.replace(/^v/, "");

let latest;
if (latestAsset) {
  const buf = await downloadAsset(latestAsset);
  try {
    latest = JSON.parse(buf.toString("utf-8"));
  } catch {
    latest = {};
  }
} else {
  latest = {};
  console.log("latest.json 资产缺失 → 重建");
}
latest.version = latest.version || version;
latest.pub_date = latest.pub_date || rel.published_at;
latest.platforms = latest.platforms || {};
latest.platforms["windows-x86_64"] = {
  url: `https://github.com/${REPO}/releases/download/${TAG}/${exeName}`,
  sha256: sha,
};
const oldNotes = latest.notes;
latest.notes = notes;
const newBuf = Buffer.from(JSON.stringify(latest, null, 2) + "\n", "utf-8");

// 删除旧资产后重传（GitHub 不允许同名资产覆盖）
if (latestAsset) {
  await api("DELETE", `/releases/assets/${latestAsset.id}`);
  console.log("已删除旧 latest.json 资产");
}

// ⚠️ 上传资产的 endpoint 在 **uploads.github.com**，不是 api.github.com
// （后者只管元数据操作）—— 用错主机会 404。
const upload = await fetch(
  `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=latest.json`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mwtyper-fix-release-notes",
      "Content-Type": "application/octet-stream",
    },
    body: newBuf,
  }
);
if (!upload.ok) {
  const t = await upload.text();
  throw new Error(`上传 latest.json 失败：HTTP ${upload.status} ${t.slice(0, 200)}`);
}
const uploaded = await upload.json();
console.log(`已重传 latest.json：${uploaded.size} B（notes 从 ${oldNotes.length} 字符 → ${notes.length} 字符）`);
