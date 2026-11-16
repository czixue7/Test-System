fn main() {
    let source = "../build-number.txt";
    println!("cargo:rerun-if-changed={source}");
    let source_text = std::fs::read_to_string(source).expect("读取构建号失败");
    let build = source_text.trim();
    assert!(build.len() == 8 && build.bytes().all(|c| c.is_ascii_digit()), "构建号必须为 YYYYMMDD");
    println!("cargo:rustc-env=APP_BUILD_NUMBER={build}");
    tauri_build::build()
}
