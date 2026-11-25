import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { cmDark, cmLight } from "./cm-theme";
import { markdownMarkDecorations } from "./cm-marks";
import { markdownStructureDecorations } from "./cm-structure";

interface Props {
  doc: string;
  onChange: (value: string) => void;
  dark?: boolean;
  onReady?: (view: EditorView | null) => void;
  /** 初始光标位置（字符偏移）：切换模式时用来还原上次的位置 */
  initialSelection?: { anchor: number; head: number } | null;
  /** 用户移动光标时上报，宿主据此在下次进入源码模式时还原 */
  onSelectionChange?: (sel: { anchor: number; head: number }) => void;
}

export function SourceMode({
  doc,
  onChange,
  dark = false,
  onReady,
  initialSelection,
  onSelectionChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const initialSelRef = useRef(initialSelection);
  const docRef = useRef(doc);
  const darkRef = useRef(dark);
  const suppressChangeRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: docRef.current,
        extensions: [
          basicSetup,
          // 用 **GFM** 解析器（markdownLanguage），不用默认的 CommonMark：
          // 默认的 commonmarkLanguage **不解析表格**（源里 `markdown()` 的
          // `base: { parser } = commonmarkLanguage`），于是源码里的表格不会被解析成
          // Table 节点 → 结构装饰加不上，表格在源码里仍是纯文本。
          // 换成 markdownLanguage 后，表格 / 删除线 / 任务列表 / 自动链接都能被识别。
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          // 亮色主题以前传的是空数组 → 亮色下压根没有专属语法高亮，
          // 落到了 basicSetup 的默认 fallback，与暗色那套完全不一致。现在两套都有。
          themeComp.current.of(darkRef.current ? cmDark : cmLight),
          // Markdown 标记符（# > - * ` [）在 lezer 里共用同一个 tag，
          // HighlightStyle 无法区分，靠语法树 + Decoration 单独着色。
          markdownMarkDecorations,
          // 结构视觉：围栏代码块 / 表格 / 引用在源码侧也画出与预览一致的样子
          markdownStructureDecorations,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !suppressChangeRef.current) onChangeRef.current(u.state.doc.toString());
            // 文本变了也要上报光标：用户可能在文件开头打字而光标没动，
            // 此时旧的偏移已失效，宿主需要知道「光标现在在哪、对应哪份文本」。
            if (u.docChanged || u.selectionSet) {
              const main = u.state.selection.main;
              onSelectionChangeRef.current?.({ anchor: main.anchor, head: main.head });
            }
          }),
        ],
      }),
    });
    // 还原上次退出源码模式时的光标位置（否则每次切回来都回到文档开头）。
    const sel = initialSelRef.current;
    if (sel) {
      const len = view.state.doc.length;
      view.dispatch({
        selection: {
          anchor: Math.max(0, Math.min(sel.anchor, len)),
          head: Math.max(0, Math.min(sel.head, len)),
        },
      });
    }
    viewRef.current = view;
    onReadyRef.current?.(view);
    return () => {
      viewRef.current = null;
      // E09：通知宿主释放 CM 引用，避免 openHit/搜索面板持有已销毁的 view。
      onReadyRef.current?.(null);
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    // E04：外部重载/快照恢复替换全文；用户自身输入导致 doc 变化时两边已一致，无需 dispatch。
    if (current === doc) return;
    suppressChangeRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: doc },
      selection: { anchor: Math.min(view.state.selection.main.head, doc.length) },
    });
    suppressChangeRef.current = false;
  }, [doc]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure(dark ? cmDark : cmLight),
    });
  }, [dark]);

  return <div className="source-mode" ref={hostRef} />;
}
