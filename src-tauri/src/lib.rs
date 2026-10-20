use tauri_plugin_sql::{Migration, MigrationKind};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, Response};
use tauri::Manager;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct ApkDownloads(Mutex<HashMap<String, (String, tokio::sync::watch::Sender<bool>)>>);

#[tauri::command]
fn cancel_apk_download(app: tauri::AppHandle, download_id: String) -> Result<(), String> {
    let state = app.state::<ApkDownloads>();
    let mut downloads = state.0.lock().map_err(|e| e.to_string())?;
    if let Some((_, sender)) = downloads.get(&download_id) {
        let _ = sender.send(true);
    } else {
        // Cancellation can reach IPC before the download command starts.
        let (sender, _) = tokio::sync::watch::channel(true);
        downloads.insert(download_id, (String::new(), sender));
    }
    Ok(())
}

#[cfg(target_os = "android")]
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f32,
}

#[tauri::command]
async fn fetch_remote_text(url: String, bearer_token: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(if bearer_token.is_some() { reqwest::redirect::Policy::none() } else { reqwest::redirect::Policy::limited(10) })
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let mut request = client
        .get(&url)
        .header("User-Agent", "Answer-Test-App");
    if let Some(token) = bearer_token { request = request.bearer_auth(token); }
    let response = request.send()
        .await
        .map_err(|e| format!("请求失败 {}: {}", url, e))?;

    let response = response
        .error_for_status()
        .map_err(|e| format!("服务器返回错误状态 {}: {}", url, e))?;

    let text = response
        .text()
        .await
        .map_err(|e| format!("读取文本失败 {}: {}", url, e))?;

    log::info!("fetch_remote_text: 成功, url={}, 长度={}", url, text.len());
    Ok(text)
}

#[tauri::command]
async fn fetch_remote_bytes(url: String, bearer_token: Option<String>) -> Result<Response, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .redirect(if bearer_token.is_some() { reqwest::redirect::Policy::none() } else { reqwest::redirect::Policy::limited(10) })
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let mut request = client
        .get(&url)
        .header("User-Agent", "Answer-Test-App");
    if let Some(token) = bearer_token { request = request.bearer_auth(token); }
    let response = request.send()
        .await
        .map_err(|e| format!("请求失败 {}: {}", url, e))?;

    let response = response
        .error_for_status()
        .map_err(|e| format!("服务器返回错误状态 {}: {}", url, e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取数据失败 {}: {}", url, e))?;

    log::info!("fetch_remote_bytes: 成功, url={}, 字节数={}", url, bytes.len());
    Ok(Response::new(bytes.to_vec()))
}

#[tauri::command]
async fn data_source_request(url: String, token: String, method: String, body: Option<String>) -> Result<serde_json::Value, String> {
    use futures_util::StreamExt;
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !["http", "https"].contains(&parsed.scheme()) || !parsed.username().is_empty() || parsed.password().is_some() { return Err("数据源地址无效".into()); }
    if !["GET", "PUT"].contains(&method.as_str()) { return Err("数据源请求方法无效".into()); }
    if body.as_ref().is_some_and(|s| s.len() > 16 * 1024 * 1024) { return Err("同步数据超过 16 MiB".into()); }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())?;
    let mut request = client.request(if method == "PUT" { reqwest::Method::PUT } else { reqwest::Method::GET }, parsed).bearer_auth(token);
    if let Some(body) = body { request = request.header("Content-Type", "application/json").body(body); }
    let response = request.send().await.map_err(|e|e.to_string())?;
    let status = response.status().as_u16();
    let mut stream = response.bytes_stream(); let mut data = Vec::new();
    while let Some(chunk) = stream.next().await { let chunk = chunk.map_err(|e|e.to_string())?; if data.len()+chunk.len()>32*1024*1024 { return Err("服务响应超过 32 MiB".into()); } data.extend_from_slice(&chunk); }
    let body = String::from_utf8(data).map_err(|e|e.to_string())?;
    Ok(serde_json::json!({"status":status,"body":body}))
}

