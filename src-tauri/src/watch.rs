use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub struct WatchState(pub Mutex<Option<notify::RecommendedWatcher>>);
pub struct ThemeWatchState(pub Mutex<Option<notify::RecommendedWatcher>>);

#[derive(Clone, serde::Serialize)]
struct FsChange {
    path: String,
    kind: String,
}

/// 自身写入（原子写临时文件、.mwtyper 回收/快照目录）不推送，避免自动保存→事件→重载死循环。
fn is_self_noise(p: &PathBuf) -> bool {
    let s = p.to_string_lossy().replace('\\', "/");
    s.contains("/.mwtyper/") || s.ends_with(".mwtyper-tmp") || s.contains("/.mwtyper-trash/")
}

#[tauri::command]
pub fn watch_folder(app: AppHandle, path: String, state: tauri::State<WatchState>) -> Result<(), String> {
    // A10：把 asset 协议的可读范围收窄到当前打开的工作区（配置里已去掉全盘 "**"）。
    // 工作区是运行时才确定的，因此在这里动态放行；未打开过的目录不会被读取。
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&path, true);
    start_watcher(app, &path, "fs-changed", &state.0)
}

#[tauri::command]
pub fn watch_themes(app: AppHandle, state: tauri::State<ThemeWatchState>) -> Result<(), String> {
    let d = crate::themes::themes_dir();
    let _ = std::fs::create_dir_all(&d);
    start_watcher(app, &d.to_string_lossy(), "themes-changed", &state.0)
}

fn start_watcher(
    app: AppHandle,
    path: &str,
    event: &'static str,
    slot: &Mutex<Option<notify::RecommendedWatcher>>,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let _ = tx.send(ev);
        }
    })
    .map_err(|e| format!("创建监听器失败：{e}"))?;
    watcher
        .watch(std::path::Path::new(path), RecursiveMode::Recursive)
        .map_err(|e| format!("监听目录失败：{e}"))?;
    *slot.lock().unwrap() = Some(watcher);

    std::thread::spawn(move || {
        let mut pending: HashMap<PathBuf, (Instant, String)> = HashMap::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(150)) {
                Ok(ev) => {
                    let kind = match ev.kind {
                        notify::EventKind::Create(_) => "create",
                        notify::EventKind::Remove(_) => "remove",
                        _ => "modify",
                    };
                    for p in ev.paths {
                        if !is_self_noise(&p) {
                            pending.insert(p, (Instant::now(), kind.to_string()));
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
            // A11：debounce 检查独立于接收超时。事件持续以 <150ms 间隔到达时，
            // 永远不会进入 Timeout 分支，变更通知会被无限推迟；这里每轮都按
            // 「距最后一次事件是否已满 300ms」判定到期并刷新。
            let now = Instant::now();
            let ready: Vec<PathBuf> = pending
                .iter()
                .filter(|(_, (t, _))| now.duration_since(*t) >= Duration::from_millis(300))
                .map(|(p, _)| p.clone())
                .collect();
            for p in ready {
                if let Some((_, kind)) = pending.remove(&p) {
                    let _ = app.emit(event, FsChange {
                        path: p.to_string_lossy().replace('\\', "/"),
                        kind,
                    });
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn unwatch_folder(state: tauri::State<WatchState>) {
    *state.0.lock().unwrap() = None;
}