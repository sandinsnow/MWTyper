import CodeBlock from "@tiptap/extension-code-block";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import plaintext from "highlight.js/lib/languages/plaintext";

// 按需注册常用语言（全量 hljs 约 1MB+，是 bundle 大头）；未注册语言降级为纯文本
for (const [name, lang] of Object.entries({ bash, c, cpp, csharp, css, diff, go, java, javascript, json, kotlin, lua, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml, plaintext })) {
  hljs.registerLanguage(name, lang);
}

// 高亮走 inline decorations：NodeView 内直接改 contentDOM 的 innerHTML 会被
// ProseMirror 的内容同步覆盖，且 DOM 变更会被误读为用户编辑。decorations 由
// PM 原生管理，编辑事务后依然稳定（CodeBlockLowlight 同款机制，换用 hljs）。

export const hljsKey = new PluginKey<DecorationSet>("hljsCodeBlock");

// listLanguages() 只列注册名（typescript），不含别名（ts）；选择器值需归一化
const LANG_ALIASES: Record<string, string> = {};
for (const l of hljs.listLanguages()) {
  for (const a of hljs.getLanguage(l)?.aliases || []) LANG_ALIASES[a] = l;
}
const canonicalLang = (l: string) => LANG_ALIASES[l] || l;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

const TOKEN = /<span class="([^"]*)">|<\/span>|([^<]+)/g;

function collectBlockDecorations(node: ProseMirrorNode, pos: number, decos: Decoration[]): void {
  const lang = node.attrs.language as string | null;
  const text = node.textContent;
  if (!lang || !text || !hljs.getLanguage(lang)) return;
  const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  const stack: string[] = [];
  let offset = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    if (m[1] !== undefined) {
      stack.push(m[1]);
    } else if (m[0] === "</span>") {
      stack.pop();
    } else {
      const raw = decodeEntities(m[2]);
      const cls = stack[stack.length - 1];
      if (cls && raw.length) {
        decos.push(Decoration.inline(pos + 1 + offset, pos + 1 + offset + raw.length, { class: cls }));
      }
      offset += raw.length;
    }
  }
}

/** 全文重算：等价性测试的基准实现。 */
export function highlightDecorations(doc: ProseMirrorNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;
    collectBlockDecorations(node, pos, decos);
    return false;
  });
  return DecorationSet.create(doc, decos);
}

interface Range {
  from: number;
  to: number;
}

/** 当前 PM 版本无 tr.changes；用各 StepMap 的 forEach 还原新旧改动区间。 */
export function changedRanges(tr: Transaction): { oldFrom: number; oldTo: number; newFrom: number; newTo: number }[] {
  const pairs: { oldFrom: number; oldTo: number; newFrom: number; newTo: number }[] = [];
  for (let i = 0; i < tr.mapping.maps.length; i++) {
    const before = tr.mapping.slice(0, i).invert();
    const after = tr.mapping.slice(i + 1);
    tr.mapping.maps[i].forEach((oldStart, oldEnd, newStart, newEnd) => {
      pairs.push({
        oldFrom: before.map(oldStart, -1),
        oldTo: before.map(oldEnd, 1),
        newFrom: after.map(newStart, -1),
        newTo: after.map(newEnd, 1),
      });
    });
  }
  return pairs;
}

function touchedBlocks(doc: ProseMirrorNode, ranges: Range[]): Range[] {
  const out: Range[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;
    const end = pos + node.nodeSize;
    if (ranges.some((r) => pos <= r.to && end >= r.from)) out.push({ from: pos, to: end });
    return false;
  });
  return out;
}

function decorationsIn(doc: ProseMirrorNode, blocks: Range[]): Decoration[] {
  const out: Decoration[] = [];
  for (const block of blocks) {
    doc.descendants((node, pos) => {
      if (node.type.name !== "codeBlock") return pos < block.to;
      if (pos === block.from) collectBlockDecorations(node, pos, out);
      return false;
    });
  }
  return out;
}

/** 增量重算：仅受影响代码块重新高亮，其余装饰经 mapping 平移保留。 */
export function incrementalHighlightDecorations(old: DecorationSet, tr: Transaction): DecorationSet {
  if (!tr.docChanged) return old.map(tr.mapping, tr.doc);
  const pairs = changedRanges(tr);
  if (!pairs.length) return old.map(tr.mapping, tr.doc);

  const newBlocks = touchedBlocks(tr.doc, pairs.map((p) => ({ from: p.newFrom, to: p.newTo })));
  const oldBlocks = touchedBlocks(tr.before, pairs.map((p) => ({ from: p.oldFrom, to: p.oldTo })));
  const fresh = decorationsIn(tr.doc, newBlocks);
  const kept = old.find().filter((deco) => !oldBlocks.some((b) => deco.from >= b.from && deco.to <= b.to));
  const mapped = DecorationSet.create(tr.before, kept).map(tr.mapping, tr.doc).find();
  const all = [...mapped, ...fresh].sort((a, b) => a.from - b.from || a.to - b.to);
  return DecorationSet.create(tr.doc, all);
}

export const CodeBlockHljs = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: hljsKey,
        state: {
          init: (_, { doc }) => highlightDecorations(doc),
          apply: (tr, old) => incrementalHighlightDecorations(old, tr),
        },
        props: {
          decorations: (state) => hljsKey.getState(state),
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "code-block";

      const bar = document.createElement("div");
      bar.className = "code-block-bar";
      bar.contentEditable = "false";
      const select = document.createElement("select");
      select.className = "code-block-lang";
      for (const l of ["", ...hljs.listLanguages().sort()]) {
        const opt = document.createElement("option");
        opt.value = l;
        opt.textContent = l || "纯文本";
        select.append(opt);
      }
      const setSelectValue = (lang: string | null) => {
        const v = lang ? canonicalLang(lang) : "";
        if (v && !Array.from(select.options).some((o) => o.value === v)) {
          const opt = document.createElement("option");
          opt.value = v;
          opt.textContent = v;
          select.append(opt);
        }
        select.value = v;
      };
      setSelectValue(current.attrs.language as string | null);
      select.addEventListener("change", () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            language: select.value || null,
          })
        );
      });
      bar.append(select);

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "hljs";
      pre.append(code);
      dom.append(bar, pre);

      return {
        dom,
        contentDOM: code,
        // 下拉在 contentDOM 之外：不拦截的话 PM 会把 mousedown 当成节点选择，劫持下拉操作
        stopEvent: (event) => bar.contains(event.target as Node),
        update(next) {
          if (next.type.name !== "codeBlock") return false;
          current = next;
          setSelectValue(next.attrs.language as string | null);
          return true;
        },
      };
    };
  },
});