# 答题测试库

一个基于 Tauri 2.x 构建的跨平台测试应用，支持 Windows 桌面端和 Android 移动端。

## 项目介绍

本系统用于考试练习，包含以下功能：
- 多题库练习与切换
- 选择题、多选题、填空题、主观题答题
- **AI 智能判题**：基于 WebLLM 和 GGUF 的填空题和主观题智能评分
- 多种模型支持：
  - WebLLM 模型：Qwen3 1.7B（推荐）、Qwen3 0.6B（轻量）
  - GGUF 模型：Qwen3.5 0.8B、TinyLlama 1.1B
- 自定义模型导入：支持在线下载或离线导入 GGUF 格式模型
- AI 考试评价：考试结束后生成 AI 总体评价和每题解析
- 主观题智能评分（基于文本相似度算法）
- 答题记录管理
- 错题回顾功能
- 自定义题库导入
- 深色模式支持

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 桌面端 | Tauri 2.x (Rust) |
| 移动端 | Tauri Mobile (Android) |
| 样式 | TailwindCSS |
| 状态管理 | Zustand |
| 路由 | React Router DOM |
| 本地存储 | SQLite (Tauri Plugin) |
| 文件系统 | tauri-plugin-fs |
| AI 推理 | @mlc-ai/web-llm (WebGPU) |
| 文本相似度 | string-similarity |

## 环境要求

### 基础环境

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 18.x | JavaScript 运行时 |
| Rust | >= 1.70 | 系统编程语言 |
| pnpm/npm/yarn | 最新版 | 包管理器 |

### Windows 开发环境

1. **安装 Node.js**
   ```bash
   # 推荐使用 nvm-windows 管理 Node.js 版本
   # 下载地址: https://github.com/coreybutler/nvm-windows/releases
   
   nvm install 20
   nvm use 20
   ```

2. **安装 Rust**
   ```bash
   # 下载并运行 rustup-init.exe
   # 官网: https://www.rust-lang.org/tools/install
   
   # 或使用 winget
   winget install Rustlang.Rustup
   ```

3. **安装 Visual Studio Build Tools**
   - 下载地址: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - 选择 "Desktop development with C++" 工作负载

### Android 开发环境

1. **安装 Android SDK**
   ```bash
   # 下载 Android Studio 或仅下载 Command Line Tools
   # 官网: https://developer.android.com/studio
   
   # 设置环境变量
   ANDROID_HOME=C:\Users\<用户名>\AppData\Local\Android\Sdk
   ```

2. **安装 Android NDK**
   ```bash
   # 通过 Android Studio SDK Manager 安装
   # 或手动下载: https://developer.android.com/ndk/downloads
   
   # 推荐版本: NDK r26d 或更高
   # 设置环境变量
   NDK_HOME=C:\Users\<用户名>\AppData\Local\Android\Sdk\ndk\26.3.11579264
   ```

3. **安装 Rust Android 编译目标**
   ```bash
   rustup target add aarch64-linux-android
   rustup target add armv7-linux-androideabi
   rustup target add i686-linux-android
   rustup target add x86_64-linux-android
   ```

4. **配置 NDK 路径（重要）**
   ```bash
   # 设置 NDK_TOOLCHAIN 环境变量
   # 或在项目根目录创建 .cargo/config.toml:
   
   [target.aarch64-linux-android]
   linker = "C:\\Users\\<用户名>\\AppData\\Local\\Android\\Sdk\\ndk\\26.3.11579264\\toolchains\\llvm\\prebuilt\\windows-x86_64\\bin\\aarch64-linux-android35-clang.cmd"
   
   [target.armv7-linux-androideabi]
   linker = "C:\\Users\\<用户名>\\AppData\\Local\\Android\\Sdk\\ndk\\26.3.11579264\\toolchains\\llvm\\prebuilt\\windows-x86_64\\bin\\armv7a-linux-androideabi35-clang.cmd"
   
   [target.i686-linux-android]
   linker = "C:\\Users\\<用户名>\\AppData\\Local\\Android\\Sdk\\ndk\\26.3.11579264\\toolchains\\llvm\\prebuilt\\windows-x86_64\\bin\\i686-linux-android35-clang.cmd"
   
   [target.x86_64-linux-android]
   linker = "C:\\Users\\<用户名>\\AppData\\Local\\Android\\Sdk\\ndk\\26.3.11579264\\toolchains\\llvm\\prebuilt\\windows-x86_64\\bin\\x86_64-linux-android35-clang.cmd"
   ```

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务