#[cfg(target_os = "android")]
#[derive(Clone)]
struct AndroidInstaller(PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
fn installer_plugin() -> TauriPlugin<tauri::Wry> {
    PluginBuilder::new("installer")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.exam.test_system", "InstallApkPlugin")?;
            app.manage(AndroidInstaller(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
async fn download_apk(
    app: tauri::AppHandle,
    url: String,
    filename: String,
    download_id: String,
    on_progress: Channel<DownloadProgress>,
    bearer_token: Option<String>,
) -> Result<String, String> {
    // Only a basename is allowed; the frontend cannot write outside the download directory.
    if filename.is_empty() || filename.contains(['/', '\\', ':']) || filename == "." || filename == ".." {
        return Err("无效的下载文件名".into());
    }
    let state = app.state::<ApkDownloads>();
    let (sender, mut receiver) = tokio::sync::watch::channel(false);
    {
        let mut downloads = state.0.lock().map_err(|e| e.to_string())?;
        if downloads.get(&download_id).map(|(name, _)| name.is_empty()).unwrap_or(false) {
            downloads.remove(&download_id);
            return Err("下载已取消".into());
        }
        if downloads.contains_key(&download_id) || downloads.values().any(|(name, _)| name == &filename) {
            return Err("该文件正在下载，请等待或取消后重试".into());
        }
        downloads.insert(download_id.clone(), (filename.clone(), sender));
    }
    #[cfg(target_os = "android")]
    let directory = app.path().app_cache_dir();
    #[cfg(not(target_os = "android"))]
    let directory = app.path().download_dir();
    let result = tokio::select! {
        biased;
        _ = receiver.changed() => Err("下载已取消".to_string()),
        result = download_apk_file(app.clone(), url, filename.clone(), on_progress, bearer_token) => result,
    };
    // Dropping the download future closes the file before removing its partial contents.
    if result.is_err() {
        if let Ok(directory) = directory {
            let _ = std::fs::remove_file(directory.join(format!("{}.part", filename)));
        }
    }
    state.0.lock().map_err(|e| e.to_string())?.remove(&download_id);
    result
}

async fn download_apk_file(
    app: tauri::AppHandle,
    url: String,
    filename: String,
    on_progress: Channel<DownloadProgress>,
    bearer_token: Option<String>,
) -> Result<String, String> {
    log::info!("download_apk: 开始下载 APK, url={}, filename={}", url, filename);

    // Android 11+ 强制分区存储（Scoped Storage）：
    // requestLegacyExternalStorage 只在 Android 10 生效，WRITE_EXTERNAL_STORAGE
    // 又被 maxSdkVersion="28" 限制，且未申请 MANAGE_EXTERNAL_STORAGE ——
    // 直接写 /storage/emulated/0/Download 会 EACCES 失败，整个自更新链路走不通。
    // 改为写入应用私有缓存目录，再通过已有的 FileProvider 交给系统安装器
    // （file_paths.xml 已包含 cache-path / files-path）。
    #[cfg(target_os = "android")]
    let download_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("获取应用缓存目录失败: {}", e))?;

    #[cfg(not(target_os = "android"))]
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("获取下载目录失败: {}", e))?;

    let file_path = download_dir.join(&filename);
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    // Only a fully downloaded file is renamed to the final path. Keep and reuse it.
    if file_path.metadata().map(|meta| meta.len() > 0).unwrap_or(false) {
        return Ok(file_path.to_string_lossy().to_string());
    }
    // 先写临时文件，全部校验通过后再 rename 成正式文件，
    // 避免中断/失败时留下一个损坏的 .apk
    let temp_path = download_dir.join(format!("{}.part", filename));
    log::info!("download_apk: 临时文件路径={:?}", temp_path);

    let client = reqwest::Client::builder()
        .redirect(if bearer_token.is_some() { reqwest::redirect::Policy::none() } else { reqwest::redirect::Policy::limited(10) })
        .build().map_err(|e| e.to_string())?;

    log::info!("download_apk: 发送 HTTP 请求");
    let mut request = client.get(&url);
    if let Some(token) = bearer_token { request = request.bearer_auth(token); }
    let response = request.send()
        .await
        .map_err(|e| {
            let err = format!("下载请求失败: {}", e);
            log::error!("{}", err);
            err
        })?;

    // 校验 HTTP 状态码：Release 资产链接失效时服务器会返回 404/错误页，
    // 旧实现不检查状态，会把整段 HTML 原样写成 .apk 并报告「下载完成」，
    // 用户点安装才看到「解析软件包时出现问题」。
    let response = response.error_for_status().map_err(|e| {
        let err = format!("下载失败，服务器返回错误状态: {}", e);
        log::error!("{}", err);
        err
    })?;

    let total_size = response.content_length().unwrap_or(0);
    log::info!("download_apk: 文件总大小={} bytes", total_size);

    if total_size == 0 {
        return Err("下载失败：服务器返回的文件为空".to_string());
    }

    let mut file = std::fs::File::create(&temp_path).map_err(|e| {
        format!("创建临时文件失败: {}", e)
    })?;

    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;

    let mut downloaded: u64 = 0;

    // 用闭包风格的下载过程，任何错误都在下面统一清理临时文件
    let download_result: Result<(), String> = async {
        use std::io::Write as _;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("下载数据块失败: {}", e))?;
            let chunk_size = chunk.len() as u64;

            file.write_all(&chunk)
                .map_err(|e| format!("写入文件失败: {}", e))?;

            downloaded += chunk_size;

            let percentage = if total_size > 0 {
                (downloaded as f32 / total_size as f32) * 100.0
            } else {
                0.0
            };

            let progress = DownloadProgress {
                downloaded,
                total: total_size,
                percentage,
            };

            if let Err(e) = on_progress.send(progress) {
                log::error!("发送进度失败: {}", e);
            }

            log::debug!("下载进度: {} / {} bytes ({:.1}%)", downloaded, total_size, percentage);
        }

        file.flush().map_err(|e| format!("刷新文件缓冲失败: {}", e))?;
        Ok(())
    }
    .await;

    if let Err(e) = download_result {
        drop(file);
        let _ = std::fs::remove_file(&temp_path);
        return Err(e);
    }

    if downloaded != total_size {
        drop(file);
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "下载不完整：期望 {} 字节，实际 {} 字节，已取消本次更新",
            total_size, downloaded
        ));
    }

    drop(file);

    // rename 前清掉可能存在的旧文件（Windows 上 rename 不覆盖已存在文件）
    if file_path.exists() {
        let _ = std::fs::remove_file(&file_path);
    }
    std::fs::rename(&temp_path, &file_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("保存下载文件失败: {}", e)
    })?;

    let path_str = file_path.to_string_lossy().to_string();
    log::info!("download_apk: 文件保存成功, 路径={}", path_str);

    Ok(path_str)
}

