use crate::model::{valid_id, Mount};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

pub const MAX_TEXT: u64 = 8 * 1024 * 1024;
pub fn is_text_mount(mount: &Mount) -> bool {
    !["bank", "knowledge", "duty", "package"].contains(&mount.kind.as_str())
}
pub fn allowed(path: &Path) -> bool {
    [
        "txt", "md", "markdown", "json", "csv", "log", "yaml", "yml", "toml", "xml",
    ]
    .contains(
        &path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
            .as_str(),
    )
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn encoded(path: &Path) -> String {
    path.components()
        .map(|part| {
            utf8_percent_encode(&part.as_os_str().to_string_lossy(), NON_ALPHANUMERIC).to_string()
        })
        .collect::<Vec<_>>()
        .join("/")
}
fn info(mount: &Mount, root: &Path, file: &Path, bytes: &[u8]) -> Value {
    let relative = file.strip_prefix(root).unwrap();
    let updated = fs::metadata(file)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|t| t.as_millis() as u64)
        .unwrap_or(0);
    json!({"mountId":mount.id,"kind":mount.kind,"category":mount.kind,"folder":mount.name,
        "name":file.file_name().unwrap().to_string_lossy(),"path":relative.to_string_lossy().replace('\\',"/"),
        "sha":sha(bytes),"size":bytes.len(),"updatedAt":updated,"writable":true,
        "downloadUrl":format!("/files/{}/{}",mount.id,encoded(relative)),
        "syncUrl":format!("/api/v1/text/{}/{}",mount.id,encoded(relative))})
}
fn collect(root: &Path, dir: &Path, files: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
    if depth > 12 {
        return Err("文本目录层级超过 12 层".into());
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let path = fs::canonicalize(entry.path()).map_err(|e| e.to_string())?;
        if kind.is_symlink() || !path.starts_with(root) {
            continue;
        }
        if kind.is_dir() {
            collect(root, &path, files, depth + 1)?;
        } else if kind.is_file() && allowed(&path) {
            files.push(path);
            if files.len() > 10000 {
                return Err("文本目录超过 10000 个文件".into());
            }
        }
    }
    Ok(())
}
pub fn catalog(mounts: &[Mount]) -> Result<Value, String> {
    let mut items = vec![];
    let mut folders = vec![];
    let mut warnings = vec![];
    for mount in mounts.iter().filter(|m| m.enabled && is_text_mount(m)) {
        let root = match fs::canonicalize(&mount.path) {
            Ok(root) => root,
            Err(e) => {
                warnings.push(format!("{}：{e}", mount.name));
                continue;
            }
        };
        folders.push(json!({"id":mount.id,"name":mount.name,"kind":mount.kind,"writable":true}));
        let mut files = vec![];
        collect(&root, &root, &mut files, 0)?;
        files.sort();
        for path in files {
            if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_TEXT {
                warnings.push(format!(
                    "文本超过 8 MiB：{}",
                    path.file_name().unwrap().to_string_lossy()
                ));
                continue;
            }
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            items.push(info(mount, &root, &path, &bytes));
        }
    }
    Ok(json!({"folders":folders,"items":items,"warnings":warnings}))
}

// 对新文件也检查所有已有父目录，禁止隐藏路径、反向路径、链接逃逸和 Windows 设备路径。
fn target(root: &Path, encoded: &str) -> Result<PathBuf, (u16, String)> {
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| (400, "路径编码无效".into()))?;
    if decoded.is_empty() || decoded.contains(['\\', ':', '\0']) {
        return Err((403, "文本路径无效".into()));
    }
    let relative = Path::new(decoded.as_ref());
    for part in relative.components() {
        let name = part.as_os_str().to_string_lossy();
        let stem = name
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end()
            .to_ascii_uppercase();
        let device = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
            || ["COM", "LPT"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|n| {
                    n.len() == 1 && n.as_bytes()[0] >= b'1' && n.as_bytes()[0] <= b'9'
                })
            });
        if device
            || name
                .chars()
                .any(|c| c.is_control() || ['<', '>', '"', '|', '?', '*'].contains(&c))
        {
            return Err((403, "文本文件名无效".into()));
        }
    }
    if relative.components().count() > 13
        || relative.components().any(|p| {
            !matches!(p, Component::Normal(_))
                || p.as_os_str().to_string_lossy().starts_with('.')
                || p.as_os_str().to_string_lossy().ends_with(['.', ' '])
        })
    {
        return Err((403, "禁止访问此文本路径".into()));
    }
    if !allowed(relative) {
        return Err((415, "仅支持文本文件类型".into()));
    }
    let mut result = root.to_path_buf();
    for part in relative.components() {
        result.push(part);
        if let Ok(meta) = fs::symlink_metadata(&result) {
            let resolved = fs::canonicalize(&result).map_err(|e| (403, e.to_string()))?;
            if meta.file_type().is_symlink() || !resolved.starts_with(root) {
                return Err((403, "文本路径超出目录".into()));
            }
        }
    }
    Ok(result)
}

