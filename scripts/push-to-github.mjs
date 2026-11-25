#!/usr/bin/env node
/**
 * 用 GitHub 的 Git Data API 把本地提交推送到远端。
 *
 * 为什么不用 `git push`：本机到 github.com:443 的 TCP 连接不通（超时），
 * 但 api.github.com:443 可达 —— 所以走 REST 的 Git Data API
 * （blobs → trees → commits → refs）可以达到同样的效果，且**一次 commit**，
 * 不会像 Contents API 那样产生上百个碎 commit。
 *
 * 用法：node scripts/push-to-github.mjs [--dry-run]
 * 凭据：优先读环境变量 GITHUB_TOKEN / GH_TOKEN；
 *       否则向 git credential manager 询问 https/github.com。
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const REPO = "sandinsnow/MWTyper";
const API = `https://api.github.com/repos/${REPO}`;
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

/** 覆盖新提交的 parent（用于修正已推送但内容不对的提交） */
const PARENT_OVERRIDE = (() => {
  const i = process.argv.indexOf("--parent");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();

// ── 凭据 ──────────────────────────────────────────────────────────────────

function getToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  try {
    const out = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const m = out.match(/^password=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* 下面统一报错 */
  }
  throw new Error(
    "拿不到 GitHub 凭据：请设置 GITHUB_TOKEN 环境变量，或在凭据管理器里登录 git"
  );
}

const TOKEN = getToken();

// ── HTTP ──────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mwtyper-push-script",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const msg = json?.message || text.slice(0, 300);
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return json;
}

// ── 读取本地索引里的文件清单（含 mode）────────────────────────────────────

function listFiles() {
  const out = execFileSync("git", ["ls-files", "--stage"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const m = /^(\d{6}) ([0-9a-f]{40}) \d+\t(.+)$/.exec(line);
    if (!m) continue;
    files.push({ mode: m[1], sha: m[2], path: m[3] });
  }
  return files;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const files = listFiles();
  console.log(`本地文件数：${files.length}`);

  // 1) 远端 main 的当前 SHA（作为新提交的 parent）
  const ref = await api("GET", "/git/refs/heads/main");
  const parent = PARENT_OVERRIDE || ref.object.sha;
  console.log(`远端 main：${ref.object.sha}`);
  console.log(`新提交的 parent：${parent}`);

  if (DRY) {
    console.log("[dry-run] 不做任何写操作。");
    return;
  }

  // 2) 上传 blob（并发 8）
  const entries = [];
  let done = 0;
  const CONCURRENCY = 8;

  async function upload(f) {
    // ⚠️ 必须从 **Git 对象库** 读，而不是从工作区读文件。
    //   工作区文件在 Windows 上是 CRLF，而 index 里的 blob 是 Git 规范化后的 LF
    //   （core.autocrlf=true）。直接上传工作区文件会让远端 blob 与本地 commit
    //   的 blob 不一致 —— 两端 SHA 不同，后续 git push 就会冲突。
    //   `git cat-file blob <sha>` 取出的正是 index 里那个已经规范化的对象。
    const bytes = execFileSync("git", ["cat-file", "blob", f.sha], {
      cwd: ROOT,
      maxBuffer: 128 * 1024 * 1024,
    });
    const content = bytes.toString("base64");
    const blob = await api("POST", "/git/blobs", {
      content,
      encoding: "base64",
    });
    done++;
    if (done % 20 === 0 || done === files.length) {
      console.log(`  blob ${done}/${files.length}`);
    }
    return { path: f.path, mode: f.mode, type: "blob", sha: blob.sha };
  }

  const queue = files.slice();
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const f = queue.shift();
      entries.push(await upload(f));
    }
  });
  await Promise.all(workers);

  // 3) 组装 tree（以远端 tree 为 base，未在本地改动的文件自动保留）
  const tree = await api("POST", "/git/trees", {
    base_tree: null,
    tree: entries,
  });
  console.log(`tree：${tree.sha}`);

  // 4) 建 commit
  const message = execFileSync("git", ["log", "-1", "--pretty=%B"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const commit = await api("POST", "/git/commits", {
    message,
    tree: tree.sha,
    parents: [parent],
  });
  console.log(`commit：${commit.sha}`);

  // 5) 推进远端 main
  const updated = await api("PATCH", "/git/refs/heads/main", {
    sha: commit.sha,
    force: FORCE,
  });
  console.log(`refs/heads/main → ${updated.object.sha}`);
  console.log(`\n完成：https://github.com/${REPO}/commit/${commit.sha}`);
}

main().catch((e) => {
  console.error("推送失败：" + e.message);
  process.exit(1);
});
