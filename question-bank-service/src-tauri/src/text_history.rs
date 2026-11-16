use crate::{model::{Mount, valid_id, write_json, read_json}, text_sync, server::safe_file};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{fs,io::Write,path::{Path,PathBuf}};
type ResultApi = Result<(u16,Value),(u16,String)>;
fn sha(bytes:&[u8])->String { format!("{:x}",Sha256::digest(bytes)) }
fn folder(data:&Path,id:&str,path:&str)->PathBuf { data.join("text-file-history").join(id).join(sha(path.as_bytes())) }
fn context<'a>(mounts:&'a[Mount],rest:&str)->Result<(&'a Mount,PathBuf,String),(u16,String)> {
    let (id,path)=rest.split_once('/').ok_or((400,"缺少文件路径".into()))?;
    let mount=mounts.iter().find(|m|m.enabled&&m.id==id&&text_sync::is_text_mount(m)).ok_or((404,"文本目录不存在".into()))?;
    let file=safe_file(&mount.path,path).map_err(|e|(403,e))?;
    if !file.is_file() || !text_sync::allowed(&file) {return Err((404,"文本文件不存在".into()));}
    let root=fs::canonicalize(&mount.path).map_err(|e|(500,e.to_string()))?;
    let relative=file.strip_prefix(root).map_err(|_|(403,"路径越界".into()))?.to_string_lossy().replace('\\',"/");
    Ok((mount,file,relative))
}
fn backup(data:&Path,mount:&Mount,path:&str,bytes:&[u8])->Result<(),(u16,String)> {
    let dir=folder(data,&mount.id,path);fs::create_dir_all(&dir).map_err(|e|(500,e.to_string()))?;
    let id=uuid::Uuid::new_v4().to_string();
    let raw=dir.join(format!("{id}.bin"));
    let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&raw).map_err(|e|(500,e.to_string()))?;
    output.write_all(bytes).and_then(|_|output.sync_all()).map_err(|e|(500,e.to_string()))?;drop(output);
    let created=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    write_json(&dir.join(format!("{id}.json")),&json!({"id":id,"mountId":mount.id,"path":path,"sha":sha(bytes),"size":bytes.len(),"createdAt":created})).map_err(|e|(500,e))
}
pub fn save(mounts:&[Mount],data:&Path,method:&str,rest:&str,body:&[u8])->ResultApi {
    if method=="PUT" {
        if let Ok((mount,file,path))=context(mounts,rest) {
            let input:Value=serde_json::from_slice(body).map_err(|_|(400,"JSON 无效".into()))?;
            if let Some(content)=input["content"].as_str() {
                if fs::metadata(&file).map_err(|e|(500,e.to_string()))?.len()>text_sync::MAX_TEXT {return Err((413,"文件过大".into()));}
                let current=fs::read(file).map_err(|e|(500,e.to_string()))?;
                if !current.is_empty() && content.chars().all(|c|c.is_whitespace() || c=='\u{feff}' || c=='\u{200b}') {return Err((422,"空文件覆盖已拦截，原内容未改动".into()));}
                if content.len() as u64 <=text_sync::MAX_TEXT && input["baseSha"].as_str()==Some(sha(&current).as_str()) && current!=content.as_bytes() {backup(data,mount,&path,&current)?;}
            }
        }
    }
    text_sync::route(mounts,method,rest,body)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_history_empty_guard_and_reversible_restore() {
        let dir=std::env::temp_dir().join(format!("text-history-test-{}",uuid::Uuid::new_v4()));
        let files=dir.join("files");fs::create_dir_all(&files).unwrap();
        let mounts=[Mount{id:"novel".into(),name:"小说".into(),kind:"小说".into(),path:files.to_string_lossy().into(),enabled:true}];
        let file=files.join("任意名称.txt");fs::write(&file,"旧正文").unwrap();
        let body=serde_json::to_vec(&json!({"baseSha":sha("旧正文".as_bytes()),"content":"新版正文"})).unwrap();
        assert_eq!(save(&mounts,&dir,"PUT","novel/任意名称.txt",&body).unwrap().0,200);
        let list=history(&mounts,&dir,"GET","novel/任意名称.txt",b"").unwrap().1;
        assert_eq!(list["items"].as_array().unwrap().len(),1);
        assert_eq!(list["items"][0]["sha"],sha("旧正文".as_bytes()));
        let empty=serde_json::to_vec(&json!({"baseSha":sha("新版正文".as_bytes()),"content":" \u{feff}\r\n"})).unwrap();
        assert_eq!(save(&mounts,&dir,"PUT","novel/任意名称.txt",&empty).unwrap_err().0,422);
        assert_eq!(fs::read_to_string(&file).unwrap(),"新版正文");
        let restore=serde_json::to_vec(&json!({"baseSha":sha("新版正文".as_bytes()),"versionId":list["items"][0]["id"]})).unwrap();
        assert_eq!(history(&mounts,&dir,"PUT","novel/任意名称.txt",&restore).unwrap().0,200);
        assert_eq!(fs::read_to_string(&file).unwrap(),"旧正文");
        assert_eq!(history(&mounts,&dir,"GET","novel/任意名称.txt",b"").unwrap().1["items"].as_array().unwrap().len(),2);
        assert_eq!(history(&mounts,&dir,"PUT","novel/任意名称.txt",&restore).unwrap().0,409);
        let blank=" \u{feff}\u{200b}\r\n";
        backup(&dir,&mounts[0],"任意名称.txt",blank.as_bytes()).unwrap();
        let versions=history(&mounts,&dir,"GET","novel/任意名称.txt",b"").unwrap().1;
        let empty_id=versions["items"].as_array().unwrap().iter().find(|item|item["sha"]==sha(blank.as_bytes())).unwrap()["id"].clone();
        let blocked_restore=serde_json::to_vec(&json!({"baseSha":sha("旧正文".as_bytes()),"versionId":empty_id})).unwrap();
        assert_eq!(history(&mounts,&dir,"PUT","novel/任意名称.txt",&blocked_restore).unwrap_err().0,422);
        assert_eq!(fs::read_to_string(&file).unwrap(),"旧正文");
        let blocked=dir.join("not-a-directory");fs::write(&blocked,"blocked").unwrap();
        assert!(save(&mounts,&blocked,"PUT","novel/任意名称.txt",&body).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(),"旧正文");
        fs::remove_dir_all(dir).unwrap();
    }
}
pub fn history(mounts:&[Mount],data:&Path,method:&str,rest:&str,body:&[u8])->ResultApi {
    let (mount,file,path)=context(mounts,rest)?;
    let dir=folder(data,&mount.id,&path);
    if method=="GET" {
        let mut items=vec![];
        if dir.exists() {for entry in fs::read_dir(&dir).map_err(|e|(500,e.to_string()))? {
            let p=entry.map_err(|e|(500,e.to_string()))?.path();
            if p.extension().and_then(|e|e.to_str())==Some("json") {let value:Value=read_json(&p).map_err(|e|(500,e))?;items.push(value);}
        }}
        items.sort_by(|a,b|b["createdAt"].as_u64().cmp(&a["createdAt"].as_u64()).then_with(||a["id"].as_str().cmp(&b["id"].as_str())));
        return Ok((200,json!({"items":items})));
    }
    if method!="PUT" {return Err((405,"历史仅支持 GET 和 PUT 恢复".into()));}
    let input:Value=serde_json::from_slice(body).map_err(|_|(400,"JSON 无效".into()))?;
    let id=input["versionId"].as_str().filter(|id|valid_id(id)).ok_or((400,"历史版本无效".into()))?;
    let metadata:Value=read_json(&dir.join(format!("{id}.json"))).map_err(|_|(404,"历史版本不存在".into()))?;
    let bytes=fs::read(dir.join(format!("{id}.bin"))).map_err(|_|(404,"历史正文不存在".into()))?;
    if std::str::from_utf8(&bytes).map(|text|text.chars().all(|c|c.is_whitespace()||c=='\u{feff}'||c=='\u{200b}')).unwrap_or(true) || sha(&bytes)!=metadata["sha"].as_str().unwrap_or("") {return Err((422,"空或损坏的历史版本不可恢复".into()));}
    if fs::metadata(&file).map_err(|e|(500,e.to_string()))?.len()>text_sync::MAX_TEXT {return Err((413,"文件过大".into()));}
    let current=fs::read(&file).map_err(|e|(500,e.to_string()))?;
    if input["baseSha"].as_str()!=Some(sha(&current).as_str()) {return Ok((409,json!({"error":"当前文件已变化，请刷新后再恢复","sha":sha(&current)})));}
    backup(data,mount,&path,&current)?;
    let temp=file.parent().unwrap().join(format!(".restore-{}.tmp",uuid::Uuid::new_v4()));
    let result=(||->Result<(),String>{let mut out=fs::File::create(&temp).map_err(|e|e.to_string())?;out.write_all(&bytes).and_then(|_|out.sync_all()).map_err(|e|e.to_string())?;drop(out);fs::rename(&temp,&file).map_err(|e|e.to_string())})();
    if result.is_err(){let _=fs::remove_file(&temp);}result.map_err(|e|(500,e))?;
    Ok((200,json!({"sha":sha(&bytes),"size":bytes.len(),"restored":true})))
}
