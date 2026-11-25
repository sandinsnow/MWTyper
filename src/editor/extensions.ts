import { mergeAttributes } from "@tiptap/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableHeader, TableCell } from "./table";
import { CodeBlockHljs } from "./code-block";
import { MwtyperShortcuts } from "./shortcuts";
import { RawHtml } from "./raw-html";
import { MwtyperMarkdownManager } from "./markdown-serde";
import { MarkdownEscape } from "./markdown-escape";
import { isTauri } from "../ipc";

let imageBase: () => string | null = () => null;
export function setImageBaseGetter(fn: () => string | null) {
  imageBase = fn;
}

// Tauri 窗口内相对路径图片走 asset 协议；attrs 保留原始相对路径，序列化保真不受影响
const WorkspaceImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    let src: string = HTMLAttributes.src ?? "";
    if (isTauri && src && !/^(data:|blob:|https?:|asset:)/i.test(src)) {
      const base = imageBase();
      if (base) {
        const abs = /^([A-Za-z]:[\\/]|\/)/.test(src) ? src : base.replace(/[\\/]+$/, "") + "/" + src;
        src = convertFileSrc(abs);
      }
    }
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src })];
  },
});

export const extensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockHljs,
  MwtyperShortcuts,
  TaskList,
  TaskItem.configure({ nested: true }),
  // 块级公式必须 displayMode（默认 false 会按行内样式渲染）；
  // throwOnError:false 避免输入未完成公式时 NodeView 抛错
  InlineMath.configure({ katexOptions: { throwOnError: false } }),
  BlockMath.configure({ katexOptions: { displayMode: true, throwOnError: false } }),
  WorkspaceImage,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  // 承载原始 HTML 块（注释 / <script> / 带属性 div）：schema 里没有它时
  // 这些内容在 parse → serialize 往返中会被静默丢弃（缺陷 B1/B4）
  RawHtml,
  // 处理 marked 的 escape token：没有它，反斜杠转义的字符在解析时被整段丢弃
  MarkdownEscape,
  // 空文档提示：编辑器一片空白时给出可写的引导。
  // 文案只放主提示，辅助提示（Markdown 语法 / 快捷键）由 CSS 的 ::after 分行呈现 ——
  // 合成一长串会让提示变成一堵墙，也看不出主次。
  Placeholder.configure({ placeholder: "开始写作…" }),
];

// 自建 MarkdownManager：补脚注定义保留（B4）与段落行首转义（B3）
export const markdown = new MwtyperMarkdownManager({ extensions });

// marked 不解析 YAML frontmatter：剥离单独保管，序列化时回贴（spike ② 结论）
//
// BOM 处理：Windows 编辑器保存的 UTF-8 文件常带 BOM（U+FEFF）。若不先剥离，
// 正则的 `^---` 锚点会失配 → frontmatter 不被剥离 → 往返后 YAML 降级为正文，
// 实测 `"---\ntitle: x\n---\n\n正文"` 会变成 `"## ---\ntitle: x\n\n正文"`（语义彻底丢失）。
export function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  // BOM 属于文件编码标记，不属于 frontmatter 内容：剥离时保留在 frontmatter 里回贴，
  // 否则保存后会丢掉 BOM（部分工具依赖它判定 UTF-8）。
  let bom = "";
  let text = md;
  if (text.charCodeAt(0) === 0xfeff) {
    bom = "\uFEFF";
    text = text.slice(1);
  }
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m) return { frontmatter: bom, body: text };
  return { frontmatter: bom + m[0], body: text.slice(m[0].length) };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter ? frontmatter + body : body;
}