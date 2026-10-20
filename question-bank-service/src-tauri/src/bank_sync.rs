use crate::model::{now, read_json, valid_id, write_json, Mount};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, fs, path::Path};

type ResultApi = Result<(u16, Value), (u16, String)>;
fn bad(message: &str) -> (u16, String) { (400, message.into()) }
fn hash(content: &str) -> String { format!("{:x}", Sha256::digest(content.as_bytes())) }
fn valid_hash(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
}
pub fn route(dir: &Path, mounts: &[Mount], method: &str, rest: &str, body: &[u8]) -> ResultApi {
    let (space, action) = rest.split_once('/').ok_or_else(|| bad("题库同步路径无效"))?;
    if !valid_id(space) { return Err(bad("同步空间无效")); }
    let root = dir.join("sync").join(space).join("banks");
    if action == "manifest" && method == "PUT" {
        let input: Value = serde_json::from_slice(body).map_err(|_| bad("清单 JSON 无效"))?;
        let items = input["banks"].as_array().ok_or_else(|| bad("缺少题库 hash 清单"))?;
        if items.len() > 10000 { return Err(bad("题库数量超过 10000")); }
        let mut local = BTreeMap::new();
        for item in items {
            let id = item["id"].as_str().ok_or_else(|| bad("题库标识无效"))?;
            if !valid_id(id) || id.starts_with("built-in-") || !valid_hash(&item["hash"]) ||
                (!item["baseHash"].is_null() && !valid_hash(&item["baseHash"])) || local.insert(id, item).is_some() {
                return Err(bad("题库标识或 hash 无效、重复"));
            }
        }
        let mut remote = BTreeMap::new();
        if root.exists() {
            for entry in fs::read_dir(&root).map_err(|e| (500, e.to_string()))? {
                let entry = entry.map_err(|e| (500, e.to_string()))?;
                if !entry.file_type().map_err(|e| (500, e.to_string()))?.is_file() || entry.path().extension().and_then(|e| e.to_str()) != Some("json") { continue; }
                let id = entry.path().file_stem().unwrap().to_string_lossy().into_owned();
                if valid_id(&id) { remote.insert(id, read_json::<Value>(&entry.path()).map_err(|e| (500, e))?); }
            }
        }
        let mut upload = vec![]; let mut download = vec![];
        for (id, item) in &local {
            match remote.get(*id) {
                None => upload.push(json!({"id":id,"baseHash":null})),
                Some(value) if item["hash"] == value["hash"] => {},
                Some(value) if item["baseHash"] == value["hash"] => upload.push(json!({"id":id,"baseHash":value["hash"]})),
                Some(value) => download.push(json!({"id":id,"hash":value["hash"],"conflict":item["hash"] != item["baseHash"]})),
            }
        }
        for (id, value) in &remote {
            if !local.contains_key(id.as_str()) { download.push(json!({"id":id,"hash":value["hash"],"conflict":false})); }
        }
        // Published folders stay read-only. Return only changed descriptors, never whole banks.
        let published = input["published"].as_array().ok_or_else(|| bad("缺少发布题库清单"))?;
        let mut seen = HashSet::new();
        for item in published { if !item["filename"].is_string() || !seen.insert(item["filename"].as_str().unwrap()) { return Err(bad("发布题库清单无效")); } }
        let catalog = crate::server::catalog(mounts).map_err(|e| (500, e))?;
        let changed: Vec<_> = catalog["banks"]["userBanks"].as_array().unwrap().iter().filter(|bank| {
            !published.iter().any(|p| p["filename"] == bank["filename"] && p["sha"] == bank["sha"] && p["images"] == bank["images"])
        }).cloned().collect();
        return Ok((200, json!({"upload":upload,"download":download,"published":changed,"warnings":catalog["warnings"]})));
    }
    let id = action.strip_prefix("banks/").ok_or_else(|| bad("题库同步路径无效"))?;
    if !valid_id(id) || id.starts_with("built-in-") { return Err(bad("题库标识无效")); }
    let file = root.join(format!("{id}.json"));
    let current: Value = if file.exists() { read_json(&file).map_err(|e| (500, e))? } else { Value::Null };
    if method == "GET" { return if current.is_null() { Err((404, "题库不存在".into())) } else { Ok((200, current)) }; }
    if method != "PUT" { return Err((405, "只支持 GET / PUT".into())); }
    let input: Value = serde_json::from_slice(body).map_err(|_| bad("题库 JSON 无效"))?;
    let content = input["content"].as_str().ok_or_else(|| bad("缺少题库内容"))?;
    if !valid_hash(&input["hash"]) || hash(content) != input["hash"].as_str().unwrap() { return Err(bad("题库 hash 校验失败")); }
    let bank: Value = serde_json::from_str(content).map_err(|_| bad("题库内容无效"))?;
    if bank["id"].as_str() != Some(id) || !bank["name"].is_string() || !bank["questions"].is_array() || !bank["createdAt"].is_string() || !bank["updatedAt"].is_string() {
        return Err(bad("题库结构无效"));
    }
    if current["hash"] == input["hash"] { return Ok((200, json!({"hash":current["hash"]}))); }
    if input["baseHash"] != current["hash"] { return Ok((409, json!({"error":"题库已被其他设备修改，请重新同步"}))); }
    let next = json!({"hash":input["hash"],"content":content,"updatedAt":now()});
    write_json(&file, &next).map_err(|e| (500, e))?;
    Ok((200, json!({"hash":next["hash"]})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hashes_first_skip_identical_detect_conflicts_and_reject_corruption() {
        let dir = std::env::temp_dir().join(format!("bank-sync-{}", uuid::Uuid::new_v4()));
        let content = r#"{"id":"one","name":"中文","questions":[],"createdAt":"now","updatedAt":"now"}"#;
        let sha = hash(content);
        let call = |method, path, value: Value| route(&dir, &[], method, path, &serde_json::to_vec(&value).unwrap());
        let plan = |items: Value| call("PUT", "a/manifest", json!({"banks":items,"published":[]})).unwrap().1;
        assert_eq!(plan(json!([{"id":"one","hash":sha}]))["upload"].as_array().unwrap().len(), 1);
        assert_eq!(call("PUT", "a/banks/one", json!({"hash":sha,"baseHash":null,"content":content})).unwrap().0, 200);
        assert_eq!(plan(json!([{"id":"one","hash":sha}]))["download"], json!([]));
        assert_eq!(plan(json!([{"id":"one","hash":sha}]))["upload"], json!([]));
        assert_eq!(plan(json!([]))["download"][0]["hash"], sha);
        let changed = content.replace("中文", "修改"); let next = hash(&changed);
        assert_eq!(plan(json!([{"id":"one","hash":next,"baseHash":sha}]))["upload"][0]["baseHash"], sha);
        assert_eq!(plan(json!([{"id":"one","hash":next}]))["download"][0]["conflict"], true);
        assert_eq!(call("PUT", "a/banks/one", json!({"hash":next,"content":changed})).unwrap().0, 409);
        assert_eq!(call("PUT", "a/banks/one", json!({"hash":sha,"content":changed})).unwrap_err().0, 400);
        assert!(call("PUT", "../manifest", json!({})).is_err());
        assert_eq!(call("GET", "b/banks/one", Value::Null).unwrap_err().0, 404);
        assert_eq!(call("GET", "a/banks/one", Value::Null).unwrap().1["content"], content);
        fs::remove_dir_all(dir).unwrap();
    }
}
