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
 * 已挂载模态的栈：**后挂载的 = 更上层的浮层**。
 *
 * 为什么需要栈：应用里存在**分层模态** —— 命令面板可以叠在「关闭脏标签」的
 * 确认框之上（QA 探针 P6 就在守这条）。若每个模态都独立响应 Escape，
 * 一次按键会把两层一起关掉，而期望是「只关最上面那层」。
 */
const modalStack: Array<() => void> = [];

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
  /**
   * 稳定的关闭包装：内部引用**最新**的 close，但自身引用永不变。
   *
   * 模态栈与 document 级 Escape 监听都需要一个可比较的稳定引用 ——
   * `close` 常常是内联箭头函数，每次渲染都是新引用，直接入栈会导致
   * 「出栈时找不到自己」与「调用到旧闭包」。
   */
  const stableClose = useCallback(() => closeRef.current(), []);
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

  /**
   * Escape 在 **document 捕获阶段**兜底处理。
   *
   * 为什么不能只靠容器上的 onKeyDown（React 合成事件）：
   *   合成事件要靠**焦点在容器内**才会冒泡到容器。一旦焦点落到容器之外
   *   （典型场景：容器内的按钮在异步等待期间被 `disabled` → 浏览器把焦点
   *   移到 body），Escape 就再也关不掉弹窗 —— 用户会以为界面卡死了。
   *   本项目实测命中过这条路径：帮助中心「检查远端更新」按钮在检查期间
   *   被禁用，焦点丢失后 Escape 失效。
   *
   * 分层模态：**只有栈顶响应** Escape（见 modalStack）——
   *   命令面板叠在确认框之上时，按一次只关命令面板，确认框保持不动。
   *
   * 捕获阶段 + stopPropagation：既保证「焦点在哪都能关」，又不会与容器上的
   *   onKeyDown 重复触发（事件在到达 React 根节点前就被拦下）。
   */
  useEffect(() => {
    // ⚠️ 本文件顶部 import 的 `KeyboardEvent` 是 **React 的**合成事件类型，
    // 与 DOM 原生事件类型不同 —— 这里必须显式用 `globalThis.KeyboardEvent`。
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (modalStack[modalStack.length - 1] !== stableClose) return; // 非栈顶不响应
      e.preventDefault();
      e.stopPropagation();
      stableClose();
    };
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [stableClose]);

  /** 入栈 / 出栈：后挂载的模态在栈顶。 */
  useEffect(() => {
    modalStack.push(stableClose);
    return () => {
      const i = modalStack.lastIndexOf(stableClose);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, [stableClose]);

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
