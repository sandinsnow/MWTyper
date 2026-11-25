// M1 验证：浏览器 mock IPC 链路（pnpm dev 预览后端）。
// jsdom 提供 localStorage；真实 Tauri 命令链由 cargo test 覆盖（11/11）。
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "localStorage"]) {
  Object.defineProperty(globalThis, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`OK ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

async function main() {
  const { api, isTauri, dirname, basename } = await import("../src/ipc");
  ok("环境判定为浏览器 mock", !isTauri);

  const tree = await api.listTree("/demo");
  ok("mock 树含种子文件", JSON.stringify(tree).includes("欢迎.md"));
  ok("mock 树含子目录", tree.children?.some((c) => c.kind === "dir" && c.name === "笔记") === true);

  const text = await api.readFile("/demo/欢迎.md");
  ok("读取种子文件", text.includes("欢迎使用 MWTyper"));

  await api.saveFile("/demo/新文件.md", "# 新文件\n\n正文。\n");
  ok("保存后可读回", (await api.readFile("/demo/新文件.md")).includes("# 新文件"));
  const tree2 = await api.listTree("/demo");
  ok("保存后树刷新可见", JSON.stringify(tree2).includes("新文件.md"));

  await api.renamePath("/demo/新文件.md", "/demo/改名.md");
  let threw = false;
  try {
    await api.readFile("/demo/新文件.md");
  } catch {
    threw = true;
  }
  ok("重命名：旧路径失效", threw);
  ok("重命名：新路径可读", (await api.readFile("/demo/改名.md")).includes("# 新文件"));

  const trash = await api.deletePath("/demo/改名.md", "/demo");
  ok("删除进 trash 而非物理删除", trash.includes(".mwtyper/trash/"));
  ok("trash 内容可恢复", (await api.readFile(trash)).includes("# 新文件"));

  const rel = await api.saveImageAsset("/demo", "photo.png", "aGVsbG8=");
  ok("图片资产返回相对路径", rel.startsWith("assets/") && rel.endsWith(".png"));
  ok("图片资产落盘 mock fs", (await api.readFile(`/demo/${rel}`)).startsWith("data:image/"));

  const s = await api.stats("你好世界 hello world\n");
  ok("mock 统计中英混排", s.words === 6, `words=${s.words}`);

  await api.writeSettings({ theme: "dark", autosave_ms: 1000, recent_files: ["/demo/欢迎.md"], sidebar_open: false });
  const loaded = await api.readSettings();
  ok("设置持久化往返", loaded.theme === "dark" && loaded.sidebar_open === false);

  ok("dirname/basename", dirname("D:/a/b.md") === "D:/a" && basename("D:/a/b.md") === "b.md");

  console.log(`\n== M1 mock IPC：${pass}/${pass + fail} PASS ==`);
  if (fail > 0) process.exit(1);
}

void main();