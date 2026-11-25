import { markdown } from "./extensions";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";

/**
 * 富文本光标位置 → Markdown 文本偏移。
 *
 * 用于「在源码模式里把光标放到同一个字上」：把光标之前的文档切出来序列化，
 * 得到的字符串长度就是该位置在 Markdown 源文本里的字符偏移。
 */
export function pmPosToTextOffset(doc: import("@tiptap/pm/model").Node, pos: number): number {
  try {
    const clamped = Math.max(0, Math.min(pos, doc.content.size));
    return markdown.serialize(doc.cut(0, clamped).toJSON()).length;
  } catch {
    return 0;
  }
}

/**
 * 恢复富文本光标。
 *
 * 文档长度没变（源码模式里没改内容）时按绝对位置精确还原；改过内容时按比例
 * 估算——精确映射需要把文本偏移反解成 PM 位置，代价与复杂度都不划算，
 * 而比例估算在常见场景（改了开头几行）已经足够接近。
 */
export function restoreCaret(
  ed: import("@tiptap/core").Editor,
  saved: { pos: number; size: number }
): void {
  const size = ed.state.doc.content.size;
  const target =
    saved.size === size
      ? Math.min(saved.pos, size)
      : Math.min(Math.round((saved.pos / Math.max(saved.size, 1)) * size), size);
  try {
    ed.commands.setTextSelection(target);
  } catch {
    /* 位置落在非文本块上时忽略 */
  }
}


/**
 * 把选区收成**折叠的光标**。
 *
 * 为什么必须做：`setContent` / `replaceWith(0, size, …)` 是**整篇替换**，
 * ProseMirror 会把选区映射成**整个新文档**。若此时编辑器仍持有焦点
 * （例如用户在写文档时外部文件变更触发了重载，或从随航模式切回），
 * 用户下一个按键就会把**整篇替换成那个字符** —— 实测切回标签后敲一个 "X"，
 * 文档从「标题正文内容。」变成「X」，内容直接没了。
 *
 * 折叠到文档开头是保守但安全的：不会误删内容。
 * （更理想的是**按标签记住光标位置**，属后续增强，不在本轮范围内。）
 */
export function collapseSelection(ed: Editor): void {
  try {
    const pos = Math.min(1, ed.state.doc.content.size);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(pos), 1)));
  } catch {
    // 位置不合法时忽略 —— 选区保持原样也比抛错好
  }
}
