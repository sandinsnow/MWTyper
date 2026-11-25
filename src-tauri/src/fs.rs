use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// A10：把 asset 协议的可读范围动态收窄到「当前工作区 / 当前文件所在目录」。
///
/// 关键点：**必须在返回内容之前完成放行**。
/// 前端渲染图片时（WorkspaceImage.renderHTML → convertFileSrc）会立刻发起 asset: 请求，
/// 而放行动作若只发生在 watch_folder（由 React useEffect 触发），
/// 则首帧图片请求会早于放行 → 403 白图。
/// 故在「产出内容」的命令里同步放行，杜绝竞态。
///
/// 放行范围与前端 asset 基准目录一致：
/// 有工作区时是工作区根（list_tree 放行，递归覆盖工作区内全部相对路径图片），
/// 无工作区时是当前文件所在目录（read_file 放行）。
fn allow_asset_dir(app: &AppHandle, dir: Option<&Path>) {
    let Some(dir) = dir else { return };
    if dir.as_os_str().is_empty() {
        return;
    }
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(dir, true);
}

/// 单个文件对应的 asset 基准目录 = 其父目录；无父目录（相对路径）时返回 None。
fn asset_dir_for_file(path: &str) -> Option<PathBuf> {
    Path::new(path)
        .parent()
        .map(|p| p.to_path_buf())
        .filter(|p| !p.as_os_str().is_empty())
}

#[derive(Serialize, Clone)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub children: Option<Vec<TreeNode>>,
}

pub(crate) const MD_EXTS: [&str; 3] = ["md", "markdown", "txt"];

pub(crate) fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist"
}

pub(crate) fn path_str(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// 目录递归深度上限：即使出现无法识别的链接环也不会栈溢出。
const MAX_TREE_DEPTH: usize = 32;

fn build_dir(dir: &Path, depth: usize) -> TreeNode {
    let mut entries: Vec<(bool, String, PathBuf)> = Vec::new();
    if depth < MAX_TREE_DEPTH {
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if is_ignored(&name) {
                    continue;
                }
                let p = e.path();
                // symlink_metadata 不跟随链接；跳过符号链接，防止目录环无限递归。
                let meta = match fs::symlink_metadata(&p) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.file_type().is_symlink() {
                    continue;
                }
                let is_dir = meta.is_dir();
                if !is_dir {
                    let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                    if !MD_EXTS.contains(&ext.as_str()) {
                        continue;
                    }
                }
                entries.push((!is_dir, name.to_lowercase(), p));
            }
        }
    }
    entries.sort();
    let children = entries
        .into_iter()
        .map(|(_, _, p)| {
            if p.is_dir() {
                build_dir(&p, depth + 1)
            } else {
                TreeNode {
                    name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    path: path_str(&p),
                    kind: "file".into(),
                    children: None,
                }
            }
        })
        .collect();
    TreeNode {
        name: dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path_str(dir)),
        path: path_str(dir),
        kind: "dir".into(),
        children: Some(children),
    }
}

#[tauri::command]
pub fn list_tree(app: AppHandle, root: String) -> Result<TreeNode, String> {
    let p = Path::new(&root);
    if !p.is_dir() {
        return Err("目录不存在或不可读".into());
    }
    // A10：工作区根目录递归放行给 asset 协议（工作区内相对路径图片的前提）。
    allow_asset_dir(&app, Some(p));
    Ok(build_dir(p, 0))
}

/// 读取文件内容（纯逻辑，便于单测直接调用）。
fn read_file_inner(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("读取失败：{e}"))
}

#[tauri::command]
pub fn read_file(app: AppHandle, path: String) -> Result<String, String> {
    // A10：先放行文件所在目录，再返回内容 —— 保证前端首帧渲染的 asset: 图片请求不被拒。
    let dir = asset_dir_for_file(&path);
    allow_asset_dir(&app, dir.as_deref());
    read_file_inner(&path)
}

/// 原子写：同目录临时文件 + rename，避免写一半崩溃留下半截文稿。
#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let tmp = p.with_file_name(format!(
        "{}.mwtyper-tmp",
        p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "untitled".into())
    ));
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入失败：{e}"))?;
    fs::rename(&tmp, p).map_err(|e| format!("保存失败：{e}"))
}

