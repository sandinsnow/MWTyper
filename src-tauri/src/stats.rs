use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;

#[derive(Serialize, Clone, Copy)]
pub struct Stats {
    pub words: usize,
    pub chars: usize,
    pub reading_minutes: usize,
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF
        | 0x3000..=0x303F | 0xFF00..=0xFFEF)
}

/// 字数：中文按字（含中文标点）、英文按词；代码块不计入正文统计。
#[tauri::command]
pub fn stats(md: &str) -> Stats {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);

    let mut text = String::new();
    let mut in_code = false;
    for ev in Parser::new_ext(md, opts) {
        match ev {
            Event::Start(Tag::CodeBlock(_)) => in_code = true,
            Event::End(TagEnd::CodeBlock) => in_code = false,
            Event::Text(t) if !in_code => text.push_str(&t),
            Event::Code(t) => {
                text.push_str(&t);
                text.push(' ');
            }
            _ => {}
        }
    }

    let chars = text.chars().filter(|c| !c.is_whitespace()).count();
    let mut words = 0usize;
    let mut in_word = false;
    for c in text.chars() {
        if is_cjk(c) {
            words += 1;
            in_word = false;
        } else if c.is_alphanumeric() {
            if !in_word {
                words += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    let reading_minutes = if words == 0 { 0 } else { (words + 299) / 300 };
    Stats { words, chars, reading_minutes }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_chinese_english_counting() {
        let s = stats("你好世界 hello world\n");
        assert_eq!(s.words, 6, "4 中文字 + 2 英文词");
        assert_eq!(s.chars, 14, "4 + 5 + 5");
    }

    #[test]
    fn code_block_excluded_inline_code_counted() {
        let s = stats("正文 `x=1`\n\n```rust\nfn main() {}\n```\n");
        assert_eq!(s.words, 4, "正文 2 字 + 行内代码 2 词（x、1）；代码块不计");
    }

    #[test]
    fn empty_doc_zero() {
        let s = stats("");
        assert_eq!((s.words, s.chars, s.reading_minutes), (0, 0, 0));
    }

    #[test]
    fn reading_time_rounds_up() {
        let s = stats(&"字".repeat(301));
        assert_eq!(s.reading_minutes, 2);
    }
}