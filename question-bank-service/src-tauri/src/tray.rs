use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Window, WindowEvent,
};

const TRAY_ID: &str = "service-desk-tray";

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

pub(crate) fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        "show-main-window" => {
            if let Err(error) = show_main_window(app) {
                eprintln!("无法恢复题库服务台窗口：{error}");
            }
        }
        // AppHandle::exit still emits RunEvent::Exit, which stops the server and saves traffic.
        "quit-service-desk" => app.exit(0),
        _ => {}
    }
}

pub(crate) fn setup(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(
        app,
        "show-main-window",
        "打开题库服务台",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit-service-desk", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| std::io::Error::other("题库服务台缺少托盘图标"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("题库服务台 · 关闭窗口后在后台运行")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                if let Err(error) = show_main_window(tray.app_handle()) {
                    eprintln!("无法恢复题库服务台窗口：{error}");
                }
            }
        })
        .build(app)?;
    Ok(())
}

pub(crate) fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == "main" && window.app_handle().tray_by_id(TRAY_ID).is_some() {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("无法将题库服务台收起到托盘：{error}");
            }
        }
    }
}
