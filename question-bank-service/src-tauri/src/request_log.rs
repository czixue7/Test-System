use crate::model::Config;
use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

const PREVIEW_LIMIT: usize = 8192;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub time: u64,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub upload: u64,
    pub download: u64,
    pub peer: String,
    pub summary: String,
    pub direction: String,
    pub has_detail: bool,
    pub detail: Option<RequestDetail>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RequestDetail {
    pub protocol: String,
    pub direction: String,
    pub duration_ms: u64,
    pub resource: String,
    pub local_path: Option<String>,
    pub query: String,
    pub request_headers: BTreeMap<String, String>,
    pub response_headers: BTreeMap<String, String>,
    pub request_body: BodyPreview,
    pub response_body: BodyPreview,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BodyPreview {
    pub kind: String,
    pub text: String,
    pub truncated: bool,
}

fn sensitive(key: &str) -> bool {
    let key: String = key.chars().filter(|c| c.is_ascii_alphanumeric()).flat_map(char::to_lowercase).collect();
    ["authorization", "cookie", "token", "password", "passwd", "secret", "apikey", "credential"]
        .iter().any(|word| key.contains(word))
}

fn clip(text: &str, limit: usize) -> (String, bool) {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) { end -= 1; }
    (text[..end].to_owned(), end < text.len())
}

fn scrub(value: &Value, secret: &str, depth: usize, truncated: &mut bool) -> Value {
    if depth > 10 { *truncated = true; return Value::String("[层级过深，已省略]".into()); }
    match value {
        Value::Object(map) => {
            if map.len() > 64 { *truncated = true; }
            Value::Object(map.iter().take(64).map(|(key, value)| {
                let value = if sensitive(key) { Value::String("[已隐藏]".into()) }
                    else if key == "data" && map.get("encoding").and_then(Value::as_str) == Some("base64") {
                        Value::String("[二进制数据，已省略]".into())
                    } else { scrub(value, secret, depth + 1, truncated) };
                (key.clone(), value)
            }).collect())
        }
        Value::Array(items) => {
            if items.len() > 32 { *truncated = true; }
            Value::Array(items.iter().take(32).map(|v| scrub(v, secret, depth + 1, truncated)).collect())
        }
        Value::String(text) => {
            let (text, cut) = clip(&redact_text(text, secret), 2048);
            *truncated |= cut;
            Value::String(text)
        }
        _ => value.clone(),
    }
}

pub fn redact_text(text: &str, secret: &str) -> String {
    if secret.is_empty() { text.into() } else { text.replace(secret, "[已隐藏]") }
}

pub fn headers(headers: &HeaderMap, secret: &str) -> BTreeMap<String, String> {
    headers.iter().take(64).map(|(key, value)| {
        let value = if sensitive(key.as_str()) { "[已隐藏]".into() }
            else { clip(&redact_text(value.to_str().unwrap_or("[非文本]"), secret), 1024).0 };
        (key.to_string(), value)
    }).collect()
}

pub fn query(query: &str, secret: &str) -> String {
    clip(&query.split('&').take(64).map(|part| {
        let (key, value) = part.split_once('=').unwrap_or((part, ""));
        let key = percent_encoding::percent_decode_str(key).decode_utf8_lossy();
        let value = percent_encoding::percent_decode_str(value).decode_utf8_lossy();
        format!("{key}={}", if sensitive(&key) { "[已隐藏]".into() } else { redact_text(&value, secret) })
    }).collect::<Vec<_>>().join("&"), PREVIEW_LIMIT).0
}

pub fn preview(bytes: &[u8], content_type: &str, secret: &str) -> BodyPreview {
    if bytes.is_empty() { return BodyPreview { kind: "empty".into(), text: "无正文".into(), truncated: false }; }
    if content_type.contains("json") {
        if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
            let mut truncated = false;
            let value = scrub(&value, secret, 0, &mut truncated);
            let (text, cut) = clip(&serde_json::to_string_pretty(&value).unwrap_or_default(), PREVIEW_LIMIT);
            return BodyPreview { kind: "json".into(), text, truncated: truncated || cut };
        }
        return BodyPreview { kind: "text".into(), text: "JSON 格式无效，原始正文未记录".into(), truncated: false };
    }
    if content_type.starts_with("text/") || content_type.contains("json") {
        let (text, cut) = clip(&String::from_utf8_lossy(&bytes[..bytes.len().min(PREVIEW_LIMIT + 4)]), PREVIEW_LIMIT);
        return BodyPreview { kind: "text".into(), text: redact_text(&text, secret), truncated: cut || bytes.len() > PREVIEW_LIMIT };
    }
    BodyPreview { kind: "binary".into(), text: "二进制文件，内容不展开".into(), truncated: false }
}

