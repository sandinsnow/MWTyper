import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Markdown 标记符的专属配色
//
// 为什么要单独做：lezer-markdown 把 6 种标记符全部映射到**同一个** tag
// （`tags.processingInstruction`）：
//     HeaderMark / QuoteMark / ListMark / LinkMark / EmphasisMark / CodeMark
// → 所以 `HighlightStyle` 无论怎么写，它们拿到的都是同一个样式 class，
//    **无法分别着色**（实测：6 种标记符的 class 全是 `ͼo`）。
//    `Tag.define({ HeaderMark: true })` 也不行 —— 节点名落在 `set` 里，
//    `highlightTags()` 取不到。
//
// 可行路径（已实测验证）：走语法树按**节点名**找区间，用 `Decoration.mark`
// 加稳定的 class。与本项目 `src/editor/code-block.ts` 已有的 Decoration 范式一致。
//
// 配色写在 CSS 里（`.mw-HeaderMark` 等），两套主题各一组值。
// ---------------------------------------------------------------------------

/** 节点名 → 装饰。class 名是稳定契约，CSS 依赖它。 */
const MARK_DECO: Record<string, Decoration> = {
  HeaderMark: Decoration.mark({ class: "mw-HeaderMark" }),
  QuoteMark: Decoration.mark({ class: "mw-QuoteMark" }),
  ListMark: Decoration.mark({ class: "mw-ListMark" }),
  EmphasisMark: Decoration.mark({ class: "mw-EmphasisMark" }),
  CodeMark: Decoration.mark({ class: "mw-CodeMark" }),
  LinkMark: Decoration.mark({ class: "mw-LinkMark" }),
};

function buildDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const deco = MARK_DECO[node.name];
      if (deco) decos.push(deco.range(node.from, node.to));
    },
  });
  // 第二个参数 true = 按位置排序。mark 装饰区间可能重叠或嵌套，
  // 不排序 CM 会抛 "Decorations that replace line breaks" 一类的错。
  return Decoration.set(decos, true);
}

/**
 * 给 Markdown 标记符加专属 class 的视图插件。
 */
export const markdownMarkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: { state: EditorState }) {
      this.decorations = buildDecorations(view.state);
    }

    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