pub fn route(
    mounts: &[Mount],
    method: &str,
    rest: &str,
    body: &[u8],
) -> Result<(u16, Value), (u16, String)> {
    let (id, relative) = rest
        .split_once('/')
        .map(|(id, path)| (id, Some(path)))
        .unwrap_or((rest, None));
    if !valid_id(id) {
        return Err((400, "目录标识无效".into()));
    }
    let mount = mounts
        .iter()
        .find(|m| m.enabled && m.id == id)
        .ok_or((404, "文本目录不存在或未启用".into()))?;
    if !is_text_mount(mount) {
        return Err((403, "此目录只读发布，不允许文本同步写入".into()));
    }
    if relative.is_none() {
        if method != "GET" {
            return Err((405, "目录仅支持 GET".into()));
        }
        return Ok((200, catalog(&[mount.clone()]).map_err(|e| (500, e))?));
    }
    if !["GET", "PUT"].contains(&method) {
        return Err((405, "文本同步仅支持 GET / PUT".into()));
    }
    let root = fs::canonicalize(&mount.path).map_err(|e| (404, e.to_string()))?;
    let file = target(&root, relative.unwrap())?;
    if file.exists() && !file.is_file() {
        return Err((400, "目标不是文件".into()));
    }
    let current = if file.exists() {
        if fs::metadata(&file).map_err(|e| (500, e.to_string()))?.len() > MAX_TEXT {
            return Err((413, "文本超过 8 MiB".into()));
        }
        Some(fs::read(&file).map_err(|e| (500, e.to_string()))?)
    } else {
        None
    };
    if method == "GET" {
        let bytes = current.ok_or((404, "文本文件不存在".into()))?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| (422, "文本不是 UTF-8，请使用 downloadUrl 原样下载".into()))?;
        let mut value = info(mount, &root, &file, &bytes);
        value["content"] = json!(text);
        return Ok((200, value));
    }
    let input: Value =
        serde_json::from_slice(body).map_err(|_| (400, "上传数据必须为 JSON".into()))?;
    let base = input
        .get("baseSha")
        .ok_or((400, "必须提供 baseSha，新文件使用 null".into()))?;
    if !base.is_null()
        && !base
            .as_str()
            .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err((400, "baseSha 必须为 SHA-256 或 null".into()));
    }
    let content = input["content"]
        .as_str()
        .ok_or((400, "content 必须为文本字符串".into()))?;
    if content.len() as u64 > MAX_TEXT {
        return Err((413, "文本超过 8 MiB".into()));
    }
    let current_sha = current.as_ref().map(|bytes| sha(bytes));
    if base.as_str() != current_sha.as_deref() {
        return Ok((
            409,
            json!({"error":"文件已变化，请重新下载并合并后重试","sha":current_sha,"path":relative}),
        ));
    }
    if current.as_deref() == Some(content.as_bytes()) {
        return Ok((200, info(mount, &root, &file, content.as_bytes())));
    }
    let parent = file.parent().unwrap();
    fs::create_dir_all(parent).map_err(|e| (500, e.to_string()))?;
    let parent = fs::canonicalize(parent).map_err(|e| (500, e.to_string()))?;
    if !parent.starts_with(&root) {
        return Err((403, "文本路径超出目录".into()));
    }
    let file = parent.join(file.file_name().unwrap());
    // 临时文件与目标位于同一目录；写入完成后原子替换，失败则保留原文件。
    let temp = parent.join(format!(".textsync-{}.tmp", uuid::Uuid::new_v4()));
    let write = (|| -> Result<(), String> {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        output
            .write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        fs::rename(&temp, &file).map_err(|e| e.to_string())
    })();
    if write.is_err() {
        let _ = fs::remove_file(&temp);
    }
    write.map_err(|e| (500, e))?;
    Ok((
        if current.is_some() { 200 } else { 201 },
        info(mount, &root, &file, content.as_bytes()),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        dir: PathBuf,
        mount: Mount,
    }
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("text-sync-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self {
                mount: Mount {
                    id: "novel".into(),
                    name: "小说目录".into(),
                    kind: "小说".into(),
                    path: dir.to_string_lossy().into(),
                    enabled: true,
                },
                dir,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
    #[test]
    fn text_roundtrip_conflicts_and_nested_files() {
        let f = Fixture::new();
        let mounts = [f.mount.clone()];
        let text = "\u{feff}第一章\r\n你好，世界。\r\n";
        fs::write(f.dir.join("正文.txt"), text).unwrap();
        fs::write(f.dir.join("opaque.json"), b"not valid json").unwrap();
        fs::write(f.dir.join("ignore.exe"), b"ignored").unwrap();
        let index = catalog(&mounts).unwrap();
        assert_eq!(index["items"].as_array().unwrap().len(), 2);
        let current = route(&mounts, "GET", "novel/正文.txt", b"").unwrap().1;
        assert_eq!(current["content"], text);
        assert_eq!(current["size"], text.len());
        let input = json!({"baseSha":current["sha"],"content":"更新的正文\r\n"});
        let updated = route(
            &mounts,
            "PUT",
            "novel/正文.txt",
            &serde_json::to_vec(&input).unwrap(),
        )
        .unwrap();
        assert_eq!(updated.0, 200);
        let conflict = route(
            &mounts,
            "PUT",
            "novel/正文.txt",
            &serde_json::to_vec(&input).unwrap(),
        )
        .unwrap();
        assert_eq!(conflict.0, 409);
        assert_eq!(
            fs::read_to_string(f.dir.join("正文.txt")).unwrap(),
            "更新的正文\r\n"
        );
        let new = serde_json::to_vec(&json!({"baseSha":null,"content":""})).unwrap();
        assert_eq!(
            route(&mounts, "PUT", "novel/卷一/空章.txt", &new)
                .unwrap()
                .0,
            201
        );
        assert_eq!(
            route(&mounts, "PUT", "novel/卷一/空章.txt", &new)
                .unwrap()
                .0,
            409
        );
        assert_eq!(fs::read(f.dir.join("卷一/空章.txt")).unwrap(), b"");
        assert!(fs::read_dir(&f.dir).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".textsync-")));
    }
    #[test]
    fn text_paths_and_existing_readonly_types_are_protected() {
        let f = Fixture::new();
        let mounts = [f.mount.clone()];
        let body = br#"{"baseSha":null,"content":"test"}"#;
        for path in [
            "../outside.txt",
            "%2e%2e/outside.txt",
            "%5coutside.txt",
            ".private.txt",
            "folder/.hidden.txt",
            "C%3a/a.txt",
            "NUL.txt",
            "sub/COM1.txt",
            "bad.exe",
            "/root.txt",
        ] {
            assert!(
                route(&mounts, "PUT", &format!("novel/{path}"), body).is_err(),
                "{path}"
            );
        }
        for kind in ["bank", "knowledge", "duty", "package"] {
            let readonly = Mount {
                kind: kind.into(),
                ..f.mount.clone()
            };
            assert_eq!(
                route(&[readonly], "PUT", "novel/正文.txt", body)
                    .unwrap_err()
                    .0,
                403
            );
        }
        let disabled = Mount {
            enabled: false,
            ..f.mount.clone()
        };
        assert_eq!(route(&[disabled], "GET", "novel", b"").unwrap_err().0, 404);
        assert_eq!(
            route(&mounts, "PUT", "novel/missing.txt", br#"{"content":"x"}"#)
                .unwrap_err()
                .0,
            400
        );
        fs::write(f.dir.join("gbk.txt"), [0xff, 0xfe, 0x80]).unwrap();
        assert_eq!(
            route(&mounts, "GET", "novel/gbk.txt", b"").unwrap_err().0,
            422
        );
        let mut config = crate::model::Config::default();
        config.mounts = mounts.to_vec();
        config.validate().unwrap();
        config.mounts[0].kind = " ".into();
        assert!(config.validate().is_err());
    }
}
