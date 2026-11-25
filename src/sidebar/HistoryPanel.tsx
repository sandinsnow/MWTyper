import { useEffect, useRef, useState } from "react";
import { api, basename, type SnapshotMeta } from "../ipc";
import { diffLines } from "../diff";
import { useModal } from "../ui/Modal";

interface Props {
  workspace: string | null;
  filePath: string | null;
  version: number;
  currentText: () => string;
  onRestore: (text: string) => void;
  onError?: (message: string) => void;
}

export default function HistoryPanel({ workspace, filePath, version, currentText, onRestore, onError }: Props) {
  const [metas, setMetas] = useState<SnapshotMeta[]>([]);
  const [selected, setSelected] = useState<SnapshotMeta | null>(null);
  const [snapText, setSnapText] = useState("");
  const [tab, setTab] = useState<"diff" | "preview">("diff");
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeSnapshot = () => setSelected(null);
  const { onKeyDown, restoreFocus } = useModal(closeSnapshot, closeRef);

  useEffect(() => {
    setSelected(null);
    if (!workspace || !filePath) {
      setMetas([]);
      return;
    }
    void api.snapshotList(workspace, filePath).then(setMetas).catch(() => setMetas([]));
  }, [workspace, filePath, version]);

  useEffect(() => {
    if (selected) closeRef.current?.focus();
  }, [selected]);

  const dismiss = () => {
    restoreFocus();
    closeSnapshot();
  };

  const open = async (m: SnapshotMeta) => {
    if (!workspace || !filePath) return;
    try {
      const text = await api.snapshotRead(workspace, filePath, m.id);
      setSnapText(text);
      setSelected(m);
      setTab("diff");
    } catch (err) {
      onError?.(`读取快照失败：${err}`);
    }
  };

  if (!filePath) return <div className="panel-empty">打开文件后<br />此处显示快照历史</div>;

  const diff = selected ? diffLines(snapText, currentText()) : [];

  return (
    <div className="history">
      {!metas.length && <div className="panel-empty">暂无快照<br />手动保存或每 5 分钟自动创建</div>}
      {metas.map((m) => (
        <button key={m.id} className="history-item" onClick={() => void open(m)}>
          <span className="history-time">{new Date(m.ts).toLocaleString()}</span>
          <span className={"history-badge" + (m.auto ? " auto" : "")}>{m.auto ? "自动" : "手动"}</span>
          <span className="history-bytes">{m.bytes} B</span>
        </button>
      ))}

      {selected && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`快照 ${basename(filePath)} · ${new Date(selected.ts).toLocaleString()}`}
            tabIndex={-1}
            onKeyDown={onKeyDown}
          >
            <div className="modal-head">
              <span className="modal-title">
                {basename(filePath)} · {new Date(selected.ts).toLocaleString()}
              </span>
              <div className="modal-tabs" role="tablist" aria-label="快照视图">
                <button role="tab" aria-selected={tab === "diff"} className={tab === "diff" ? "active" : ""} onClick={() => setTab("diff")}>与当前差异</button>
                <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>预览</button>
              </div>
              <button
                className="modal-restore"
                onClick={() => {
                  onRestore(snapText);
                  dismiss();
                }}
              >
                恢复此版本
              </button>
              <button ref={closeRef} className="modal-close" aria-label="关闭快照" onClick={dismiss}>×</button>
            </div>
            <div className="modal-body">
              {tab === "diff" ? (
                <div className="diff">
                  <div className="diff-legend">红 = 快照独有（将被移除） · 绿 = 当前独有（将被加入）</div>
                  {diff.map((l, i) => (
                    <div key={i} className={"diff-line " + l.kind}>
                      <span className="diff-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
                      <span className="diff-text">{l.text || " "}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="snapshot-preview">{snapText}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
