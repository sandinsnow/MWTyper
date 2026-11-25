import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import { Mark, type Node as PMNode } from "@tiptap/pm/model";

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  matches: FindMatch[];
  current: number;
}

export const findKey = new PluginKey<FindState>("mwtyperFind");

const EMPTY: FindState = { query: "", caseSensitive: false, wholeWord: false, matches: [], current: 0 };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 「词边界」的判定字符集：**ASCII 单词字符 + Unicode 数字**。
 *
 * 两个坑都要避开：
 *
 * 1. 不能用 JS 正则的 `\b`：它基于 ASCII 的 `\w`，且要求边界两侧「一侧是 \w、一侧不是」。
 *    汉字属于非 \w 字符，于是 `"这是中文测试"` 里 "中文" 两侧都是非 \w →
 *    **没有边界** → `\b中文\b` 永远匹配不到（实测：普通匹配 2 处，
 *    开启「全词匹配」后直接归零）。这正是 VS Code 全词搜索对中文失效的同一原因。
 *
 * 2. 词字符**不含 Unicode 字母**（汉字/假名等不算），只有 ASCII 单词与数字算。
 *    这样「中文」在「这是中文测试」中仍能命中（前后是汉字，不是词字符），
 *    而「hello」在「hellox」中不命中（后接 ASCII 字母）——中英文语义一致。
 */
const WORD_CHAR = "\\w\\p{N}";
const WORD_START = "(?<![" + WORD_CHAR + "])";
const WORD_END = "(?![" + WORD_CHAR + "])";

// 逐文本节点匹配（跨节点命中不支持，与多数编辑器首版一致）
// ranges 省略 = 全文重算（等价性测试基准）；传入时只扫描受影响文本节点。
export function computeMatches(
  doc: PMNode,
  query: string,
  cs: boolean,
  ww: boolean,
  ranges?: { from: number; to: number }[]
): FindMatch[] {
  if (!query) return [];
  let pat = escapeRegex(query);
  if (ww) pat = WORD_START + pat + WORD_END;
  // `u` flag 是使用 \p{...} 字符类的前提
  const re = new RegExp(pat, cs ? "gu" : "giu");
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    // 注意：ProseMirror 的 descendants 回调返回 false 表示「不再下潜该节点的子树」。
    // 非文本节点（段落/标题/列表项）必须返回 true 继续下降，否则其内部文本节点永不被访问，
    // 匹配集合恒为空（E01 根因，QA 于 M3 回归中发现）。
    if (!node.isText || !node.text) return true;
    // 范围过滤同样返回 true：范围外的文本节点不应终止对后续兄弟节点的遍历。
    if (ranges && !ranges.some((r) => pos <= r.to && pos + node.nodeSize >= r.from)) return true;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.text))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ from: pos + m.index, to: pos + m.index + m[0].length });
    }
    return false;
  });
  return out;
}

/** 当前 PM 版本无 tr.changes；用各 StepMap 的 forEach 还原新旧改动区间。 */
function transactionChangedRanges(tr: Transaction): { newFrom: number; newTo: number }[] {
  const pairs: { newFrom: number; newTo: number }[] = [];
  for (let i = 0; i < tr.mapping.maps.length; i++) {
    const after = tr.mapping.slice(i + 1);
    tr.mapping.maps[i].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      pairs.push({
        newFrom: after.map(newStart, -1),
        newTo: after.map(newEnd, 1),
      });
    });
  }
  return pairs;
}

/**
 * 增量匹配：受影响的文本窗口重新扫描，窗口外的旧命中经 mapping 平移保留。
 * 窗口按 query.length-1 向两侧扩张，保证跨改动边界的命中被重算。
 */
