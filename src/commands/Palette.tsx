import { useEffect, useMemo, useRef, useState } from "react";
import { useModal } from "../ui/Modal";

export interface PaletteCommand {
  id: string;
  title: string;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (found === 0 ? 3 : 0);
    ti = found + 1;
  }
  return score;
}

export default function Palette({
  commands,
  onClose,
  placeholder,
  deferModal = false,
}: {
  commands: PaletteCommand[];
  onClose: () => void;
  placeholder?: string;
  /** 同屏已有其他模态浮层时为 true：命令面板降级为非模态（避免出现第二个 aria-modal）。 */
  deferModal?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { onKeyDown, restoreFocus } = useModal(onClose, inputRef);
  // 兜底：命令面板可能叠在子组件自带的模态（如快照详情）之上，挂载后再核对一次。
  // 用 MutationObserver 持续观察：模态浮层可能在面板打开之后才出现/消失，
  // 只在挂载时探测一次会漏掉「后来出现的模态」，导致同屏出现两个 aria-modal。
  const [otherModal, setOtherModal] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const detect = () => {
      const others = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
      ).filter((node) => node !== el);
      setOtherModal(others.length > 0);
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal", "role"],
    });
    return () => observer.disconnect();
  }, []);
  const modal = deferModal || otherModal ? "false" : "true";

  const filtered = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: fuzzyScore(q, c.title + " " + (c.keywords ?? "")) }))
      .filter((x): x is { c: PaletteCommand; s: number } => x.s !== null);
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c);
  }, [q, commands]);

  const active = Math.min(sel, Math.max(0, filtered.length - 1));

  const exec = (c: PaletteCommand) => {
    restoreFocus();
    onClose();
    c.run();
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { restoreFocus(); onClose(); } }}>
      <div
        ref={panelRef}
        className="palette"
        role="dialog"
        aria-modal={modal}
        aria-label={placeholder ?? "命令面板"}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          autoFocus
          value={q}
          placeholder={placeholder ?? "输入命令…"}
          aria-label="搜索命令或文件"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[active]) exec(filtered[active]);
            }
          }}
        />
        <div className="palette-list" role="listbox" aria-label="命令列表">
          {filtered.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={"palette-item" + (i === active ? " active" : "")}
              onMouseEnter={() => setSel(i)}
              onClick={() => exec(c)}
            >
              <span>{c.title}</span>
              {c.shortcut && <span className="palette-shortcut">{c.shortcut}</span>}
            </button>
          ))}
          {!filtered.length && <div className="panel-empty">无匹配命令</div>}
        </div>
      </div>
    </div>
  );
}
