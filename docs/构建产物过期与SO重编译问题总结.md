# 构建产物过期与 .so 重编译问题总结

> 适用范围：本项目（Tauri 2.x + React 前端，Windows 桌面端 + Android 移动端）。
> 记录 2026-08-25 排查「关于弹窗构建号不是 20260825A」问题的完整链路、根因与修复方法。

## 1. 结论先行

前端（`dist/`）更新后，**必须重新编译 Rust 二进制**（Android 的 `.so` 与桌面端 EXE），再重新打包 APK/EXE，否则安装包里跑的还是旧版前端。

原因：Tauri 运行时读的不是 APK 的 `assets` 文件夹，而是 Rust 二进制在**编译期内嵌**的前端资源（`tauri::generate_context!` 宏把 `dist/` 写进二进制）。`.so` 不变，前端就不会变。本次问题中，Android 各 ABI 的 `.so` 停留在 2026-03-21（内嵌 0.3.7/20250321a 时代的资源），所以重装全新 APK 后关于弹窗仍显示旧构建号。

## 2. 核心机制

### 2.1 前端资源如何进入安装包

1. `npm run build` 产出 `dist/`（Vite 构建，含哈希 chunk 名）。
2. `tauri::generate_context!` 宏在 **Rust 编译期**读取 `tauri.conf.json` 的 `build.frontendDist`（`../dist`），把 dist 作为静态数据编译进二进制。
3. 运行时通过自定义协议 `tauri.localhost` 提供资源，数据源是**二进制内嵌副本**；APK 里 `assets/` 目录的拷贝只是构建脚本顺带复制，运行时并不使用。

推论：**修改前端代码后，只要 Rust 没有重编译，产物里的前端就是旧的。** 这是本类问题 90% 的根源。

### 2.2 dev 模式与 custom-protocol 特性

`tauri-macros` 源码（`src/context.rs`）中：

```rust
dev: cfg!(not(feature = "custom-protocol")),
```

- 编译时未启用 `custom-protocol` 特性 → `dev = true` → **开发模式**：不内嵌任何资源，运行时直接去连 `devUrl`（本工程为 `http://localhost:1420`），连不上就白屏并显示 `Failed to request http://localhost:1420/`。
- 启用 `custom-protocol` → 生产模式：内嵌 dist，从 `tauri.localhost` 提供资源。

本项目 `Cargo.toml` 曾缺失该特性（`[features]` 只有 `default = []`），导致手动 `cargo build` 出来的二进制全部是开发模式。

> **v0.3.9 更新**：已改为 `default = ["custom-protocol"]`，任何 `cargo build`（含手动 Android .so 编译）默认启用生产模式。注意 `tauri-build` 没有 `custom-protocol` feature（可用：codegen/config-json/isolation 等），只给 `tauri` 主 crate 加即可。验证方式：编译后在二进制内搜索前端 chunk 名（如 `KnowledgeBase-*.js`），能搜到即内嵌成功。

### 2.3 增量编译陷阱

cargo 按 Rust 源码的指纹决定是否重编译。**前端 dist 的变化不在 cargo 的输入指纹里**，所以：

- 改前端 → 跑 gradle 重新打包 → 依赖缓存的旧 `.so` → 产物仍旧前端。
- 修复办法：强制让 cargo 重编译，常见手段是 `touch src-tauri/src/lib.rs`、修改 `Cargo.toml`、或 `cargo clean`。

## 3. 问题清单

