import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface TitleMenuItem {
  id: string;
  label: string;
  /** 快捷键提示（展示用，不自行绑定） */
  shortcut?: string;
  /** 危险操作（删除类）用警示色 */
  danger?: boolean;
  /** 勾选态（如「专注模式」当前是否开启） */
  checked?: boolean;
  run: () => void;
}

export interface TitleMenuGroup {
  /** 分组标题（为空则不渲染标题） */
  title?: string;
  items: TitleMenuItem[];
}

interface Props {
  groups: TitleMenuGroup[];
  /** 触发按钮的无障碍名 */
  label?: string;
  onClose?: () => void;
}

/**
 * 标题栏的「更多」下拉菜单。
 *
 * 用途：把**低频**操作从标题栏收进菜单，让标题栏只保留高频入口 ——
 * 之前右侧挤了 12 个控件（新建/打开/文件夹/保存/最近/主题/帮助/设置/源码/随航 + 3 个窗口键），
 * 视觉上没有任何层级，用户要逐个辨认。
 *
 * 键盘：↑↓ 在项间移动、Enter 执行、Esc 关闭、Tab 关闭并让焦点自然离开。
 * 点击外部关闭。**不是** aria-modal（它不是模态层，不该抢走整个页面的焦点）。
 */
export default function TitleMenu({ groups, label = "更多操作", onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const flat = groups.flatMap((g) => g.items);
  const close = (restore = true) => {
    setOpen(false);
    if (restore) btnRef.current?.focus();
    onClose?.();
  };

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [open]);

  // 打开时把焦点放到当前项
  useEffect(() => {
    if (open) itemRefs.current[activeIdx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = flat.length;
      const next = (activeIdx + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      setActiveIdx(next);
      itemRefs.current[next]?.focus();
      return;
    }
    if (e.key === "Tab") {
      // 让焦点自然离开，但收起菜单
      setOpen(false);
    }
  };

  const run = (item: TitleMenuItem) => {
    close();
    item.run();
  };

  let idx = -1;
  return (
    <div className="title-menu-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="tb-btn tb-btn-ghost"
        title="更多操作"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⋯</span>
        <span className="tb-label">更多</span>
      </button>

      {open && (
        <>
          {/* 不放全屏遮罩：遮罩会**吞掉对标题栏其它按钮的点击** ——
              「最近」浮层开着时点「⋯」会只关掉浮层、菜单却不开。
              「点击外部关闭」由上面的 window mousedown 监听负责。 */}
          <div
            className="title-menu"
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
          >
            {groups.map((g, gi) => (
              <div key={gi} className="title-menu-group" role="group" aria-label={g.title}>
                {g.title && <div className="title-menu-title">{g.title}</div>}
                {g.items.map((it) => {
                  idx += 1;
                  const i = idx;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      role="menuitem"
                      tabIndex={i === activeIdx ? 0 : -1}
                      ref={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      className={"title-menu-item" + (it.danger ? " danger" : "")}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => run(it)}
                    >
                      <span className="title-menu-check" aria-hidden="true">
                        {it.checked ? "✓" : ""}
                      </span>
                      <span className="title-menu-label">{it.label}</span>
                      {it.shortcut && <span className="title-menu-shortcut">{it.shortcut}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
