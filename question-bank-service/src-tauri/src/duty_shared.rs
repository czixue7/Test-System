use crate::model::{read_json, valid_id, write_json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

pub type ApiError = (u16, String);

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Entry {
    pub version: String,
    pub value: Value,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Snapshot {
    pub revision: u64,
    pub entries: BTreeMap<String, Entry>,
}

#[derive(Default, Deserialize, Serialize)]
struct Document {
    #[serde(flatten)]
    snapshot: Snapshot,
    recent: Vec<String>,
}

#[derive(Deserialize)]
struct Change {
    expected: Option<String>,
    value: Value,
}

#[derive(Deserialize)]
struct Batch {
    id: String,
    changes: BTreeMap<String, Change>,
}

fn load(file: &Path) -> Result<Document, ApiError> {
    if !file.exists() {
        return Ok(Document::default());
    }
    read_json(file).map_err(|error| (500, error))
}

pub fn read(file: &Path) -> Result<Snapshot, ApiError> {
    Ok(load(file)?.snapshot)
}

fn date_key(date: &str) -> bool {
    date.len() == 10 && date.bytes().enumerate().all(|(index, byte)|
        if index == 4 || index == 7 { byte == b'-' } else { byte.is_ascii_digit() })
}

fn text(value: &Value, max: usize) -> bool {
    value.as_str().is_some_and(|s| !s.trim().is_empty() && s.len() <= max)
}

fn optional_text(value: &Value, max: usize) -> bool {
    value.is_null() || value.as_str().is_some_and(|s| s.len() <= max)
}

fn validate(key: &str, value: &Value) -> bool {
    let parts: Vec<_> = key.split('/').collect();
    let matches_date = |item: &Value, date: &str| item.is_object() && item["date"] == date;
    let valid_group = |group: &str| matches!(group, "" | "A" | "B" | "C" | "D");
    match parts.as_slice() {
        ["drill", date, group] if date_key(date) && valid_group(group) => value.is_null()
            || value.as_array().is_some_and(|drills| drills.len() <= 256 && drills.iter().all(|drill|
                matches_date(drill, date) && drill["group"] == *group && text(&drill["name"], 4000))),
        ["role", date, group, category] if date_key(date) && valid_group(group) && matches!(*category, "white" | "night") => {
            value.is_null() || (matches_date(value, date) && value["group"] == *group
                && match value["shiftType"].as_str() {
                    Some("night") => *category == "night",
                    Some("morning" | "noon" | "allday") => *category == "white",
                    _ => false,
                }
                && optional_text(&value["leader"], 256) && optional_text(&value["leaderLabel"], 256)
                && value["posts"].as_array().is_some_and(|posts| posts.len() <= 256 && posts.iter().all(|post|
                    text(&post["name"], 512) && text(&post["person"], 256)
                    && (post["kind"].is_null() || matches!(post["kind"].as_str(), Some("patrol" | "report" | "rest"))))))
        }
        ["shift", date] if date_key(date) => value.as_array().is_some_and(|shifts| {
            let mut ids = std::collections::HashSet::new();
            shifts.len() <= 512 && shifts.iter().all(|shift|
                matches_date(shift, date) && text(&shift["id"], 256)
                && ids.insert(shift["id"].as_str().unwrap_or_default())
                && matches!(shift["shiftType"].as_str(), Some("night" | "morning" | "noon" | "allday"))
                && shift["tasks"].as_array().is_some_and(|tasks| tasks.len() <= 64 && tasks.iter().all(|t| optional_text(t, 4000)))
                && optional_text(&shift["group"], 40) && optional_text(&shift["personInCharge"], 256)
                && optional_text(&shift["notes"], 4000) && optional_text(&shift["startTime"], 32)
                && optional_text(&shift["endTime"], 32) && optional_text(&shift["originGroup"], 40)
                && optional_text(&shift["originDate"], 32))
        }),
        _ => false,
    }
}

pub fn save(file: &Path, body: &[u8]) -> Result<(u16, Snapshot, bool), ApiError> {
    if body.len() > 2 * 1024 * 1024 {
        return Err((413, "单次共享修改超过 2 MiB".into()));
    }
    let batch: Batch = serde_json::from_slice(body).map_err(|_| (400, "共享标注格式无效".into()))?;
    if !valid_id(&batch.id) || batch.changes.is_empty() || batch.changes.len() > 2000
        || batch.changes.iter().any(|(key, change)| {
            change.expected.as_deref().is_some_and(|id| !valid_id(id)) || !validate(key, &change.value)
        })
    {
        return Err((400, "共享标注的日期、班组或内容无效".into()));
    }

    let mut doc = load(file)?;
    if doc.recent.contains(&batch.id) {
        return Ok((200, doc.snapshot, false));
    }
    if batch.changes.iter().any(|(key, change)|
        doc.snapshot.entries.get(key).map(|entry| &entry.version) != change.expected.as_ref())
    {
        return Ok((409, doc.snapshot, false));
    }
    for (key, change) in batch.changes {
        doc.snapshot.entries.insert(key, Entry { version: batch.id.clone(), value: change.value });
    }
    doc.snapshot.revision = doc.snapshot.revision.checked_add(1).ok_or((500, "共享版本超出范围".into()))?;
    doc.recent.push(batch.id);
    if doc.recent.len() > 256 {
        doc.recent.remove(0);
    }
    if doc.snapshot.entries.len() > 20000 || serde_json::to_vec(&doc).map_err(|e| (500, e.to_string()))?.len() > 8 * 1024 * 1024 {
        return Err((413, "共享副本超过容量限制".into()));
    }
    write_json(file, &doc).map_err(|error| (500, error))?;
    Ok((200, doc.snapshot, true))
}