| # | 现象 | 根因 | 解决 |
|---|------|------|------|
| 1 | 关于弹窗显示 0.3.7 / 构建 20250321a，而不是 0.3.8 / 20260825A | Android `.so` 停留在 2026-03-21，内嵌旧 dist；重装 APK 无效 | 重编译 4 个目标的 `.so`，拷贝进 jniLibs，重新打包 |
| 2 | 新 APK 安装后白屏，报 `Failed to request http://localhost:1420/` | `Cargo.toml` 缺 `custom-protocol` 特性，二进制处于 dev 模式 | 补特性 `custom-protocol = ["tauri/custom-protocol"]`，重编译 |
| 3 | `cargo` 报 `program not found` | 新终端 PATH 不含 `C:\Users\Administrator\.cargo\bin` | 手动加入 PATH 再运行 |
| 4 | cargo 编译报 `failed to find tool "clang.exe"` | Android 目标需要 NDK 工具链，需设置 `CC_*` / `AR_*` / `CARGO_TARGET_*_LINKER` | 指向 NDK `toolchains/llvm/prebuilt/windows-x86_64/bin` 下的 `*-linux-android*-clang.cmd` 与 `llvm-ar.exe` |
| 5 | tauri CLI 报 `ANDROID_HOME not set` | 环境变量未配置 | 设置 `ANDROID_HOME`（本项目为 `d:\Project\Test_System\.android-sdk`）与 `NDK_HOME` |
| 6 | `npm run tauri:android:build` 报符号链接创建失败 | Windows 未开启开发者模式/无符号链接权限；CLI 把 `target/.../*.so` 软链到 jniLibs | 绕过 CLI：手动拷贝 `.so` 到 jniLibs，直接用 `gradlew assembleRelease` |
| 7 | 构建出的 arm64 APK 只有 5.3MB，universal 缺 arm64 库 | 失败的 tauri CLI 在创建软链前**删除了** jniLibs/arm64-v8a 里已拷贝的 `.so` | 重新拷贝 arm64 `.so`，重建 `assembleArm64Release assembleUniversalRelease` |
| 8 | gradle 报 `Toolchain installation ... TRAE .../jre does not provide ... [JAVA_COMPILER]` | gradle 自动探测到系统 PATH 上的 TRAE 自带 JRE（无编译器） | 设 `JAVA_HOME` 指向真实 JDK（`.android-sdk\jdk-17.0.13+11`），并把其 `bin` 放 PATH 首位 |
| 9 | Release 包连不上 WebView 调试（无 `webview_devtools_remote_*` socket） | tauri CLI 重新生成 `RustWebView.kt`（自动生成文件）时覆盖了 `setWebContentsDebuggingEnabled(true)` | 在 `RustWebView.kt` 的 `init` 块补回该行，重建 APK |
| 10 | `adb forward` 后 CDP 连接被拒 | socket 名解析错误 / WebView 未就绪 / 进程重启换了 socket | 用 `localabstract:webview_devtools_remote_<pid>`（不要带 `@` 前缀）；进程重启后重新查 `/proc/net/unix` 再转发 |
| 11 | `uiautomator dump` 看不到应用内容 | Tauri 是 WebView 渲染，uiautomator 只能看到单个 FrameLayout | 改用 CDP（adb forward + WebSocket）直读 DOM |
| 12 | GitHub Release 说明变 `?????` 乱码 | PowerShell 5.1 `Invoke-RestMethod` 发送 body 时按系统 ANSI（GBK）编码，GitHub 按 UTF-8 解析 | 先用文件保存 UTF-8 JSON，读 bytes 后以 `-ContentType 'application/json; charset=utf-8'` 发送 |
| 13 | `git push origin main` 被拒 | 本地分支是 `master`，远端默认分支是 `main` | 改用 `git push origin master:main` |

## 4. 正确构建流程（已验证可复现）

前置约定：所有命令在项目根目录 `d:\Project\Test_System` 执行。

