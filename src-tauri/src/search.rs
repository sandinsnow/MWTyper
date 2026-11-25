use crate::fs::{is_ignored, path_str, MD_EXTS};
use regex::bytes::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::time::Instant;
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line_no: usize,
    pub line: String,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
    pub files_scanned: usize,
    pub elapsed_ms: u64,
}

/// 跨文件全文/正则搜索（SPEC §5.5）。忽略隐藏目录与 .mwtyper；命中行截断 300 字符。
#[tauri::command]
pub fn search_workspace(
    root: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
    limit: Option<usize>,
) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult { hits: Vec::new(), truncated: false, files_scanned: 0, elapsed_ms: 0 });
    }
    let started = Instant::now();
    let mut pat = if use_regex { query.clone() } else { regex::escape(&query) };
    if whole_word {
        pat = format!(r"\b(?:{})\b", pat);
    }
    let re = RegexBuilder::new(&pat)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("正则无效：{e}"))?;
    let limit = limit.unwrap_or(500);

    let mut hits = Vec::new();
    let files_scanned: usize;
    let truncated: bool;

    let walker = WalkDir::new(&root).into_iter().filter_entry(|e| {
        if e.depth() == 0 {
            return true;
        }
        let name = e.file_name().to_string_lossy();
        if e.file_type().is_dir() {
            return !is_ignored(&name);
        }
        let ext = e.path().extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        MD_EXTS.contains(&ext.as_str())
    });
    let paths: Vec<std::path::PathBuf> = walker
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect();

    // 分块并行读取+匹配（Windows 逐文件读是热路径瓶颈）；
    // 共享命中计数达 limit 即停工，合并后按 walk 顺序截断，语义同单线程版。
    let nthreads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunk_size = (paths.len() / nthreads).max(1);
    let total_hits = std::sync::atomic::AtomicUsize::new(0);
    let scanned = std::sync::atomic::AtomicUsize::new(0);
    // E06：命中数达 limit 时置位停工标记；各线程"命中即 break"会让 hits.len() == limit，
    // 用 `> limit` 判断会把真实截断误报为 false。
    let stopped = std::sync::atomic::AtomicBool::new(false);
    let ordered: Vec<Vec<SearchHit>> = std::thread::scope(|scope| {
        let handles: Vec<_> = paths
            .chunks(chunk_size)
            .map(|chunk| {
                let re = &re;
                let total = &total_hits;
                let scanned = &scanned;
                let stopped = &stopped;
                scope.spawn(move || {
                    let mut local: Vec<SearchHit> = Vec::new();
                    for p in chunk {
                        if total.load(std::sync::atomic::Ordering::Relaxed) >= limit {
                            stopped.store(true, std::sync::atomic::Ordering::Relaxed);
                            break;
                        }
                        scanned.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Ok(bytes) = fs::read(p) else { continue };
                        for (i, line) in bytes.split(|b| *b == b'\n').enumerate() {
                            if re.is_match(line) {
                                let trimmed: String = String::from_utf8_lossy(line).trim().chars().take(300).collect();
                                local.push(SearchHit { path: path_str(p), line_no: i + 1, line: trimmed });
                                if total.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1 >= limit {
                                    stopped.store(true, std::sync::atomic::Ordering::Relaxed);
                                    break;
                                }
                            }
                        }
                    }
                    local
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
    });
    for part in ordered {
        hits.extend(part);
    }
    files_scanned = scanned.load(std::sync::atomic::Ordering::Relaxed);
    truncated = stopped.load(std::sync::atomic::Ordering::Relaxed) || hits.len() > limit;
    hits.truncate(limit);

    Ok(SearchResult { hits, truncated, files_scanned, elapsed_ms: started.elapsed().as_millis() as u64 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mwtyper-search-{}-{tag}", std::process::id()));
        fs::create_dir_all(dir.join(".mwtyper")).unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.md"), "Hello world\nhello Rust\n你好世界\n").unwrap();
        fs::write(dir.join("sub/b.md"), "HELLO again\nworld peace\n").unwrap();
        fs::write(dir.join(".mwtyper/hidden.md"), "hello secret\n").unwrap();
        fs::write(dir.join("c.txt"), "say hello now\n").unwrap();
        fs::write(dir.join("d.png"), "hello binary").unwrap();
        dir
    }

    #[test]
    fn case_insensitive_default_and_ignore_rules() {
        let dir = setup("case");
        let r = search_workspace(dir.to_string_lossy().into(), "hello".into(), false, false, false, None).unwrap();
        assert_eq!(r.hits.len(), 4, "a.md 2 + b.md 1 + c.txt 1；.mwtyper 与 png 不计");
        assert!(r.hits.iter().all(|h| !h.path.contains(".mwtyper")));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn case_sensitive_and_whole_word_and_regex() {
        let dir = setup("word");
        let r = search_workspace(dir.to_string_lossy().into(), "hello".into(), true, false, false, None).unwrap();
        assert_eq!(r.hits.len(), 2, "区分大小写：a.md 小写 1 + c.txt 1");
        let r = search_workspace(dir.to_string_lossy().into(), "world".into(), false, true, false, None).unwrap();
        assert_eq!(r.hits.len(), 2, "全词：Hello world / world peace");
        let r = search_workspace(dir.to_string_lossy().into(), r"h\w+o".into(), false, false, true, None).unwrap();
        assert!(r.hits.len() >= 3, "正则 hello/HELLO 命中");
        let bad = search_workspace(dir.to_string_lossy().into(), "(".into(), false, false, true, None);
        assert!(bad.is_err(), "非法正则报错");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn limit_truncates() {
        let dir = setup("limit");
        let r = search_workspace(dir.to_string_lossy().into(), "hello".into(), false, false, false, Some(1)).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert!(r.truncated);
        fs::remove_dir_all(&dir).ok();
    }

    /// E06：单文件多命中触顶时 truncated 必须为 true（旧实现用 `> limit` 会误报 false）。
    #[test]
    fn truncated_flag_set_when_limit_reached() {
        let dir = std::env::temp_dir().join(format!("mwtyper-search-cap-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let mut body = String::new();
        for i in 0..20 {
            body.push_str(&format!("needle {i}\n"));
        }
        fs::write(dir.join("many.md"), body).unwrap();
        let r = search_workspace(dir.to_string_lossy().into(), "needle".into(), false, false, false, Some(5)).unwrap();
        assert_eq!(r.hits.len(), 5, "命中数应被截断到 limit");
        assert!(r.truncated, "触顶必须标记 truncated");
        fs::remove_dir_all(&dir).ok();
    }

    /// E06：并行实现与单线程扫描在同一输入下结果一致（路径 + 行号 + 顺序）。
    #[test]
    fn parallel_matches_sequential_scan() {
        let dir = setup("parity");
        let r = search_workspace(dir.to_string_lossy().into(), "hello".into(), false, false, false, None).unwrap();
        let mut expected: Vec<(String, usize)> = Vec::new();
        for entry in WalkDir::new(&dir).into_iter().filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                return !is_ignored(&name);
            }
            let ext = e.path().extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            MD_EXTS.contains(&ext.as_str())
        }) {
            let entry = entry.unwrap();
            if !entry.file_type().is_file() {
                continue;
            }
            let bytes = fs::read(entry.path()).unwrap();
            for (i, line) in bytes.split(|b| *b == b'\n').enumerate() {
                let text = String::from_utf8_lossy(line);
                if text.to_lowercase().contains("hello") {
                    expected.push((path_str(entry.path()), i + 1));
                }
            }
        }
        let actual: Vec<(String, usize)> = r.hits.iter().map(|h| (h.path.clone(), h.line_no)).collect();
        assert_eq!(actual, expected, "并行与单线程结果应一致");
        fs::remove_dir_all(&dir).ok();
    }

    /// 万文件级性能基准：cargo test -p mwtyper bench_10k_files -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_10k_files() {
        let dir = std::env::temp_dir().join(format!("mwtyper-bench-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. 正文段落混排中文与 English words.\n";
        for i in 0..10_000 {
            let sub = dir.join(format!("d{:03}", i / 100));
            fs::create_dir_all(&sub).unwrap();
            let mut body = String::new();
            for _ in 0..20 {
                body.push_str(filler);
            }
            if i == 9_999 {
                body.push_str("zzrareneedle 唯一命中\n");
            }
            fs::write(sub.join(format!("f{i:05}.md")), body).unwrap();
        }
        let root = dir.to_string_lossy().to_string();
        // 全量扫描：稀有词仅 1 处命中，必须读完全部文件
        let r = search_workspace(root.clone(), "zzrareneedle".into(), false, false, false, None).unwrap();
        assert_eq!(r.files_scanned, 10_000);
        assert_eq!(r.hits.len(), 1);
        println!("BENCH full-scan 10000 files (~20MB): {} ms, hits={}", r.elapsed_ms, r.hits.len());
        let rw = search_workspace(root.clone(), "zzrareneedle".into(), false, false, false, None).unwrap();
        println!("BENCH full-scan warm cache: {} ms", rw.elapsed_ms);
        // 常见词 + 默认 limit 500：提前截断
        let r2 = search_workspace(root.clone(), "ipsum".into(), false, false, false, None).unwrap();
        println!("BENCH common+limit500: {} ms, hits={}, truncated={}", r2.elapsed_ms, r2.hits.len(), r2.truncated);
        // 正则全量扫描
        let r3 = search_workspace(root, r"中文与\s+English".into(), false, false, true, Some(100_000)).unwrap();
        println!("BENCH regex full-scan: {} ms, hits={}", r3.elapsed_ms, r3.hits.len());
        fs::remove_dir_all(&dir).ok();
    }
}