```bash
# 启动 Web 开发服务（仅前端）
npm run dev

# 启动 Tauri 开发模式（Windows 桌面应用）
npm run tauri:dev

# 启动 Tauri 开发模式（带调试信息）
npm run tauri:dev:debug
```

开发服务将在 `http://localhost:1420` 启动。

## 构建打包

### Windows 桌面应用打包

```bash
# 构建生产版本
npm run tauri:build

# 构建调试版本
npm run tauri:build:debug
```

构建产物位于 `src-tauri/target/release/bundle/` 目录：
- `nsis/` - NSIS 安装程序
- `msi/` - MSI 安装包

### Android APK 打包

```bash
# 初始化 Android 项目（首次）
npm run tauri:android init

# 构建 APK
npm run tauri:android:build
```

构建产物位于 `src-tauri/gen/android/app/build/outputs/apk/` 目录：
- `arm64/release/` - ARM64 架构 APK
- `arm/release/` - ARM 架构 APK
- `x86_64/release/` - x86_64 架构 APK
- `x86/release/` - x86 架构 APK
- `universal/release/` - 通用 APK（包含所有架构）

## APK 签名配置

### 生成签名密钥

```bash
# 进入 Android 项目目录
cd src-tauri/gen/android/app

# 生成密钥库（keystore）
keytool -genkey -v -keystore release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias exam-key

# 按提示输入密钥库密码、个人信息等
```

### 配置签名信息

1. 创建 `keystore.properties` 文件（位于 `src-tauri/gen/android/app/`）：

```properties
storePassword=你的密钥库密码
keyPassword=你的密钥密码
keyAlias=exam-key
```

2. 确保 `build.gradle.kts` 中已配置签名：

```kotlin
signingConfigs {
    create("release") {
        storeFile = file("release-key.jks")
        storePassword = keystoreProperties.getProperty("storePassword", "123456")
        keyAlias = keystoreProperties.getProperty("keyAlias", "exam-key")
        keyPassword = keystoreProperties.getProperty("keyPassword", "123456")
    }
}
```

### 注意事项

- **不要将 `keystore.properties` 和 `release-key.jks` 提交到版本控制**
- 妥善保管密钥库文件和密码，丢失后无法更新应用
- 生产环境建议使用更复杂的密码

## 项目结构

