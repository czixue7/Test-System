use crate::model::read_json;
use serde_json::{json, Value};
use std::{fs, path::Path};

pub fn overview(dir: &Path) -> Result<Value, String> {
    let root = dir.join("sync");
    if !root.exists() {
        return Ok(json!({"rows":[],"warnings":[]}));
    }
    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    for space in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let space = space.map_err(|e| e.to_string())?;
        if !space.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let id = space.file_name().to_string_lossy().to_string();
        if id.is_empty()
            || id.len() > 100
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            continue;
        }
        // Old bank/duty archives stay untouched and are excluded from storage.
        for kind in ["knowledge", "summaries", "chat"] {
            let file = space.path().join(format!("{kind}.json"));
            let Ok(meta) = fs::symlink_metadata(&file) else {
                continue;
            };
            if !meta.is_file() || meta.len() > 32 * 1024 * 1024 {
                continue;
            }
            match read_json::<Value>(&file) {
                Ok(value) => {
                    let data = &value["data"];
                    let count = |key: &str| data[key].as_array().map_or(0, Vec::len);
                    let records = match kind {
                        "knowledge" => count("items"),
                        "summaries" => ["knowledge", "questionBank", "combined"]
                            .iter()
                            .map(|key| count(key))
                            .sum(),
                        "chat" => count("conversations"),
                        _ => 0,
                    };
                    rows.push(json!({"space":id,"kind":kind,"revision":value["revision"].as_u64().unwrap_or(0),"updatedAt":value["updatedAt"].as_u64().unwrap_or(0),"bytes":meta.len(),"records":records}));
                }
                Err(_) => warnings.push(format!("{id} / {kind} 的同步记录无法读取")),
            }
        }
    }
    rows.sort_by(|a, b| {
        a["space"]
            .as_str()
            .cmp(&b["space"].as_str())
            .then(a["kind"].as_str().cmp(&b["kind"].as_str()))
    });
    Ok(json!({"rows":rows,"warnings":warnings}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::write_json;
    #[test]
    fn counts_only_personal_channels_and_ignores_legacy_archives() {
        let dir = std::env::temp_dir().join(format!("sync-overview-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(overview(&dir).unwrap()["rows"].as_array().unwrap().len(), 0);
        for (kind, data, count) in [
            ("knowledge", json!({"items":[{},{}]}), 2),
            (
                "summaries",
                json!({"knowledge":[{}],"questionBank":[{}],"combined":[{}]}),
                3,
            ),
            ("chat", json!({"conversations":[{}]}), 1),
        ] {
            write_json(
                &dir.join("sync/one").join(format!("{kind}.json")),
                &json!({"revision":2,"updatedAt":123,"data":data}),
            )
            .unwrap();
            let result = overview(&dir).unwrap();
            let row = result["rows"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["kind"] == kind)
                .unwrap();
            assert_eq!(row["records"], count);
            assert_eq!(row["revision"], 2);
            assert_eq!(row["updatedAt"], 123);
        }
        fs::create_dir_all(dir.join("sync/legacy/banks")).unwrap();
        fs::write(dir.join("sync/legacy/banks/one.json"),"legacy bank").unwrap();
        fs::write(dir.join("sync/legacy/duty.json"),"legacy duty").unwrap();
        fs::create_dir_all(dir.join("sync/broken")).unwrap();
        fs::write(dir.join("sync/broken/chat.json"), "invalid").unwrap();
        let result = overview(&dir).unwrap();
        assert_eq!(result["rows"].as_array().unwrap().len(), 3);
        assert_eq!(result["warnings"].as_array().unwrap().len(), 1);
        assert_eq!(fs::read_to_string(dir.join("sync/legacy/banks/one.json")).unwrap(),"legacy bank");
        assert_eq!(fs::read_to_string(dir.join("sync/legacy/duty.json")).unwrap(),"legacy duty");
        fs::remove_dir_all(dir).unwrap();
    }
}
