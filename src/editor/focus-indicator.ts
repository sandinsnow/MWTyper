/**
 * 编辑区焦点指示的输入模态追踪。
 *
 * 为什么不能直接用 `:focus-visible`：
 * Chrome 对 **contenteditable** 的 `:focus-visible` 启发式是「总是匹配」——
 * 实测鼠标点击进入编辑区时 `pm.matches(":focus-visible") === true`，
 * 键盘 Tab 进来反而要看你从哪儿来。于是任何挂在 `:focus-visible` 上的
 * 焦点装饰都会变成编辑区里的**常驻元素**（用户反馈「这个绿色的边框是什么」）。
 *
 * 正确做法是自己判断输入模态：
 * - 键盘操作（Tab / 方向键 / Enter / 空格）→ 标记为键盘模态
 * - 指针操作（mousedown / pointerdown）→ 标记为指针模态
 * 编辑区获得焦点时按当时的模态决定要不要显示焦点指示：
 * 键盘用户有明确指示（WCAG 2.4.7 Focus Visible），鼠标用户由光标本身表达位置，
 * 画布保持干净。
 */

/** 当前是否为键盘操作模态 */
let keyboardMode = false;

export function isKeyboardMode(): boolean {
  return keyboardMode;
}

/**
 * 挂载全局输入模态追踪，返回卸载函数。
 *
 * 判定规则：出现导航类按键即视为键盘模态（Tab / 方向键 / Enter / 空格 / Home / End / PageUp / PageDown），
 * 任何指针按下即视为指针模态。
 */
export function trackInputModality(): () => void {
  const NAV_KEYS = new Set([
    "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Enter", " ", "Home", "End", "PageUp", "PageDown",
  ]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (NAV_KEYS.has(e.key)) keyboardMode = true;
  };
  const onPointer = () => {
    keyboardMode = false;
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("mousedown", onPointer, true);
  window.addEventListener("pointerdown", onPointer, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("mousedown", onPointer, true);
    window.removeEventListener("pointerdown", onPointer, true);
  };
}

/** 编辑区获得焦点时的 class 名（CSS 依此显示焦点指示） */
export const KEYBOARD_FOCUS_CLASS = "kb-focus";

/**
 * 给编辑区挂上焦点 class 的开关：焦点进入时按当前输入模态决定是否显示指示。
 * 返回卸载函数。
 */
export function applyFocusIndicator(el: HTMLElement): () => void {
  const onFocus = () => {
    el.classList.toggle(KEYBOARD_FOCUS_CLASS, isKeyboardMode());
  };
  const onBlur = () => {
    el.classList.remove(KEYBOARD_FOCUS_CLASS);
  };
  // 焦点**已经在**编辑区里时，鼠标点一下不会再触发 focus 事件 ——
  // 指示线会赖着不走。指针按下即撤掉。
  const onPointer = () => {
    el.classList.remove(KEYBOARD_FOCUS_CLASS);
  };
  el.addEventListener("focus", onFocus, true);
  el.addEventListener("blur", onBlur, true);
  el.addEventListener("mousedown", onPointer, true);
  el.addEventListener("pointerdown", onPointer, true);
  return () => {
    el.removeEventListener("focus", onFocus, true);
    el.removeEventListener("blur", onBlur, true);
    el.removeEventListener("mousedown", onPointer, true);
    el.removeEventListener("pointerdown", onPointer, true);
    el.classList.remove(KEYBOARD_FOCUS_CLASS);
  };
}
