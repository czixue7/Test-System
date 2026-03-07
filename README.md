# 低压电工考试系统

一个基于 Tauri 2.x 构建的跨平台考试应用，支持 Windows 桌面端和 Android 移动端。

## 项目介绍

本系统用于低压电工考试练习，包含以下功能：
- 10 周考题练习
- 选择题、判断题、主观题答题
- 主观题智能评分（基于文本相似度算法）
- 答题记录管理
- 自定义题库导入

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

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Web 开发服务 |
| `npm run build` | 构建前端生产版本 |
| `npm run preview` | 预览构建结果 |
| `npm run tauri:dev` | 启动 Tauri 开发模式 |
| `npm run tauri:dev:debug` | 启动 Tauri 调试模式 |
| `npm run tauri:build` | 构建 Windows 安装包 |
| `npm run tauri:build:debug` | 构建 Windows 调试版本 |
| `npm run tauri:android` | Tauri Android 命令 |
| `npm run tauri:android:build` | 构建 Android APK |
| `npm run parse-pdf` | 解析 PDF 题库 |

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

## 许可证

MIT License
