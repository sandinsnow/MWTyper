import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  addRowBefore,
  addRowAfter,
  addColumnBefore,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  selectedRect,
} from "prosemirror-tables";

type TableCmd = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

export function selectionInTable(editor: Editor | null): boolean {
  if (!editor) return false;
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.spec.tableRole) return true;
  }
  return false;
}

/**
 * 「删行」是否可用。
 *
 * prosemirror-tables 的 deleteRow 在**只有一行**时会把操作吞掉（内部 guard
 * 直接 return false），但它对调用方的返回值仍是 true —— 也就是说按钮永远
 * 可点、点了没反应，是典型的「死按钮」。这里自己算一遍选中矩形来判断。
 */
function canDeleteRow(editor: Editor): boolean {
  try {
    const rect = selectedRect(editor.state);
    return !(rect.top === 0 && rect.bottom === rect.map.height);
  } catch {
    return false;
  }
}

/** 「删列」是否可用（整表只有一列时不可删） */
function canDeleteColumn(editor: Editor): boolean {
  try {
    const rect = selectedRect(editor.state);
    return !(rect.left === 0 && rect.right === rect.map.width);
  } catch {
    return false;
  }
}

interface ButtonDef {
  label: string;
  title: string;
  cmd: TableCmd;
  /** 该按钮当前是否可执行（不可执行时置 disabled，避免「死按钮」） */
  enabled: (editor: Editor) => boolean;
}

const always = (editor: Editor) => {
  try {
    return editor.state.selection.$head.depth > 0;
  } catch {
    return false;
  }
};

const BUTTONS: ButtonDef[] = [
  { label: "行↑", title: "上方插入行", cmd: addRowBefore, enabled: always },
  { label: "行↓", title: "下方插入行", cmd: addRowAfter, enabled: always },
  { label: "列←", title: "左侧插入列", cmd: addColumnBefore, enabled: always },
  { label: "列→", title: "右侧插入列", cmd: addColumnAfter, enabled: always },
  { label: "删行", title: "删除当前行", cmd: deleteRow, enabled: canDeleteRow },
  { label: "删列", title: "删除当前列", cmd: deleteColumn, enabled: canDeleteColumn },
  { label: "删表", title: "删除整个表格", cmd: deleteTable, enabled: always },
];

export default function TableToolbar({ editor }: { editor: Editor }) {
  const run = (cmd: TableCmd) => () => {
    cmd(editor.state, editor.view.dispatch, editor.view);
    editor.view.focus();
  };
  return (
    <div className="table-toolbar" role="toolbar" aria-label="表格操作">
      <span className="table-toolbar-label" aria-hidden="true">表格</span>
      {BUTTONS.map((b) => {
        const ok = b.enabled(editor);
        return (
          <button
            key={b.label}
            title={b.title}
            aria-label={b.title}
            disabled={!ok}
            onClick={run(b.cmd)}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