pub fn resource(config: &Config, path: &str) -> (String, Option<String>) {
    if let Some(rest) = path.strip_prefix("/files/") {
        if let Some((id, relative)) = rest.split_once('/') {
            if let Some(mount) = config.mounts.iter().find(|m| m.id == id) {
                let filename = percent_encoding::percent_decode_str(relative).decode_utf8_lossy();
                let kind = match mount.kind.as_str() { "bank" => "题库", "duty" => "值班表", "knowledge" => "知识库", "package" => "软件包", _ => "文件" };
                let local = crate::server::safe_file(&mount.path, relative).ok().map(|p| p.to_string_lossy().into_owned());
                return (format!("{kind} · {} · {filename}", mount.name), local);
            }
        }
    }
    let label = match path {
        "/bank-index.json" => "题库发布清单",
        "/duty-index.json" => "值班表发布清单",
        "/app-update.json" => "软件更新清单",
        "/api/v1/catalog" => "全部发布目录清单",
        "/api/v1/knowledge" => "发布的知识库内容",
        "/api/v1/health" => "服务连接检查",
        _ if path.starts_with("/api/v1/sync/") => match path.rsplit('/').next().unwrap_or("") {
            "knowledge" => "知识库个人同步", "summaries" => "总结个人同步", "chat" => "AI 聊天个人同步", "config" => "API 配置同步", _ => "已停用或无效的同步请求",
        },
        _ if path.starts_with("/api/v1/images/") => "题库图片目录",
        _ => "其他服务请求",
    };
    (label.into(), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn previews_redact_credentials_and_bound_text_without_corrupting_utf8() {
        let secret = "test-access-secret";
        let value = json!({"accessToken":secret,"password":"other-password","nested":{"api_key":"other-key"},
            "content":format!("hello {secret}"),"items":vec!["中文".repeat(2000);40]});
        let preview = preview(&serde_json::to_vec(&value).unwrap(), "application/json", secret);
        assert!(preview.truncated);
        assert!(preview.text.len() <= PREVIEW_LIMIT);
        for raw in [secret,"other-password","other-key"] { assert!(!preview.text.contains(raw)); }
        assert!(preview.text.contains("[已隐藏]"));
        assert!(std::str::from_utf8(preview.text.as_bytes()).is_ok());
        let binary = super::preview(&[0xff,0,1], "application/octet-stream", secret);
        assert_eq!(binary.kind,"binary");
        let udp = super::preview(br#"{"encoding":"base64","offset":0,"data":"secret-binary-base64"}"#, "application/json", secret);
        assert!(!udp.text.contains("secret-binary-base64"));
        let invalid = super::preview(br#"{"apiKey":"broken-json-secret""#, "application/json", secret);
        assert!(!invalid.text.contains("broken-json-secret"));
    }

    #[test]
    fn old_records_load_without_details_and_request_metadata_is_redacted() {
        let old: Record = serde_json::from_value(json!({"time":1,"method":"GET","path":"/duty-index.json","status":200,"upload":40,"download":0,"peer":"localhost"})).unwrap();
        assert!(old.detail.is_none() && !old.has_detail && old.id.is_empty());
        let mut values = HeaderMap::new();
        values.insert("authorization", "Bearer secret".parse().unwrap());
        values.insert("cookie", "session=other-secret".parse().unwrap());
        values.insert("user-agent", "client-test".parse().unwrap());
        let values = headers(&values, "secret");
        assert_eq!(values["authorization"], "[已隐藏]");
        assert_eq!(values["cookie"], "[已隐藏]");
        assert_eq!(values["user-agent"], "client-test");
        assert_eq!(query("access%54oken=secret&file=abc.xlsx&key=secret", "secret"), "accessToken=[已隐藏]&file=abc.xlsx&key=[已隐藏]");
    }
}