export function incrementalMatches(
  previous: FindMatch[],
  tr: Transaction,
  query: string,
  cs: boolean,
  ww: boolean
): FindMatch[] {
  if (!query) return [];
  if (!tr.docChanged) return previous;
  const pairs = transactionChangedRanges(tr);
  if (!pairs.length) return previous;
  const pad = Math.max(0, query.length - 1);
  const size = tr.doc.content.size;
  const scan = pairs.map((p) => ({
    from: Math.max(0, p.newFrom - pad),
    to: Math.min(size, p.newTo + pad),
  }));
  const fresh = computeMatches(tr.doc, query, cs, ww, scan);
  const inScan = (m: FindMatch): boolean =>
    scan.some((r) => m.from <= r.to && m.to >= r.from);
  const mapped = previous
    .map((m) => ({ from: tr.mapping.map(m.from), to: tr.mapping.map(m.to, -1) }))
    .filter((m) => !inScan(m));
  const all = [...mapped, ...fresh].sort((a, b) => a.from - b.from || a.to - b.to);
  return all.filter((m, i) => i === 0 || m.from !== all[i - 1].from || m.to !== all[i - 1].to);
}

/**
 * 替换文本规范化。
 *
 * `<input type="text">` 粘贴多行文本时浏览器会自动去掉换行，但替换文本也可能经由
 * 脚本注入含换行。若直接 `schema.text("a\nb")`，ProseMirror 会在段落内造出一个**含
 * 换行的文本节点**——不抛异常，但序列化后一个段落被拆成两个（实测：
 * `"第一行\n第二行 world"`），Markdown 结构就此错乱。故此处统一把换行折叠为空格。
 */
export function normalizeReplacement(text: string): string {
  return text.replace(/\r\n?|\n/g, " ");
}

/**
 * 把 [from, to] 区间按 **mark 边界**切成若干段，每段携带自己的 marks。
 *
 * 为什么必须分段：直接 `schema.text(replacement)`（无 marks）替换整个区间会丢掉区间上
 * 的全部 mark，并把相邻的同 mark 文本合并掉。实测后果：
 *   - `[链接文字](https://example.com)` 替换「链接文字」→ 整条链接连 URL 一起消失，
 *     序列化成纯文本 "新文字"；
 *   - `**粗体词** 和普通词` 替换「粗体词」→ 整段的加粗一起消失，
 *     序列化成 "替换后 和普通词"。
 * 两者都是**静默的 Markdown 语义丢失**，用户存盘后才可能察觉。
 */
function splitByMarkBoundaries(
  doc: PMNode,
  from: number,
  to: number
): { from: number; to: number; marks: readonly Mark[] }[] {
  const segments: { from: number; to: number; marks: readonly Mark[] }[] = [];
  let current: { from: number; to: number; marks: readonly Mark[] } | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const nodeFrom = pos;
    const nodeTo = pos + node.nodeSize;
    const segFrom = Math.max(nodeFrom, from);
    const segTo = Math.min(nodeTo, to);
    if (segFrom >= segTo) return false;
    const marks = node.marks;
    if (current && current.to === segFrom && Mark.sameSet(current.marks, marks)) {
      current.to = segTo;
    } else {
      current = { from: segFrom, to: segTo, marks };
      segments.push(current);
    }
    return false;
  });
  return segments;
}

/**
 * 保留 mark 的区间替换。
 *
 * 区间内部按 mark 边界分段，每段用该段原有的 marks 构造新文本节点；
 * 从后往前替换，保证前面各段的原始位置不被前面的替换影响。
 * 替换文本本身**不解析 Markdown 语法**（与 VS Code / 浏览器查找替换一致）。
 */
function replacePreservingMarks(
  tr: Transaction,
  doc: PMNode,
  from: number,
  to: number,
  replacement: string
): void {
  const schema = doc.type.schema;
  const segments = splitByMarkBoundaries(doc, from, to);
  if (!segments.length) {
    if (replacement) tr.replaceWith(from, to, schema.text(replacement));
    else tr.delete(from, to);
    return;
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (replacement) {
      tr.replaceWith(seg.from, seg.to, schema.text(replacement, seg.marks as Mark[]));
    } else {
      tr.delete(seg.from, seg.to);
    }
  }
}

