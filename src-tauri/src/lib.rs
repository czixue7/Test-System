use tauri_plugin_sql::{Migration, MigrationKind};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f32,
}

#[tauri::command]
async fn download_apk(
    _app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    log::info!("download_apk: 开始下载 APK, url={}, filename={}", url, filename);

    // 获取下载目录 - 使用 Android 外部存储的 Download 目录
    #[cfg(target_os = "android")]
    let download_dir = get_android_download_dir()?;
    
    #[cfg(not(target_os = "android"))]
    let download_dir = {
        use tauri::Manager;
        _app.path().download_dir()
            .map_err(|e| format!("获取下载目录失败: {}", e))?
    };

    let file_path = download_dir.join(&filename);
    log::info!("download_apk: 文件保存路径={:?}", file_path);

    // 使用 tauri-plugin-http 下载文件
    let client = tauri_plugin_http::reqwest::Client::new();

    log::info!("download_apk: 发送 HTTP 请求");
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| {
            let err = format!("下载请求失败: {}", e);
            log::error!("{}", err);
            err
        })?;

    let total_size = response.content_length().unwrap_or(0);
    log::info!("download_apk: 文件总大小={} bytes", total_size);

    // 读取响应体
    let bytes = response.bytes()
        .await
        .map_err(|e| {
            let err = format!("读取响应体失败: {}", e);
            log::error!("{}", err);
            err
        })?;

    let downloaded_size = bytes.len() as u64;
    log::info!("download_apk: 已下载={} bytes", downloaded_size);

    // 保存文件
    std::fs::write(&file_path, bytes)
        .map_err(|e| {
            let err = format!("保存文件失败: {}", e);
            log::error!("{}", err);
            err
        })?;

    let path_str = file_path.to_string_lossy().to_string();
    log::info!("download_apk: 文件保存成功, 路径={}", path_str);

    Ok(path_str)
}

#[cfg(target_os = "android")]
fn get_android_download_dir() -> Result<PathBuf, String> {
    // 在 Android 上，使用外部存储的 Download 目录
    // /storage/emulated/0/Download/
    let download_dir = PathBuf::from("/storage/emulated/0/Download");
    
    // 确保目录存在
    if !download_dir.exists() {
        std::fs::create_dir_all(&download_dir)
            .map_err(|e| format!("创建下载目录失败: {}", e))?;
    }
    
    log::info!("Android 下载目录: {:?}", download_dir);
    Ok(download_dir)
}

#[tauri::command]
async fn install_apk(_app: tauri::AppHandle, apk_path: String) -> Result<String, String> {
    log::info!("install_apk: 开始安装 APK, path={}", apk_path);

    #[cfg(target_os = "android")]
    {
        // 在 Android 上，我们返回 APK 路径给前端
        // 前端将通过 Tauri 的 API 调用 Android 原生代码
        log::info!("install_apk: Android 平台，返回 APK 路径");
        Ok(apk_path)
    }

    #[cfg(not(target_os = "android"))]
    {
        log::warn!("install_apk: 非 Android 平台, 不支持安装");
        Err("仅支持 Android 平台".to_string())
    }
}

#[tauri::command]
async fn download_and_install_apk(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    log::info!("download_and_install_apk: 开始下载并安装, url={}", url);

    // 先下载
    let file_path = download_apk(app.clone(), url, filename).await?;

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

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:exam.db", migrations).build())
        .invoke_handler(tauri::generate_handler![
            download_apk,
            install_apk,
            download_and_install_apk,
        ])
        .setup(move |_app| {
            #[cfg(all(debug_assertions, not(target_os = "android")))]
            {
                use tauri::Manager;
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