#[tauri::command]
pub fn rename_path(old: String, new: String) -> Result<(), String> {
    let target = Path::new(&new);
    if new.trim().is_empty() || target.exists() {
        return Err("目标名为空或已存在".into());
    }
    fs::rename(&old, target).map_err(|e| format!("重命名失败：{e}"))
}

/// 删除 = 移入回收目录（trash crate 不离线可得，退化为工作区 .mwtyper/trash/，可恢复）。
#[tauri::command]
pub fn delete_path(path: String, workspace: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    let ws = Path::new(&workspace);
    let trash_root = if !workspace.is_empty() && p.starts_with(ws) {
        ws.join(".mwtyper").join("trash")
    } else {
        p.parent().unwrap_or(Path::new(".")).join(".mwtyper-trash")
    };
    fs::create_dir_all(&trash_root).map_err(|e| format!("创建回收目录失败：{e}"))?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut dest = trash_root.join(format!("{stamp}-{name}"));
    let mut i = 1;
    while dest.exists() {
        dest = trash_root.join(format!("{stamp}-{i}-{name}"));
        i += 1;
    }
    fs::rename(p, &dest).map_err(|e| format!("删除失败：{e}"))?;
    Ok(path_str(&dest))
}

/// 粘贴/拖拽图片 → 复制到 base_dir/assets/，返回相对路径（正斜杠）。
#[tauri::command]
pub fn save_image_asset(base_dir: String, name: String, data_b64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|_| "图片数据解码失败".to_string())?;
    let src = Path::new(&name);
    let ext = src
        .extension()
        .map(|x| x.to_string_lossy().to_lowercase())
        .filter(|x| ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].contains(&x.as_str()))
        .unwrap_or_else(|| "png".into());
    let stem: String = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".into())
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let assets = Path::new(&base_dir).join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("创建 assets 失败：{e}"))?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut filename = format!("{stem}-{stamp}.{ext}");
    let mut i = 1;
    while assets.join(&filename).exists() {
        filename = format!("{stem}-{stamp}-{i}.{ext}");
        i += 1;
    }
    fs::write(assets.join(&filename), bytes).map_err(|e| format!("保存图片失败：{e}"))?;
    Ok(format!("assets/{filename}"))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    #[serde(default = "d_theme")]
    pub theme: String,
    #[serde(default = "d_autosave")]
    pub autosave_ms: u64,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default = "d_sidebar")]
    pub sidebar_open: bool,
    #[serde(default = "d_sidebar_width")]
    pub sidebar_width: u32,
    /// 随航模式左右两栏的比例（百分比），20–80。
    #[serde(default = "d_split_ratio")]
    pub split_ratio: u32,
    #[serde(default)]
    pub goal_words: u64,
    #[serde(default)]
    pub focus_mode: bool,
    #[serde(default)]
    pub typewriter_mode: bool,
    #[serde(default = "d_snap_keep")]
    pub snapshot_keep: usize,
    #[serde(default = "d_snap_days")]
    pub snapshot_days: u64,
    #[serde(default = "d_zoom")]
    pub zoom: u64,
    #[serde(default)]
    pub custom_theme: String,
}

fn d_theme() -> String { "system".into() }
fn d_autosave() -> u64 { 1000 }
fn d_sidebar() -> bool { true }
fn d_sidebar_width() -> u32 { 240 }
fn d_split_ratio() -> u32 { 50 }
fn d_snap_keep() -> usize { 50 }
fn d_snap_days() -> u64 { 30 }
fn d_zoom() -> u64 { 100 }

impl Default for Settings {
    fn default() -> Self {
        Settings { theme: d_theme(), autosave_ms: d_autosave(), recent_files: Vec::new(), sidebar_open: d_sidebar(), sidebar_width: d_sidebar_width(), split_ratio: d_split_ratio(), goal_words: 0, focus_mode: false, typewriter_mode: false, snapshot_keep: d_snap_keep(), snapshot_days: d_snap_days(), zoom: d_zoom(), custom_theme: String::new() }
    }
}

fn settings_path() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("MWTyper").join("settings.json")
}

#[tauri::command]
pub fn read_settings() -> Settings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn write_settings(settings: Settings) -> Result<(), String> {
    let p = settings_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败：{e}"))?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| format!("写入配置失败：{e}"))
}

