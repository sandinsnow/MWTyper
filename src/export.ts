import katex from "katex";
import katexCssRaw from "katex/dist/katex.min.css?raw";
import { api } from "./ipc";

const fontUrls = import.meta.glob("/node_modules/katex/dist/fonts/*.woff2", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

let cssPromise: Promise<string> | null = null;

// 单文件导出：KaTeX CSS 的 woff2 字体全部 base64 内嵌（离线可渲染，D5）
export function katexCssEmbedded(): Promise<string> {
  if (!cssPromise) {
    cssPromise = (async () => {
      let css = katexCssRaw;
      const names = [...new Set([...css.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g)].map((m) => m[1]))];
      for (const name of names) {
        const key = Object.keys(fontUrls).find((k) => k.endsWith("/" + name));
        if (!key) continue;
        const resp = await fetch(fontUrls[key]);
        const b64 = toBase64(await resp.arrayBuffer());
        css = css.split(`url(fonts/${name})`).join(`url(data:font/woff2;base64,${b64})`);
      }
      return css;
    })();
  }
  return cssPromise;
}

function renderSegment(seg: string): string {
  let out = seg.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) =>
    katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false, output: "html" })
  );
  out = out
    .split(/(`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\$([^$\n]+?)\$/g, (_, tex: string) =>
            katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false, output: "html" })
          )
    )
    .join("");
  return out;
}

// 公式 → KaTeX HTML 注入 md（Rust pulldown 的 Html/InlineHtml 事件透传）；代码块/行内代码不动
export function injectKatex(md: string): string {
  return md
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((seg, i) => (i % 2 === 1 ? seg : renderSegment(seg)))
    .join("");
}

export async function buildExportHtml(md: string, title: string, theme: string, baseDir: string, userCss = ""): Promise<string> {
  const extraCss = (await katexCssEmbedded()) + (userCss ? "\n" + userCss : "");
  return api.exportHtml(injectKatex(md), title, theme, extraCss, baseDir, true);
}

// PDF 走系统打印通道（SPEC §5.4）：隐藏 iframe srcdoc → print，用户在对话框选「另存为 PDF」
export function printHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.width = "860px";
  iframe.style.height = "600px";
  iframe.srcdoc = html;
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    iframe.remove();
  };
  document.body.append(iframe);
}