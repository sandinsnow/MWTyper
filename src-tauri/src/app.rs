use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 应用信息（版本号等），供「关于」「检查更新」展示。
#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub build_time: String,
}

/// 更新清单：放在 `%APPDATA%/MWTyper/update-manifest.json`。
///
/// 为什么是本地文件而不是联网拉取：本应用是**离线优先**设计，构建环境无网络、
/// 无 HTTP 客户端（cargo 缓存里没有 reqwest 之类的客户端），WebView 的 CSP 也把
/// `connect-src` 限制在 `ipc:`。与其做一个必然失败的「联网检查」，不如把更新源
/// 做成一个**用户可放置的本地文件**：检查逻辑与将来接在线源完全一致，
/// 只是把「取清单」这一步从网络换成本地文件。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub published_at: String,
}

fn data_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("MWTyper")
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let info = app.package_info();
    AppInfo {
        name: info.name.clone(),
        version: info.version.to_string(),
        build_time: env!("MWTYPER_BUILD_TIME").to_string(),
    }
}

/// 解析更新清单文本（纯函数，便于单测）。
pub fn parse_manifest(text: &str) -> Result<UpdateManifest, String> {
    match serde_json::from_str::<UpdateManifest>(text) {
        Ok(m) => Ok(m),
        Err(e) => Err(format!("更新清单格式有误：{e}")),
    }
}

/// 读取更新清单；没有或格式不对时返回 `Ok(None)`（**不是错误** —— 没放清单是正常状态）。
#[tauri::command]
pub fn read_update_manifest() -> Result<Option<UpdateManifest>, String> {
    let path = data_dir().join("update-manifest.json");
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    parse_manifest(&text).map(Some)
}

/// 更新清单的存放路径（帮助中心要把它显示给用户）。
#[tauri::command]
pub fn update_manifest_path() -> String {
    data_dir().join("update-manifest.json").to_string_lossy().to_string()
}

/// 校验一个待打开的外部链接：只放行 http/https/mailto。
///
/// 裸的 `cmd /c start` 方案会把 URL 拼进命令行，`&` `|` `^` 等字符会被 shell 解释；
/// 而 `ShellExecuteW` 直接把字符串交给系统协议处理器，不经 shell，因此这些字符
/// 不会被二次解释 —— 仍要拒绝**控制字符**与**裸引号**：
/// 协议处理器最终可能把 URL 交给某个命令行程序，裸引号会破坏它的参数引用。
/// 合法 URL 里这两类字符都必须百分号编码，故不会误伤正常链接。
fn validate_external_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !scheme_ok {
        return Err("仅支持 http/https/mailto 链接".into());
    }
    if trimmed
        .chars()
        .any(|c| c.is_ascii_control() || c == '"')
    {
        return Err("链接含非法字符（控制字符或未编码的引号）".into());
    }
    Ok(trimmed.to_string())
}

/// 在系统默认浏览器打开外部链接（「检查更新 → 打开下载页」）。
///
/// 用 `ShellExecuteW` 直接交给系统协议处理器，**不经 cmd/shell**，
/// 因此 URL 里的 `& ? = % #` 既不会被解释成命令，也不需要字符集白名单。
///
/// `async` 属性：启动浏览器可能阻塞数百毫秒，不能占住主线程。
#[tauri::command(async)]
pub fn open_external(url: String) -> Result<(), String> {
    let trimmed = validate_external_url(&url)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use winapi::um::shellapi::ShellExecuteW;
        use winapi::um::winuser::SW_SHOWNORMAL;

        let wide = |s: &str| -> Vec<u16> {
            std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        };
        let op = wide("open");
        let target = wide(&trimmed);
        let rc = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        // 返回值 >32 表示成功；<=32 是错误码（如 31 = 无关联程序）。
        if (rc as isize) <= 32 {
            return Err(format!("打开链接失败（代码 {}）", rc as isize));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = trimmed;
        Err("当前平台暂不支持打开外部链接".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 清单只有 version 是必填，其余字段可有可无。
    #[test]
    fn manifest_requires_only_version() {
        let m = parse_manifest(r#"{"version":"0.2.0"}"#).unwrap();
        assert_eq!(m.version, "0.2.0");
        assert_eq!(m.url, "");
        assert_eq!(m.notes, "");
        assert_eq!(m.published_at, "");
    }

    /// 完整清单应原样读出。
    #[test]
    fn manifest_reads_all_fields() {
        let m = parse_manifest(
            r#"{"version":"9.9.9","url":"https://x/y.exe","notes":"n","publishedAt":"2026-11-25"}"#,
        )
        .unwrap();
        assert_eq!(m.version, "9.9.9");
        assert_eq!(m.url, "https://x/y.exe");
        assert_eq!(m.notes, "n");
        assert_eq!(m.published_at, "2026-11-25");
    }

    /// 坏 JSON 必须给出可读的错误（帮助中心要把它显示给用户）。
    #[test]
    fn manifest_reports_bad_json() {
        let e = parse_manifest("{ not json").unwrap_err();
        assert!(e.contains("更新清单格式有误"), "{}", e);
    }

    /// 只放行 http/https/mailto —— 其余协议（javascript/data/file/vbscript…）一律拒绝。
    #[test]
    fn external_url_rejects_non_web_schemes() {
        for bad in [
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///C:/Windows/win.ini",
            "vbscript:msgbox(1)",
            "//evil.example/a",
            "",
        ] {
            assert!(
                validate_external_url(bad).is_err(),
                "应拒绝：{bad:?}"
            );
        }
    }

    /// 控制字符与裸引号一律拒绝（协议处理器可能把 URL 交给命令行程序）。
    ///
    /// 注意：**首尾**的空白会被裁掉（用户从剪贴板粘贴时常常带尾随换行），
    /// 因此只有出现在 URL **中间**的换行才是注入尝试。
    #[test]
    fn external_url_rejects_control_chars_and_quotes() {
        for bad in [
            "https://ok.example/\r\nX-Injected: 1",
            "https://ok.example/\" -- \"",
            "https://ok.example/\u{0}",
            "https://ok.example/a\nb",
        ] {
            assert!(
                validate_external_url(bad).is_err(),
                "应拒绝：{bad:?}"
            );
        }
    }

    /// 合法链接放行，且首尾空白被裁掉（含尾随换行）。
    #[test]
    fn external_url_accepts_web_links() {
        assert_eq!(
            validate_external_url("  https://github.com/sandinsnow/MWTyper/releases/latest  ").unwrap(),
            "https://github.com/sandinsnow/MWTyper/releases/latest"
        );
        assert_eq!(
            validate_external_url("https://ok.example/path\n").unwrap(),
            "https://ok.example/path"
        );
        assert_eq!(
            validate_external_url("mailto:someone@example.com").unwrap(),
            "mailto:someone@example.com"
        );
    }
}
