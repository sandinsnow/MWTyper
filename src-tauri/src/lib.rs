mod app;
mod export;
mod fs;
mod search;
mod snapshot;
mod stats;
mod themes;
mod watch;

use pulldown_cmark::{Alignment, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::sync::OnceLock;
use syntect::easy::HighlightLines;
use syntect::highlighting::ThemeSet;
use syntect::html::{styled_line_to_highlighted_html, IncludeBackground};
use syntect::parsing::SyntaxSet;

fn syntax_set() -> &'static SyntaxSet {
    static SS: OnceLock<SyntaxSet> = OnceLock::new();
    SS.get_or_init(SyntaxSet::load_defaults_newlines)
}

fn theme_set() -> &'static ThemeSet {
    static TS: OnceLock<ThemeSet> = OnceLock::new();
    TS.get_or_init(ThemeSet::load_defaults)
}

pub(crate) fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// 属性上下文转义：额外转义双引号与单引号，避免 `a" onmouseover="x` 逃逸出属性值。
/// 文本节点仍用 escape_html，避免影响既有输出与测试断言。
pub(crate) fn escape_attr(s: &str) -> String {
    escape_html(s).replace('"', "&quot;").replace('\'', "&#39;")
}

fn highlight_code(code: &str, lang: &str) -> String {
    let lang = lang.trim();
    if lang.is_empty() {
        return escape_html(code);
    }
    let ss = syntax_set();
    let syntax = match ss
        .find_syntax_by_token(lang)
        .or_else(|| ss.find_syntax_by_extension(lang))
    {
        Some(s) => s,
        None => return escape_html(code),
    };
    let theme = &theme_set().themes["base16-ocean.dark"];
    let mut hl = HighlightLines::new(syntax, theme);
    let mut html = String::with_capacity(code.len() * 2);
    for line in code.split_inclusive('\n') {
        match hl
            .highlight_line(line, ss)
            .and_then(|ranges| styled_line_to_highlighted_html(&ranges, IncludeBackground::No))
        {
            Ok(snippet) => html.push_str(&snippet),
            Err(_) => html.push_str(&escape_html(line)),
        }
    }
    html
}

/// Markdown → 标准 HTML（导出用；代码块带 syntect 内联配色）。
#[tauri::command]
fn md_to_html(md: &str) -> String {
    render_md(md)
}

