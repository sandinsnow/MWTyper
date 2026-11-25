// 「检查更新」核心逻辑的回归守卫：版本比对 + 远端 Release 响应解析。
//
// 运行：node node_modules/tsx/dist/cli.mjs tests/spikes/update-probe.ts
//
// 为什么单独写探针而不是靠浏览器闸门：浏览器闸门只能覆盖「点按钮 → UI 变化」，
// 而版本比对的边界（v 前缀 / 预发布后缀 / 位数不齐）与响应解析的字段映射
// 必须在纯函数层逐条钉死。
import { compareVersions, fetchLatest } from "../../src/update";

let pass = 0;
let fail = 0;
function check(cond: boolean, name: string, detail = ""): void {
  if (cond) { pass++; console.log(`OK  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`!!  ${name}${detail ? " — " + detail : ""}`); }
}

// ── 1) 版本比对 ────────────────────────────────────────────────────────────
console.log("=== 版本比对 ===");
check(compareVersions("0.2.0", "0.1.0") === 1, "U-1 0.2.0 > 0.1.0");
check(compareVersions("0.1.0", "0.2.0") === -1, "U-2 0.1.0 < 0.2.0");
check(compareVersions("0.1.0", "0.1.0") === 0, "U-3 相同版本为 0");
check(compareVersions("v0.2.0", "0.1.0") === 1, "U-4 容忍 v 前缀");
check(compareVersions("0.10.0", "0.9.0") === 1, "U-5 按数值比而非字典序（0.10 > 0.9）");
check(compareVersions("0.1", "0.1.0") === 0, "U-6 位数不齐按 0 补齐");
check(compareVersions("1.0.0", "0.9.9") === 1, "U-7 主版本优先");
check(compareVersions("", "0.1.0") === -1, "U-8 空串当作 0.0.0");
// 预发布版的优先级**低于**正式版（SemVer）：本地跑 0.1.0-beta 时必须能收到
// 远端 0.1.0 的更新提示 —— 若这里判成「预发布更新」，提示就永远不出现。
check(compareVersions("0.1.0-beta.2", "0.1.0") === -1, "U-9 预发布版 < 正式版");
check(compareVersions("0.1.0", "0.1.0-beta.2") === 1, "U-9b 正式版 > 预发布版");
check(compareVersions("0.1.0-beta.2", "0.1.0-beta.10") === -1, "U-9c 预发布标识按数值比（beta.2 < beta.10）");
check(compareVersions("0.1.0-beta", "0.1.0-alpha") === 1, "U-9d 字母标识按字典序比（alpha < beta）");
check(compareVersions("0.1.0+build7", "0.1.0") === 0, "U-10 构建元数据不参与比较");

// ── 2) 远端响应解析 ────────────────────────────────────────────────────────
console.log("=== 远端 Release 响应解析 ===");

const realFetch = globalThis.fetch;
type FetchArgs = { url: string; init?: RequestInit };
let lastArgs: FetchArgs | null = null;

function mockFetch(body: unknown, ok = true, status = 200): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    lastArgs = { url, init };
    return {
      ok,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

const sample = {
  tag_name: "v0.2.0",
  body: "修复了若干问题",
  published_at: "2026-11-25T10:00:00Z",
  assets: [
    { name: "MWTyper.exe.sha256", browser_download_url: "https://example.com/MWTyper.exe.sha256" },
    { name: "MWTyper.exe", browser_download_url: "https://example.com/MWTyper.exe" },
  ],
};

mockFetch(sample);
const info = await fetchLatest();
check(info.version === "0.2.0", "U-11 tag_name 去掉 v 前缀", info.version);
check(info.url === "https://example.com/MWTyper.exe", "U-12 从 assets 里挑出 MWTyper.exe", info.url ?? "");
check(info.notes === "修复了若干问题", "U-13 body 映射为 notes", info.notes ?? "");
check(info.publishedAt === "2026-11-25T10:00:00Z", "U-14 published_at 映射为 publishedAt", info.publishedAt ?? "");
check(
  !!lastArgs && lastArgs.url.includes("api.github.com") && lastArgs.url.includes("sandinsnow/MWTyper"),
  "U-15 请求打到本仓库的 GitHub Releases 接口",
  lastArgs?.url ?? ""
);
check(
  !!lastArgs && (lastArgs.init?.headers as Record<string, string> | undefined)?.Accept === "application/json",
  "U-16 请求头 Accept: application/json（免预检）"
);

// 空 body / 非字符串 notes → 不应变成 "undefined" 之类的脏数据
mockFetch({ tag_name: "v1.0.0", body: "   ", published_at: null, assets: [] });
const info2 = await fetchLatest();
check(info2.notes === undefined, "U-17 空白正文不作为 notes", String(info2.notes));
check(info2.publishedAt === undefined, "U-18 非字符串 published_at 被忽略", String(info2.publishedAt));
check(info2.url === undefined, "U-19 没有 MWTyper.exe 资产时 url 为 undefined", String(info2.url));

// 缺 tag_name → version 为空串（调用方据此判定「远端返回异常」）
mockFetch({ body: "x" });
const info3 = await fetchLatest();
check(info3.version === "", "U-20 缺 tag_name 时 version 为空串", info3.version);

// HTTP 错误必须抛出，交给调用方显示「检查失败」
mockFetch({}, false, 404);
let threw = false;
try {
  await fetchLatest();
} catch (e) {
  threw = true;
  check(String(e).includes("404"), "U-21 HTTP 错误抛出并带上状态码", String(e));
}
check(threw, "U-21b HTTP 错误确实抛出");

// AbortSignal 必须透传给 fetch（断网/被墙时能被打断）
mockFetch(sample);
const ctrl = new AbortController();
await fetchLatest(ctrl.signal);
check(
  !!lastArgs && lastArgs.init?.signal === ctrl.signal,
  "U-22 AbortSignal 透传给 fetch"
);

globalThis.fetch = realFetch;

console.log(`\n总计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
console.log(fail === 0 ? "== 结论：检查更新核心逻辑全部通过 ==" : "== 结论：存在失败项 ==");
process.exit(fail === 0 ? 0 : 1);
