fn main() {
    // 记录构建时间（Unix 秒）：帮助中心的「关于 / 检查更新」要显示构建时间，
    // 让用户能分辨自己用的是哪个构建。格式化成可读时间在前端做（这里不引 chrono）。
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    println!("cargo:rustc-env=MWTYPER_BUILD_TIME={now}");
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}
