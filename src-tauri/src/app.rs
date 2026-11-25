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
}