/**
 * 整个文档被替换掉了吗？
 *
 * tiptap 的 `setContent` 用 `tr.replaceWith(0, doc.content.size, newDoc)` 实现
 * （见 @tiptap/core/src/commands/setContent.ts），即**单个覆盖全文档的 ReplaceStep**。
 * 这类事务不能用「增量映射」更新匹配：旧的匹配区间全部落在被替换掉的内容上，
 * 映射后的结果既不是新文档里的匹配，也不是空 —— 表现为
 * **切换到另一个文件后，查找高亮还停留在上一个文件的位置上**。
 *
 * 同理，用户「全选 + 输入」也是单个覆盖全文档的步骤，同样需要重算。
 */
export function isDocumentReplaced(tr: Transaction): boolean {
  if (tr.steps.length !== 1) return false;
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep)) return false;
  return step.from === 0 && step.to === tr.docs[0].content.size;
}

export const findReplace = Extension.create({
  name: "mwtyperFindReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            let next = meta ? { ...value, ...meta } : value;
            const flagsChanged =
              meta && (meta.query !== undefined || meta.caseSensitive !== undefined || meta.wholeWord !== undefined);
            if (flagsChanged) {
              // 查询词/标志变化属于用户显式请求，走全文重算。
              const matches = computeMatches(tr.doc, next.query, next.caseSensitive, next.wholeWord);
              const current = matches.length ? Math.min(Math.max(0, next.current), matches.length - 1) : 0;
              next = { ...next, matches, current };
            } else if (tr.docChanged && isDocumentReplaced(tr)) {
              // 整个文档被换掉（切换文件 / 全选重输）：增量映射的结果已失效，必须重算。
              const matches = computeMatches(tr.doc, next.query, next.caseSensitive, next.wholeWord);
              const current = matches.length ? Math.min(Math.max(0, next.current), matches.length - 1) : 0;
              next = { ...next, matches, current };
            } else if (tr.docChanged) {
              const matches = incrementalMatches(
                value.matches,
                tr,
                next.query,
                next.caseSensitive,
                next.wholeWord
              );
              const current = matches.length ? Math.min(Math.max(0, next.current), matches.length - 1) : 0;
              next = { ...next, matches, current };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const f = findKey.getState(state);
            if (!f || !f.matches.length) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              f.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === f.current ? "find-match find-match-current" : "find-match",
                })
              )
            );
          },
        },
      }),
    ];
  },
});

export function getFindState(editor: Editor): FindState {
  return findKey.getState(editor.state) ?? EMPTY;
}

export function findUpdate(editor: Editor, patch: Partial<FindState>) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, patch));
}

export function findNavigate(editor: Editor, dir: 1 | -1) {
  const f = getFindState(editor);
  if (!f.matches.length) return;
  const current = (f.current + dir + f.matches.length) % f.matches.length;
  const m = f.matches[current];
  const tr = editor.state.tr.setMeta(findKey, { current });
  // 选中整个匹配（而非只放一个折叠光标在起点）：
  // 折叠光标下用户接着输入会插到匹配**前面**，把原匹配顶开，
  // 与「查找替换」的直觉（选中→直接输入即替换）严重不符。
  tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
  tr.scrollIntoView();
  editor.view.dispatch(tr);
}

export function replaceCurrent(editor: Editor, replacement: string) {
  const f = getFindState(editor);
  const m = f.matches[f.current];
  if (!m) return;
  const text = normalizeReplacement(replacement);
  const tr = editor.state.tr;
  replacePreservingMarks(tr, tr.doc, m.from, m.to, text);
  tr.setMeta(findKey, { current: f.current });
  tr.scrollIntoView();
  editor.view.dispatch(tr);
}

export function replaceAll(editor: Editor, replacement: string) {
  const f = getFindState(editor);
  if (!f.matches.length) return;
  const text = normalizeReplacement(replacement);
  const tr = editor.state.tr;
  // 从后往前替换：前面各匹配的原始位置不受后面替换的影响
  for (let i = f.matches.length - 1; i >= 0; i--) {
    const m = f.matches[i];
    replacePreservingMarks(tr, tr.doc, m.from, m.to, text);
  }
  tr.setMeta(findKey, { current: 0 });
  editor.view.dispatch(tr);
}

export function findClose(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: "", matches: [], current: 0 }));
}