```
Low_Voltage_Electrician_Exam/
├── src/                          # 前端源码
│   ├── pages/                    # 页面组件
│   │   ├── Exam.tsx              # 答题页面
│   │   ├── Home.tsx              # 首页
│   │   ├── Import.tsx            # 题库导入
│   │   ├── QuestionBankDetail.tsx# 题库详情
│   │   ├── Records.tsx           # 答题记录列表
│   │   └── Result.tsx            # 答题结果
│   ├── store/                    # 状态管理
│   │   ├── examStore.ts          # 考试状态
│   │   ├── questionBankStore.ts  # 题库状态
│   │   └── recordStore.ts        # 记录状态
│   ├── utils/                    # 工具函数
│   │   ├── builtInBanks.ts       # 内置题库
│   │   ├── jsonImporter.ts       # JSON 导入
│   │   ├── similarity.ts         # 相似度计算
│   │   └── tauriStore.ts         # Tauri 存储
│   ├── App.tsx                   # 根组件
│   ├── main.tsx                  # 入口文件
│   ├── index.css                 # 全局样式
│   └── types.ts                  # 类型定义
├── src-tauri/                    # Tauri 后端
│   ├── src/                      # Rust 源码
│   │   ├── main.rs               # 主入口
│   │   └── lib.rs                # 库文件
│   ├── icons/                    # 应用图标
│   ├── capabilities/             # 权限配置
│   ├── Cargo.toml                # Rust 依赖
│   ├── build.rs                  # 构建脚本
│   └── tauri.conf.json           # Tauri 配置
├── public/                       # 静态资源
│   ├── banks/                    # 题库 JSON 文件
│   └── images/                   # 图片资源
├── scripts/                      # 脚本工具
│   ├── parse-pdf.ts              # PDF 解析脚本
│   ├── create-icons.js           # 图标生成
│   └── create-ico.js             # ICO 生成
├── index.html                    # HTML 入口
├── package.json                  # 项目配置
├── vite.config.ts                # Vite 配置
├── tailwind.config.js            # TailwindCSS 配置
├── postcss.config.js             # PostCSS 配置
└── tsconfig.json                 # TypeScript 配置
```

## 开发命令汇总

| 命令 | 说明 | 详细作用 |
|------|------|----------|
| `npm run dev` | 启动 Web 开发服务 | 仅启动 Vite 前端开发服务器，用于浏览器预览和调试前端界面 |
| `npm run build` | 构建前端生产版本 | 执行 TypeScript 类型检查 + Vite 构建，输出静态文件到 `dist/` 目录 |
| `npm run preview` | 预览构建结果 | 启动本地服务器预览已构建的前端产物，用于验证构建结果 |
| `npm run tauri:dev` | 启动 Tauri 开发模式 | 启动 Vite 开发服务器 + Rust 后端热重载，打开桌面应用窗口进行开发调试 |
| `npm run tauri:dev:debug` | 启动 Tauri 调试模式 | 同上，但启用 Rust 调试符号，便于使用调试器排查问题 |
| `npm run tauri:build` | 构建 Windows 安装包 | 编译前端 + Rust 后端，生成可直接运行的 EXE 和 NSIS 安装程序 |
| `npm run tauri:build:debug` | 构建 Windows 调试版本 | 同上，但生成调试版本（未优化），体积更大但便于调试 |
| `npm run tauri:android` | Tauri Android 命令 | 执行 Tauri Android 相关命令（如 init 初始化项目） |
| `npm run tauri:android:build` | 构建 Android APK | 编译 Rust Android 目标 + 前端，生成 Android APK 安装包 |
| `npm run parse-pdf` | 解析 PDF 题库 | 运行 PDF 解析脚本，从 PDF 文件提取题目并生成 JSON 题库 |

### 构建产物说明

执行 `npm run tauri:build` 后，产物位于 `src-tauri/target/release/` 目录：

| 文件/目录 | 说明 |
|-----------|------|
| `low-voltage-electrician-exam.exe` | 可直接运行的应用程序（无需安装） |
| `bundle/nsis/答题测试库_0.3.0_x64-setup.exe` | NSIS 安装程序（带安装向导） |

## NSIS 安装包汉化配置

安装包默认支持简体中文界面，配置位于 `src-tauri/tauri.conf.json`：

