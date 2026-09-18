use tauri_plugin_sql::{Migration, MigrationKind};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, Response};
use tauri::Manager;

#[cfg(target_os = "android")]
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f32,
}

#[derive(Serialize, Deserialize)]
struct UpdateAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Serialize, Deserialize)]
struct UpdateCheckResult {
    latest_version: String,
    version_hash: Option<String>,
    assets: Vec<UpdateAsset>,
    fallback_assets: Vec<UpdateAsset>,
    source: String,
}

struct ReleaseInfo {
    version: String,
    version_hash: Option<String>,
    assets: Vec<UpdateAsset>,
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.')
            .map(|p| {
                p.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .collect()
    };
    let pa = parse(a);
    let pb = parse(b);
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let va = *pa.get(i).unwrap_or(&0);
        let vb = *pb.get(i).unwrap_or(&0);
        match va.cmp(&vb) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

// 比较构建号（构建时间戳）：版本号相同时使用，数值越大表示越新的构建
fn compare_build_numbers(a: Option<&str>, b: Option<&str>) -> std::cmp::Ordering {
    match (a, b) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (Some(x), Some(y)) => match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(vx), Ok(vy)) => vx.cmp(&vy),
            _ => x.cmp(y),
        },
    }
}

fn parse_release(json: &serde_json::Value) -> ReleaseInfo {
    let version = json["tag_name"]
        .as_str()
        .unwrap_or("0.0.0")
        .trim_start_matches('v')
        .to_string();

    let version_hash = parse_hash_from_body(json["body"].as_str().unwrap_or(""));

    let assets: Vec<UpdateAsset> = json["assets"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|asset| {
                    Some(UpdateAsset {
                        name: asset["name"].as_str()?.to_string(),
                        browser_download_url: asset["browser_download_url"].as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    ReleaseInfo {
        version,
        version_hash,
        assets,
    }
}

// 从发行版列表中挑选最新的一个：先比版本号，版本相同再比构建号
fn pick_best_release(releases: Vec<ReleaseInfo>) -> Option<ReleaseInfo> {
    releases.into_iter().reduce(|best, cur| {
        match compare_versions(&cur.version, &best.version) {
            std::cmp::Ordering::Greater => cur,
            std::cmp::Ordering::Less => best,
            std::cmp::Ordering::Equal => {
                if compare_build_numbers(
                    cur.version_hash.as_deref(),
                    best.version_hash.as_deref(),
                ) == std::cmp::Ordering::Greater
                {
                    cur
                } else {
                    best
                }
            }
        }
    })
}

async fn fetch_release_list(
    client: &reqwest::Client,
    api_url: &str,
    headers: &[(&str, &str)],
) -> Result<Vec<ReleaseInfo>, String> {
    let mut request = client.get(api_url).header("User-Agent", "Answer-Test-App");
    for (key, value) in headers {
        request = request.header(*key, *value);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("请求失败 {}: {}", api_url, e))?;

    let response = response
        .error_for_status()
        .map_err(|e| format!("服务器返回错误状态 {}: {}", api_url, e))?;

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败 {}: {}", api_url, e))?;

    let json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("解析JSON失败 {}: {}", api_url, e))?;

    // 列表接口返回数组；兼容单个对象返回
    let releases = match json.as_array() {
        Some(arr) => arr.iter().map(parse_release).collect(),
        None => vec![parse_release(&json)],
    };

    Ok(releases)
}

async fn fetch_best_release(
    client: &reqwest::Client,
    api_url: &str,
    headers: &[(&str, &str)],
) -> Result<ReleaseInfo, String> {
    let list = fetch_release_list(client, api_url, headers).await?;
    pick_best_release(list).ok_or_else(|| format!("未找到任何发行版 {}", api_url))
}

fn parse_hash_from_body(body: &str) -> Option<String> {
    let lower = body.to_lowercase();
    let pos = lower.find("hash")?;
    // ⚠️ 必须在 `lower` 上切片。`to_lowercase()` 可能改变字节长度
    // （例如 'İ' U+0130 → "i" + U+0307），拿 lower 的字节下标去切原始 body
    // 会落在非字符边界上 → panic；而 release profile 是 `panic = "abort"`，
    // 整个应用会直接崩溃。
    let after = &lower[pos + "hash".len()..];
    let trimmed = after.trim_start_matches(|c: char| c == ':' || c.is_whitespace());
    let hash: String = trimmed
        .chars()
        .take_while(|c| c.is_ascii_hexdigit())
        .collect();

    // 构建号是 8 位构建时间戳（如 20260918）；同时兼容真实摘要长度（40/64 位十六进制）
    // 避免把正文里形如 "hash值abc" 的零碎十六进制当成摘要，进而误报「有新版本」
    if hash.len() == 8 || hash.len() == 40 || hash.len() == 64 {
        Some(hash.to_lowercase())
    } else {
        None
    }
}

// 解析 Gitee 网页版 releases.json 中的单个发行版
// 结构：{ tag: { name, message }, release: { description, attach_files: [{ name, cli_download_url }] } }
fn parse_gitee_web_release(item: &serde_json::Value) -> ReleaseInfo {
    let version = item["tag"]["name"]
        .as_str()
        .unwrap_or("0.0.0")
        .trim_start_matches('v')
        .to_string();

    // 发行说明或标签提交信息中可能携带 <!-- hash:xxxx --> 构建号
    let version_hash = item["release"]["description"]
        .as_str()
        .and_then(parse_hash_from_body)
        .or_else(|| {
            item["tag"]["message"]
                .as_str()
                .and_then(parse_hash_from_body)
        });

    let assets: Vec<UpdateAsset> = item["release"]["attach_files"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|file| {
                    let name = file["name"].as_str()?.to_string();
                    let url = file["cli_download_url"]
                        .as_str()
                        .or_else(|| file["download_url"].as_str())?;
                    let browser_download_url =
                        if url.starts_with("http://") || url.starts_with("https://") {
                            url.to_string()
                        } else {
                            format!("https://gitee.com{}", url)
                        };
                    Some(UpdateAsset {
                        name,
                        browser_download_url,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    ReleaseInfo {
        version,
        version_hash,
        assets,
    }
}

// Gitee 开放 API v5 对匿名调用限流（403 Rate Limit Exceeded），
// 改用网页版数据接口 releases.json：匿名可访问，且为结构化 JSON。
async fn fetch_gitee_web_releases(
    client: &reqwest::Client,
) -> Result<Vec<ReleaseInfo>, String> {
    let api_url = "https://gitee.com/zixue7/Test-System/releases.json";

    let response = client
        .get(api_url)
        .header("User-Agent", "Answer-Test-App")
        .send()
        .await
        .map_err(|e| format!("请求失败 {}: {}", api_url, e))?;

    let response = response
        .error_for_status()
        .map_err(|e| format!("服务器返回错误状态 {}: {}", api_url, e))?;

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败 {}: {}", api_url, e))?;

    let json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("解析JSON失败 {}: {}", api_url, e))?;

    Ok(json["releases"]
        .as_array()
        .map(|arr| arr.iter().map(parse_gitee_web_release).collect())
        .unwrap_or_default())
}

#[tauri::command]
async fn check_github_update() -> Result<UpdateCheckResult, String> {
    log::info!("check_github_update: 开始通过 Rust 后端检查 GitHub / Gitee 更新");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| {
            let msg = format!("创建HTTP客户端失败: {}", e);
            log::error!("{}", msg);
            msg
        })?;

    let github = fetch_best_release(
        &client,
        "https://api.github.com/repos/czixue7/Test-System/releases?per_page=20",
        &[("Accept", "application/vnd.github.v3+json")],
    )
    .await;

    let gitee = fetch_gitee_web_releases(&client)
        .await
        .and_then(|list| {
            pick_best_release(list).ok_or_else(|| "Gitee 未找到任何发行版".to_string())
        });

    // 两者都查，取更高版本；版本相同时再比构建号，仍相同则优先 Gitee
    let prefer_gitee = match (&gitee, &github) {
        (Ok(g), Ok(h)) => match compare_versions(&g.version, &h.version) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Less => false,
            std::cmp::Ordering::Equal => {
                compare_build_numbers(g.version_hash.as_deref(), h.version_hash.as_deref())
                    != std::cmp::Ordering::Less
            }
        },
        (Ok(_), Err(_)) => true,
        (Err(_), Ok(_)) => false,
        (Err(e1), Err(e2)) => {
            let msg = format!("GitHub 与 Gitee 均无法访问: GitHub={}; Gitee={}", e1, e2);
            log::error!("{}", msg);
            return Err(msg);
        }
    };

    let (primary, fallback, source) = if prefer_gitee {
        (gitee, github, "gitee")
    } else {
        (github, gitee, "github")
    };

    let primary = match primary {
        Ok(info) => info,
        Err(e) => {
            let msg = format!("更新源不可用: {}", e);
            log::error!("{}", msg);
            return Err(msg);
        }
    };

    let fallback_assets = fallback.map(|info| info.assets).unwrap_or_default();

    let latest_version = primary.version;
    let version_hash = primary.version_hash;

    log::info!(
        "check_github_update: 来源={}, 版本={}, 哈希={}, 资产数={}, 备用资产数={}",
        source,
        latest_version,
        version_hash.as_deref().unwrap_or("无"),
        primary.assets.len(),
        fallback_assets.len()
    );

    Ok(UpdateCheckResult {
        latest_version,
        version_hash,
        assets: primary.assets,
        fallback_assets,
        source: source.to_string(),
    })
}

#[tauri::command]
async fn fetch_remote_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Answer-Test-App")
        .send()
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
async fn fetch_remote_bytes(url: String) -> Result<Response, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Answer-Test-App")
        .send()
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
    on_progress: Channel<DownloadProgress>,
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
    // 先写临时文件，全部校验通过后再 rename 成正式文件，
    // 避免中断/失败时留下一个损坏的 .apk
    let temp_path = download_dir.join(format!("{}.part", filename));
    log::info!("download_apk: 临时文件路径={:?}", temp_path);

    let client = reqwest::Client::new();

    log::info!("download_apk: 发送 HTTP 请求");
    let response = client
        .get(&url)
        .send()
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
        let _ = &app; // 非 Android 平台下不使用 app，避免 unused_variables 警告
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
            check_github_update,
            fetch_remote_text,
            fetch_remote_bytes,
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
