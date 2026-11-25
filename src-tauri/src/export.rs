use base64::Engine;
use std::fs;
use std::path::Path;

const BASE_CSS: &str = r#"
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.75; font-size: 16px; }
body[data-theme="light"] { background: #ffffff; color: #1f2937; }
body[data-theme="dark"] { background: #22252b; color: #d6d9de; }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 40px 32px 80px; }
.markdown-body > * + * { margin-top: 0.75em; }
h1 { font-size: 1.9em; border-bottom: 1px solid #8884; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #8884; padding-bottom: 0.25em; }
h3 { font-size: 1.25em; }
blockquote { border-left: 4px solid #34d399; margin-left: 0; padding: 8px 16px; background: #8881; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #8886; padding: 6px 12px; text-align: left; }
th { background: #8882; }
hr { border: none; border-top: 2px solid #8884; margin: 1.5em 0; }
code { font-family: Consolas, "Courier New", monospace; font-size: 0.9em; background: #8882; border-radius: 4px; padding: 2px 5px; }
pre { background: #282c34; border-radius: 8px; overflow-x: auto; }
pre code { display: block; padding: 12px 16px; background: none; color: #abb2bf; font-size: 14px; line-height: 1.6; }
img { max-width: 100%; }
a { color: #10b981; }
ul[data-type="taskList"] { list-style: none; padding-left: 0.5em; }
.katex-display { overflow-x: auto; padding: 4px 0; }
@media print { body { background: #fff !important; color: #111 !important; } .markdown-body { max-width: none; padding: 0; } }
"#;

fn mime_of(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

/// E11：只允许内嵌 base_dir 内的图片。两侧都 canonicalize 后比较前缀，
/// `../` 越界、绝对路径、符号链接逃逸都会被拒绝（Windows 下 canonicalize 归一化盘符与分隔符）。
fn read_local_image(base_dir: &str, rel: &str) -> Option<(std::path::PathBuf, Vec<u8>)> {
    let base = fs::canonicalize(base_dir).ok()?;
    let target = fs::canonicalize(Path::new(base_dir).join(rel)).ok()?;
    if !target.starts_with(&base) {
        return None;
    }
    let bytes = fs::read(&target).ok()?;
    Some((target, bytes))
}

/// Markdown → 单文件 HTML（SPEC §5.4 / D5）。
/// md 中的公式已由前端替换为 KaTeX HTML（pulldown Html 事件透传）；
/// extra_css 携带字体已内嵌的 KaTeX 样式；图片可选 base64 内嵌。
#[tauri::command]
pub fn export_html(
    md: String,
    title: String,
    theme: String,
    extra_css: String,
    base_dir: String,
    embed_images: bool,
) -> String {
    let mut body = crate::render_md(&md);
    if embed_images {
        let re = regex::Regex::new(r#"<img src="([^"]+)""#).unwrap();
        body = re
            .replace_all(&body, |caps: &regex::Captures| {
                let src = &caps[1];
                if src.starts_with("data:") || src.starts_with("http://") || src.starts_with("https://") {
                    return caps[0].to_string();
                }
                let decoded = src.replace("&amp;", "&");
                match read_local_image(&base_dir, &decoded) {
                    Some((p, bytes)) => {
                        let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                        format!(
                            "<img src=\"data:{};base64,{}\"",
                            mime_of(&ext),
                            base64::engine::general_purpose::STANDARD.encode(&bytes)
                        )
                    }
                    None => caps[0].to_string(),
                }
            })
            .to_string();
    }
    let theme = if theme == "dark" { "dark" } else { "light" };
    format!(
        "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{}</title>\n<style>{}{}</style>\n</head>\n<body data-theme=\"{}\">\n<main class=\"markdown-body\">\n{}\n</main>\n</body>\n</html>\n",
        crate::escape_html(&title),
        BASE_CSS,
        extra_css,
        theme,
        body
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_document_and_passes_katex_html() {
        let html = export_html(
            "# 标题\n\n<span class=\"katex\">E=mc^2</span>\n".into(),
            "测试文档".into(),
            "dark".into(),
            ".katex{font-size:1.1em}".into(),
            ".".into(),
            false,
        );
        assert!(html.starts_with("<!doctype html>"));
        assert!(html.contains("<title>测试文档</title>"));
        assert!(html.contains("data-theme=\"dark\""));
        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<span class=\"katex\">E=mc^2</span>"), "KaTeX HTML 透传");
        assert!(html.contains(".katex{font-size:1.1em}"));
    }

    #[test]
    fn embeds_local_images_only() {
        let dir = std::env::temp_dir().join(format!("mwtyper-export-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("pic.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
        let html = export_html(
            "![图](pic.png)\n\n![远](https://x.test/a.png)\n".into(),
            "t".into(),
            "light".into(),
            String::new(),
            dir.to_string_lossy().into(),
            true,
        );
        assert!(html.contains("src=\"data:image/png;base64,iVBORw==\""), "本地图内嵌");
        assert!(html.contains("src=\"https://x.test/a.png\""), "远程图保持原样");
        fs::remove_dir_all(&dir).ok();
    }

    /// E11：`../` 越界的图片不得被读取并 base64 内嵌进导出物。
    #[test]
    fn rejects_images_outside_base_dir() {
        let dir = std::env::temp_dir().join(format!("mwtyper-export-inside-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("mwtyper-export-secret-{}.png", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(&outside, [0x89, 0x50, 0x4e, 0x47]).unwrap();
        fs::write(dir.join("inside.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
        let rel = format!("../{}", outside.file_name().unwrap().to_string_lossy());
        let html = export_html(
            format!("![in](inside.png)\n\n![out]({rel})\n"),
            "t".into(),
            "light".into(),
            String::new(),
            dir.to_string_lossy().into(),
            true,
        );
        assert_eq!(
            html.matches("data:image/png;base64,").count(),
            1,
            "只应内嵌目录内的图片：{}",
            html
        );
        assert!(html.contains(&rel), "越界路径保持原样，不内嵌：{}", html);
        fs::remove_dir_all(&dir).ok();
        fs::remove_file(&outside).ok();
    }
}