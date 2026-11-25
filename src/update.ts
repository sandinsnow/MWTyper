/**
 * 检查更新：查询 GitHub Releases 的**最新正式版本**，与本地版本比对。
 *
 * 为什么走 GitHub REST API 而不是下载资产直链：
 *   资产直链（releases/download/…）会 302 跳到 CDN，浏览器 fetch 常因缺 CORS 头失败；
 *   `api.github.com` 返回 `Access-Control-Allow-Origin: *`，可直接在 WebView 里取。
 *   CI 另外发布的 `latest.json` 供将来的 Rust 端自替换更新器使用（无 CORS 限制）。
 *
 * 为什么不需要 Rust 侧 HTTP 客户端：
 *   联网发生在 WebView2 里（浏览器自带 fetch），Rust 侧只负责「调起系统浏览器打开下载页」。
 *   这样既保持了「Rust 后端零 HTTP 依赖」的离线约束，又让检查更新真正查的是**远端**。
 *
 * 唯一的联网行为是用户主动点「立即检查」；不自动轮询、不上报任何数据。
 */
export const REPO = "sandinsnow/MWTyper";
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

/** 远端最新版本信息 */
export interface LatestInfo {
  version: string;
  /** 下载地址（Release 里的 MWTyper.exe 资产） */
  url?: string;
  /** 发布说明（Release 正文） */
  notes?: string;
  /** 发布时间（ISO 8601） */
  publishedAt?: string;
}

/**
 * 比较两个语义化版本号：a > b 返回 1，a < b 返回 -1，相等返回 0。
 *
 * 按 SemVer 2.0 的优先级规则实现：
 *   1. 先比「主版本.次版本.修订号」三段（**按数值**，不是字典序）；
 *   2. 三段相同时，**带预发布标记的版本更旧**（`0.1.0-beta < 0.1.0`）；
 *   3. 两者都是预发布版时，逐段比较预发布标识符（数字段按数值、字母段按字典序，
 *      段少的更旧）；
 *   4. `+build` 构建元数据**不参与**优先级比较（SemVer 规定）。
 *
 * ⚠️ 为什么不能用「把整串按 `.`/`-`/`+` 切开后逐段取数字」：
 *   那样 `0.1.0-beta.2` 会变成 [0,1,0,0,2]、`0.1.0` 变成 [0,1,0]，
 *   补齐后第 5 位 2 > 0 → **得出「预发布版比正式版新」的反向结论**，
 *   于是本地跑预发布版时永远收不到正式版的更新提示。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) => {
    const raw = String(s).trim().replace(/^v/, "");
    // 构建元数据（+ 之后）不参与比较，先剥掉
    const plus = raw.indexOf("+");
    const noBuild = plus >= 0 ? raw.slice(0, plus) : raw;
    // 预发布标识（- 之后）
    const dash = noBuild.indexOf("-");
    const core = dash >= 0 ? noBuild.slice(0, dash) : noBuild;
    const pre = dash >= 0 ? noBuild.slice(dash + 1) : "";
    const nums = core.split(".").map((x) => parseInt(x, 10) || 0);
    return { nums, pre };
  };

  const A = parse(a);
  const B = parse(b);
  const n = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < n; i++) {
    const x = A.nums[i] ?? 0;
    const y = B.nums[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }

  // 核心版本相同：正式版 > 预发布版
  const aPre = A.pre.length > 0;
  const bPre = B.pre.length > 0;
  if (aPre !== bPre) return aPre ? -1 : 1;
  if (!aPre) return 0;

  // 同为预发布版：逐段比较标识符
  const pa = A.pre.split(".");
  const pb = B.pre.split(".");
  const m = Math.max(pa.length, pb.length);
  for (let i = 0; i < m; i++) {
    if (pa[i] === undefined) return -1; // 段少的一方更旧
    if (pb[i] === undefined) return 1;
    const na = parseInt(pa[i], 10);
    const nb = parseInt(pb[i], 10);
    const aNum = !Number.isNaN(na);
    const bNum = !Number.isNaN(nb);
    if (aNum && bNum) {
      if (na !== nb) return na > nb ? 1 : -1;
    } else if (aNum !== bNum) {
      // 数字段优先级低于字母段（SemVer：纯数字标识符 < 含字母的标识符）
      return aNum ? -1 : 1;
    } else if (pa[i] !== pb[i]) {
      return pa[i] > pb[i] ? 1 : -1;
    }
  }
  return 0;
}

/**
 * 拉取远端最新版本信息。
 *
 * @param signal 调用方传入的中断信号 —— 断网/被墙时 fetch 可能长时间挂起，
 *               必须能被超时或用户取消打断。
 */
export async function fetchLatest(signal?: AbortSignal): Promise<LatestInfo> {
  // Accept: application/json 属 CORS 安全头，不触发预检 → 简单 GET。
  const res = await fetch(API_LATEST, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const tag = String(j?.tag_name ?? "");
  const assets: { name?: string; browser_download_url?: string }[] = Array.isArray(j?.assets)
    ? j.assets
    : [];
  const exe = assets.find((a) => a?.name === "MWTyper.exe");
  return {
    version: tag.replace(/^v/, ""),
    url: exe?.browser_download_url,
    notes: typeof j?.body === "string" && j.body.trim() ? j.body : undefined,
    publishedAt: typeof j?.published_at === "string" ? j.published_at : undefined,
  };
}
