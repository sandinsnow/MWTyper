import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const focusKey = new PluginKey<DecorationSet>("mwtyperFocus");

/**
 * 找出「顶层块」：pos 落在某块内或其后紧邻的块；pos 在文档末尾则取最后一块。
 *
 * 为什么需要它：`$pos.depth === 0` 表示位置不在任何块内部（文档开头、
 * 两个顶层块之间的空隙、或选中了整块节点）。此时 `$pos.before(1)` /
 * `$pos.node(1)` 都不可用，旧的实现直接返回空 DecorationSet → 光标停在
 * 文档最开头时**整篇文档都没有当前段落高亮**，专注模式形同失效。
 */
function topLevelBlockAt(
  doc: ProseMirrorNode,
  pos: number
): { node: ProseMirrorNode; start: number } | null {
  let last: { node: ProseMirrorNode; start: number } | null = null;
  let hit: { node: ProseMirrorNode; start: number } | null = null;
  doc.forEach((child, offset) => {
    const rec = { node: child, start: offset };
    last = rec;
    if (hit) return;
    // 块覆盖 [offset, offset + nodeSize)；pos < 块尾 即表示该块覆盖 pos 或紧随其后
    if (pos < offset + child.nodeSize) hit = rec;
  });
  return hit ?? last;
}

function currentBlockDeco(doc: ProseMirrorNode, pos: number): DecorationSet {
  if (doc.childCount === 0) return DecorationSet.empty;
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  if ($pos.depth === 0) {
    const block = topLevelBlockAt(doc, pos);
    if (!block) return DecorationSet.empty;
    return DecorationSet.create(doc, [
      Decoration.node(block.start, block.start + block.node.nodeSize, { class: "focus-current" }),
    ]);
  }
  const start = $pos.before(1);
  const node = $pos.node(1);
  return DecorationSet.create(doc, [Decoration.node(start, start + node.nodeSize, { class: "focus-current" })]);
}

// 专注模式：当前顶层块标 focus-current，其余由 CSS 降透明度（SPEC §5.6.3）
export function focusMode(isEnabled: () => boolean) {
  return Extension.create({
    name: "mwtyperFocus",
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: focusKey,
          state: {
            init: (_, { doc }) => (isEnabled() ? currentBlockDeco(doc, 0) : DecorationSet.empty),
            apply: (tr, old) => {
              if (!isEnabled()) return DecorationSet.empty;
              if (tr.docChanged || tr.selectionSet || tr.getMeta("mwtyperFocusToggle")) {
                return currentBlockDeco(tr.doc, tr.selection.head);
              }
              return old.map(tr.mapping, tr.doc);
            },
          },
          props: {
            decorations: (state) => focusKey.getState(state),
          },
        }),
      ];
    },
  });
}