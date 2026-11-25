import React, { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";

/** 可被 Tab 聚焦的元素选择器（与浏览器默认顺序一致）。 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * 弹窗键盘行为：Escape 关闭、Tab 在容器内循环、关闭后归还焦点。
 *
 * 将返回的 onKeyDown 挂在弹窗容器（如 `.modal`，需 tabIndex={-1}）上；
 * initialFocus 指向打开时应该获得焦点的内部元素（如输入框或取消按钮）。
 */
export function useModal(
  close: () => void,
  initialFocus?: RefObject<HTMLElement>
): { onKeyDown: (e: KeyboardEvent) => void; restoreFocus: () => void } {
  const closeRef = useRef(close);
  closeRef.current = close;
  const previousActiveRef = useRef<HTMLElement | null>(null);

  const restoreFocus = useCallback(() => {
    const previous = previousActiveRef.current;
    previousActiveRef.current = null;
    if (previous && document.contains(previous) && typeof previous.focus === "function") {
      previous.focus();
    }
  }, []);

  useEffect(() => {
    previousActiveRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const target = initialFocus?.current;
    if (target && typeof target.focus === "function") target.focus();
    // 组件随 open=false 卸载时自动归还焦点；显式调用 restoreFocus 是幂等的。
    return restoreFocus;
  }, [initialFocus, restoreFocus]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    const container = e.currentTarget as HTMLElement | null;
    if (!container) return;
    const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !active || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !active || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return { onKeyDown, restoreFocus };
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialogBody(props: ConfirmDialogProps): React.JSX.Element {
  const { title, message, danger = false, onConfirm, onCancel } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { onKeyDown, restoreFocus } = useModal(onCancel, cancelRef);
  const titleId = useId();
  const messageId = useId();

  const cancel = (): void => {
    restoreFocus();
    onCancel();
  };
  const confirm = (): void => {
    restoreFocus();
    onConfirm();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ width: "min(420px, 92vw)" }}
      >
        <div className="modal-head">
          <span className="modal-title" id={titleId}>{title}</span>
          <button className="modal-close" type="button" aria-label="关闭" onClick={cancel}>×</button>
        </div>
        <div className="modal-body" id={messageId} style={{ lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {message}
        </div>
        <div className="modal-foot">
          <button ref={cancelRef} className="tb-btn" type="button" onClick={cancel}>取消</button>
          <button
            className="tb-btn"
            type="button"
            onClick={confirm}
            style={{
              background: danger ? "var(--danger)" : "var(--accent-strong)",
              color: danger ? "var(--on-danger)" : "var(--on-accent-strong)",
              borderColor: danger ? "var(--danger)" : "var(--accent-strong)",
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

/** 确认弹窗：替代 window.confirm。 */
export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element | null {
  if (!props.open) return null;
  return <ConfirmDialogBody {...props} />;
}

export interface PromptDialogProps {
  open: boolean;
  title: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function PromptDialogBody(props: PromptDialogProps): React.JSX.Element {
  const { title, defaultValue = "", onSubmit, onCancel } = props;
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const { onKeyDown, restoreFocus } = useModal(onCancel, inputRef);
  const titleId = useId();
  // 对话框的描述指向输入框：读屏进入对话框时会一并播报「此处需填写什么」，
  // 与 ConfirmDialog 用 aria-describedby 指向消息体的做法保持一致。
  const inputId = useId();

  useEffect(() => {
    // 打开时全选默认文本，直接输入即可替换。
    inputRef.current?.select();
  }, []);

  const cancel = (): void => {
    restoreFocus();
    onCancel();
  };
  const submit = (): void => {
    restoreFocus();
    onSubmit(value);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={inputId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ width: "min(420px, 92vw)" }}
      >
        <div className="modal-head">
          <span className="modal-title" id={titleId}>{title}</span>
          <button className="modal-close" type="button" aria-label="关闭" onClick={cancel}>×</button>
        </div>
        <div className="modal-body">
          <input
            ref={inputRef}
            id={inputId}
            aria-label={title}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            style={{
              width: "100%",
              background: "var(--bg-editor)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 13,
            }}
          />
        </div>
        <div className="modal-foot">
          <button className="tb-btn" type="button" onClick={cancel}>取消</button>
          <button
            className="tb-btn"
            type="button"
            onClick={submit}
            style={{
              background: "var(--accent-strong)",
              color: "var(--on-accent-strong)",
              borderColor: "var(--accent-strong)",
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

/** 输入弹窗：替代 window.prompt。 */
export function PromptDialog(props: PromptDialogProps): React.JSX.Element | null {
  if (!props.open) return null;
  return <PromptDialogBody {...props} />;
}
