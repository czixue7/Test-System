use tauri_plugin_sql::{Migration, MigrationKind};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[cfg(target_os = "android")]
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::Manager;
#[cfg(target_os = "android")]
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f32,
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
    _app: tauri::AppHandle,
    url: String,
    filename: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<String, String> {
    log::info!("download_apk: 开始下载 APK, url={}, filename={}", url, filename);

    // 获取下载目录 - 使用 Android 外部存储的 Download 目录
    #[cfg(target_os = "android")]
    let download_dir = get_android_download_dir()?;
    
    #[cfg(not(target_os = "android"))]
    let download_dir = {
        use tauri::Manager;
#[cfg(target_os = "android")]
use serde_json::Value;
        _app.path().download_dir()
            .map_err(|e| format!("获取下载目录失败: {}", e))?
    };

    let file_path = download_dir.join(&filename);
    log::info!("download_apk: 文件保存路径={:?}", file_path);

    // 使用 reqwest 下载文件（支持流式下载）
    let client = reqwest::Client::new();

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

    // 使用流式下载，支持进度回调
    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;

    // 使用 bytes_stream 方法获取数据流
    let mut stream = response.bytes_stream();
    
    use futures_util::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("下载数据块失败: {}", e))?;
        let chunk_size = chunk.len() as u64;
        
        // 写入文件
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("写入文件失败: {}", e))?;
        
        downloaded += chunk_size;
        
        // 计算进度并发送
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
        
        // 发送进度到前端
        if let Err(e) = on_progress.send(progress) {
            log::error!("发送进度失败: {}", e);
        }
        
        log::debug!("下载进度: {} / {} bytes ({:.1}%)", downloaded, total_size, percentage);
    }

    log::info!("download_apk: 已下载={} bytes", downloaded);

    let path_str = file_path.to_string_lossy().to_string();
    log::info!("download_apk: 文件保存成功, 路径={}", path_str);

    Ok(path_str)
}

#[cfg(target_os = "android")]
fn get_android_download_dir() -> Result<std::path::PathBuf, String> {
    use std::path::PathBuf;
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
        let installer = app
            .try_state::<AndroidInstaller>()
            .ok_or_else(|| "Android 安装插件未初始化".to_string())?;

        let result: Value = installer
            .0
            .run_mobile_plugin::<Value>("install", apk_path)
            .map_err(|e| e.to_string())?;

        let status = result
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN")
            .to_string();

        log::info!("install_apk: Android 安装请求已发送: {}", status);
        Ok(status)
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
    on_progress: Channel<DownloadProgress>,
) -> Result<String, String> {
    log::info!("download_and_install_apk: 开始下载并安装, url={}", url);

    // 先下载
    let file_path = download_apk(app.clone(), url, filename, on_progress).await?;

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
            install_apk,
            download_and_install_apk,
        ])
        .setup(move |_app| {
            #[cfg(all(debug_assertions, not(target_os = "android")))]
            {
                use tauri::Manager;
#[cfg(target_os = "android")]
use serde_json::Value;
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
