use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct SnapshotMeta {
    pub id: String,
    pub ts: String,
    pub hash: String,
    pub auto: bool,
    pub bytes: usize,
}

fn hash64(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

fn norm(p: &str) -> String {
    p.replace('\\', "/")
}

/// 快照目录：工作区 .mwtyper/snapshots/<文件相对路径哈希>/（SPEC §5.6.1，随文件夹迁移）
fn snap_dir(workspace: &str, file_path: &str) -> PathBuf {
    let ws = norm(workspace);
    let fp = norm(file_path);
    let rel = fp.strip_prefix(&format!("{}/", ws.trim_end_matches('/'))).unwrap_or(&fp);
    PathBuf::from(workspace)
        .join(".mwtyper")
        .join("snapshots")
        .join(format!("{:016x}", hash64(rel)))
}

fn read_metas(dir: &PathBuf) -> Vec<SnapshotMeta> {
    let mut metas: Vec<SnapshotMeta> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .filter_map(|e| fs::read_to_string(e.path()).ok())
        .filter_map(|s| serde_json::from_str(&s).ok())
        .collect();
    metas.sort_by(|a, b| b.id.cmp(&a.id));
    metas
}

fn prune(dir: &PathBuf, keep: usize, days: u64) {
    let metas = read_metas(dir);
    let today = chrono::Local::now().date_naive();
    let mut daily_seen: Vec<String> = Vec::new();
    for (i, m) in metas.iter().enumerate() {
        let date_key = m.id.get(0..8).unwrap_or("").to_string();
        let within_days = chrono::NaiveDate::parse_from_str(&date_key, "%Y%m%d")
            .map(|d| (today - d).num_days() <= days as i64)
            .unwrap_or(false);
        let is_daily_last = within_days && !daily_seen.contains(&date_key);
        if is_daily_last {
            daily_seen.push(date_key);
        }
        if i < keep || is_daily_last {
            continue;
        }
        fs::remove_file(dir.join(format!("{}.md", m.id))).ok();
        fs::remove_file(dir.join(format!("{}.json", m.id))).ok();
    }
}

#[tauri::command]
pub fn snapshot_save(
    workspace: String,
    path: String,
    content: String,
    auto: bool,
    keep: Option<usize>,
    days: Option<u64>,
) -> Result<SnapshotMeta, String> {
    let dir = snap_dir(&workspace, &path);
    fs::create_dir_all(&dir).map_err(|e| format!("创建快照目录失败：{e}"))?;
    let hash = format!("{:016x}", hash64(&content));
    let existing = read_metas(&dir);
    if let Some(latest) = existing.first() {
        if latest.hash == hash {
            return Ok(latest.clone());
        }
    }
    let now = chrono::Local::now();
    let id = format!("{}-{:08x}", now.format("%Y%m%d-%H%M%S-%3f"), (hash64(&content) & 0xFFFF_FFFF) as u32);
    let meta = SnapshotMeta {
        id: id.clone(),
        ts: now.to_rfc3339(),
        hash,
        auto,
        bytes: content.len(),
    };
    fs::write(dir.join(format!("{id}.md")), &content).map_err(|e| format!("写快照失败：{e}"))?;
    fs::write(dir.join(format!("{id}.json")), serde_json::to_string(&meta).unwrap())
        .map_err(|e| format!("写快照元数据失败：{e}"))?;
    prune(&dir, keep.unwrap_or(50), days.unwrap_or(30));
    Ok(meta)
}

#[tauri::command]
pub fn snapshot_list(workspace: String, path: String) -> Result<Vec<SnapshotMeta>, String> {
    Ok(read_metas(&snap_dir(&workspace, &path)))
}

#[tauri::command]
pub fn snapshot_read(workspace: String, path: String, id: String) -> Result<String, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("非法快照 id".into());
    }
    fs::read_to_string(snap_dir(&workspace, &path).join(format!("{id}.md")))
        .map_err(|e| format!("读快照失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mwtyper-snap-{}-{tag}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn dedup_and_read_roundtrip() {
        let dir = ws("dedup");
        let w = dir.to_string_lossy().to_string();
        let f = format!("{w}/a.md");
        let m1 = snapshot_save(w.clone(), f.clone(), "# v1\n".into(), false, None, None).unwrap();
        let m2 = snapshot_save(w.clone(), f.clone(), "# v1\n".into(), true, None, None).unwrap();
        assert_eq!(m1.id, m2.id, "相同内容哈希去重");
        snapshot_save(w.clone(), f.clone(), "# v2\n".into(), false, None, None).unwrap();
        let list = snapshot_list(w.clone(), f.clone()).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].id > list[1].id, "按时间倒序");
        assert_eq!(snapshot_read(w.clone(), f.clone(), list[1].id.clone()).unwrap(), "# v1\n");
        assert!(snapshot_read(w.clone(), f.clone(), "../evil".into()).is_err(), "路径穿越拒绝");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prune_keeps_recent_n() {
        let dir = ws("prune");
        let w = dir.to_string_lossy().to_string();
        let f = format!("{w}/b.md");
        for i in 0..5 {
            snapshot_save(w.clone(), f.clone(), format!("v{i}\n"), false, Some(2), Some(0)).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let list = snapshot_list(w, f).unwrap();
        assert_eq!(list.len(), 2, "keep=2 且 days=0 时只留最近 2");
        fs::remove_dir_all(&dir).ok();
    }
}