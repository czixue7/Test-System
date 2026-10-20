use regex::Regex;
use serde_json::{json, Value};
use std::{path::Path, sync::OnceLock};

pub const MAX_PACKAGE: u64 = 2 * 1024 * 1024 * 1024;

pub fn allowed(path: &Path) -> bool {
    matches!(path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "apk" | "exe" | "msi" | "dmg" | "appimage" | "zip")
}

/// Only stable numeric versions and numeric builds are published. Ambiguous or
/// missing metadata is reported instead of using file modification times.
pub fn metadata(path: &Path) -> Result<Value, String> {
    static VERSION: OnceLock<Regex> = OnceLock::new();
    static BUILD: OnceLock<Regex> = OnceLock::new();
    static BARE_BUILD: OnceLock<Regex> = OnceLock::new();
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("文件名不是有效 UTF-8")?;
    if !allowed(path) { return Err("不支持的安装包格式".into()); }
    let stem = path.file_stem().unwrap().to_string_lossy();
    let version_re = VERSION.get_or_init(|| Regex::new(r"(?i)(?:^|[_\s+()\[\]-])v?(\d+\.\d+\.\d+(?:\.\d+)?)(?:$|[_\s+()\[\]-])").unwrap());
    let found = version_re.captures(&stem).ok_or("缺少版本号，例如 v0.4.4")?;
    let version = found.get(1).unwrap();
    let tail = &stem[version.end()..];
    let build_re = BUILD.get_or_init(|| Regex::new(r"(?i)(?:^|[_\s+()\[\]-])(?:build|构建|b)[_\s-]*(\d{1,20})(?:$|[_\s+()\[\]-])").unwrap());
    let bare_re = BARE_BUILD.get_or_init(|| Regex::new(r"(?:^|[_\s+()\[\]-])(\d{6,20})(?:$|[_\s+()\[\]-])").unwrap());
    let build = build_re.captures(tail).or_else(|| bare_re.captures(tail))
        .and_then(|c| c.get(1).map(|v| v.as_str().to_owned()))
        .ok_or("缺少构建号，例如 build20261021")?;
    // Reject pre-release names rather than accidentally publishing as stable.
    let lower = stem.to_ascii_lowercase();
    if lower.split(|c: char| !c.is_ascii_alphanumeric()).any(|v| ["alpha", "beta", "rc", "debug"].iter().any(|prefix| v == *prefix || v.strip_prefix(prefix).is_some_and(|tail| !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit())))) {
        return Err("预发布或调试包不作为正式更新发布".into());
    }
    let extension = path.extension().unwrap().to_string_lossy().to_ascii_lowercase();
    let platform = match extension.as_str() {
        "apk" => "android", "exe" | "msi" => "windows", "dmg" => "macos", "appimage" => "linux",
        "zip" if lower.contains("windows") => "windows",
        "zip" if lower.contains("macos") => "macos",
        "zip" if lower.contains("linux") => "linux",
        _ => return Err("ZIP 文件名需包含 windows、macos 或 linux 平台标记".into()),
    };
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size == 0 || size > MAX_PACKAGE { return Err("安装包为空或超过 2 GiB".into()); }
    Ok(json!({"name":name,"version":version.as_str(),"buildNumber":build,"platform":platform,"size":size}))
}

pub fn releases(items: &[Value]) -> Vec<Value> {
    let mut releases: Vec<Value> = vec![];
    for item in items {
        let idx = releases.iter().position(|r| r["version"] == item["version"] && r["versionHash"] == item["buildNumber"]);
        let idx = idx.unwrap_or_else(|| {
            releases.push(json!({"version":item["version"],"versionHash":item["buildNumber"],"assets":[]}));
            releases.len() - 1
        });
        releases[idx]["assets"].as_array_mut().unwrap().push(json!({
            "name":item["name"],"browser_download_url":item["downloadUrl"],"size":item["size"]
        }));
    }
    releases
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filename_metadata_and_release_grouping() {
        let dir = std::env::temp_dir().join(format!("package-name-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for (filename, version, build) in [
            ("Answer_Test_v0.4.4_build20261021_arm64.apk","0.4.4","20261021"),
            ("Answer_Test_v0.4.4_2026102101_x64.exe","0.4.4","2026102101"),
            ("Answer_Test_v0.4.5+build9_windows.zip","0.4.5","9"),
        ] {
            let p = dir.join(filename); std::fs::write(&p,b"test").unwrap();
            let meta = metadata(&p).unwrap();
            assert_eq!(meta["version"],version); assert_eq!(meta["buildNumber"],build);
        }
        for filename in ["app.apk","app_v0.4.4_arm64.apk","app_v0.4.4-beta_build20261021.apk","app_v0.4.4-rc1_build20261021.apk","app_v0.4.4_build20261021_source.zip"] {
            let p = dir.join(filename); std::fs::write(&p,b"test").unwrap();
            assert!(metadata(&p).is_err(),"{filename}");
        }
        let grouped = releases(&[json!({"version":"0.4.4","buildNumber":"9","name":"a.apk","downloadUrl":"/a"}),json!({"version":"0.4.4","buildNumber":"9","name":"a.exe","downloadUrl":"/b"})]);
        assert_eq!(grouped.len(),1); assert_eq!(grouped[0]["assets"].as_array().unwrap().len(),2);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
