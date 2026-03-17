# 0.3.3 变更说明与关键实现

本文档汇总本次修改的文件、关键代码与实现原理，便于审阅与复现。

**修改文件清单（含目的）**
- `E:\Project\Ai_Solving\Test-System\source-code\package.json`
版本号改为 `0.3.3`。
- `E:\Project\Ai_Solving\Test-System\source-code\package-lock.json`
版本号同步为 `0.3.3`。
- `E:\Project\Ai_Solving\Test-System\source-code\CHANGELOG.md`
版本记录更新为 `0.3.3`。
- `E:\Project\Ai_Solving\Test-System\source-code\src\pages\Profile.tsx`
展示版本号更新为 `0.3.3`。
- `E:\Project\Ai_Solving\Test-System\source-code\src\utils\updater.ts`
更新逻辑展示版本号改为 `0.3.3`。
- `E:\Project\Ai_Solving\Test-System\source-code\src-tauri\Cargo.toml`
版本号改为 `0.3.3`。
- `E:\Project\Ai_Solving\Test-System\source-code\src-tauri\Cargo.lock`
Rust 依赖锁文件版本号与校验更新（见下文“锁文件校验”）。
- `E:\Project\Ai_Solving\Test-System\source-code\src-tauri\tauri.conf.json`
版本号改为 `0.3.3`。
- `E:\Project\Ai_Solving\Test-System\source-code\src-tauri\src\lib.rs`
Android 安装插件接入与安装调用逻辑更新。
- `E:\Project\Ai_Solving\Test-System\source-code\src-tauri\gen\android\app\src\main\java\com\exam\test_system\InstallApkPlugin.kt`
Android 侧安装 APK 插件实现修正（FileProvider + JSObject 返回）。

**关键代码与实现原理**

1. Android 安装流程（Rust 侧）
- 目标：通过 Tauri 移动端插件调用 Android 原生安装逻辑，避免 `file://` 直接安装的兼容性问题。
- 关键点：在 `AppHandle` 中注册并保存 Android 插件句柄，调用 `run_mobile_plugin` 触发原生安装。

关键代码（Rust）：
```rust
#[cfg(target_os = "android")]
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::Manager;
#[cfg(target_os = "android")]
use serde_json::Value;

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
async fn install_apk(app: tauri::AppHandle, apk_path: String) -> Result<String, String> {
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

        Ok(status)
    }

    #[cfg(not(target_os = "android"))]
    {
        Err("仅支持 Android 平台".to_string())
    }
}
```

实现原理说明：
- 使用 `register_android_plugin` 注册自定义 Kotlin 插件。
- 插件句柄保存在 `State` 中，后续通过 `run_mobile_plugin` 调用原生方法。
- 返回值统一用 `JSObject`（JSON）承载 `status`，Rust 侧解析成字符串。

2. Android 安装流程（Kotlin 侧）
- 目标：避免 Android 7+ 对 `file://` 安装限制，改为 `content://` + `FileProvider`。
- 关键点：
  - 使用 `FileProvider.getUriForFile` 生成 `content://`。
  - 添加 `FLAG_GRANT_READ_URI_PERMISSION` 以授予读取权限。
  - Android 8+ 检查“未知来源安装”权限，必要时跳转设置。
  - `invoke.resolve` 统一返回 `JSObject`。

关键代码（Kotlin）：
```kotlin
import androidx.core.content.FileProvider
import app.tauri.plugin.JSObject

val authority = activity.packageName + ".fileprovider"
val apkUri = FileProvider.getUriForFile(activity, authority, apkFile)

val intent = Intent(Intent.ACTION_VIEW)
intent.setDataAndType(apkUri, "application/vnd.android.package-archive")
intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

activity.startActivity(intent)
val result = JSObject().put("status", "INSTALL_INTENT_SENT")
invoke.resolve(result)
```

实现原理说明：
- Android 7+ 禁止 `file://` 暴露，必须用 `FileProvider` 生成 `content://`。
- 通过 `FLAG_GRANT_READ_URI_PERMISSION` 将文件读取权限临时授予安装器。
- 返回 JSON 结构给 Rust 侧，避免 Tauri 端对返回类型的约束问题。

3. Rust 锁文件校验修复
- 现象：手动改版本导致 `Cargo.lock` 中 crate 校验与实际版本不一致。
- 处理：更新 `field-offset 0.3.3` 的 checksum 以匹配本机 registry 索引。

4. 编码修复
- 修复 `package.json` 被写入 BOM 导致 Vite JSON 解析失败的问题。
- 修复 `src-tauri/Cargo.toml` 的 `description` 中文乱码。

**产物位置**
- APK：`E:\Project\Ai_Solving\Test-System\source-code\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk`
- AAB：`E:\Project\Ai_Solving\Test-System\source-code\src-tauri\gen\android\app\build\outputs\bundle\universalRelease\app-universal-release.aab`
