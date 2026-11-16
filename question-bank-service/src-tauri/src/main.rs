#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod endpoint;
mod api_config;
mod bank_sync;
mod model;
mod packages;
mod server;
mod request_log;
mod sync_overview;
mod tray;
mod text_sync;
mod text_history;
use model::*;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

struct Runtime {
    config: Config,
    running: Option<server::Running>,
}
struct AppState {
    dir: PathBuf,
    runtime: tokio::sync::Mutex<Runtime>,
}
#[tauri::command]
async fn get_api_config(space: String, state: State<'_, AppState>) -> Result<Value, String> {
    let rt = state.runtime.lock().await;
    let _guard = if let Some(r) = &rt.running { Some(r.shared.sync_lock.lock().await) } else { None };
    api_config::load(&state.dir, &space)
}
#[tauri::command]
async fn save_api_config(space: String, base_revision: u64, data: Value, state: State<'_, AppState>) -> Result<Value, String> {
    let rt = state.runtime.lock().await;
    let _guard = if let Some(r) = &rt.running { Some(r.shared.sync_lock.lock().await) } else { None };
    let (status, envelope) = api_config::save(&state.dir, &space, base_revision, data)?;
    Ok(json!({"status":status,"envelope":envelope}))
}
#[tauri::command]
async fn get_state(state: State<'_, AppState>) -> Result<Value, String> {
    let rt = state.runtime.lock().await;
    let mut metrics = if let Some(r) = &rt.running {
        r.shared.metrics.lock().map_err(|e| e.to_string())?.clone()
    } else if state.dir.join("traffic.json").exists() {
        read_json(&state.dir.join("traffic.json"))?
    } else {
        server::Metrics::default()
    };
    // Full previews are fetched only when a record is opened, not on every poll.
    for record in &mut metrics.records { record.detail = None; }
    Ok(
        json!({"config":rt.config,"running":rt.running.is_some(),"metrics":metrics,"dataDir":state.dir}),
    )
}
#[tauri::command]
async fn get_request_detail(id: String, state: State<'_, AppState>) -> Result<Option<request_log::RequestDetail>, String> {
    let rt = state.runtime.lock().await;
    let metrics: server::Metrics = if let Some(r) = &rt.running {
        r.shared.metrics.lock().map_err(|e| e.to_string())?.clone()
    } else if state.dir.join("traffic.json").exists() {
        read_json(&state.dir.join("traffic.json"))?
    } else { server::Metrics::default() };
    metrics.records.iter().find(|record| record.id == id).map(|record| record.detail.clone())
        .ok_or_else(|| "该请求已超出最近 500 条记录范围，请选择其他记录".into())
}
#[tauri::command]
async fn save_config(config: Config, state: State<'_, AppState>) -> Result<(), String> {
    config.validate()?;
    let mut rt = state.runtime.lock().await;
    if rt.running.is_some() {
        return Err("请先关闭服务再修改配置".into());
    }
    write_json(&state.dir.join("config.json"), &config)?;
    rt.config = config;
    Ok(())
}
#[tauri::command]
async fn set_theme(theme: String, state: State<'_, AppState>) -> Result<(), String> {
    if !["light", "dark", "system"].contains(&theme.as_str()) {
        return Err("主题无效".into());
    }
    let mut rt = state.runtime.lock().await;
    let mut next = rt.config.clone();
    next.theme = theme;
    write_json(&state.dir.join("config.json"), &next)?;
    rt.config = next;
    Ok(())
}
#[tauri::command]
async fn start_service(state: State<'_, AppState>) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    if rt.running.is_some() {
        return Ok(());
    }
    rt.running = Some(server::start(rt.config.clone(), state.dir.clone()).await?);
    Ok(())
}
#[tauri::command]
async fn stop_service(state: State<'_, AppState>) -> Result<(), String> {
    let mut rt = state.runtime.lock().await;
    if let Some(r) = rt.running.take() {
        r.stop().await
    } else {
        Ok(())
    }
}
#[tauri::command]
async fn save_public_endpoint(
    url: String,
    port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let url = endpoint::normalize_url(&url, port)?;
    let mut rt = state.runtime.lock().await;
    let mut next = rt.config.clone();
    next.public_url = url.clone();
    next.public_port = None;
    write_json(&state.dir.join("config.json"), &next)?;
    rt.config = next;
    Ok(url)
}
#[tauri::command]
async fn test_endpoint(
    url: String,
    port: Option<u16>,
    token: String,
) -> Result<endpoint::TestResult, String> {
    endpoint::probe(&url, port, &token).await
}
#[tauri::command]
async fn choose_path(app: tauri::AppHandle, directory: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let path = if directory {
            dialog.blocking_pick_folder()
        } else {
            dialog.blocking_pick_file()
        };
        path.map(|p| {
            p.into_path()
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn inspect_mounts(config: Config) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || server::catalog(&config.mounts))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_sync_overview(state: State<'_, AppState>) -> Result<Value, String> {
    let dir = state.dir.clone();
    tauri::async_runtime::spawn_blocking(move || sync_overview::overview(&dir))
        .await.map_err(|e| e.to_string())?
}
fn main() {
    // Same binary supports controlled headless integration checks without opening a window.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--headless") {
        let dir = PathBuf::from(args.get(2).expect("--headless 需要指定数据目录"));
        let config: Config = read_json(&dir.join("config.json")).expect("读取配置失败");
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let r = server::start(config, dir).await.expect("服务启动失败");
            tokio::signal::ctrl_c().await.unwrap();
            r.stop().await.unwrap();
        });
        return;
    }
    let data_override = args
        .iter()
        .position(|arg| arg == "--data-dir")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let dir = if let Some(dir) = &data_override {
                dir.clone()
            } else {
                app.path().app_data_dir()?
            };
            std::fs::create_dir_all(&dir)?;
            let file = dir.join("config.json");
            let mut config: Config = if file.exists() {
                read_json(&file).map_err(std::io::Error::other)?
            } else {
                let c = Config::default();
                write_json(&file, &c).map_err(std::io::Error::other)?;
                c
            };
            if endpoint::migrate_legacy_endpoint(&mut config).map_err(std::io::Error::other)? {
                write_json(&file, &config).map_err(std::io::Error::other)?;
            }
            app.manage(AppState {
                dir,
                runtime: tokio::sync::Mutex::new(Runtime {
                    config,
                    running: None,
                }),
            });
            tray::setup(app)?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("题库服务台 v{} · {}", env!("CARGO_PKG_VERSION"), env!("APP_BUILD_NUMBER")))?;
            }
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            get_api_config,
            save_api_config,
            get_request_detail,
            get_state,
            save_config,
            set_theme,
            start_service,
            stop_service,
            choose_path,
            inspect_mounts,
            get_sync_overview,
            save_public_endpoint,
            test_endpoint
        ])
        .build(tauri::generate_context!())
        .expect("题库服务台启动失败");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = handle.state::<AppState>();
            tauri::async_runtime::block_on(async {
                let mut rt = state.runtime.lock().await;
                if let Some(r) = rt.running.take() {
                    let _ = r.stop().await;
                }
            });
        }
    });
}
