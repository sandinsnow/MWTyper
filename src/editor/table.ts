import { Node, type MarkdownToken, type MarkdownParseHelpers, type MarkdownRendererHelpers, type JSONContent } from "@tiptap/core";

// store 无 @tiptap/extension-table：自定义节点接 marked 的 GFM table token（M0 spike ② 已验证往返保真）

function cellContent(token: MarkdownToken, helpers: MarkdownParseHelpers): JSONContent[] {
  return [{ type: "paragraph", content: helpers.parseInline((token as any).tokens || []) }];
}

function renderCell(node: JSONContent, helpers: MarkdownRendererHelpers): string {
  return helpers.renderChildren(node.content || []).replace(/\n+/g, " ").trim();
}

// prosemirror-tables 的 TableMap 依赖 colspan/rowspan 计算网格，缺省即命令全部失效
const cellAttrs = () => ({
  colspan: { default: 1 },
  rowspan: { default: 1 },
});

export const TableCell = Node.create({
  name: "tableCell",
  group: "tableCell",
  content: "block+",
  extendNodeSchema: (ext) => (ext.name === "tableCell" ? { tableRole: "cell" } : {}),
  addAttributes: cellAttrs,
  isolating: true,
  parseHTML: () => [{ tag: "td" }],
  renderHTML: ({ HTMLAttributes }) => ["td", HTMLAttributes, 0],
  parseMarkdown: (token, helpers) => ({ type: "tableCell", content: cellContent(token, helpers) }),
  renderMarkdown: (node, helpers) => renderCell(node, helpers),
});

export const TableHeader = Node.create({
  name: "tableHeader",
  group: "tableCell",
  content: "block+",
  extendNodeSchema: (ext) => (ext.name === "tableHeader" ? { tableRole: "header_cell" } : {}),
  addAttributes: cellAttrs,
  isolating: true,
  parseHTML: () => [{ tag: "th" }],
  renderHTML: ({ HTMLAttributes }) => ["th", HTMLAttributes, 0],
  parseMarkdown: (token, helpers) => ({ type: "tableHeader", content: cellContent(token, helpers) }),
  renderMarkdown: (node, helpers) => renderCell(node, helpers),
});

export const TableRow = Node.create({
  name: "tableRow",
  group: "tableRow",
  content: "(tableCell | tableHeader)*",
  extendNodeSchema: (ext) => (ext.name === "tableRow" ? { tableRole: "row" } : {}),
  parseHTML: () => [{ tag: "tr" }],
  renderHTML: ({ HTMLAttributes }) => ["tr", HTMLAttributes, 0],
  parseMarkdown: (token, helpers) => ({
    type: "tableRow",
    content: ((token as any).tokens || []).map((c: any) =>
      c.type === "table_header_cell" || c.header
        ? { type: "tableHeader", content: cellContent(c, helpers) }
        : { type: "tableCell", content: cellContent(c, helpers) }
    ),
  }),
  renderMarkdown: (node, helpers) =>
    "| " + (node.content || []).map((c) => helpers.renderChildren([c])).join(" | ") + " |",
});

export const Table = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  extendNodeSchema: (ext) => (ext.name === "table" ? { tableRole: "table" } : {}),
  isolating: true,
  parseHTML: () => [{ tag: "table" }],
  renderHTML: ({ HTMLAttributes }) => ["table", ["tbody", 0]],
  parseMarkdown: (token, helpers) => {
    const t = token as any;
    const headerCells: JSONContent[] = (t.header || []).map((c: any) => ({ type: "tableHeader", content: cellContent(c, helpers) }));
    const rows: JSONContent[] = [];
    // 表格首行必须是 tableHeader：GFM/Markdown 里第一行就是表头，
    // 反过来序列化时才能稳定还原成同一张表（缺陷 B2）
    if (headerCells.length) {
      rows.push({ type: "tableRow", content: headerCells });
    }
    for (const row of t.rows || []) {
      rows.push({
        type: "tableRow",
        content: row.map((c: any) => ({ type: "tableCell", content: cellContent(c, helpers) })),
      });
    }
    // 没有 header 的表格（理论上不会出现）→ 把首行提升为表头，保证往返稳定
    if (!rows.length && t.rows && t.rows.length) {
      const first = t.rows[0];
      rows.push({
        type: "tableRow",
        content: first.map((c: any) => ({ type: "tableHeader", content: cellContent(c, helpers) })),
      });
      for (const row of t.rows.slice(1)) {
        rows.push({
          type: "tableRow",
          content: row.map((c: any) => ({ type: "tableCell", content: cellContent(c, helpers) })),
        });
      }
    }
    return { type: "table", content: rows };
  },
  renderMarkdown: (node, helpers) => {
    const rows = node.content || [];
    if (!rows.length) return "";
    // 表头行按 schema 里 tableHeader 节点的实际位置确定（缺陷 B2）：
    // 老实现无条件把分隔行插在第 2 行，于是在表头前插入一行后，
    // 那个空行被当成表头、真正的表头降级成数据行 → 往返一次表头内容就丢了。
    const headerIndex = rows.findIndex((r) => (r.content || []).some((c) => c.type === "tableHeader"));
    if (headerIndex === -1) {
      // 没有表头：不凭空造分隔行（GFM 表必须是「表头 + 分隔行」才能被解析）
      return rows.map((r) => helpers.renderChildren([r])).join("\n");
    }
    // GFM 只认第一行做表头：把真正的表头行提到最前面，
    // 它前面的行降级为紧随其后的数据行（内容不丢，只是相对位置后移）
    const header = rows[headerIndex];
    const rest = rows.filter((_, i) => i !== headerIndex);
    const cols = (header.content || []).length;
    const lines = [helpers.renderChildren([header]), "| " + Array(cols).fill("---").join(" | ") + " |"];
    for (const r of rest) lines.push(helpers.renderChildren([r]));
    return lines.join("\n");
  },
});