#[tauri::command]
pub fn pick_folder(window: tauri::Window) -> Option<String> {
    rfd::FileDialog::new()
        .set_parent(&window)
        .pick_folder()
        .map(|p| path_str(&p))
}

#[tauri::command]
pub fn pick_open_file(window: tauri::Window) -> Option<String> {
    rfd::FileDialog::new()
        .set_parent(&window)
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .pick_file()
        .map(|p| path_str(&p))
}

#[tauri::command]
pub fn pick_save_file(window: tauri::Window, default_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .set_parent(&window)
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .save_file()
        .map(|p| path_str(&p))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// P-QA3：三个原生对话框命令必须把应用窗口挂为 parent（模态），
    /// 否则在 Windows 上对话框会与 Tauri 窗口争抢焦点/层级。
    ///
    /// 这里做的是**签名级断言**：不真正弹窗，只在编译期校验
    /// `tauri::Window` 满足 rfd 的 `set_parent` 所需的 trait 约束
    /// （`HasWindowHandle` + `HasDisplayHandle`），防止 tauri / rfd 升级后
    /// 到编译期才暴露问题。
    #[test]
    fn file_dialogs_accept_window_as_parent() {
        /// 编译期断言：rfd 的 `set_parent` 要求 parent 同时实现
        /// `raw_window_handle::HasWindowHandle` 与 `HasDisplayHandle`。
        /// `tauri::Window` 是否满足，由这行调用在编译期判定 ——
        /// tauri / rfd 升级导致 trait 不再匹配时，会在这里立即暴露，
        /// 而不必等到运行期弹窗才发现对话框不再模态。
        ///
        /// 注意：这里只构造 FileDialog（不调用 pick_*），因此测试内不会真的弹窗。
        fn accepts_tauri_window(window: &tauri::Window) -> rfd::FileDialog {
            rfd::FileDialog::new().set_parent(window)
        }
        // 引用函数项避免未使用告警；真实窗口由运行期的 command 传入。
        let _ = accepts_tauri_window;
    }

    #[test]
    fn atomic_save_and_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("mwtyper-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.md");
        save_file(f.to_string_lossy().into(), "# 你好\n".into()).unwrap();
        assert_eq!(read_file_inner(f.to_string_lossy().as_ref()).unwrap(), "# 你好\n");
        assert!(!f.with_file_name("a.md.mwtyper-tmp").exists(), "临时文件应已 rename");
        fs::remove_dir_all(&dir).ok();
    }

    /// A10：asset 基准目录 = 文件所在目录；无父目录（纯文件名）时不应放行任何目录。
    #[test]
    fn asset_dir_resolves_file_parent() {
        assert_eq!(
            asset_dir_for_file("D:/ws/sub/a.md"),
            Some(PathBuf::from("D:/ws/sub".replace('/', std::path::MAIN_SEPARATOR_STR)))
        );
        assert_eq!(asset_dir_for_file("a.md"), None, "无父目录的相对路径不放行目录");
        assert_eq!(asset_dir_for_file(""), None);
    }

    #[test]
    fn delete_moves_to_trash_not_physical() {
        let dir = std::env::temp_dir().join(format!("mwtyper-trash-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("b.md");
        fs::write(&f, "x").unwrap();
        let dest = delete_path(f.to_string_lossy().into(), dir.to_string_lossy().into()).unwrap();
        assert!(!f.exists());
        assert!(Path::new(&dest).exists());
        assert!(dest.contains(".mwtyper/trash"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn image_asset_returns_relative_path() {
        let dir = std::env::temp_dir().join(format!("mwtyper-img-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3]);
        let rel = save_image_asset(dir.to_string_lossy().into(), "我的 图.PNG".into(), b64).unwrap();
        assert!(rel.starts_with("assets/"));
        assert!(rel.ends_with(".png"));
        assert!(dir.join(&rel).exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn old_settings_without_sidebar_width_use_default() {
        let old = r#"{"theme":"dark","zoom":110}"#;
        let s: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(s.sidebar_width, 240);
        assert_eq!(s.zoom, 110);
    }

    /// 旧配置文件里没有 split_ratio 字段时必须回落到默认值，
    /// 而不是反序列化失败 —— 否则用户升级后设置直接读不出来。
    #[test]
    fn old_settings_without_split_ratio_use_default() {
        let old = r#"{"theme":"dark","zoom":110}"#;
        let s: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(s.split_ratio, 50);
    }
}