```powershell
# 1. 刷新前端 dist
npm run build

# 2. 确认 Cargo.toml 的 [features] 包含 custom-protocol
#    [features]
#    default = []
#    custom-protocol = ["tauri/custom-protocol"]

# 3. 设置 NDK 工具链环境变量（4 个 Android 目标）
$ndkBin = 'd:\Project\Test_System\.android-sdk\ndk\26.3.11579264\toolchains\llvm\prebuilt\windows-x86_64\bin'
$env:PATH = 'C:\Users\Administrator\.cargo\bin;' + $ndkBin + ';' + $env:PATH
$env:CC_aarch64_linux_android        = "$ndkBin\aarch64-linux-android24-clang.cmd"
$env:AR_aarch64_linux_android        = "$ndkBin\llvm-ar.exe"
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = "$ndkBin\aarch64-linux-android24-clang.cmd"
$env:CC_x86_64_linux_android         = "$ndkBin\x86_64-linux-android24-clang.cmd"
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER  = "$ndkBin\x86_64-linux-android24-clang.cmd"
$env:CC_armv7_linux_androideabi      = "$ndkBin\armv7a-linux-androideabi24-clang.cmd"
$env:CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER = "$ndkBin\armv7a-linux-androideabi24-clang.cmd"
$env:CC_i686_linux_android           = "$ndkBin\i686-linux-android24-clang.cmd"
$env:CARGO_TARGET_I686_LINUX_ANDROID_LINKER = "$ndkBin\i686-linux-android24-clang.cmd"

# 4. 强制 Rust 重编译（关键！让 generate_context! 重新内嵌当前 dist）
(Get-Item 'src-tauri\src\lib.rs').LastWriteTime = Get-Date
(Get-Item 'src-tauri\src\main.rs').LastWriteTime = Get-Date

# 5. 编译 4 个 Android 目标（必须带 --features custom-protocol）
cargo build --release --features custom-protocol --target aarch64-linux-android  --manifest-path src-tauri\Cargo.toml
cargo build --release --features custom-protocol --target x86_64-linux-android   --manifest-path src-tauri\Cargo.toml
cargo build --release --features custom-protocol --target armv7-linux-androideabi --manifest-path src-tauri\Cargo.toml
cargo build --release --features custom-protocol --target i686-linux-android     --manifest-path src-tauri\Cargo.toml

# 6. 拷贝新 .so 到 jniLibs（gradle 的 rustBuild 任务被禁用，只打包 jniLibs）
$j = 'src-tauri\gen\android\app\src\main\jniLibs'
Copy-Item "src-tauri\target\aarch64-linux-android\release\libanswer_test_lib.so"  "$j\arm64-v8a\libanswer_test_lib.so"   -Force
Copy-Item "src-tauri\target\armv7-linux-androideabi\release\libanswer_test_lib.so" "$j\armeabi-v7a\libanswer_test_lib.so" -Force
Copy-Item "src-tauri\target\i686-linux-android\release\libanswer_test_lib.so"      "$j\x86\libanswer_test_lib.so"         -Force
Copy-Item "src-tauri\target\x86_64-linux-android\release\libanswer_test_lib.so"    "$j\x86_64\libanswer_test_lib.so"       -Force

# 7. 打包 APK（JAVA_HOME 必须指向真实 JDK，避开 TRAE 自带 JRE）
$env:JAVA_HOME = 'd:\Project\Test_System\.android-sdk\jdk-17.0.13+11'
$env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH
$env:ANDROID_HOME = 'd:\Project\Test_System\.android-sdk'
& 'src-tauri\gen\android\gradlew.bat' -p 'src-tauri\gen\android' assembleRelease --console=plain
```

桌面端同理：`npm run tauri:build`（tauri CLI 会自动带上 `custom-protocol` 特性）。

## 5. 验证方法

### 5.1 运行时验证（最可靠）

新格式的 tauri 内嵌资源在 Android `.so` 里不暴露明文 chunk 名，字符串搜索不可靠，**以运行时为准**。

```powershell
# 连模拟器，找到 WebView 调试 socket（注意 localabstract: 前缀，不带 @）
adb shell 'cat /proc/net/unix' | Select-String -Pattern 'webview_devtools_remote'
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>

# 用 Node（内置 WebSocket）连接 CDP，直接读取关于弹窗文本
# 步骤：点击底部「我的」按钮 → 点击「关于」→ 读 document.body.innerText
# 期望输出：版本 0.3.8 / 构建 20260825A
```

注意：应用进程重启后 socket 名会变（`webview_devtools_remote_<pid>` 的 pid 变了），需要重新 forward；uiautomator 读不到 WebView 内容，别浪费时间。

### 5.2 辅助手段

- `.so` 体积对比：生产模式内嵌资源后体积明显大于 dev 模式（本次 x86_64 从 11.8MB 增至 14.1MB）。
- 桌面 EXE 可搜明文 chunk 名（`index-CQ350oA4`、`Profile-BZbXp-53`）确认内嵌的是当前 dist。
- 安装后看关于弹窗：新包应显示「版本 0.3.8 / 构建 20260825A」。

## 6. 预防措施

- **前端变更后必须重编译 Rust**。最稳的做法：改完前端顺手 `touch src-tauri/src/lib.rs`，再走第 5、6、7 步。
- **不要用 `tauri android build` 全自动流程**（Windows 符号链接权限会失败，且会覆盖 `RustWebView.kt` 的调试开关、删除 jniLibs 里的 .so）。用本文第 4 节的手动流程。
- **打包前检查每个 ABI 的 .so 是否就位**：`jniLibs/<abi>/libanswer_test_lib.so` 缺失时 gradle 会静默打出几 MB 的残废 APK，`universal` 缺库也不报错。
- **`Cargo.toml` 的 `custom-protocol` 特性是生产模式的开关**，任何人都不应删掉；删掉后所有产物都会变 dev 模式。
- **验证以运行时为准**：装到模拟器/真机上点开关于弹窗，或用 CDP 直读 DOM，不要只看构建产物文件名。
- 中文内容发 GitHub API 时，body 必须走 UTF-8 字节（先写文件再读 bytes），避免 PowerShell 5.1 的 GBK 编码把中文变 `?`。
