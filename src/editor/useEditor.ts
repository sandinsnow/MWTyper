import { useEffect, useRef, useState } from "react";
import { Editor, type EditorOptions } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { applyFocusIndicator, trackInputModality } from "./focus-indicator";

/** store 无 @tiptap/react：薄封装。editor 实例挂在 ref 容器上，事务按需触发重渲染。 */
export interface EditorHostOptions extends Partial<EditorOptions> {
  /** 默认仅 docChanged / selectionSet 触发宿主重渲染；额外谓词可放行 find meta 等。 */
  rerenderOn?: (tr: Transaction) => boolean;
}

export function useEditor(options: EditorHostOptions) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, setTick] = useState(0);
  const optionsRef = useRef(options);
  const rerenderOnRef = useRef(options.rerenderOn);
  rerenderOnRef.current = options.rerenderOn;

  useEffect(() => {
    if (!elementRef.current) return;
    // rerenderOn 是宿主契约，不传给 tiptap 构造器。
    const { rerenderOn: _rerenderOn, ...editorOptions } = optionsRef.current;
    const ed = new Editor({ ...editorOptions, element: elementRef.current });
    const rerender = () => setTick((t) => t + 1);
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      const shouldRerender =
        transaction.docChanged ||
        transaction.selectionSet ||
        (rerenderOnRef.current?.(transaction) ?? false);
      if (shouldRerender) rerender();
    };
    ed.on("transaction", onTransaction);
    // 焦点指示只在**键盘导航**进入时显示（Chrome 对 contenteditable 的
    // :focus-visible 总是匹配，用它会让装饰变成常驻元素）。
    const stopModality = trackInputModality();
    const stopIndicator = applyFocusIndicator(elementRef.current);
    setEditor(ed);
    return () => {
      ed.off("transaction", onTransaction);
      stopIndicator();
      stopModality();
      ed.destroy();
    };
  }, []);

  return { editor, elementRef };
}
