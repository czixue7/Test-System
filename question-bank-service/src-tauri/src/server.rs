use crate::model::*;
use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, State},
    http::{Request, Response},
    Router,
};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    net::SocketAddr,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::{
    net::{TcpListener, UdpSocket},
    sync::{oneshot, Semaphore},
    task::JoinHandle,
};

const MAX_FILE: u64 = 32 * 1024 * 1024;
const MAX_SYNC: usize = 16 * 1024 * 1024;
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub time: u64,
    pub upload: u64,
    pub download: u64,
    pub requests: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub time: u64,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub upload: u64,
    pub download: u64,
    pub peer: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Metrics {
    pub upload: u64,
    pub download: u64,
    pub requests: u64,
    pub minutes: Vec<Bucket>,
    pub days: Vec<Bucket>,
    pub records: Vec<Record>,
}
impl Metrics {
    fn record(&mut self, r: Record) {
        self.upload += r.upload;
        self.download += r.download;
        self.requests += 1;
        for (bins, interval) in [(&mut self.minutes, 60), (&mut self.days, 86400)] {
            let time = r.time / interval * interval;
            if bins.last().map(|b| b.time) != Some(time) {
                bins.push(Bucket {
                    time,
                    ..Bucket::default()
                });
            }
            if let Some(b) = bins.last_mut() {
                b.upload += r.upload;
                b.download += r.download;
                b.requests += 1;
            }
        }
        self.minutes.retain(|b| b.time + 7 * 86400 > now());
        self.records.push(r);
        if self.records.len() > 500 {
            self.records.drain(..self.records.len() - 500);
        }
    }
}
pub struct Shared {
    pub config: Config,
    pub data_dir: PathBuf,
    pub metrics: Mutex<Metrics>,
    sync_lock: tokio::sync::Mutex<()>,
    slots: Semaphore,
}
pub struct Running {
    pub shared: Arc<Shared>,
    stop: Option<oneshot::Sender<()>>,
    http: JoinHandle<()>,
    udp: JoinHandle<()>,
    flush: JoinHandle<()>,
}
impl Running {
    pub async fn stop(mut self) -> Result<(), String> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        self.udp.abort();
        self.flush.abort();
        if tokio::time::timeout(std::time::Duration::from_secs(3), &mut self.http)
            .await
            .is_err()
        {
            self.http.abort();
            let _ = self.http.await;
        }
        let _ = self.udp.await;
        let _ = self.flush.await;
        self.shared.flush()
    }
}
impl Shared {
    pub fn flush(&self) -> Result<(), String> {
        write_json(
            &self.data_dir.join("traffic.json"),
            &*self.metrics.lock().map_err(|e| e.to_string())?,
        )
    }
}
pub async fn start(config: Config, dir: PathBuf) -> Result<Running, String> {
    config.validate()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let addr = format!(
        "{}:{}",
        if config.host.contains(':') {
            format!("[{}]", config.host)
        } else {
            config.host.clone()
        },
        config.port
    );
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("HTTP 端口无法监听：{e}"))?;
    let socket = UdpSocket::bind(&addr)
        .await
        .map_err(|e| format!("UDP 端口无法监听：{e}"))?;
    // A corrupt history must be reported, not silently overwritten.
    let history_path = dir.join("traffic.json");
    let metrics = if history_path.exists() {
        read_json(&history_path)?
    } else {
        Metrics::default()
    };
    let shared = Arc::new(Shared {
        config,
        data_dir: dir,
        metrics: Mutex::new(metrics),
        sync_lock: tokio::sync::Mutex::new(()),
        slots: Semaphore::new(32),
    });
    let router = Router::new().fallback(handle).with_state(shared.clone());
    let (stop, rx) = oneshot::channel();
    let http = tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = rx.await;
        })
        .await;
    });
    let udp_state = shared.clone();
    let udp = tokio::spawn(async move {
        let mut buffer = [0u8; 2048];
        while let Ok((len, peer)) = socket.recv_from(&mut buffer).await {
            // Each reply stays below a typical network MTU. Custom UDP clients can retry chunks.
            let request: Value = serde_json::from_slice(&buffer[..len]).unwrap_or(Value::Null);
            if request["token"].as_str() != Some(udp_state.config.access_token.as_str()) {
                continue;
            }
            let path = request["path"].as_str().unwrap_or("/api/v1/health");
            let (status, value) = if path == "/api/v1/health" {
                (200, json!({"service":"question-bank-service","version":1}))
            } else {
                udp_read(&udp_state, path, request["offset"].as_u64().unwrap_or(0)).await
            };
            let bytes = serde_json::to_vec(&value).unwrap_or_default();
            if let Ok(sent) = socket.send_to(&bytes, peer).await {
                udp_state.metrics.lock().unwrap().record(Record {
                    time: now(),
                    method: "UDP".into(),
                    path: path.into(),
                    status,
                    upload: sent as u64,
                    download: len as u64,
                    peer: peer.to_string(),
                });
            }
        }
    });
    let flush_state = shared.clone();
    let flush = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            if let Err(e) = flush_state.flush() {
                eprintln!("流量记录保存失败：{e}");
            }
        }
    });
    Ok(Running {
        shared,
        stop: Some(stop),
        http,
        udp,
        flush,
    })
}
async fn udp_read(state: &Arc<Shared>, path: &str, offset: u64) -> (u16, Value) {
    use base64::Engine;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let read = async {
        if let Some(rest) = path.strip_prefix("/files/") {
            let (id, relative) = rest.split_once('/').ok_or((404, "文件不存在".into()))?;
            let mount = state
                .config
                .mounts
                .iter()
                .find(|m| m.enabled && m.id == id)
                .ok_or((404, "目录不存在".into()))?;
            let file = safe_file(&mount.path, relative).map_err(|e| (403, e))?;
            if !mount_file_allowed(mount, &file) || !file.is_file() {
                return Err((404, "文件不存在".into()));
            }
            let total = fs::metadata(&file).map_err(|e| (500, e.to_string()))?.len();
            if total > file_limit(mount) || offset > total {
                return Err((413, "文件过大或偏移超出范围".into()));
            }
            let mut file = tokio::fs::File::open(file)
                .await
                .map_err(|e| (500, e.to_string()))?;
            file.seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| (500, e.to_string()))?;
            let mut bytes = vec![0u8; 768];
            let n = file
                .read(&mut bytes)
                .await
                .map_err(|e| (500, e.to_string()))?;
            bytes.truncate(n);
            return Ok((200, total, bytes));
        }
        let response = route(state, "GET", path, &[]).await?;
        let status = response.status().as_u16();
        let bytes = to_bytes(response.into_body(), MAX_FILE as usize)
            .await
            .map_err(|e| (500, e.to_string()))?;
        let total = bytes.len() as u64;
        if offset > total {
            return Err((400, "偏移超出范围".into()));
        }
        Ok::<_, (u16, String)>((
            status,
            total,
            bytes[offset as usize..std::cmp::min(bytes.len(), offset as usize + 768)].to_vec(),
        ))
    }
    .await;
    match read {
        Ok((status, total, bytes)) => (
            status,
            json!({"status":status,"offset":offset,"total":total,"encoding":"base64","data":base64::engine::general_purpose::STANDARD.encode(bytes)}),
        ),
        Err((status, error)) => (status, json!({"status":status,"error":error})),
    }
}
fn response(status: u16, value: Value) -> Response<Body> {
    bytes_response(
        status,
        "application/json; charset=utf-8",
        serde_json::to_vec(&value).unwrap_or_default(),
    )
}
fn bytes_response(status: u16, mime: &str, bytes: Vec<u8>) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        .header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type",
        )
        .body(Body::from(bytes))
        .unwrap()
}
async fn handle(
    State(state): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request<Body>,
) -> Response<Body> {
    let method = req.method().to_string();
    let path = req.uri().path().to_owned();
    if method == "OPTIONS" {
        return response(204, Value::Null);
    }
    let authorized = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.strip_prefix("Bearer ") == Some(state.config.access_token.as_str()))
        .unwrap_or(false);
    let Ok(_permit) = state.slots.try_acquire() else {
        return response(429, json!({"error":"服务繁忙，请稍后重试"}));
    };
    let mut download = 0;
    let res = if !authorized {
        response(401, json!({"error":"访问密钥无效"}))
    } else {
        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            to_bytes(req.into_body(), MAX_SYNC),
        )
        .await
        {
            Ok(Ok(body)) => {
                download = body.len() as u64;
                match route(&state, &method, &path, &body).await {
                    Ok(r) => r,
                    Err((code, e)) => response(code, json!({"error":e})),
                }
            }
            Ok(Err(_)) => response(413, json!({"error":"请求体超过 16 MiB"})),
            Err(_) => response(408, json!({"error":"读取请求超时"})),
        }
    };
    use axum::body::HttpBody;
    let upload = res.body().size_hint().exact().or_else(|| res.headers().get("content-length").and_then(|v|v.to_str().ok()?.parse().ok())).unwrap_or(0);
    state.metrics.lock().unwrap().record(Record {
        time: now(),
        method,
        path,
        status: res.status().as_u16(),
        upload,
        download,
        peer: peer.to_string(),
    });
    res
}
type ApiResult = Result<Response<Body>, (u16, String)>;
async fn route(state: &Arc<Shared>, method: &str, path: &str, body: &[u8]) -> ApiResult {
    if let Some(rest) = path.strip_prefix("/api/v1/bank-sync/") {
        let _lock = state.sync_lock.lock().await;
        let (status, value) = crate::bank_sync::route(&state.data_dir, &state.config.mounts, method, rest, body)?;
        return Ok(response(status, value));
    }
    if method == "GET" && path == "/api/v1/health" {
        return Ok(response(
            200,
            json!({"service":"question-bank-service","version":1}),
        ));
    }
    if let Some(rest) = path.strip_prefix("/api/v1/sync/") {
        let Some((space, kind)) = rest.split_once('/') else {
            return Err((400, "同步路径无效".into()));
        };
        if ["banks", "duty"].contains(&kind) {
            return Err((410, "题库和值班表不使用同步存储，请从发布目录手动获取".into()));
        }
        if !valid_id(space) || !["knowledge", "summaries", "chat"].contains(&kind) {
            return Err((400, "同步空间或数据类型无效".into()));
        }
        let _lock = state.sync_lock.lock().await;
        let file = state
            .data_dir
            .join("sync")
            .join(space)
            .join(format!("{kind}.json"));
        let current: Value = if file.exists() {
            read_json(&file).map_err(|e| (500, e))?
        } else {
            json!({"revision":0,"data":null})
        };
        if method == "GET" {
            return Ok(response(200, current));
        }
        if method == "PUT" {
            let input: Value =
                serde_json::from_slice(body).map_err(|_| (400, "JSON 格式无效".into()))?;
            if input["baseRevision"].as_u64().is_none() || !input["data"].is_object() {
                return Err((400, "同步数据缺少版本或内容".into()));
            }
            if input["baseRevision"] != current["revision"] {
                return Ok(response(409, current));
            }
            let next = json!({"revision":current["revision"].as_u64().unwrap_or(0)+1,"data":input["data"],"updatedAt":now()});
            write_json(&file, &next).map_err(|e| (500, e))?;
            return Ok(response(200, next));
        }
        return Err((405, "只支持 GET / PUT".into()));
    }
    if method != "GET" {
        return Err((405, "只支持读取资源".into()));
    }
    if [
        "/bank-index.json",
        "/duty-index.json",
        "/api/v1/knowledge",
        "/api/v1/catalog",
        "/app-update.json",
    ]
    .contains(&path)
    {
        let mounts: Vec<Mount> = state.config.mounts.iter()
            .filter(|m| path != "/app-update.json" || m.kind == "package").cloned().collect();
        let catalog = tokio::task::spawn_blocking(move || catalog(&mounts))
            .await
            .map_err(|e| (500, e.to_string()))?
            .map_err(|e| (500, e))?;
        let value = match path {
            "/bank-index.json" => catalog["banks"].clone(),
            "/duty-index.json" => catalog["duties"].clone(),
            "/api/v1/knowledge" => catalog["knowledge"].clone(),
            "/app-update.json" => json!(crate::packages::releases(catalog["packages"]["items"].as_array().unwrap())),
            _ => catalog,
        };
        return Ok(response(200, value));
    }
    if let Some(rest) = path.strip_prefix("/files/") {
        let Some((id, relative)) = rest.split_once('/') else {
            return Err((404, "文件不存在".into()));
        };
        let mount = state
            .config
            .mounts
            .iter()
            .find(|m| m.enabled && m.id == id)
            .ok_or((404, "目录不存在".into()))?;
        let file = safe_file(&mount.path, relative).map_err(|e| (403, e))?;
        if !mount_file_allowed(mount, &file) || !file.is_file() {
            return Err((404, "文件类型不允许或不存在".into()));
        }
        let size = fs::metadata(&file).map_err(|e| (404, e.to_string()))?.len();
        if size > file_limit(mount) {
            return Err((413, "文件超过此目录允许的大小".into()));
        }
        if mount.kind == "package" {
            crate::packages::metadata(&file).map_err(|e| (404, e))?;
            let file = tokio::fs::File::open(&file).await.map_err(|e| (500,e.to_string()))?;
            return Ok(Response::builder().status(200)
                .header("Content-Type", "application/octet-stream")
                .header("Content-Length", size)
                .header("Content-Disposition", "attachment")
                .header("Access-Control-Allow-Origin", "*")
                .header("Cache-Control", "no-store")
                .body(Body::from_stream(tokio_util::io::ReaderStream::new(file))).unwrap());
        }
        let mime = mime(&file);
        let bytes = tokio::fs::read(&file)
            .await
            .map_err(|e| (500, e.to_string()))?;
        return Ok(bytes_response(200, mime, bytes));
    }
    if let Some(rest) = path.strip_prefix("/api/v1/images/") {
        let Some((id, relative)) = rest.split_once('/') else {
            return Err((404, "目录不存在".into()));
        };
        let mount = state
            .config
            .mounts
            .iter()
            .find(|m| m.enabled && m.id == id)
            .ok_or((404, "目录不存在".into()))?;
        let dir = safe_file(&mount.path, relative).map_err(|e| (403, e))?;
        let mut files = vec![];
        for entry in fs::read_dir(dir).map_err(|e| (404, e.to_string()))? {
            let entry = entry.map_err(|e| (500, e.to_string()))?;
            if !entry
                .file_type()
                .map_err(|e| (500, e.to_string()))?
                .is_file()
                || !is_image(&entry.path())
            {
                continue;
            }
            let root = fs::canonicalize(&mount.path).map_err(|e| (500, e.to_string()))?;
            let full = fs::canonicalize(entry.path()).map_err(|e| (500, e.to_string()))?;
            if !full.starts_with(&root) {
                continue;
            }
            files.push(json!({"name":entry.file_name().to_string_lossy(),"type":"file","download_url":file_url(&mount.id,full.strip_prefix(root).unwrap())}));
        }
        return Ok(response(200, json!(files)));
    }
    Err((404, "接口不存在".into()))
}
pub fn safe_file(root: &str, encoded: &str) -> Result<PathBuf, String> {
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| "路径编码无效")?;
    if decoded.contains('\\') || decoded.contains(':') || decoded.contains('\0') {
        return Err("路径无效".into());
    }
    let p = Path::new(decoded.as_ref());
    if p.components().any(|c| !matches!(c, Component::Normal(_)))
        || p.components()
            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    {
        return Err("禁止访问此路径".into());
    }
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let file = fs::canonicalize(root.join(p)).map_err(|e| e.to_string())?;
    if !file.starts_with(&root) {
        return Err("路径超出发布目录".into());
    }
    Ok(file)
}
fn ext(p: &Path) -> String {
    p.extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
}
fn is_image(p: &Path) -> bool {
    ["png", "jpg", "jpeg", "gif", "webp"].contains(&ext(p).as_str())
}
fn allowed(p: &Path) -> bool {
    is_image(p) || ["json", "md", "txt"].contains(&ext(p).as_str())
}
fn mount_file_allowed(mount: &Mount, path: &Path) -> bool {
    if mount.kind == "package" { crate::packages::metadata(path).is_ok() } else { allowed(path) }
}
fn file_limit(mount: &Mount) -> u64 {
    if mount.kind == "package" { crate::packages::MAX_PACKAGE } else { MAX_FILE }
}
fn mime(p: &Path) -> &'static str {
    match ext(p).as_str() {
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "text/plain; charset=utf-8",
    }
}
fn encoded(p: &Path) -> String {
    p.components()
        .map(|c| {
            utf8_percent_encode(&c.as_os_str().to_string_lossy(), NON_ALPHANUMERIC).to_string()
        })
        .collect::<Vec<_>>()
        .join("/")
}
fn file_url(id: &str, relative: &Path) -> String {
    format!("/files/{id}/{}", encoded(relative))
}
fn walk(root: &Path, dir: &Path, files: &mut Vec<PathBuf>, depth: usize, package: bool) -> Result<(), String> {
    if depth > 12 {
        return Err("目录层级超过 12 层".into());
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let e = entry.map_err(|e| e.to_string())?;
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let typ = e.file_type().map_err(|e| e.to_string())?;
        // Do not follow symlinks or Windows junctions outside the root.
        let full = fs::canonicalize(e.path()).map_err(|e| e.to_string())?;
        if !full.starts_with(root) || typ.is_symlink() {
            continue;
        }
        if typ.is_dir() {
            walk(root, &full, files, depth + 1, package)?;
        } else if typ.is_file() && (if package {crate::packages::allowed(&full)} else {allowed(&full)}) {
            files.push(full);
            if files.len() > 10000 {
                return Err("发布目录超过 10000 个文件".into());
            }
        }
    }
    Ok(())
}
pub fn catalog(mounts: &[Mount]) -> Result<Value, String> {
    let mut banks = vec![];
    let mut duties = vec![];
    let mut knowledge = vec![];
    let mut warnings = vec![];
    let mut packages = vec![];
    for m in mounts.iter().filter(|m| m.enabled) {
        let root = match fs::canonicalize(&m.path) {
            Ok(p) => p,
            Err(e) => {
                warnings.push(format!("{}：{e}", m.name));
                continue;
            }
        };
        let mut files = vec![];
        walk(&root, &root, &mut files, 0, m.kind == "package")?;
        files.sort();
        if m.kind == "package" {
            for full in &files {
                match crate::packages::metadata(full) {
                    Ok(mut item) => {
                        item["downloadUrl"] = json!(file_url(&m.id,full.strip_prefix(&root).unwrap()));
                        packages.push(item);
                    }
                    Err(e) => warnings.push(format!("{}：{e}",full.file_name().unwrap().to_string_lossy())),
                }
            }
            continue;
        }
        for full in files
            .iter()
            .filter(|p| ["json", "md", "txt"].contains(&ext(p).as_str()))
        {
            if fs::metadata(full).map_err(|e| e.to_string())?.len() > MAX_FILE {
                warnings.push(format!("文件过大：{}", full.display()));
                continue;
            }
            let bytes = fs::read(full).map_err(|e| e.to_string())?;
            let relative = full.strip_prefix(&root).unwrap();
            let filename = format!("{}/{}", m.id, relative.to_string_lossy().replace('\\', "/"));
            let sha = format!("{:x}", Sha256::digest(&bytes));
            let data: Value = if ext(full) == "json" {
                match serde_json::from_slice(&bytes) {
                    Ok(v) => v,
                    Err(_) => {
                        warnings.push(format!("JSON 无效：{filename}"));
                        continue;
                    }
                }
            } else {
                Value::Null
            };
            let name = data["name"]
                .as_str()
                .or(data["title"].as_str())
                .unwrap_or_else(|| full.file_stem().unwrap().to_str().unwrap_or("未命名"));
            let modified = fs::metadata(full).ok().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t|t.as_millis() as u64).unwrap_or(0);
            let mut item = json!({"name":name,"filename":filename,"downloadUrl":file_url(&m.id,relative),"sha":sha,"updatedAt":modified});
            match m.kind.as_str() {
                "bank" if data["questions"].is_array() => {
                    item["bankId"] = data["bankId"].as_str().filter(|id| !id.trim().is_empty())
                        .map(|id| json!(id)).unwrap_or_else(|| json!(format!("bank:{}", full.file_name().unwrap().to_string_lossy())));
                    let image_dir = full.parent().unwrap().join("image");
                    if image_dir.is_dir() && image_dir.starts_with(&root) {
                        item["imagePath"] = json!(format!(
                            "/api/v1/images/{}/{}",
                            m.id,
                            encoded(image_dir.strip_prefix(&root).unwrap())
                        ));
                        let mut images = vec![];
                        for image in files
                            .iter()
                            .filter(|p| p.parent() == Some(image_dir.as_path()) && is_image(p))
                        {
                            if fs::metadata(image).map_err(|e| e.to_string())?.len() > MAX_FILE {
                                continue;
                            }
                            let image_modified = fs::metadata(image).ok().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t|t.as_millis() as u64).unwrap_or(0);
                            item["updatedAt"] = json!(item["updatedAt"].as_u64().unwrap_or(0).max(image_modified));
                            images.push(json!({"filename":image.file_name().unwrap().to_string_lossy(),"sha":format!("{:x}",Sha256::digest(fs::read(image).map_err(|e| e.to_string())?))}));
                        }
                        item["images"] = json!(images);
                    }
                    banks.push(item);
                }
                "duty" if data["shifts"].is_array() => duties.push(item),
                "knowledge" => {
                    let content = if data.is_null() {
                        String::from_utf8(bytes).map_err(|_| "知识库文本必须是 UTF-8")?
                    } else {
                        data["content"].as_str().unwrap_or("").to_owned()
                    };
                    if !content.is_empty() {
                        knowledge.push(json!({"id":format!("published-{filename}"),"title":name,"category":m.name,"content":content,"createdAt":"1970-01-01T00:00:00Z","updatedAt":format!("{}",fs::metadata(full).ok().and_then(|x|x.modified().ok()).and_then(|x|x.duration_since(std::time::UNIX_EPOCH).ok()).map(|x|x.as_secs()).unwrap_or(0)),"sourceHash":sha}));
                    }
                }
                _ => {}
            }
        }
    }
    Ok(
        json!({"banks":{"systemBanks":[],"userBanks":banks},"duties":{"systemDuties":[],"userDuties":duties},"knowledge":{"items":knowledge},"packages":{"items":packages},"warnings":warnings}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn package_updates_and_large_authenticated_downloads() {
        let dir = std::env::temp_dir().join(format!("package-api-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let name = "Answer_Test_v0.4.4_build2026102101_arm64.apk";
        let file = fs::File::create(dir.join(name)).unwrap();
        let size = MAX_FILE + 17;
        file.set_len(size).unwrap(); drop(file);
        fs::write(dir.join("Answer_Test_v0.5.0_build9_x64.exe"),b"installer").unwrap();
        fs::write(dir.join("Answer_Test_v0.4.4_arm64.apk"),b"no build").unwrap();
        fs::write(dir.join("private.json"),b"{}").unwrap();
        let mount = Mount{id:"packages".into(),name:"软件包".into(),path:dir.to_string_lossy().into(),kind:"package".into(),enabled:true};
        let disabled = Mount{id:"disabled".into(),enabled:false,..mount.clone()};
        let ordinary = Mount{id:"ordinary".into(),kind:"bank".into(),..mount.clone()};
        let mut config = Config::default();
        // Use an ephemeral listener port selected in the same controlled test.
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        config.port = socket.local_addr().unwrap().port(); drop(socket);
        config.mounts=vec![mount,disabled,ordinary]; config.validate().unwrap();
        let token=config.access_token.clone();
        let running=start(config,dir.join("data")).await.unwrap();
        let base=format!("http://127.0.0.1:{}",running.shared.config.port);
        let client=reqwest::Client::new();
        assert_eq!(client.get(format!("{base}/app-update.json")).send().await.unwrap().status(),401);
        let res=client.get(format!("{base}/app-update.json")).bearer_auth(&token).send().await.unwrap();
        let list: Value=serde_json::from_slice(&res.bytes().await.unwrap()).unwrap();
        assert_eq!(list.as_array().unwrap().len(),2);
        let asset=list.as_array().unwrap().iter().find(|v|v["version"]=="0.4.4").unwrap()["assets"][0].clone();
        let url=format!("{base}{}",asset["browser_download_url"].as_str().unwrap());
        assert_eq!(client.get(&url).send().await.unwrap().status(),401);
        let mut response=client.get(&url).bearer_auth(&token).send().await.unwrap();
        assert_eq!(response.status(),200); assert_eq!(response.content_length(),Some(size));
        let mut total=0;
        while let Some(chunk)=response.chunk().await.unwrap(){assert!(chunk.iter().all(|b|*b==0));total+=chunk.len() as u64;}
        assert_eq!(total,size);
        for path in [format!("/files/disabled/{name}"),format!("/files/ordinary/{name}"),"/files/packages/private.json".into(),"/files/packages/Answer_Test_v0.4.4_arm64.apk".into()] {
            assert_eq!(client.get(format!("{base}{path}")).bearer_auth(&token).send().await.unwrap().status(),404);
        }
        let catalog=catalog(&running.shared.config.mounts).unwrap();
        assert_eq!(catalog["packages"]["items"].as_array().unwrap().len(),2);
        assert!(catalog["warnings"].as_array().unwrap().iter().any(|v|v.as_str().unwrap().contains("构建号")));
        running.stop().await.unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("bank-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("ok.json"), "{}").unwrap();
        for p in [
            "../secret",
            "%2e%2e/secret",
            "C:/secret",
            "..%5csecret",
            "/absolute",
            ".hidden",
        ] {
            assert!(safe_file(dir.to_str().unwrap(), p).is_err(), "{p}");
        }
        assert!(safe_file(dir.to_str().unwrap(), "ok.json").is_ok());
        fs::remove_file(dir.join("ok.json")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn traffic_aggregates() {
        let mut m = Metrics::default();
        for _ in 0..2 {
            m.record(Record {
                time: now(),
                method: "GET".into(),
                path: "/".into(),
                status: 200,
                upload: 20,
                download: 5,
                peer: "local".into(),
            });
        }
        assert_eq!(m.upload, 40);
        assert_eq!(m.download, 10);
        assert_eq!(m.days.len(), 1);
        assert_eq!(m.days[0].requests, 2);
    }

    async fn request(
        port: u16,
        method: &str,
        path: &str,
        token: &str,
        value: Value,
    ) -> (u16, Value) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        let body = if value.is_null() {
            String::new()
        } else {
            value.to_string()
        };
        let req=format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        stream.write_all(req.as_bytes()).await.unwrap();
        let mut response = vec![];
        stream.read_to_end(&mut response).await.unwrap();
        let text = String::from_utf8(response).unwrap();
        let (headers, body) = text.split_once("\r\n\r\n").unwrap();
        let code = headers.split_whitespace().nth(1).unwrap().parse().unwrap();
        (code, serde_json::from_str(body).unwrap_or(json!(body)))
    }
    #[tokio::test]
    async fn service_lifecycle_auth_catalog_and_sync_conflict() {
        let dir = std::env::temp_dir().join(format!("bank-service-test-{}", uuid::Uuid::new_v4()));
        let bank = dir.join("bank");
        let knowledge = dir.join("knowledge");
        let duty = dir.join("duty");
        for p in [&bank, &knowledge, &duty] {
            fs::create_dir_all(p).unwrap();
        }
        fs::write(bank.join("中文题库.json"),r#"{"name":"测试题库","questions":[{"type":"single-choice","content":"测试","correctAnswer":"A"}]}"#).unwrap();
        fs::write(knowledge.join("知识.md"), "测试知识内容").unwrap();
        fs::write(duty.join("duty.json"), r#"{"name":"值班表","shifts":[]}"#).unwrap();
        let port = (0..30).find_map(|_| {
            let tcp = std::net::TcpListener::bind("127.0.0.1:0").ok()?;
            let port = tcp.local_addr().ok()?.port();
            let _udp = std::net::UdpSocket::bind(("127.0.0.1",port)).ok()?;
            Some(port)
        }).expect("没有可用于测试的本地 TCP/UDP 端口");
        let mut config = Config::default();
        config.port = port;
        for (id, path, kind) in [
            ("bank", &bank, "bank"),
            ("knowledge", &knowledge, "knowledge"),
            ("duty", &duty, "duty"),
        ] {
            config.mounts.push(Mount {
                id: id.into(),
                name: id.into(),
                path: path.to_string_lossy().into_owned(),
                kind: kind.into(),
                enabled: true,
            });
        }
        let running = start(config.clone(), dir.join("state")).await.unwrap();
        let token = &config.access_token;
        assert_eq!(
            request(port, "GET", "/api/v1/health", "wrong", Value::Null)
                .await
                .0,
            401
        );
        assert_eq!(
            request(port, "GET", "/api/v1/health", token, Value::Null)
                .await
                .1["service"],
            "question-bank-service"
        );
        let (_, index) = request(port, "GET", "/bank-index.json", token, Value::Null).await;
        assert_eq!(index["userBanks"].as_array().unwrap().len(), 1);
        assert!(index["userBanks"][0]["updatedAt"].as_u64().unwrap() > 0);
        assert!(index["userBanks"][0]["bankId"].as_str().unwrap().starts_with("bank:"));
        let url = index["userBanks"][0]["downloadUrl"].as_str().unwrap();
        assert_eq!(
            request(port, "GET", url, token, Value::Null).await.1["name"],
            "测试题库"
        );
        assert_eq!(
            request(port, "GET", "/api/v1/knowledge", token, Value::Null)
                .await
                .1["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            request(port, "GET", "/duty-index.json", token, Value::Null)
                .await
                .1["userDuties"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            request(port, "GET", "/files/bank/%2e%2e/secret", token, Value::Null)
                .await
                .0,
            403
        );
        let path = "/api/v1/sync/device-a/knowledge";
        let payload = json!({"baseRevision":0,"data":{"items":[],"categories":[]}});
        let (left, right) = tokio::join!(
            request(port, "PUT", path, token, payload.clone()),
            request(port, "PUT", path, token, payload)
        );
        assert!([left.0, right.0] == [200, 409] || [left.0, right.0] == [409, 200]);
        assert_eq!(
            request(port, "GET", path, token, Value::Null).await.1["revision"],
            1
        );
        assert_eq!(
            request(
                port,
                "GET",
                "/api/v1/sync/device-b/knowledge",
                token,
                Value::Null
            )
            .await
            .1["revision"],
            0
        );
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        socket
            .send_to(
                json!({"token":token,"path":"/api/v1/health"})
                    .to_string()
                    .as_bytes(),
                ("127.0.0.1", port),
            )
            .await
            .unwrap();
        let mut packet = [0u8; 2048];
        let (len, _) = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            socket.recv_from(&mut packet),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&packet[..len]).unwrap()["service"],
            "question-bank-service"
        );
        socket
            .send_to(
                json!({"token":token,"path":url,"offset":0})
                    .to_string()
                    .as_bytes(),
                ("127.0.0.1", port),
            )
            .await
            .unwrap();
        let (len, _) = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            socket.recv_from(&mut packet),
        )
        .await
        .unwrap()
        .unwrap();
        let chunk: Value = serde_json::from_slice(&packet[..len]).unwrap();
        use base64::Engine;
        let restored = base64::engine::general_purpose::STANDARD
            .decode(chunk["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&restored).unwrap()["name"],
            "测试题库"
        );
        for kind in ["knowledge", "summaries", "chat"] {
            let path = format!("/api/v1/sync/roundtrip/{kind}");
            let payload = json!({"baseRevision":0,"data":{"channel":kind}});
            assert_eq!(request(port,"PUT",&path,token,payload.clone()).await.0,200);
            assert_eq!(request(port,"PUT",&path,token,payload).await.0,409);
            assert_eq!(request(port,"GET",&path,token,Value::Null).await.1["data"]["channel"],kind);
        }
        for path in ["/api/v1/bank-sync/hash-test/manifest", "/api/v1/bank-sync/hash-test/banks/local-bank", "/api/v1/sync/roundtrip/duty", "/api/v1/sync/roundtrip/banks"] {
            for method in ["GET", "PUT"] {
                assert_eq!(request(port,method,path,token,json!({"baseRevision":0,"data":{}})).await.0,410);
            }
        }
        assert!(!dir.join("state/sync/hash-test").exists());
        assert!(!dir.join("state/sync/roundtrip/duty.json").exists());
        assert!(!dir.join("state/sync/roundtrip/banks.json").exists());
        running.stop().await.unwrap();
        assert!(tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err());
        let history: Metrics = read_json(&dir.join("state/traffic.json")).unwrap();
        assert!(history.requests >= 13);
        assert!(history.upload > 0);
        assert!(history.download > 0);
        let restarted = start(config.clone(), dir.join("state")).await.unwrap();
        assert_eq!(
            restarted.shared.metrics.lock().unwrap().requests,
            history.requests
        );
        for kind in ["knowledge", "summaries", "chat"] {
            let path=format!("/api/v1/sync/roundtrip/{kind}");
            let result=request(port,"GET",&path,token,Value::Null).await;
            assert_eq!(result.0,200);assert_eq!(result.1["revision"],1);assert_eq!(result.1["data"]["channel"],kind);
        }
        restarted.stop().await.unwrap();
        assert!(
            dir.starts_with(std::env::temp_dir())
                && dir
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("bank-service-test-")
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