pub(crate) fn render_md(md: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);

    let mut out = String::new();
    let mut in_code = false;
    let mut code_lang = String::new();
    let mut code_buf = String::new();
    let mut in_thead = false;
    let mut in_image = false;
    let mut img_src = String::new();
    let mut img_title = String::new();
    let mut img_alt = String::new();
    let mut table_aligns: Vec<Alignment> = Vec::new();
    let mut cell_idx = 0usize;

    for ev in Parser::new_ext(md, opts) {
        match ev {
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => out.push_str(&format!("<h{}>", level as u8)),
                Tag::Paragraph => out.push_str("<p>"),
                Tag::Strong => out.push_str("<strong>"),
                Tag::Emphasis => out.push_str("<em>"),
                Tag::Strikethrough => out.push_str("<del>"),
                Tag::CodeBlock(kind) => {
                    in_code = true;
                    code_buf.clear();
                    code_lang = match kind {
                        CodeBlockKind::Fenced(info) => {
                            info.split_whitespace().next().unwrap_or("").to_string()
                        }
                        CodeBlockKind::Indented => String::new(),
                    };
                    out.push_str(&format!(
                        "<pre><code class=\"language-{}\">",
                        escape_attr(&code_lang)
                    ));
                }
                Tag::Link { dest_url, .. } => {
                    out.push_str(&format!("<a href=\"{}\">", escape_attr(&dest_url)))
                }
                Tag::Image { dest_url, title, .. } => {
                    in_image = true;
                    img_src = dest_url.to_string();
                    img_title = title.to_string();
                    img_alt.clear();
                }
                Tag::List(Some(start)) => out.push_str(&format!("<ol start=\"{}\">", start)),
                Tag::List(None) => out.push_str("<ul>"),
                Tag::Item => out.push_str("<li>"),
                Tag::BlockQuote(..) => out.push_str("<blockquote>"),
                Tag::Table(aligns) => {
                    table_aligns = aligns;
                    out.push_str("<table>");
                }
                Tag::TableHead => {
                    in_thead = true;
                    cell_idx = 0;
                    out.push_str("<thead><tr>");
                }
                Tag::TableRow => {
                    cell_idx = 0;
                    out.push_str("<tr>");
                }
                Tag::TableCell => {
                    let style = match table_aligns.get(cell_idx).copied().unwrap_or(Alignment::None) {
                        Alignment::Left => " style=\"text-align:left\"",
                        Alignment::Center => " style=\"text-align:center\"",
                        Alignment::Right => " style=\"text-align:right\"",
                        Alignment::None => "",
                    };
                    out.push_str(&format!("<{}{}>", if in_thead { "th" } else { "td" }, style));
                    cell_idx += 1;
                }
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Heading(level) => out.push_str(&format!("</h{}>", level as u8)),
                TagEnd::Paragraph => out.push_str("</p>"),
                TagEnd::Strong => out.push_str("</strong>"),
                TagEnd::Emphasis => out.push_str("</em>"),
                TagEnd::Strikethrough => out.push_str("</del>"),
                TagEnd::CodeBlock => {
                    in_code = false;
                    out.push_str(&highlight_code(&code_buf, &code_lang));
                    out.push_str("</code></pre>");
                }
                TagEnd::Link => out.push_str("</a>"),
                TagEnd::Image => {
                    in_image = false;
                    let title_attr = if img_title.is_empty() {
                        String::new()
                    } else {
                        format!(" title=\"{}\"", escape_attr(&img_title))
                    };
                    out.push_str(&format!(
                        "<img src=\"{}\" alt=\"{}\"{} />",
                        escape_attr(&img_src),
                        escape_attr(&img_alt),
                        title_attr
                    ));
                }
                TagEnd::List(true) => out.push_str("</ol>"),
                TagEnd::List(false) => out.push_str("</ul>"),
                TagEnd::Item => out.push_str("</li>"),
                TagEnd::BlockQuote(..) => out.push_str("</blockquote>"),
                TagEnd::TableHead => {
                    in_thead = false;
                    out.push_str("</tr></thead><tbody>");
                }
                TagEnd::TableRow => out.push_str("</tr>"),
                TagEnd::TableCell => out.push_str(if in_thead { "</th>" } else { "</td>" }),
                TagEnd::Table => out.push_str("</tbody></table>"),
                _ => {}
            },
            Event::Text(txt) => {
                if in_code {
                    code_buf.push_str(&txt);
                } else if in_image {
                    img_alt.push_str(&txt);
                } else {
                    out.push_str(&escape_html(&txt));
                }
            }
            Event::Code(txt) => out.push_str(&format!("<code>{}</code>", escape_html(&txt))),
            Event::SoftBreak => out.push('\n'),
            Event::HardBreak => out.push_str("<br/>"),
            Event::Rule => out.push_str("<hr/>"),
            Event::Html(h) | Event::InlineHtml(h) => out.push_str(&h),
            Event::TaskListMarker(checked) => out.push_str(if checked {
                "<input type=\"checkbox\" checked disabled /> "
            } else {
                "<input type=\"checkbox\" disabled /> "
            }),
            _ => {}
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(watch::WatchState(std::sync::Mutex::new(None)))
        .manage(watch::ThemeWatchState(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            md_to_html,
            fs::list_tree,
            fs::read_file,
            fs::save_file,
            fs::rename_path,
            fs::delete_path,
            fs::save_image_asset,
            fs::read_settings,
            fs::write_settings,
            fs::pick_folder,
            fs::pick_open_file,
            fs::pick_save_file,
            stats::stats,
            watch::watch_folder,
            watch::unwatch_folder,
            watch::watch_themes,
            themes::themes_dir_path,
            themes::list_themes,
            themes::read_theme,
            themes::reveal_themes_dir,
            themes::install_builtin_themes,
            search::search_workspace,
            snapshot::snapshot_save,
            snapshot::snapshot_list,
            snapshot::snapshot_read,
            export::export_html,
            app::app_info,
            app::read_update_manifest,
            app::update_manifest_path,
            app::open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_gfm_and_highlights_code() {
        let md = "# 标题\n\n**粗体** 与 `code`\n\n```rust\nfn main() { let x = 1; }\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n";
        let html = md_to_html(md);
        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<strong>粗体</strong>"));
        assert!(html.contains("<table>"));
        assert!(html.contains("<span style=\"color:#"));
        assert!(html.contains("checked"));
    }

    #[test]
    fn unknown_language_falls_back_to_escaped_text() {
        let html = md_to_html("```\nplain <text> & more\n```\n");
        assert!(html.contains("plain &lt;text&gt; &amp; more"));
    }

    #[test]
    fn image_alt_from_children_not_leaked() {
        let html = md_to_html("![替代文字](pic.png \"标题\")\n");
        assert!(html.contains("<img src=\"pic.png\" alt=\"替代文字\" title=\"标题\" />"));
        assert!(!html.contains("替代文字</p>"), "alt 文本不应泄漏为正文：{}", html);
    }

    #[test]
    fn table_alignment_preserved() {
        let html = md_to_html("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n");
        assert!(html.contains("text-align:left"));
        assert!(html.contains("text-align:center"));
        assert!(html.contains("text-align:right"));
    }

    /// E05：属性上下文必须转义引号，否则 md 可注入 onmouseover 等事件属性。
    #[test]
    fn attribute_context_escapes_quotes() {
        // CommonMark 的链接目标不允许空格，故注入串写成无空格形式
        let md = "[x](a\"onmouseover=\"alert(1))\n\n![alt\"onerror=\"alert(2)](p.png \"t\\\" onx=\\\"\")\n";
        let html = md_to_html(md);
        assert!(!html.contains("onmouseover=\"alert(1)\""), "链接属性不得逃逸：{}", html);
        assert!(!html.contains("onerror=\"alert(2)\""), "图片 alt 属性不得逃逸：{}", html);
        assert!(!html.contains("onx=\"\""), "图片 title 属性不得逃逸：{}", html);
        assert!(html.contains("&quot;"), "引号应被转义为 &quot;：{}", html);
        // 代码块语言名同样处于 class 属性上下文
        let html2 = md_to_html("```\" onload=\"alert(3)\ncode\n```\n");
        assert!(!html2.contains("onload=\"alert(3)\""), "class 属性不得逃逸：{}", html2);
    }

    /// E05：文本节点转义行为不变（escape_html 不受属性转义影响）。
    #[test]
    fn text_nodes_keep_original_escaping() {
        let html = md_to_html("\" 引号 ' 单引号 <标签>\n");
        assert!(html.contains("<p>\" 引号 ' 单引号 &lt;标签&gt;</p>"), "文本节点保持原样转义：{}", html);
    }
}