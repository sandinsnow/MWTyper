import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Editor } from "@tiptap/core";
import { findClose, findNavigate, findUpdate, getFindState, replaceAll, replaceCurrent } from "../editor/find-replace";

interface Props {
  editor: Editor;
  withReplace: boolean;
  onClose: () => void;
}

export default function FindReplaceBar({ editor, withReplace, onClose }: Props) {
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("");
  const [cs, setCs] = useState(false);
  const [ww, setWw] = useState(false);
  const qRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    qRef.current?.focus();
    qRef.current?.select();
  }, []);

  useEffect(() => {
    findUpdate(editor, { query: q, caseSensitive: cs, wholeWord: ww, current: 0 });
  }, [editor, q, cs, ww]);

  const f = getFindState(editor);
  const count = f.matches.length;

  const close = () => {
    findClose(editor);
    onClose();
    editor.commands.focus();
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.target === qRef.current || !withReplace) findNavigate(editor, e.shiftKey ? -1 : 1);
      else replaceCurrent(editor, rep);
    }
  };

  return (
    <div className="find-bar" role="search" aria-label="查找与替换" onKeyDown={onKey}>
      <div className="find-row">
        <input
          ref={qRef}
          value={q}
          placeholder="查找…"
          aria-label="查找关键词"
          onChange={(e) => setQ(e.target.value)}
        />
        {/* 匹配计数随输入实时变化，屏幕阅读器需要它来播报「找到第几处」 */}
        <span className="find-count" role="status" aria-live="polite">
          {count ? `${f.current + 1}/${count}` : "0/0"}
        </span>
        <button aria-pressed={cs} className={cs ? "on" : ""} title="区分大小写" aria-label="区分大小写" onClick={() => setCs((v) => !v)}>Aa</button>
        <button aria-pressed={ww} className={ww ? "on" : ""} title="全词匹配" aria-label="全词匹配" onClick={() => setWw((v) => !v)}>ab</button>
        <button aria-label="上一个匹配" title="上一个 (Shift+Enter)" onClick={() => findNavigate(editor, -1)}>↑</button>
        <button aria-label="下一个匹配" title="下一个 (Enter)" onClick={() => findNavigate(editor, 1)}>↓</button>
        <button className="find-close" aria-label="关闭查找栏" title="关闭 (Esc)" onClick={close}>×</button>
      </div>
      {withReplace && (
        <div className="find-row">
          <input value={rep} placeholder="替换为…" aria-label="替换为" onChange={(e) => setRep(e.target.value)} />
          <button onClick={() => replaceCurrent(editor, rep)}>替换</button>
          <button onClick={() => replaceAll(editor, rep)}>全部替换</button>
        </div>
      )}
    </div>
  );
}