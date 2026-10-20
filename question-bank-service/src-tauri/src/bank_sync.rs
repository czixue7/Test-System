use crate::model::Mount;
use serde_json::Value;
use std::path::Path;

/// Old clients may still call these URLs. Never read or write their archives.
pub fn route(_dir: &Path, _mounts: &[Mount], _method: &str, _rest: &str, _body: &[u8]) -> Result<(u16, Value), (u16, String)> {
    Err((410, "题库同步存储已停用，请从发布目录手动获取题库".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bank_storage_is_disabled_without_touching_legacy_files() {
        let dir=std::env::temp_dir().join(format!("disabled-bank-sync-{}",uuid::Uuid::new_v4()));
        let file=dir.join("sync/old/banks/one.json");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file,b"legacy").unwrap();
        for (method,path) in [("PUT","new/manifest"),("PUT","new/banks/one"),("GET","old/banks/one")] {
            assert_eq!(route(&dir,&[],method,path,b"{}").unwrap_err().0,410);
        }
        assert!(!dir.join("sync/new").exists());
        assert_eq!(std::fs::read(&file).unwrap(),b"legacy");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
