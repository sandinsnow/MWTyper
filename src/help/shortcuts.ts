/**
 * 快捷键表 —— **单一事实源**。
 *
 * 命令面板（`Ctrl+Shift+P` / `Ctrl+P`）与帮助中心的「快捷键」分区都从这里取，
 * 避免两处各写一份、日后漂移。
 */

export interface ShortcutItem {
  keys: string;
  desc: string;
  group: string;
}

export const SHORTCUTS: ShortcutItem[] = [
  // 文件
  { group: "文件", keys: "Ctrl+N", desc: "新建文稿" },
  { group: "文件", keys: "Ctrl+O", desc: "打开文件" },
  { group: "文件", keys: "Ctrl+Shift+O", desc: "打开文件夹" },
  { group: "文件", keys: "Ctrl+S", desc: "保存" },
  { group: "文件", keys: "Ctrl+Shift+S", desc: "另存为（新建标签）" },
  { group: "文件", keys: "Ctrl+W", desc: "关闭当前标签" },

  // 编辑
  { group: "编辑", keys: "Ctrl+B / Ctrl+I", desc: "加粗 / 斜体" },
  { group: "编辑", keys: "Ctrl+Shift+X", desc: "删除线" },
  { group: "编辑", keys: "Ctrl+E", desc: "行内代码" },
  { group: "编辑", keys: "Ctrl+U", desc: "下划线" },
  { group: "编辑", keys: "Ctrl+K", desc: "插入链接" },
  { group: "编辑", keys: "Ctrl+1 … Ctrl+6", desc: "标题 1~6 级" },
  { group: "编辑", keys: "Ctrl+0", desc: "正文段落" },
  { group: "编辑", keys: "Ctrl+Z / Ctrl+Y", desc: "撤销 / 重做" },
  { group: "编辑", keys: "Tab / Shift+Tab", desc: "表格中跳到下一格 / 上一格" },

  // 视图
  { group: "视图", keys: "Ctrl+/", desc: "切换 所见即所得 / 源码" },
  { group: "视图", keys: "Ctrl+Shift+/", desc: "随航编辑（源码 ｜ 实时预览）" },
  { group: "视图", keys: "Ctrl+\\", desc: "折叠 / 展开侧栏" },
  { group: "视图", keys: "Ctrl+=", desc: "放大编辑区" },
  { group: "视图", keys: "Ctrl+-", desc: "缩小编辑区" },
  { group: "视图", keys: "F8", desc: "专注模式" },
  { group: "视图", keys: "F9", desc: "打字机模式（光标居中）" },
  { group: "视图", keys: "Ctrl+Shift+F", desc: "跨文件搜索" },

  // 查找与命令
  { group: "查找与命令", keys: "Ctrl+F", desc: "在当前文件内查找" },
  { group: "查找与命令", keys: "Ctrl+H", desc: "查找并替换" },
  { group: "查找与命令", keys: "Ctrl+Shift+P", desc: "命令面板（全部命令）" },
  { group: "查找与命令", keys: "Ctrl+P", desc: "快速打开（工作区文件）" },
  { group: "查找与命令", keys: "F1", desc: "帮助中心（Markdown 速查 / 快捷键 / 检查更新）" },

  // 其他
  { group: "其他", keys: "Ctrl+,", desc: "设置" },
  { group: "其他", keys: "Ctrl+Shift+H", desc: "快照历史面板" },
];

/** 按分组整理（保持 SHORTCUTS 里的分组出现顺序） */
export function shortcutGroups(): { group: string; items: ShortcutItem[] }[] {
  const map = new Map<string, ShortcutItem[]>();
  for (const s of SHORTCUTS) {
    const list = map.get(s.group);
    if (list) list.push(s);
    else map.set(s.group, [s]);
  }
  return Array.from(map, ([group, items]) => ({ group, items }));
}
