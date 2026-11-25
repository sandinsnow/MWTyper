import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { markdown } from "../editor/extensions";

interface Props {
  editor: Editor | null;
  mode: "wysiwyg" | "source" | "split";
  sourceText: string;
  onJump: (index: number) => void;
}

interface Heading {
  level: number;
  text: string;
}

function fromDoc(editor: Editor): { headings: Heading[]; active: number } {
  const headings: Heading[] = [];
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({ level: node.attrs.level as number, text: node.textContent });
      positions.push(pos);
    }
    return true;
  });
  const cursor = editor.state.selection.from;
  let active = -1;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] <= cursor) active = i;
  }
  return { headings, active };
}

/** JSON 节点的纯文本，覆盖 text / 数学公式 / 图片 alt，与 PM 的 textContent 语义对齐。 */
function textOf(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "inlineMath" || node.type === "blockMath") return String(node.attrs?.text ?? "");
  if (node.type === "image") return String(node.attrs?.alt ?? "");
  return (node.content ?? []).map(textOf).join("");
}

/** E16：源码模式也走同一份 markdown.parse，保证与 WYSIWYG 的标题顺序/索引一致。 */
function fromSource(text: string): Heading[] {
  const headings: Heading[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "heading") {
      headings.push({ level: Number(node.attrs?.level ?? 1), text: textOf(node) });
    }
    node.content?.forEach(visit);
  };
  visit(markdown.parse(text));
  return headings;
}

export default function Outline({ editor, mode, sourceText, onJump }: Props) {
  const { headings, active } =
    // 随航模式下事实源是源码，大纲跟随源码更贴近用户正在编辑的内容。
    mode === "wysiwyg" && editor ? fromDoc(editor) : { headings: fromSource(sourceText), active: -1 };

  if (!headings.length) return <div className="panel-empty">暂无标题<br />用 # 开头创建标题</div>;

  return (
    <div className="outline">
      {headings.map((h, i) => (
        <button
          key={i}
          className={"outline-item" + (i === active ? " active" : "")}
          style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
          onClick={() => onJump(i)}
          title={h.text}
        >
          {h.text || "（空标题）"}
        </button>
      ))}
    </div>
  );
}
