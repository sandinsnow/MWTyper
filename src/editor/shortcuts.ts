import { Extension, type Editor } from "@tiptap/core";

type Level = 1 | 2 | 3 | 4 | 5 | 6;
type LinkPrompt = (message: string, defaultValue: string) => string | null | Promise<string | null>;

/** App 注入的链接输入器（PromptDialog）；未注入时只在无 UI 的测试宿主中回退。 */
let linkPromptImpl: LinkPrompt | null = null;

export function setLinkPrompt(fn: LinkPrompt | null): void {
  linkPromptImpl = fn;
}

function applyLink(editor: Editor, href: string | null, from: number, to: number): void {
  if (href === null) return;
  if (href === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }
  if (from === to) {
    editor
      .chain()
      .focus()
      .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
      .run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

// SPEC §7：Ctrl+1…6 标题 / Ctrl+0 正文 / Ctrl+K 链接（StarterKit 默认是 Mod+Alt+数字，不符）
export const MwtyperShortcuts = Extension.create({
  name: "mwtyperShortcuts",
  addKeyboardShortcuts() {
    const heading = (level: Level) => () =>
      this.editor.chain().focus().toggleHeading({ level }).run();
    return {
      "Mod-1": heading(1),
      "Mod-2": heading(2),
      "Mod-3": heading(3),
      "Mod-4": heading(4),
      "Mod-5": heading(5),
      "Mod-6": heading(6),
      "Mod-0": () => this.editor.chain().focus().setParagraph().run(),
      "Mod-k": () => {
        const { from, to } = this.editor.state.selection;
        const previous = this.editor.getAttributes("link").href as string | undefined;
        // 仅在未注入 App 弹窗的 headless 测试宿主中同步回退；真实运行时始终走 PromptDialog。
        const ask: LinkPrompt =
          linkPromptImpl ??
          ((message, defaultValue) => globalThis.window?.prompt?.(message, defaultValue) ?? null);
        const result = ask("链接地址", previous || "https://");
        if (result && typeof (result as Promise<string | null>).then === "function") {
          void (result as Promise<string | null>).then((href) => applyLink(this.editor, href, from, to)).catch(() => {});
        } else {
          applyLink(this.editor, result as string | null, from, to);
        }
        return true;
      },
    };
  },
});
