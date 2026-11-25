import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import DOMPurify from "dompurify";

// HTML 粘贴：dompurify 清洗（script/事件属性/javascript: 协议）后按 schema 解析，保留格式。
// 图片文件粘贴让位给 imageAssets 插件（插件顺序在前）。
export const htmlPaste = Extension.create({
  name: "mwtyperHtmlPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const html = event.clipboardData?.getData("text/html");
            if (!html || event.clipboardData?.files?.length) return false;
            const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
            const container = document.createElement("div");
            container.innerHTML = clean;
            const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(container);
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});