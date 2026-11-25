/**
 * Markdown 语法速查表 —— 帮助中心「Markdown 帮助」的数据源。
 *
 * 每条含三部分：
 * - `syntax`：语法写法（等宽展示）
 * - `desc`：一句话说明
 * - `template`：**插入到光标处的模板**（点「插入」按钮会写进文档）
 *
 * 标注 `note` 的条目是本项目的**真实限制**，不是 Markdown 规范问题 ——
 * 帮助面板要如实告知用户，避免「照着速查表写却没效果」。
 */

export interface MarkdownRefItem {
  syntax: string;
  desc: string;
  template?: string;
  /** 本项目的特有说明 / 限制 */
  note?: string;
}

export interface MarkdownRefGroup {
  id: string;
  title: string;
  items: MarkdownRefItem[];
}

export const MARKDOWN_REF: MarkdownRefGroup[] = [
  {
    id: "basic",
    title: "基础",
    items: [
      { syntax: "# 一级标题", desc: "1~6 级标题，用 # 的个数表示层级", template: "# 标题\n" },
      { syntax: "**粗体**", desc: "加粗", template: "**粗体**" },
      { syntax: "*斜体*", desc: "斜体", template: "*斜体*" },
      { syntax: "~~删除线~~", desc: "删除线", template: "~~删除线~~" },
      { syntax: "`行内代码`", desc: "行内代码", template: "`code`" },
      { syntax: "```lang\n代码\n```", desc: "围栏代码块，lang 可指定语法高亮", template: "```ts\nconst a: number = 1;\n```\n" },
      { syntax: "---", desc: "分割线", template: "\n---\n" },
      { syntax: "反斜杠转义 \\*", desc: "转义特殊字符，让它按字面显示", template: "\\*" },
    ],
  },
  {
    id: "block",
    title: "块与列表",
    items: [
      { syntax: "> 引用", desc: "引用块，可嵌套", template: "> 引用内容\n" },
      { syntax: "- 无序列表", desc: "无序列表（- / * / + 都可）", template: "- 列表项\n" },
      { syntax: "1. 有序列表", desc: "有序列表", template: "1. 列表项\n" },
      { syntax: "- [ ] 待办", desc: "任务列表，在所见即所得里可勾选", template: "- [ ] 待办事项\n" },
      { syntax: "缩进 4 空格", desc: "缩进代码块（围栏代码块更常用）", template: "    缩进代码\n" },
    ],
  },
  {
    id: "link",
    title: "链接与图片",
    items: [
      { syntax: "[文字](https://example.com)", desc: "行内链接", template: "[链接文字](https://example.com)" },
      { syntax: "![替代文字](图片.png)", desc: "图片；替代文字会在图片缺失时显示", template: "![图片说明](image.png)" },
      { syntax: "<https://example.com>", desc: "自动链接", template: "<https://example.com>" },
      { syntax: "[引用式][ref]", desc: "引用式链接，定义写 [ref]: https://…", template: "[引用文字][ref]\n\n[ref]: https://example.com\n" },
      { syntax: "相对路径", desc: "图片用相对路径时，按**文件所在目录**解析，不是工作区根", template: "" },
    ],
  },
  {
    id: "table",
    title: "表格",
    items: [
      {
        syntax: "| 左 | 右 |\n| --- | --- |\n| 1 | 2 |",
        desc: "GFM 表格，第二行是分隔行",
        template: "| 列 A | 列 B |\n| --- | --- |\n| 值 1 | 值 2 |\n",
      },
      { syntax: "| :-- | --: |", desc: "对齐：左 / 居中 / 右", template: "" },
    ],
  },
  {
    id: "math",
    title: "公式",
    items: [
      { syntax: "$E = mc^2$", desc: "行内公式", template: "$E = mc^2$" },
      { syntax: "$$\n\\int_0^1 x dx\n$$", desc: "块级公式（独立成段）", template: "$$\n\\int_0^1 x\\,dx\n$$\n" },
    ],
  },
  {
    id: "advanced",
    title: "进阶与本项目说明",
    items: [
      {
        syntax: "脚注 [^1]",
        desc: "脚注引用，定义写作 [^1]: 脚注内容",
        template: "脚注引用[^1]\n\n[^1]: 脚注内容\n",
      },
      {
        syntax: "HTML 块",
        desc: "原始 HTML 会原样保留（以代码块形式呈现，不参与渲染）",
        template: "<!-- 注释 -->\n",
      },
      {
        syntax: "以 - 或 # 开头的普通段落",
        desc: "会被当成列表 / 标题 —— 编辑器已自动加反斜杠转义",
        note: "所见即所得里直接输入 - 开头的一行，保存时会自动转义成 \\- ，再解析回来仍是普通段落。",
      },
      {
        syntax: "源码模式的语法高亮",
        desc: "源码模式里 Markdown 标记符会各自着色",
        note: "源码模式基于 CommonMark 解析器，不认 GFM 删除线，所以 ~~删除线~~ 在源码里不会单独着色（所见即所得里正常）。",
      },
    ],
  },
];

/** 速查表条目总数（设置面板/帮助中心可以显示） */
export const MARKDOWN_REF_COUNT = MARKDOWN_REF.reduce((n, g) => n + g.items.length, 0);