```json
{
  "bundle": {
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "languages": ["SimpChinese"],
        "displayLanguageSelector": false,
        "installerIcon": "icons/icon.ico"
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 说明 |
|--------|------|
| `installMode` | 安装模式：`currentUser`（当前用户）或 `perMachine`（所有用户） |
| `languages` | 安装界面语言，支持 `SimpChinese`（简体中文）、`English` 等 |
| `displayLanguageSelector` | 是否显示语言选择器，设为 `false` 直接使用默认语言 |
| `installerIcon` | 安装程序图标路径 |
| `headerImage` | 安装向导头部图片（可选，建议尺寸 150x57） |
| `sidebarImage` | 安装向导侧边栏图片（可选，建议尺寸 164x314） |
| `license` | 许可协议文件路径（可选，支持 .txt 和 .rtf） |

### 支持的语言

NSIS 支持的主要语言标识：

- `SimpChinese` - 简体中文
- `TradChinese` - 繁体中文
- `English` - 英语
- `Japanese` - 日语
- `Korean` - 韩语
- `German` - 德语
- `French` - 法语

如需多语言支持，可配置：

```json
{
  "languages": ["SimpChinese", "English"],
  "displayLanguageSelector": true
}
```

### 自定义安装界面图片

1. 准备图片文件：
   - 头部图片：150x57 像素，BMP 格式
   - 侧边栏图片：164x314 像素，BMP 格式

2. 放置到 `src-tauri/icons/` 目录

3. 更新配置：

```json
{
  "nsis": {
    "headerImage": "icons/header.bmp",
    "sidebarImage": "icons/sidebar.bmp"
  }
}
```

## 常见问题

### 1. Rust 编译错误

确保已安装正确的 Rust 版本和编译目标：
```bash
rustup update
rustup target add aarch64-linux-android
```

### 2. Android SDK 找不到

检查环境变量配置：
```bash
echo %ANDROID_HOME%
echo %NDK_HOME%
```

### 3. Tauri 开发模式启动失败

确保已安装 Visual Studio Build Tools，并重启终端。

### 4. APK 签名失败

检查 `keystore.properties` 文件路径和密码是否正确。

### 5. Android 构建时符号链接失败

**问题现象：**
```
Failed to create a symbolic link... IO error: 系统找不到指定的文件
```

**原因：** Windows 环境下创建符号链接需要管理员权限，或 Tauri 尝试在不存在的目录创建链接。

**解决方案：**
1. 手动创建 jniLibs 目录：
```bash
mkdir src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a
```

2. 手动复制 .so 文件：
```bash
copy src-tauri\target\aarch64-linux-android\release\liblow_voltage_electrician_exam_lib.so src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\
```

### 6. Gradle 构建时 rustBuild 任务失败

**问题现象：**
```
failed to read CLI options: Context("failed to build WebSocket client"...ConnectionRefused)
```

**原因：** Tauri CLI 在 Gradle 构建过程中尝试连接 WebSocket 开发服务器失败。

**解决方案：** 在 `build.gradle.kts` 中禁用 rustBuild 任务（适用于已有 .so 文件的情况）：
```kotlin
tasks.whenTaskAdded {
    if (name.contains("rustBuild")) {
        enabled = false
    }
}
```

### 7. jarsigner 显示 "jar 未签名"

**问题现象：**
使用 `jarsigner -verify app.apk` 显示 "jar 未签名"。

**原因：** jarsigner 是旧版 Java 签名工具，不支持 Android APK v2/v3 签名格式。

**解决方案：** 使用 Android SDK 提供的 apksigner 工具验证：
```bash
cd %ANDROID_HOME%\build-tools\35.0.0
apksigner.bat verify --print-certs path\to\app.apk
```

### 8. Gradle 找不到 Android SDK

**问题现象：**
```
SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable
```

**解决方案：** 创建 `local.properties` 文件：
```properties
sdk.dir=C:\\Users\\<用户名>\\AppData\\Local\\Android\\Sdk
```

## 下载安装

### Windows 桌面端 v0.3.1
- **安装包**: `答题测试库_0.3.1_x64-setup.exe` (~3MB)
- 支持 Windows 10/11 64位系统
- 下载地址：[Releases](https://github.com/yourusername/low-voltage-electrician-exam/releases)

### Android 移动端 v0.3.1
- **安装包**: `app-universal-release.apk` (~9MB)
- 支持 Android 8.0+ 系统
- 下载地址：[Releases](https://github.com/yourusername/low-voltage-electrician-exam/releases)

## 许可证

MIT License
