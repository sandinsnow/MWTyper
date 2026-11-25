import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/core";
import { escapeAmbiguousParagraphs } from "./markdown-escape";

// ---------------------------------------------------------------------------
// MWTyper 的 Markdown 序列化器
//
// 在 @tiptap/markdown 的 MarkdownManager 基础上补两处「往返保真」缺口：
//
//   B1/B4  原始 HTML 块 / 脚注定义块在往返中被丢弃
//          —— 脚注定义（`[^1]: 正文`）不是 CommonMark 语法，marked 把它当
//             「链接引用定义（link reference definition）」吃掉，正文里的
//             `[^1]` 随即被解析成指向该定义的字面链接：
//                 parse("正文[^1]\n\n[^1]: 脚注")
//                   → paragraph(text "正文", link(^1 → 脚注))
//             往返后变成 "正文[^1](脚注)"，脚注定义整块消失。
//             这里在送进 marked 之前把脚注定义块摘出来换成占位 HTML 注释，
//             解析后再换回携带原文的 rawHtml 节点；正文里的 `[^1]` 因为
//             没有定义可引用而保持字面形态。
//
//   B3     以块级标记开头的段落往返后结构漂移
//          —— 序列化时按 CommonMark 规则给行首补反斜杠（见 markdown-escape.ts）。
//
// 公开行为（parse / serialize 签名）与父类完全一致，调用方无需改动。
// ---------------------------------------------------------------------------

/** 脚注定义行：`[^label]: 正文`（CommonMark 只认 0~3 空格缩进） */
const RE_FOOTNOTE_DEF = /^( {0,3})\[\^([^\]\s]+)\]:/;
/**
 * 「块首」判定：上一行是这些之一时，下一行才是块级起点（marked 才会把
 * `[^x]:` 当成定义）。段落中间的同名行属于段落续行，不能摘。
 */
const RE_BLOCK_OPENER =
  /^ {0,3}(?:[-+*][ \t]|\d{1,9}[.)][ \t]|#{1,6}[ \t]|>|```|~~~|\||<!--|<[A-Za-z]|[-*_]{3,})/;
/** 围栏代码块的定界符 */
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** 占位注释前缀（每次 parse 用自增序号，避免与用户自己写的注释撞车） */
let markerSeq = 0;

export interface ExtractedFootnotes {
  /** 替换掉脚注定义后的 markdown */
  text: string;
  /** 占位注释 → 脚注定义原文 */
  notes: Map<string, string>;
}

/**
 * 把 markdown 里的脚注定义块摘出来，换成占位 HTML 注释。
 * 只处理「块首」的定义行：段落中间的行属于段落文本，不能摘。
 */
export function extractFootnoteBlocks(md: string): ExtractedFootnotes {
  const notes = new Map<string, string>();
  const lines = md.split("\n");
  const out: string[] = [];
  let markerId = "";
  let changed = false;
  // 当前所在的围栏代码块定界符（代码块里的 "[^x]: ..." 是代码，不是脚注）
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = RE_FENCE.exec(line);

    if (fence) {
      out.push(line);
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      out.push(line);
      continue;
    }

    const def = RE_FOOTNOTE_DEF.exec(line);
    if (!def) {
      out.push(line);
      continue;
    }

    const prev = i > 0 ? lines[i - 1] : "";
    const atBlockStart = i === 0 || prev.trim() === "" || RE_BLOCK_OPENER.test(prev) || prev.includes("<!--mwtyper-fn-");
    if (!atBlockStart) {
      out.push(line);
      continue;
    }

    if (!markerId) {
      markerSeq += 1;
      markerId = `mwtyper-fn-${markerSeq}`;
    }
    const key = `${markerId}:${notes.size}`;
    // 用完整注释文本做 key：rawHtml 节点里的 html 就是这段注释本身
    notes.set(`<!--${key}-->`, line.replace(/[ \t]+$/, ""));
    out.push(`${def[1]}<!--${key}-->`);
    changed = true;
  }

  return { text: changed ? out.join("\n") : md, notes };
}

/** 把占位注释换回脚注定义原文 */
export function restoreFootnoteBlocks(doc: JSONContent, notes: Map<string, string>): JSONContent {
  const walk = (node: JSONContent): JSONContent => {
    const copy: JSONContent = { ...node };
    if (node.type === "rawHtml") {
      const html = node.attrs?.html;
      if (typeof html === "string" && notes.has(html)) {
        copy.attrs = { ...node.attrs, html: notes.get(html) };
      }
    }
    if (Array.isArray(node.content)) copy.content = node.content.map(walk);
    return copy;
  };
  return walk(doc);
}

export class MwtyperMarkdownManager extends MarkdownManager {
  /** 解析 markdown → ProseMirror JSON（脚注定义块保留为 rawHtml 节点） */
  parse(markdown: string): JSONContent {
    const { text, notes } = extractFootnoteBlocks(markdown);
    const doc = super.parse(text);
    return notes.size > 0 ? restoreFootnoteBlocks(doc, notes) : doc;
  }

  /** ProseMirror JSON → markdown（段落行首按 CommonMark 转义，避免结构漂移） */
  serialize(docOrContent: JSONContent): string {
    if (!docOrContent) return super.serialize(docOrContent);
    return super.serialize(escapeAmbiguousParagraphs(docOrContent));
  }
}
