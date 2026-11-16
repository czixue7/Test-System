use crate::model::{now, read_json, valid_id, write_json};
use serde_json::{json, Value};
use std::{collections::HashSet, path::Path};

pub fn validate(data: &Value) -> Result<(), String> {
    let invalid = || "API 配置数据格式无效".to_string();
    if data["schema"].as_u64() != Some(1) { return Err(invalid()); }
    let entries = data["entries"].as_array().ok_or_else(invalid)?;
    if entries.len() > 1000 { return Err(invalid()); }
    let mut ids = HashSet::new();
    for entry in entries {
        let id = entry["id"].as_str().filter(|v| valid_id(v)).ok_or_else(invalid)?;
        let version = entry["version"].as_str().filter(|v| valid_id(v)).ok_or_else(invalid)?;
        if !ids.insert(id) { return Err(invalid()); }
        let ancestors = entry["ancestors"].as_array().ok_or_else(invalid)?;
        if ancestors.len() > 10000 || ancestors.iter().any(|v| v.as_str().map_or(true, |v| !valid_id(v) || v == version)) {
            return Err(invalid());
        }
        if !entry.get("value").is_some_and(Value::is_null) {
            let value = entry["value"].as_object().ok_or_else(invalid)?;
            let fields = ["name", "apiKey", "apiModel", "apiEndpoint", "apiProvider", "apiPassword"];
            let concurrency = value.get("concurrency");
            if value.len() != fields.len() + usize::from(concurrency.is_some()) || fields.iter().any(|key| value.get(*key).and_then(Value::as_str).map_or(true, |v| v.chars().count() > 16384)) || concurrency.is_some_and(|v| v.as_u64().map_or(true, |n| !(1..=32).contains(&n))) {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
pub fn load(dir: &Path, space: &str) -> Result<Value, String> {
    if !valid_id(space) { return Err("同步空间 ID 无效".into()); }
    let file = dir.join("sync").join(space).join("config.json");
    if !file.exists() { return Ok(json!({"revision":0,"data":null})); }
    let value: Value = read_json(&file).map_err(|_| "API 配置文件无法读取".to_string())?;
    if !value["data"].is_null() { validate(&value["data"])?; }
    if value["revision"].as_u64().is_none() { return Err("API 配置版本无效".into()); }
    Ok(value)
}
// Caller holds the shared sync lock for both HTTP requests and local desk commands.
pub fn save(dir: &Path, space: &str, base_revision: u64, data: Value) -> Result<(u16, Value), String> {
    validate(&data)?;
    let current = load(dir, space)?;
    if current["revision"] != base_revision { return Ok((409, current)); }
    let revision = base_revision.checked_add(1).ok_or("API 配置版本超出范围")?;
    let next = json!({"revision":revision,"data":data,"updatedAt":now()});
    write_json(&dir.join("sync").join(space).join("config.json"), &next)
        .map_err(|_| "API 配置保存失败".to_string())?;
    Ok((200, next))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_editor_revision_validation_and_deletion() {
        let dir = std::env::temp_dir().join(format!("api-config-{}", uuid::Uuid::new_v4()));
        let data = json!({"schema":1,"entries":[{"id":"profile","version":"one","ancestors":[],"value":{
            "name":"test","apiKey":"synthetic-key","apiModel":"model","apiEndpoint":"https://example.test",
            "apiProvider":"","apiPassword":"synthetic-password"}}]});
        assert!(load(&dir, "../escape").is_err());
        assert_eq!(save(&dir, "one", 0, data.clone()).unwrap().0, 200);
        assert_eq!(load(&dir, "one").unwrap()["data"], data);
        assert_eq!(load(&dir, "two").unwrap()["data"], Value::Null);
        let mut limited = data.clone(); limited["entries"][0]["value"]["concurrency"] = json!(2);
        assert!(validate(&limited).is_ok());
        for invalid in [json!(0), json!(33), json!(1.5), json!("2"), Value::Null] {
            limited["entries"][0]["value"]["concurrency"] = invalid;
            assert!(validate(&limited).is_err());
        }
        assert_eq!(save(&dir, "one", 0, data.clone()).unwrap().0, 409);
        let mut invalid = data.clone(); invalid["entries"][0]["value"]["apiKey"] = json!(7);
        assert!(save(&dir, "one", 1, invalid).is_err());
        let deleted = json!({"schema":1,"entries":[{"id":"profile","version":"two","ancestors":["one"],"value":null}]});
        assert_eq!(save(&dir, "one", 1, deleted).unwrap().0, 200);
        let text = std::fs::read_to_string(dir.join("sync/one/config.json")).unwrap();
        assert!(!text.contains("synthetic-key") && !text.contains("synthetic-password"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
