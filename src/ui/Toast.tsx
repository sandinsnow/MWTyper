import React, { useEffect, useRef, type CSSProperties } from "react";

export type Toast = { id: number; kind: "success" | "error" | "info"; message: string };

export interface ToastHostProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/** 每条提示的存活时间（毫秒）。 */
const AUTO_DISMISS_MS = 4000;

const KIND_COLOR: Record<Toast["kind"], string> = {
  success: "var(--accent)",
  error: "var(--danger)",
  info: "var(--fg-dim)",
};

const hostStyle: CSSProperties = {
  position: "fixed",
  right: 20,
  bottom: 20,
  zIndex: 120,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 8,
  pointerEvents: "none",
};

const itemStyle = (kind: Toast["kind"]): CSSProperties => ({
  pointerEvents: "auto",
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  maxWidth: 360,
  padding: "8px 12px",
  background: "var(--bg-side)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderLeft: `3px solid ${KIND_COLOR[kind]}`,
  borderRadius: 8,
  boxShadow: "var(--shadow-modal)",
  fontSize: 12,
  lineHeight: 1.6,
  overflowWrap: "anywhere",
});

const dismissStyle: CSSProperties = {
  flex: "none",
  border: "none",
  background: "none",
  color: "var(--fg-dim)",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1.2,
  padding: "0 2px",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }): React.JSX.Element {
  // 用 ref 保存最新回调，避免父组件每次渲染重建函数导致计时器被反复重置。
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id]);

  return (
    <div style={itemStyle(toast.kind)}>
      <span>{toast.message}</span>
      <button type="button" aria-label="关闭提示" style={dismissStyle} onClick={() => dismissRef.current(toast.id)}>
        ×
      </button>
    </div>
  );
}

/** 右下角堆叠的轻量反馈，替代 window.alert。live region 常驻，保证首条提示也能被读出。 */
export function ToastHost({ toasts, onDismiss }: ToastHostProps): React.JSX.Element {
  return (
    <div className="toast-host" role="status" aria-live="polite" style={hostStyle}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
