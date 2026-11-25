use std::fs;
use std::path::PathBuf;

pub(crate) fn themes_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("MWTyper").join("themes")
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub fn themes_dir_path() -> Result<String, String> {
    let d = themes_dir();
    fs::create_dir_all(&d).map_err(|e| format!("创建主题目录失败：{e}"))?;
    Ok(crate::fs::path_str(&d))
}

#[tauri::command]
pub fn list_themes() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(themes_dir()) {
        for e in rd.flatten() {
            let p = e.path();
            let is_css = p.extension().map(|x| x.to_string_lossy().to_lowercase()).as_deref() == Some("css");
            if !is_css {
                continue;
            }
            if let Some(stem) = p.file_stem().map(|s| s.to_string_lossy().to_string()) {
                if valid_name(&stem) {
                    out.push(stem);
                }
            }
        }
    }
    out.sort();
    out
}

/// 内置示例主题：编译进 exe，用户在设置面板点一下即可安装到主题目录。
///
/// 每套主题都**显式给出浅色（:root）与深色（[data-theme="dark"]）两组基色** ——
/// 由前端的主题派生器展开成整套界面配色并做对比度兜底（见 SPEC §5.7）。
const BUILTIN_THEMES: &[(&str, &str)] = &[
    ("warm-sample", include_str!("../../examples/themes/warm-sample.css")),
    ("celadon", include_str!("../../examples/themes/celadon.css")),
    ("dusk", include_str!("../../examples/themes/dusk.css")),
    ("graphite", include_str!("../../examples/themes/graphite.css")),
    ("sea-salt", include_str!("../../examples/themes/sea-salt.css")),
];

/// 安装内置示例主题，返回**本次新装上**的主题名。
///
/// 已存在的同名文件**不覆盖** —— 用户可能已经改过它，静默覆盖会丢掉他们的修改。
#[tauri::command]
pub fn install_builtin_themes() -> Result<Vec<String>, String> {
    let dir = themes_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建主题目录失败：{e}"))?;
    let mut installed = Vec::new();
    for (name, css) in BUILTIN_THEMES {
        let path = dir.join(format!("{name}.css"));
        if path.exists() {
            continue;
        }
        fs::write(&path, css).map_err(|e| format!("写入主题「{name}」失败：{e}"))?;
        installed.push((*name).to_string());
    }
    Ok(installed)
}

#[tauri::command]
pub fn read_theme(name: String) -> Result<String, String> {
    if !valid_name(&name) {
        return Err("主题名无效".into());
    }
    fs::read_to_string(themes_dir().join(format!("{name}.css"))).map_err(|e| format!("读取主题失败：{e}"))
}

/// C7：用系统文件管理器打开主题目录（不新增依赖，仅调用系统命令）。
#[tauri::command]
pub fn reveal_themes_dir() -> Result<(), String> {
    let d = themes_dir();
    fs::create_dir_all(&d).map_err(|e| format!("创建主题目录失败：{e}"))?;
    open_dir(&d)
}

#[cfg(target_os = "windows")]
fn open_dir(dir: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开主题目录失败：{e}"))
}

#[cfg(target_os = "macos")]
fn open_dir(dir: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开主题目录失败：{e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_dir(dir: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开主题目录失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_whitelist_blocks_traversal() {
        assert!(valid_name("my-theme_2"));
        assert!(!valid_name(".."));
        assert!(!valid_name("a/b"));
        assert!(!valid_name(""));
        assert!(!valid_name("中文"));
        assert!(read_theme("../settings".into()).is_err());
        assert!(read_theme("a/b".into()).is_err());
    }

    #[test]
    fn missing_theme_errors() {
        assert!(read_theme("definitely-not-exist-xyz".into()).is_err());
    }

    /// 每套内置主题都必须**同时**给出浅色与深色两组基色 ——
    /// 缺一块就会出现「切到深色模式还是浅色的」这类问题。
    #[test]
    fn builtin_themes_declare_both_light_and_dark() {
        assert!(BUILTIN_THEMES.len() >= 5, "内置主题数量不足");
        for (name, css) in BUILTIN_THEMES {
            assert!(css.contains(":root"), "主题「{}」缺少浅色基色块", name);
            assert!(
                css.contains("[data-theme=\"dark\"]"),
                "主题「{}」缺少深色基色块",
                name
            );
            assert!(css.contains("--mw-base-bg"), "主题「{}」缺少 --mw-base-bg", name);
            assert!(
                css.contains("--mw-base-fg"),
                "主题「{}」缺少 --mw-base-fg",
                name
            );
            assert!(
                css.contains("--mw-base-accent"),
                "主题「{}」缺少 --mw-base-accent",
                name
            );
        }
    }

    /// 主题名必须满足 themes.rs 自己的 valid_name 规则，否则装不进去。
    #[test]
    fn builtin_theme_names_are_valid() {
        for (name, _) in BUILTIN_THEMES {
            assert!(valid_name(name), "主题名「{}」不合法", name);
        }
    }
}
