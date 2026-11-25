import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { api } from "../ipc";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/bmp"];

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// SPEC §5.1：图片粘贴/拖拽 → 复制到工作区 assets/ 并插入相对路径；
// 无工作区且无文件路径时退化为 data URL（浏览器预览/未保存草稿场景）。
export function imageAssets(getBaseDir: () => string | null, onError?: (message: string) => void) {
  return Extension.create({
    name: "imageAssets",
    addProseMirrorPlugins() {
      const editor = this.editor;
      const insert = async (files: File[], view: EditorView, dropPos: number | null) => {
        // 逐张递增插入位置：多图拖拽时不再全部堆到同一个 dropPos。
        let nextPos = dropPos ?? view.state.selection.from;
        for (const file of files) {
          try {
            const buf = await file.arrayBuffer();
            const b64 = toBase64(buf);
            const base = getBaseDir();
            let src: string;
            if (base) {
              src = await api.saveImageAsset(base, file.name || "image.png", b64);
            } else {
              src = `data:${file.type};base64,${b64}`;
            }
            const at = Math.max(0, Math.min(nextPos, editor.state.doc.content.size));
            editor.chain().focus().insertContentAt(at, { type: "image", attrs: { src, alt: file.name } }).run();
            // image 节点 nodeSize = 1，下一张插入到其后。
            nextPos = at + 1;
          } catch (err) {
            onError?.(`插入图片「${file.name || "未命名"}」失败：${err}`);
          }
        }
      };
      const imageFiles = (list: FileList | null | undefined): File[] =>
        Array.from(list || []).filter((f) => IMAGE_TYPES.includes(f.type));

      return [
        new Plugin({
          props: {
            handlePaste: (view, event) => {
              const files = imageFiles(event.clipboardData?.files);
              if (!files.length) return false;
              event.preventDefault();
              void insert(files, view, null);
              return true;
            },
            handleDrop: (view, event, _slice, moved) => {
              if (moved) return false;
              const files = imageFiles(event.dataTransfer?.files);
              if (!files.length) return false;
              event.preventDefault();
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              void insert(files, view, coords ? coords.pos : null);
              return true;
            },
          },
        }),
      ];
    },
  });
}
