import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * WebView2 只需 woff2：裁剪 KaTeX CSS 的 woff/ttf 回退源，避免打包 59 个字体文件。
 * 对 `katex.min.css?raw`（export.ts 内嵌导出用）同样生效，其 woff2 内嵌逻辑不受影响。
 */
const katexWoff2Only: Plugin = {
  name: "katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("katex.min.css")) return null;
    return code.replace(
      /,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g,
      ""
    );
  },
};

export default defineConfig({
  plugins: [katexWoff2Only, react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/node_modules/**", "**/dist/**", "**/target/**", "**/spikes/**"],
    },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("katex")) return "vendor-katex";
          if (id.includes("highlight.js")) return "vendor-hljs";
          if (id.includes("@codemirror") || id.includes("/codemirror/") || id.includes("@lezer")) return "vendor-codemirror";
          if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("orderedmap") || id.includes("rope-sequence") || id.includes("w3c-keyname")) return "vendor-tiptap";
          if (id.includes("/react/") || id.includes("react-dom") || id.includes("scheduler")) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