#[tauri::command]
async fn install_apk(app: tauri::AppHandle, apk_path: String) -> Result<String, String> {
    log::info!("install_apk: 开始安装 APK, path={}", apk_path);

    #[cfg(target_os = "android")]
    {
        let installer = app
            .try_state::<AndroidInstaller>()
            .ok_or_else(|| "Android 安装插件未初始化".to_string())?;

        let result: serde_json::Value = installer
            .0
            .run_mobile_plugin::<serde_json::Value>("install", apk_path)
            .map_err(|e| e.to_string())?;

        let status = result
            .get("status")
            .and_then(|v: &serde_json::Value| v.as_str())
            .unwrap_or("UNKNOWN")
            .to_string();

        log::info!("install_apk: Android 安装请求已发送: {}", status);
        Ok(status)
    }

    #[cfg(not(target_os = "android"))]
    {
        // Reveal an updater-owned file; portable builds are replaced manually.
        let root = std::fs::canonicalize(app.path().download_dir().map_err(|e|e.to_string())?)
            .map_err(|e|e.to_string())?;
        let file = std::fs::canonicalize(&apk_path).map_err(|e|e.to_string())?;
        if file.parent() != Some(root.as_path()) || !file.is_file()
            || !file.file_name().unwrap_or_default().to_string_lossy().starts_with("app-update-") {
            return Err("只能打开更新程序下载的安装包".into());
        }
        #[cfg(target_os = "windows")]
        {
            let path = file.to_string_lossy();
            let path = path.strip_prefix(r"\\?\UNC\").map(|s| format!(r"\\{s}"))
                .unwrap_or_else(|| path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned());
            std::process::Command::new("explorer.exe").arg(format!("/select,{path}")).spawn().map_err(|e|e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        std::process::Command::new("open").arg("-R").arg(&file).spawn().map_err(|e|e.to_string())?;
        #[cfg(target_os = "linux")]
        std::process::Command::new("xdg-open").arg(&root).spawn().map_err(|e|e.to_string())?;
        Ok("已尝试打开下载目录，请关闭当前程序后手动安装或替换便携版".into())
    }
}

#[tauri::command]
async fn download_and_install_apk(
    app: tauri::AppHandle,
    url: String,
    filename: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<String, String> {
    log::info!("download_and_install_apk: 开始下载并安装, url={}", url);

    // 先下载
    let download_id = format!("install-{}", filename);
    let file_path = download_apk(app.clone(), url, filename, download_id, on_progress, None).await?;

    log::info!("download_and_install_apk: 下载完成, 开始安装");

    // 再安装
    install_apk(app, file_path).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(log::LevelFilter::Debug)
                .with_tag("ExamTestSystem"),
        );
        log::info!("Starting Exam Test System app on Android");
    }

    let migrations = vec![
        Migration {
            version: 1,
            description: "create exam_records table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS exam_records (
                    id TEXT PRIMARY KEY,
                    week INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    score REAL NOT NULL,
                    total INTEGER NOT NULL,
                    answers TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
    ];

    let builder = tauri::Builder::default()
        .manage(ApkDownloads::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:exam.db", migrations).build())
        ;

    #[cfg(target_os = "android")]
    let builder = builder.plugin(installer_plugin());

    builder
        .invoke_handler(tauri::generate_handler![
            download_apk,
            cancel_apk_download,
            install_apk,
            download_and_install_apk,
            fetch_remote_text,
            fetch_remote_bytes,
            data_source_request,
        ])
        .setup(move |_app| {
            #[cfg(all(debug_assertions, not(target_os = "android")))]
            {
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            #[cfg(target_os = "android")]
            {
                log::info!("Tauri app setup completed on Android");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
