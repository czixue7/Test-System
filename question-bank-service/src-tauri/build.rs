fn main() {
    let source = "../build-number.txt";
    println!("cargo:rerun-if-changed={source}");
    let source_text = std::fs::read_to_string(source).expect("读取构建号失败");
    let build = source_text.trim();
    let bytes = build.as_bytes();
    let digits_ok = (bytes.len() == 8 || bytes.len() == 9) && bytes[..8].iter().all(|c| c.is_ascii_digit());
    let letter_ok = bytes.len() == 8 || bytes[8].is_ascii_uppercase();
    assert!(digits_ok && letter_ok, "构建号必须为 YYYYMMDD 或 YYYYMMDD + A-Z");
    println!("cargo:rustc-env=APP_BUILD_NUMBER={build}");
    tauri_build::build()
}
