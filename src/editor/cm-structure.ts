import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";

/**
 * 源码视图的**结构视觉**。
 *
 * 背景：所见即所得一侧，围栏代码块有底色+边框、表格有边框与表头底色、引用块有左侧竖线；
 * 而源码侧这些结构**全是纯文本** —— 同一份 Markdown 的两种呈现看起来像两个产品。
 *
 * `@codemirror/lang-markdown` 不给结构节点发 class（只发 token 标签），但语法树里
 * 有明确的节点类型（`FencedCode` / `Blockquote` / `Table` / `TableHeader` / `TableDelimiter`），
 * 于是可以按节点类型给对应**行**加 line decoration：
 *
 * - 用 `Decoration.line()` 而不是 `Decoration.replace({block:true, widget})`：
 *   后者会把块内容替换成静态文本 widget，**源码就不能编辑了**；
 *   line decoration 只给整行加 class，相邻行的底色/左边框自然连成一片。
 */
function buildDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const markLines = (cls: string, from: number, to: number) => {
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    for (let n = first; n <= last; n++) {
      decos.push(Decoration.line({ class: cls }).range(state.doc.line(n).from));
    }
  };

  syntaxTree(state).iterate({
    enter: (node) => {
      switch (node.name) {
        case "FencedCode":
        case "CodeBlock":
          markLines("mw-src-fence", node.from, node.to);
          break;
        case "Blockquote":
          markLines("mw-src-quote", node.from, node.to);
          break;
        case "Table":
          markLines("mw-src-table", node.from, node.to);
          break;
        case "TableHeader":
          markLines("mw-src-th", node.from, node.to);
          break;
        case "TableDelimiter":
          markLines("mw-src-td", node.from, node.to);
          break;
        default:
          break;
      }
    },
  });
  return Decoration.set(decos, true);
}

/**
 * 源码视图的结构装饰插件。
 *
 * 与 `cm-theme.ts` 的 token 配色配合，构成「源码编辑器」的完整观感：
 * token 颜色（谁是什么）+ 结构视觉（代码块/表格/引用长什么样）。
 */
export const markdownStructureDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: { state: EditorState }) {
      this.decorations = buildDecorations(view.state);
    }

    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildDecorations(u.state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
