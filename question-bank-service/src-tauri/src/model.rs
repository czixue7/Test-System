use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mount {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub enabled: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub access_token: String,
    pub theme: String,
    pub mounts: Vec<Mount>,
    pub public_url: String,
    pub public_port: Option<u16>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 18080,
            access_token: uuid::Uuid::new_v4().to_string(),
            theme: "system".into(),
            mounts: vec![],
            public_url: String::new(),
            public_port: None,
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        self.host
            .parse::<std::net::IpAddr>()
            .map_err(|_| "监听地址必须是 IP 地址")?;
        if self.port == 0 || self.access_token.len() < 16 {
            return Err("端口不能为 0，访问密钥至少 16 个字符".into());
        }
        let mut ids = std::collections::HashSet::new();
        for m in &self.mounts {
            if !valid_id(&m.id) || !ids.insert(&m.id) {
                return Err("目录标识重复或无效".into());
            }
            if !["bank", "knowledge", "duty"].contains(&m.kind.as_str()) {
                return Err("目录类型无效".into());
            }
            if m.enabled && !Path::new(&m.path).is_dir() {
                return Err(format!("目录不存在：{}", m.path));
            }
        }
        Ok(())
    }
}
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
pub fn read_json<T: serde::de::DeserializeOwned>(p: &Path) -> Result<T, String> {
    serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
pub fn write_json<T: Serialize>(p: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp: PathBuf = p.with_extension("tmp");
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, p).map_err(|e| e.to_string())
}
