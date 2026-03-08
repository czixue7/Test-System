# 答题测试库

一个基于 Tauri 2.x 构建的跨平台考试应用，支持 Windows 桌面端和 Android 移动端。

## 项目介绍

本系统用于考试练习，包含以下功能：
- 多题库练习与切换
- 选择题、多选题、填空题、主观题答题
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
| 文本相似度 | string-similarity |

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
```

### 构建打包

```bash
# Windows 桌面应用打包
npm run tauri:build

# Android APK 打包
npm run tauri:android:build
```

## 项目结构

```
Test-System/
├── src/                          # 前端源码
│   ├── pages/                    # 页面组件
│   ├── store/                    # 状态管理
│   ├── utils/                    # 工具函数
│   └── types.ts                  # 类型定义
├── src-tauri/                    # Tauri 后端
│   ├── src/                      # Rust 源码
│   ├── icons/                    # 应用图标
│   └── tauri.conf.json           # Tauri 配置
├── public/                       # 静态资源
│   └── banks/                    # 题库 JSON 文件
├── scripts/                      # 脚本工具
├── package.json                  # 项目配置
├── vite.config.ts                # Vite 配置
└── tailwind.config.js            # TailwindCSS 配置
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Web 开发服务 |
| `npm run tauri:dev` | 启动 Tauri 开发模式 |
| `npm run tauri:build` | 构建 Windows 安装包 |
| `npm run tauri:android:build` | 构建 Android APK |

## 环境要求

- Node.js >= 18.x
- Rust >= 1.70
- Windows 10/11 或 Android 5.0+

## 许可证

MIT License
