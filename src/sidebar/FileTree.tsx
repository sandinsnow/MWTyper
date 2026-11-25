import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../ipc";

interface Props {
  tree: TreeNode | null;
  currentPath: string | null;
  /**
   * 已展开的目录路径集合（受控）。
   * 展开状态必须由 App 持有：FileTree 位于条件渲染内（侧栏页签切换 / Ctrl+\ 收起侧栏
   * 都会让它卸载重挂载），若状态留在组件内，重挂载会把用户手动折叠的目录重新展开。
   */
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onNewFile: (dir: string) => void;
  /** 打开工作区（文件夹）。放在侧栏「文件」页 —— 它是**工作区操作**，语义上不属于标题栏。 */
  onOpenFolder: () => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}

interface Menu {
  x: number;
  y: number;
  node: TreeNode;
}

/** 收集树中全部目录路径（用于默认展开）。 */
export function collectDirPaths(node: TreeNode, out: string[] = []): string[] {
  if (node.kind === "dir") {
    out.push(node.path);
    for (const child of node.children ?? []) collectDirPaths(child, out);
  }
  return out;
}

/**
 * 默认展开的规模上限：单个目录的子树节点数超过此值时不自动展开。
 * ARIA tree 要求子节点嵌在父 treeitem 内，因此树必须能呈现层级；
 * 但把一个含上万条目的目录整体渲染出来会产生海量 DOM 行，拖慢侧栏。
 * 超出上限的目录保持折叠（用户仍可手动展开），并在行上标注条目数。
 */
export const TREE_AUTO_EXPAND_MAX_NODES = 200;

/** 统计某节点子树内的节点总数（含自身）。 */
function countNodes(node: TreeNode): number {
  if (node.kind !== "dir") return 1;
  let n = 1;
  for (const child of node.children ?? []) n += countNodes(child);
  return n;
}

/** 收集每个目录的子树节点数（含自身），供默认展开的规模判断使用。 */
export function collectDirSizes(node: TreeNode, out: Map<string, number> = new Map()): Map<string, number> {
  if (node.kind === "dir") {
    out.set(node.path, countNodes(node));
    for (const child of node.children ?? []) collectDirSizes(child, out);
  }
  return out;
}

function Row({
  node,
  indent,
  expanded,
  currentPath,
  dirSizes,
  onToggle,
  onOpenFile,
  onMenu,
}: {
  node: TreeNode;
  /** 该行的左内边距（绝对值）：顶层为 8，嵌套在 group 内为 14（一级缩进）。 */
  indent: number;
  expanded: Set<string>;
  currentPath: string | null;
  /** 每个目录的子树节点数，用于标注超大目录。 */
  dirSizes: Map<string, number>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const isDir = node.kind === "dir";
  const open = expanded.has(node.path);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const activate = () => (isDir ? onToggle(node.path) : onOpenFile(node.path));
  /** 超大目录：默认折叠（不自动展开），行上标注条目数，让用户知道里面有多少内容。 */
  const size = isDir ? (dirSizes.get(node.path) ?? 0) : 0;
  const oversized = isDir && size > TREE_AUTO_EXPAND_MAX_NODES;
  /**
   * 子节点嵌套在父 treeitem 内之后，点击/按键会冒泡到父级。
   * 事件源落在自己的 group 容器内时，父级不得再折叠（否则点子项会误关目录）。
   */
  const fromOwnGroup = (e: React.MouseEvent | React.KeyboardEvent): boolean =>
    !!groupRef.current && groupRef.current.contains(e.target as Node);
  return (
    <div
      className={"tree-row" + (node.path === currentPath ? " active" : "")}
      style={{ paddingLeft: indent }}
      role="treeitem"
      aria-expanded={isDir ? open : undefined}
      aria-selected={node.path === currentPath}
      tabIndex={0}
      onClick={(e) => {
        if (fromOwnGroup(e)) return;
        activate();
      }}
      onContextMenu={(e) => onMenu(e, node)}
      onKeyDown={(e) => {
        if (fromOwnGroup(e)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        } else if (isDir && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
          e.preventDefault();
          if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) onToggle(node.path);
        }
      }}
      title={oversized ? `${node.path}（${size} 项，默认折叠，点击展开）` : node.path}
    >
      <span className="tree-arrow" aria-hidden="true">{isDir ? (open ? "▾" : "▸") : ""}</span>
      <span className="tree-name">{node.name}</span>
      {oversized && (
        <span className="tree-count" title={`${size} 项，默认折叠，点击展开`}>
          {size}
        </span>
      )}
      {/* ARIA tree：子树必须嵌套在父 treeitem 内部，读屏才能获知层级关系 */}
      {isDir && open && (
        <div className="tree-group" role="group" ref={groupRef}>
          {node.children?.map((c) => (
            <Row
              key={c.path}
              node={c}
              indent={14}
              expanded={expanded}
              currentPath={currentPath}
              dirSizes={dirSizes}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onMenu={onMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTree({
  tree,
  currentPath,
  expanded,
  onToggleDir,
  onOpenFile,
  onNewFile,
  onOpenFolder,
  onRename,
  onDelete,
}: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  // 每个目录的子树节点数：用于标注超大目录（默认折叠）。
  const dirSizes = useMemo(() => (tree ? collectDirSizes(tree) : new Map<string, number>()), [tree]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    // U13：JS 侧钳制到视口内，CSS 的 max-width 作为第二道保险。
    setMenu({
      x: Math.max(4, Math.min(e.clientX, window.innerWidth - 148)),
      y: Math.max(4, Math.min(e.clientY, window.innerHeight - 128)),
      node,
    });
  };

  if (!tree) {
    // 未打开工作区时也要能点「打开文件夹」—— 这正是最需要入口的时候。
    // （工具栏放在 tree 之后渲染的话，这里就永远没有按钮，QA 基线
    //   button[title^="打开文件夹"] 也选不中。）
    return (
      <div className="file-tree">
        <div className="tree-toolbar">
          <button title="打开文件夹 (Ctrl+Shift+O)" onClick={onOpenFolder}>打开文件夹</button>
        </div>
        <div className="panel-empty">尚未打开文件夹<br />点击上方「打开文件夹」选择工作区</div>
      </div>
    );
  }

  return (
    <div className="file-tree">
      <div className="tree-toolbar">
        <button onClick={() => onNewFile(tree.path)}>新建文件</button>
        <button title="打开文件夹 (Ctrl+Shift+O)" onClick={onOpenFolder}>打开文件夹</button>
      </div>
      <div className="tree-rows" role="tree" aria-label="文件树">
        {tree.children?.map((c) => (
          <Row
            key={c.path}
            node={c}
            indent={8}
            expanded={expanded}
            currentPath={currentPath}
            dirSizes={dirSizes}
            onToggle={onToggleDir}
            onOpenFile={onOpenFile}
            onMenu={openMenu}
          />
        ))}
        {!tree.children?.length && <div className="panel-empty">文件夹中没有 Markdown 文件<br />可点击「新建文件」开始写作</div>}
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          {menu.node.kind === "dir" && (
            <button role="menuitem" onClick={() => { onNewFile(menu.node.path); setMenu(null); }}>新建文件</button>
          )}
          <button role="menuitem" onClick={() => { onRename(menu.node); setMenu(null); }}>重命名</button>
          <button role="menuitem" className="danger" onClick={() => { onDelete(menu.node); setMenu(null); }}>删除</button>
        </div>
      )}
    </div>
  );
}
