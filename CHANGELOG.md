# 更新日志

本文档记录项目的所有重要更改。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased]

## [0.3.4] - 2026-03-14

### 新增

- **图片查看器增强**：
  - 双击放大/缩小功能，支持从点击位置放大
  - 图片拖动移动功能，放大后可拖动查看
  - 双指缩放支持，以双指中心为基准缩放
  - 滚轮缩放支持，以鼠标位置为中心缩放
  - 安卓性能优化，使用 GPU 硬件加速
  - 关闭按钮位置优化，避免被状态栏遮挡
- **参考答案图片显示**：
  - 支持在参考答案区域显示图片
  - 图片宽度自适应填满容器
  - 点击可查看大图
- **答题详情页面滑动切换**：
  - 支持左右滑动切换题目
  - 整个页面区域均可触发滑动

### 修改

- **参考答案样式统一**：
  - 所有"正确答案"改为"参考答案"
  - 统一使用绿色主题样式
  - 统一参考答案区域背景、边框、文字颜色
- **禁用网页缩放**：
  - 禁用双指缩放、双击放大等浏览器默认行为
  - 保持应用内一致的交互体验

### 优化

- **图片查看器性能优化**：
  - 使用 `translate3d` 启用 GPU 加速
  - 直接操作 DOM 减少 React 渲染延迟
  - 安卓设备减少日志输出
  - 缩短动画时间提升流畅度

### 修复

- **图片查看器关闭问题**：
  - 修复安卓上关闭按钮被状态栏遮挡的问题
  - 修复图片打开/关闭动画位置不对齐的问题
  - 修复安卓系统导航返回键无法关闭图片的问题（改为关闭图片而非退出答题）
- **答题详情页面滑动**：
  - 修复空白区域无法触发滑动切换的问题
- **双指缩放问题**：
  - 修复双指缩放比例计算错误的问题
  - 优化双指缩放时的偏移计算，以双指中心为基准

### 技术细节

#### 图片查看器实现

**新增文件：** `src/components/ImageViewer.tsx`

- 使用 `transform3d` 实现 GPU 加速
- 直接操作 DOM 样式避免 React 渲染延迟
- 支持鼠标和触摸事件
- 双指缩放以中心点为基准计算偏移

```typescript
// 以中心点为基准的缩放计算
const scaleRatio = newScale / oldScale;
const newTranslateX = center.x - (center.x - transform.translateX) * scaleRatio;
const newTranslateY = center.y - (center.y - transform.translateY) * scaleRatio;
```

#### 参考答案图片显示

**修改文件：** `src/pages/Practice.tsx`, `src/pages/Result.tsx`

- 检测 `correctAnswer` 是否为对象且包含 `images` 字段
- 图片使用 `w-full` 填满容器宽度
- 保持原始比例显示

#### 滑动切换优化

**修改文件：** `src/pages/Result.tsx`

- 将 `swipeRef` 从内容容器移动到页面根容器
- 使整个页面区域都可触发滑动事件

#### 安卓返回键处理

**修改文件：** `src/components/ImageViewer.tsx`

监听 `popstate` 事件捕获安卓系统导航返回键：

```typescript
useEffect(() => {
  const handlePopState = (e: PopStateEvent) => {
    if (isVisible && !isClosing) {
      e.preventDefault();
      handleClose();
      window.history.pushState(null, '', window.location.href);
    }
  };

  window.history.pushState(null, '', window.location.href);
  window.addEventListener('popstate', handlePopState);
  
  return () => {
    window.removeEventListener('popstate', handlePopState);
  };
}, [isVisible, isClosing, handleClose]);
```

---

## [0.3.3] - 2026-03-14

### 新增

- **APK 自动更新功能（Android）**：
  - 支持自动检测 GitHub Releases 新版本
  - 智能识别系统架构（ARM64/ARM/x86/x86_64），优先下载对应架构的 APK
  - ARM64 设备优先下载 ARM64 版本（~11MB），不支持的设备回退到 Universal 版本（~38MB）
  - 使用 Tauri HTTP 插件下载 APK 到 `/storage/emulated/0/Download/` 目录
  - 调试日志实时显示，支持自动滚动
  - 下载完成后支持调用系统安装器进行安装
- **应用内更新功能**：
  - 检查更新按钮优化：检查中显示加载动画，无更新时按钮显示"当前已是最新版本"
  - 有更新时按钮变为橙色显示"可更新"
  - 下载功能：点击"可更新"后显示进度条，支持取消下载
  - 下载完成后显示"点击安装"按钮
  - 根据操作系统自动选择正确的下载文件（Windows: .exe, macOS: .dmg, Linux: .AppImage）
  - 重新进入关于弹窗时重置为初始状态
- **页面头部固定**：
  - 所有页面头部从 `sticky` 改为 `fixed` 定位
  - 头部始终固定在顶部，不随页面滚动
  - 内容区域添加顶部内边距避免被头部遮挡
- **API 云端判题支持**：
  - 新增 API 云端判题方式，支持智谱 AI GLM 系列模型
  - API 配置：支持 API Key、模型选择、自定义端点
  - 连接测试功能，验证 API 配置是否正确

### 修改

- 检查更新按钮样式优化：检查中图标旋转动画，仅文字变化
- 关闭关于弹窗时重置更新信息和下载状态
- **菜单项顺序调整**："题库管理"移到"主题"下面
- **默认判题方式改为 API 云端判题**：首次使用默认选择 API 云端判题
- **判题方式选项顺序调整**：API 云端判题显示在 WebLLM 本地模型上面
- **调试工具位置调整**：调试工具从 AI 判题区域移出，与判题模式同级
- **切换到 AI 判断时默认使用 API 云端判题**：从固定判断切换到 AI 判断时默认选择 API 云端判题
- **关于弹窗介绍内容更新**：AI 智能判题说明更新为"API 云端 / WebLLM 本地"

### 优化

- **头部高度优化**：压缩 Header 内部容器上下边距
- **内容区域与 Header 间距优化**：统一所有页面内容区顶部内边距
- **底部栏高度压缩**：减少底部导航栏 padding
- **快捷切题区域空白压缩**：减少答题页面快捷切题区域的上下空白
- **滚动条隐藏**：全局添加滚动条隐藏样式
- **弹窗动画优化**：弹窗退出时缩放动画更明显（缩小到 0）
- **按钮颜色统一**：交卷和提交按钮改为绿色
- **警告图标尺寸优化**：警告弹窗中 SVG 图标从 w-6 h-6 改为 w-8 h-8
- **警告弹窗背景优化**：警告类型背景从不刺眼的黄色改为红色

### 技术细节

#### 应用内更新实现

**修改文件：** `src/pages/Profile.tsx`

新增下载状态管理和进度显示：

```typescript
type DownloadStatus = 'idle' | 'downloading' | 'downloaded';

const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
const [downloadProgress, setDownloadProgress] = useState(0);
const abortControllerRef = useRef<AbortController | null>(null);
```

根据操作系统选择下载文件：

```typescript
const getPlatformAsset = (assets: { name: string; browser_download_url: string }[]) => {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  
  if (platform.includes('win') || userAgent.includes('windows')) {
    return assets.find(a => a.name.endsWith('.exe')) || 
           assets.find(a => a.name.includes('windows') && a.name.endsWith('.zip'));
  }
  if (platform.includes('mac') || userAgent.includes('mac')) {
    return assets.find(a => a.name.endsWith('.dmg'));
  }
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return assets.find(a => a.name.endsWith('.AppImage'));
  }
  return assets.find(a => a.name.endsWith('.zip'));
};
```

#### 页面头部固定

**修改文件：** 所有页面组件

将 `sticky top-0` 改为 `fixed top-0 left-0 right-0`：

```tsx
// 修改前
<header className="sticky top-0 z-50 ...">

// 修改后
<header className="fixed top-0 left-0 right-0 z-50 ...">
```

为内容区域添加顶部内边距：

```tsx
// 修改前
<div className="max-w-lg mx-auto px-4 py-4">

// 修改后
<div className="max-w-lg mx-auto px-4 py-4 pt-16">
```

---

## [0.3.2] - 2026-03-13

### 新增

- **检查更新功能**：
  - 在"关于"弹窗添加"检查更新"按钮
  - 通过 GitHub API 获取最新版本号
  - 自动对比版本号判断是否有更新
  - 有更新时显示"前往下载"链接
- **下载题库功能**：
  - 新增下载题库页面 `/download-banks`
  - 从 GitHub 获取系统题库和用户题库列表
  - 系统题库来源：`public/banks` 目录
  - 用户题库来源：`Question bank` 目录
  - 基于 Git SHA 检测题库是否有更新
  - 内置题库自动识别，不显示下载按钮
  - 支持一键下载并自动导入题库
- **题库管理功能**：
  - 新增题库管理页面 `/manage-banks`
  - 在"我的"页面添加"题库管理"入口
  - 支持删除用户导入的题库
  - 显示题库来源标签（系统/用户）
  - 右上角刷新按钮检查题库更新
  - 有更新时显示"更新"按钮，支持一键更新
- **UI 优化**：
  - 题库列表默认展开
  - 折叠箭头移到标题右侧
  - 刷新按钮使用顺时针旋转动画

### 移除

- **GGUF 模型支持**：
  - 移除 GGUF 模型加载功能
  - 移除 GGUF 模型下载管理器
  - 移除 llama.cpp 目录
  - 简化 AI 判题，仅保留 WebLLM 方式
  - 精简设置页面，移除 GGUF 相关 UI
  - 移除 src-tauri/src/gguf 模块
  - 移除 src/utils/ggufService.ts

### 修改

- 项目名称从"低压电工题库"改为"答题测试库"
- 项目标识符从 `com.exam.low-voltage-electrician` 改为 `com.exam.test-system`
- Rust 库名从 `low_voltage_electrician_exam_lib` 改为 `exam_test_system_lib`
- 简化 settingsStore，移除 GGUF 相关状态
- 首页左上角加号菜单添加"下载题库"入口
- 题库类型定义新增 `sourceSha`、`sourceFilename`、`sourceType` 字段
- 题库 Store 新增 `importBankWithSha`、`updateBankWithSha` 方法

### 技术细节

#### 检查更新实现

**修改文件：** `src/pages/Profile.tsx`

```typescript
const handleCheckUpdate = async () => {
  const response = await fetch('https://api.github.com/repos/czixue7/Test-System/releases/latest');
  const data = await response.json();
  const latestVersion = data.tag_name?.replace(/^v/, '') || '0.0.0';
  // 版本对比逻辑
};
```

#### 下载题库实现

**新增文件：** `src/pages/DownloadBanks.tsx`

- 同时获取两个 GitHub 目录的内容
- 基于 Git SHA 判断题库是否有更新
- 内置题库文件名列表硬编码判断

#### 题库管理实现

**新增文件：** `src/pages/ManageBanks.tsx`

- 分类显示用户题库和内置题库
- 支持检查远程更新和一键更新

#### 类型定义扩展

**修改文件：** `src/types.ts`

```typescript
export interface QuestionBank {
  // ... 原有字段
  sourceSha?: string;           // Git 文件哈希
  sourceFilename?: string;      // 源文件名
  sourceType?: 'system' | 'user'; // 题库来源类型
}
```

---

## [0.3.1] - 2026-03-08

### 新增

- **GGUF 模型真正推理**：
  - 集成 `@wllama/wllama` 库（llama.cpp 的 WASM 绑定）
  - 支持在浏览器中直接运行 GGUF 模型推理
  - 无需 WebGPU，使用 WebAssembly SIMD 加速
- **离线模型导入**：
  - 支持从本地文件导入 GGUF 模型
  - 导入成功/失败状态提示
  - 已导入模型列表展示
- **AI 考试评价**：
  - 考试结束后生成 AI 总体评价
  - 根据正确率给出不同评价等级
- **AI 判题解析**：
  - 每道题下方显示 AI 判题解析
  - 填空题显示每空的判题结果
  - 主观题显示 AI 评分和评价
- **删除模型确认弹窗**：
  - 使用美化的 ConfirmModal 替代原生 confirm
  - 显示模型名称和警告信息

### 修改

- GGUF 模型列表更新：移除不支持的 Qwen3.5，添加 TinyLlama
- WebLLM 和 GGUF 模型可同时加载，系统自动选择已加载的模型
- 判题逻辑优化：只有模型就绪时才使用 AI 判题

### 修复

- 修复 Tauri Store 在 Web 环境下的报错
- 修复 React Router Future Flag 警告
- 修复离线导入模型不显示在列表的问题
- 修复 GGUF 模型加载失败的问题（使用正确的 loadModel API）

### 技术细节

#### GGUF 推理实现

**新增文件：** `src/utils/ggufLoader.ts`

使用 wllama 库实现 GGUF 模型加载和推理：

```typescript
import { Wllama } from '@wllama/wllama';

const wllama = new Wllama(ASSETS_PATH, config);
await wllama.loadModel([modelBlob], { n_ctx: 2048, n_threads: 4 });
const result = await wllama.createCompletion(prompt, {
  nPredict: 100,
  sampling: { temp: 0.7, top_k: 40, top_p: 0.9 }
});
```

#### AI 判题反馈

**修改文件：** `src/types.ts`

```typescript
interface UserAnswer {
  questionId: string;
  answer: string | string[];
  score?: number;
  isCorrect: boolean;
  aiFeedback?: string;  // AI 判题解析
}

interface ExamRecord {
  // ...
  aiEvaluation?: string;     // AI 考试总评价
  gradingMode?: 'fixed' | 'ai';
}
```

#### 离线导入模型

**修改文件：** `src/pages/Settings.tsx`

```tsx
<input
  type="file"
  accept=".gguf"
  onChange={async (e) => {
    const file = e.target.files?.[0];
    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = event.target?.result as ArrayBuffer;
      await saveModel(customId, new Uint8Array(data));
      setCustomModels(prev => [...prev, { id, name }]);
    };
    reader.readAsArrayBuffer(file);
  }}
/>
```

#### Tauri Store 环境检测

**修改文件：** `src/utils/tauriStore.ts`

```typescript
const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

export async function getStoreValue<T>(key: string, defaultValue: T): Promise<T> {
  if (!isTauri()) {
    return defaultValue;  // Web 环境直接返回默认值
  }
  // Tauri 环境使用 Store
}
```

#### React Router Future Flags

**修改文件：** `src/App.tsx`

```tsx
<BrowserRouter
  future={{
    v7_startTransition: true,
    v7_relativeSplatPath: true,
  }}
>
```

---

## [0.3.0] - 2026-03-08

### 新增

- **AI 智能判题功能**：
  - 集成 WebLLM 库，支持浏览器端 AI 推理
  - 填空题 AI 判题：判断用户答案与标准答案的语义等价性
  - 主观题 AI 判题：分析答案语义相似度并给出评分
  - 超时自动降级到固定判断模式
- **模型管理**：
  - WebLLM 模型在线加载：Qwen3 1.7B、Qwen2.5 1.5B/0.5B、Llama 3.2 1B/3B
  - GGUF 模型下载：Qwen3.5-0.8B、Qwen2.5-1.5B、Qwen2.5-0.5B
  - 自定义模型导入：支持通过链接导入 GGUF 格式模型
  - 模型加载进度显示和状态管理
- **设置页面重构**：
  - 独立的设置页面，判题模式和模型管理分开展示
  - 判题模式设置：支持固定判断和 AI 判断两种模式
  - 折叠式交互设计，默认折叠，点击展开
- **移动端适配**：
  - 设备内存检测和警告提示
  - WebGPU 支持检测
  - 低内存设备模型推荐
- **模型存储**：
  - Tauri 环境使用 tauri-plugin-fs 存储到本地
  - Web 环境使用 IndexedDB 作为后备存储

### 修改

- 设置入口从弹窗改为独立页面 `/settings`
- 判题模式选择改为折叠框交互
- 模型列表改为折叠框形式，每个模型独立展示
- 关于弹窗添加 AI 智能判题功能说明

### 技术细节

#### AI 判题服务

**新增文件：** `src/utils/aiGrading.ts`

AI 判题核心功能：
- `gradeFillBlank()` - 填空题 AI 判题，5秒超时
- `gradeSubjective()` - 主观题 AI 判题，10秒超时
- `initializeModel()` - 模型初始化
- 自动降级到相似度计算或精确匹配

#### 模型加载服务

**新增文件：** `src/utils/modelLoader.ts`

WebLLM 模型加载服务：
- WebGPU 支持检测
- 模型加载进度回调
- 内存优化配置
- 超时控制

#### 模型存储管理

**新增文件：** `src/utils/modelStorage.ts`

模型文件存储管理：
- Tauri 环境：使用 `tauri-plugin-fs` 存储到应用数据目录
- Web 环境：使用 IndexedDB 存储
- 统一的存储接口

#### 设备检测

**新增文件：** `src/utils/deviceDetection.ts`

设备能力检测：
- 内存容量检测
- WebGPU 支持检测
- 移动端检测
- 模型推荐

#### 下载管理器

**新增文件：** `src/utils/downloadManager.ts`

基于 `fetch` + `ReadableStream` 实现的下载管理器：
- 实时进度追踪
- 暂停/继续下载（使用 AbortController）
- 任务状态管理（downloading/paused/completed/error）
- 存储到本地文件系统

```typescript
interface DownloadTask {
  id: string;
  url: string;
  fileName: string;
  progress: number;
  status: 'downloading' | 'paused' | 'completed' | 'error';
  totalSize: number;
  downloadedSize: number;
  storageProgress?: number;
  error?: string;
}
```

#### 状态管理扩展

**修改文件：** `src/store/settingsStore.ts`

新增模型状态管理：
- `modelState`: 模型状态（not-downloaded/downloading/downloaded/loading/ready/error）
- `modelLoadProgress`: 加载进度
- `modelError`: 错误信息
- `downloadedModelId`: 已下载模型 ID

---

## [0.2.2] - 2026-03-08

### 新增

- vConsole 调试面板优化：使用 fixed 定位和最高 z-index，浮于页面上方不挤压内容
- 自定义确认弹窗组件：替代原生 confirm，带有 Q 弹动画和三种类型（info/warning/danger）
- 全局滚动条美化：支持浅色/深色模式，圆角设计，悬停效果
- PC 和 Android APK 打包并签名支持
- 应用图标更新：采用蓝色渐变背景 + 白色对勾设计，统一所有平台的图标样式

### 修改

- 应用名称从"低压电工考试题库"改为"答题测试库"
- 关于弹窗描述文字更新，使用更通用的描述
- 题库选择器优化：展开列表使用绝对定位浮于上方，不挤压下方内容，支持鼠标滚动
- 主题切换过渡效果优化：使用 cubic-bezier 缓动函数，更加流畅自然
- 全局添加 CSS 过渡效果，主题切换时所有元素平滑过渡
- 答题导航优化：底部题目序号导航支持鼠标滚轮滚动，隐藏滚动条

### 修复

- 修复深色模式下页面加载时白色闪烁的问题（FOUC）
- 修复 SPA 路由切换时懒加载页面的白色闪烁问题

### 构建发布

#### PC Windows 安装包 ✅
- **文件**: `src-tauri/target/release/bundle/nsis/答题测试库_0.2.2_x64-setup.exe`
- **大小**: ~2.9MB
- **类型**: NSIS 安装程序
- **架构**: x64
- **签名**: 已配置证书指纹支持
- **构建时间**: 约 2 分钟
- **应用名称**: 答题测试库
- **版本号**: 0.2.2
- **应用图标**: 蓝色渐变背景 + 白色对勾

#### Android APK ✅
- **文件**: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
- **大小**: ~8.6MB
- **类型**: Universal APK (支持所有架构：arm64-v8a, armeabi-v7a, x86, x86_64)
- **签名**: ✅ 已使用 release-key.jks 签名
- **版本**: versionCode=2002, versionName=0.2.2
- **目标 SDK**: 36
- **最低 SDK**: 24
- **构建时间**: 约 3-5 分钟
- **应用名称**: 答题测试库
- **应用图标**: 蓝色渐变背景 + 白色对勾

#### Android AAB (Google Play) ✅
- **文件**: `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`
- **大小**: ~8.5MB
- **类型**: Android App Bundle
- **签名**: ✅ 已使用 release-key.jks 签名
- **版本**: versionCode=2002, versionName=0.2.2
- **应用名称**: 答题测试库

### 技术细节

#### vConsole 调试面板优化

**问题：** vConsole 调试面板使用绝对定位，会挤压下方的页面内容，导致底部导航栏被推开。

**解决方案：** 为 vConsole 的切换按钮和面板添加 `fixed` 定位和最高 z-index（999999），使其浮于页面所有内容之上。

**修改文件：** `src/index.css`

```css
/* vConsole 汉化样式 */
.vc-switch {
  font-size: 12px !important;
  position: fixed !important;
  z-index: 999999 !important;
}

.vc-panel {
  position: fixed !important;
  z-index: 999999 !important;
}
```

#### 应用名称更新

**修改文件：** `src/pages/Profile.tsx`

**修改前：**
```tsx
<h2 className="text-lg font-bold text-gray-800 dark:text-white mb-1">低压电工考试题库</h2>
<p>一款帮助低压电工学习和备考的应用</p>
```

**修改后：**
```tsx
<h2 className="text-lg font-bold text-gray-800 dark:text-white mb-1">答题测试库</h2>
<p>一款帮助用户学习和备考的应用</p>
```

#### 题库选择器优化

**问题：** 题库选择卡片展开时，下拉列表会占据文档流空间，将下方的功能按钮挤开。

**解决方案：** 将展开的题库列表改为绝对定位（absolute），使其浮于页面内容上方，不影响其他元素的布局。

**修改文件：** `src/pages/Home.tsx`

**修改前：**
```tsx
<div className="bg-white rounded-2xl shadow-md mb-6 border border-gray-100 overflow-hidden">
  {/* ... header ... */}
  {isBankListExpanded && (
    <div className="border-t border-gray-100 max-h-60 overflow-y-auto">
      {/* 列表内容 */}
    </div>
  )}
</div>
```

**修改后：**
```tsx
<div className="bg-white rounded-2xl shadow-md mb-6 border border-gray-100 overflow-hidden relative">
  {/* ... header ... */}
  {isBankListExpanded && (
    <div className="absolute left-0 right-0 top-full border-t border-gray-100 max-h-60 overflow-y-auto bg-white shadow-lg z-10 rounded-b-2xl">
      {/* 列表内容 */}
    </div>
  )}
</div>
```

**关键技术点：**
- 父容器添加 `relative` 定位上下文
- 展开列表使用 `absolute` 定位，`top-full` 使其位于父容器底部
- 添加 `shadow-lg` 和 `z-10` 确保列表浮于上方且有阴影效果
- 添加 `rounded-b-2xl` 保持圆角样式一致性

#### 主题切换过渡优化

**问题：** 主题切换时使用 `ease` 缓动函数，过渡效果较为平淡。

**解决方案：** 使用 `cubic-bezier(0.4, 0, 0.2, 1)` 缓动函数，提供更自然流畅的过渡效果。

**修改文件：** `src/index.css`

**修改前：**
```css
html {
  transition: color 300ms ease, background-color 300ms ease;
}
```

**修改后：**
```css
html {
  transition: color 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

#### 全局主题过渡效果

**问题：** 只有 html 和 body 元素有过渡效果，其他使用 Tailwind `dark:` 类的元素在主题切换时颜色变化是瞬间的，没有过渡。

**解决方案：** 为所有元素添加全局的 CSS 过渡效果，使主题切换时所有元素的颜色变化都平滑过渡。

**修改文件：** `src/index.css`

```css
/* 全局主题过渡效果 */
*, *::before, *::after {
  transition-property: background-color, border-color, color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 300ms;
}

/* 按钮和表单元素添加更多过渡属性 */
button, input, textarea, select {
  transition-property: background-color, border-color, color, fill, stroke, box-shadow, transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
}
```

**效果：**
- 所有背景色、边框色、文字颜色变化都有 300ms 的平滑过渡
- 按钮和表单元素有 200ms 的快速反馈过渡
- 使用 cubic-bezier(0.4, 0, 0.2, 1) 缓动函数，过渡自然流畅

#### 全局滚动条美化

**新增文件：** `src/index.css`

**滚动条样式：**
- 宽度/高度：8px（适中大小）
- 圆角：4px
- 轨道背景：浅色模式 `rgba(0, 0, 0, 0.05)`，深色模式 `rgba(255, 255, 255, 0.05)`
- 滑块背景：浅色模式 `rgba(0, 0, 0, 0.2)`，深色模式 `rgba(255, 255, 255, 0.2)`
- 悬停效果：滑块颜色加深到 0.3 透明度
- 过渡动画：200ms

**代码示例：**
```css
/* 美化滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  transition: background 200ms ease;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

/* 深色模式滚动条 */
.dark ::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

.dark ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}

.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
```

**应用场景：**
- ✅ 题库列表滚动
- ✅ 页面内容滚动
- ✅ 模态框内容滚动
- ✅ 所有带滚动条的区域

#### 题库列表鼠标滚动支持

**修改文件：** `src/pages/Home.tsx`

**问题：** 题库展开列表在滚动时，鼠标滚轮事件会冒泡到父元素，导致页面整体滚动而不是列表滚动。

**解决方案：** 为题库列表添加 `onWheel` 事件处理器，阻止事件冒泡。

```tsx
<div 
  className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto"
  onWheel={(e) => e.stopPropagation()}
>
  {/* 题库列表内容 */}
</div>
```

**效果：**
- ✅ 鼠标在题库列表上滚动时，只滚动列表内容
- ✅ 不会影响页面的整体滚动
- ✅ 提供更精确的滚动控制体验

#### 答题导航滚动优化

**修改文件：** `src/pages/Practice.tsx`、`src/pages/Exam.tsx`

**问题：** 底部题目序号导航栏在题目较多时只能横向滚动，但不支持鼠标滚轮操作。

**解决方案：** 为导航容器添加 `onWheel` 事件处理器，将垂直滚动转换为水平滚动，同时隐藏滚动条。

**代码示例：**
```tsx
<div 
  ref={navRef} 
  className="flex gap-1 overflow-x-auto py-1 mb-3 scrollbar-hide" 
  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
  onWheel={(e) => {
    e.stopPropagation();
    const delta = e.deltaY;
    if (navRef.current) {
      navRef.current.scrollLeft += delta;
    }
  }}
>
  {/* 题目序号按钮 */}
</div>
```

**特性：**
- ✅ 支持鼠标滚轮滚动（垂直滚动转换为水平滚动）
- ✅ 隐藏滚动条（保持界面简洁）
- ✅ 阻止事件冒泡（不影响页面其他部分）
- ✅ 保持原有大小和布局
- ✅ 平滑的滚动体验

**应用场景：**
- ✅ 练习模式底部导航
- ✅ 考试模式底部导航

#### 自定义确认弹窗组件

**问题：** 使用原生 `confirm()` 弹窗，样式简陋，无动画效果，不支持深色模式。

**解决方案：** 创建自定义的 ConfirmModal 组件，带有 Q 弹动画（bounceIn）和三种类型（info/warning/danger）。

**新增文件：** `src/components/ConfirmModal.tsx`

**特性：**
- 🎨 美观的圆角卡片设计
- 🎯 三种类型图标和颜色（蓝色 info/黄色 warning/红色 danger）
- 🎭 Q 弹的 bounceIn 动画效果（cubic-bezier(0.68, -0.55, 0.265, 1.55)）
- 🌓 完整的深色模式支持
- 📱 响应式设计，移动端友好
- ⚡ 按钮点击时的 scale 反馈效果
- 🎬 淡入淡出和缩放过渡动画

**使用示例：**
```tsx
<ConfirmModal
  message="确定要退出考试吗？"
  onConfirm={handleExitConfirm}
  onCancel={handleExitCancel}
  confirmText="退出"
  cancelText="继续答题"
  type="warning"
/>
```

**修改文件：** `src/pages/Exam.tsx`、`src/pages/Records.tsx`

**动画关键帧：**
```css
@keyframes bounceIn {
  0% { opacity: 0; transform: scale(0.3); }
  50% { opacity: 1; transform: scale(1.05); }
  70% { transform: scale(0.9); }
  100% { opacity: 1; transform: scale(1); }
}
```

#### 应用图标更新

**问题：** 之前打包的应用程序图标和名称没有更新，仍然显示旧的图标。

**解决方案：** 使用 Tauri CLI 的 `icon` 命令从源图标生成所有平台所需的图标尺寸。

**图标设计：**
- 背景：蓝色渐变（#3B82F6 → #2563EB）
- 前景：白色对勾符号
- 尺寸：1024x1024 PNG 源图标

**生成命令：**
```bash
cd src-tauri
npx tauri icon
```

**生成的图标文件：**
- **Windows**: `icons/icon.ico`, `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`
- **macOS**: `icons/icon.icns`
- **Android**: `gen/android/app/src/main/res/mipmap-*/ic_launcher*.png`
- **iOS**: `gen/ios/App/App/Assets.xcassets/AppIcon.appiconset/*.png`

**修改文件：** `src-tauri/tauri.conf.json`
```json
{
  "productName": "答题测试库",
  "version": "0.2.2",
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico"
    ]
  }
}
```

#### PC 和 Android 打包签名

**构建命令：**
- PC: `npm run tauri build`
- Android: `cd src-tauri/gen/android && ./gradlew assembleUniversalRelease`

**PC Windows 构建：**
- 输出目录：`src-tauri/target/release/bundle/nsis/`
- 安装包：`答题测试库_0.2.2_x64-setup.exe`
- 签名配置：支持证书指纹（`certificateThumbprint`）
- 配置文件：`src-tauri/tauri.conf.json`

**Android 构建：**
- 输出目录：`src-tauri/gen/android/app/build/outputs/`
- APK 文件：`apk/universal/release/app-universal-release.apk`
- AAB 文件：`bundle/universalRelease/app-universal-release.aab`
- 签名配置：`keystore.properties` 和 `release-key.jks`
- 签名密钥：
  - Store Password: 123456
  - Key Password: 123456
  - Key Alias: release
  - Store File: release-key.jks

**构建时间：**
- PC 构建：约 2 分钟
- Android 构建：约 3-5 分钟

#### 深色模式闪烁问题修复

**问题：** 在深色模式下，页面加载期间会短暂显示白色背景，然后才切换到深色模式。

**原因：** 主题初始化发生在 JavaScript 加载后，页面先以默认的浅色模式渲染。

**解决方案：** 在 `index.html` 的 `<head>` 中添加内联脚本，在页面渲染之前立即应用主题类。

**修改文件：** `index.html`

```html
<script>
  // 在页面渲染前立即应用主题，防止闪烁
  (function() {
    try {
      const storedTheme = localStorage.getItem('theme-preference');
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = storedTheme || (systemDark ? 'dark' : 'light');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      }
    } catch (e) {
      // 忽略错误
    }
  })();
</script>
```

#### SPA 路由切换闪烁问题修复

**问题：** 在深色模式下，首次进入其他未加载的页面（懒加载组件）时仍会看到白色闪烁。

**原因：** React Router 的懒加载组件在 Suspense fallback 中使用了硬编码的浅色背景。

**解决方案：** 
1. 为 App.tsx 中的 Suspense fallback 组件添加深色模式支持
2. 为 body 元素添加 CSS 变量背景和过渡效果

**修改文件：** `src/App.tsx`、`src/index.css`

```tsx
// App.tsx - 初始化加载
<div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">

// App.tsx - Suspense fallback
<div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">

// index.css - body 元素
body {
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: background-color 300ms ease, color 300ms ease;
}
```

---

## [0.2.1] - 2026-03-08

### 新增

- 全局错题记录功能：错题存储在全局位置，不受题库切换影响
- 错题练习模式：将所有题库的错题随机打乱进行练习
- 首页显示全局错题总数，错题练习显示所有题库的错题
- 顺序练题提交流程：提交按钮替换下一题按钮，提交后才可进入下一题
- 未作答题目提交后自动判错并记录到错题库

### 修改

- 顺序练题按钮文案从"总题库"改为"当前题库"
- 已提交的题目自动锁定，返回上一题保持答案和解析显示
- 错题练习模式下答对题目自动从错题库移除

### 修复

- 修复模拟考试页面参入其他模式题库数据的问题
- 修复顺序练题和错题练习无法在输入框输入答案的问题
- 修复选项按钮和输入框文字颜色看不清的问题（添加 text-gray-800）
- 修复错题练习显示有错题数量但看不到题目的问题
- 修复切换题目后答案状态丢失的问题

### 技术细节

#### 全局错题存储

**修改文件：** `src/pages/Practice.tsx`、`src/pages/Exam.tsx`、`src/pages/Home.tsx`

错题存储键从 `practice-data-{bankId}` 改为 `practice-data-global`：

```typescript
// 修改前
const stored = localStorage.getItem(`practice-data-${bankId}`);

// 修改后
const stored = localStorage.getItem('practice-data-global');
```

#### 输入框初始化修复

**问题：** `examState` 为 `null` 时，`setAnswer` 和 `getAnswer` 无法正常工作。

**修改文件：** `src/pages/Practice.tsx`

```typescript
// 添加 startExam 初始化
const { setAnswer, getAnswer, confirmAnswer, getResult, startExam } = useExamStore();

useEffect(() => {
  // ...
  startExam(bank.id, bank.name, questions);
}, [...]);
```

#### 文字颜色修复

为所有输入组件添加 `text-gray-800` 类：

```tsx
// 选项按钮
className={`w-full p-3 rounded-lg text-left border-2 transition-all text-gray-800 ${bgClass}`}

// 填空题输入框
className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-800"

// 主观题文本框
className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-800"
```

#### 题目状态保持

切换题目时检查已提交状态，保持答案显示：

```typescript
const handleNextQuestion = () => {
  if (practiceIndex < practiceQuestions.length - 1) {
    const nextQuestion = practiceQuestions[practiceIndex + 1];
    const nextResult = getResult(nextQuestion.id);
    setPracticeIndex(practiceIndex + 1);
    setShowAnswer(nextResult?.isConfirmed || false);
  }
};
```

#### 未作答判错逻辑

**修改文件：** `src/store/examStore.ts`

```typescript
confirmAnswer: (questionId) => {
  // ...
  const hasAnswered = answer !== undefined && 
    answer !== '' && 
    (!Array.isArray(answer) || answer.length > 0);
  
  if (!hasAnswered) {
    result = {
      answer: answer ?? '',
      isConfirmed: true,
      isCorrect: false,  // 未作答判错
      score: 0
    };
  }
  // ...
}
```

#### 顺序练题提交按钮

**修改文件：** `src/pages/Practice.tsx`

```tsx
{(!isViewMode && practiceMode === 'sequential' && !getResult(currentQuestion?.id || '')?.isConfirmed) ? (
  <button 
    onClick={handleConfirmAnswer} 
    className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors"
  >
    提交
  </button>
) : (
  <button onClick={handleNextQuestion} disabled={practiceIndex === practiceQuestions.length - 1} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50">下一题</button>
)}
```

---

## [0.2.0] - 2026-03-08

### 新增

- 现代化移动应用风格的学习页面布局
- 首页重构为现代化移动应用风格，支持题库选择和快速练习
- 新增"我的"页面，包含设置、主题、导入题库、测试记录、关于等功能入口
- 深浅主题切换功能，支持跟随系统主题偏好
- 题库选择器整合到信息卡片内部，支持展开/收起
- 底部导航栏简化为"首页"和"我的"两个导航项
- 练习模式支持收藏题目和标记错题功能
- 练习数据持久化存储（错题、收藏、常考题）
- 新增独立的练习页面 `/practice/:bankId/:mode`，支持多种练习模式
- 新增独立的考试页面 `/exam/:bankId`，支持模拟考试
- 新增考试结果页面 `/result/:id`，显示考试成绩
- 新增测试记录页面 `/records`，查看历史考试记录
- 新增导入题库页面 `/import`，支持 JSON 文件导入
- 首页添加题库弹窗，整合"新建题库"和"导入题库"选项
- 练习页面底部题目导航栏，支持快速切换题目（快捷切题）
- 练习页面题目状态指示：已答正确（绿色）、已答错误（红色）、未答（灰色）
- 练习页面收藏功能简化，底部星标按钮一键收藏/取消收藏
- 练习页面常考题标记功能，方便重点复习
- 看题模式自动显示答案和解析，无需确认
- 错题自动记录，答错题目自动加入错题库

### 修改

- QuestionBankDetail 页面采用蓝色渐变顶部栏和圆形按钮布局
- Home 页面题库选择器移入信息卡片内部
- Profile 页面主题功能从"开发中"改为实际的主题切换弹窗
- 首页底部导航"我的"链接指向 /profile
- 从 Profile 页面移除"导入题库"菜单项，整合到首页添加按钮
- 统一所有页面的 Header 布局结构（max-w-lg、py-3、w-8 占位符）
- 统一所有页面的底部导航栏样式
- 应用启动时初始化主题状态
- 关于弹窗版本号更新为 0.1.0

### 修复

- 修复 QuestionBankDetail 路由参数名不匹配导致"题库不存在"的问题
- 修复 themeStore.ts 中未使用变量导致的 TypeScript 编译错误
- 修复所有页面返回按钮导航逻辑，使用 navigate(-1) 返回上一页
- 修复主题切换功能不生效的问题
- 修复底部导航栏残留元素（报名、招聘等）
- 修复 QuestionBankDetail 页面"科二"标签和"进入考试"卡片的残留显示

### 技术细节

#### 页面路由重构

**修改文件：** `src/App.tsx`

从单页弹窗模式重构为多页面路由模式：

```tsx
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/profile" element={<Profile />} />
  <Route path="/practice/:bankId/:mode" element={<Practice />} />
  <Route path="/exam/:bankId" element={<Exam />} />
  <Route path="/result/:id" element={<Result />} />
  <Route path="/records" element={<Records />} />
  <Route path="/import" element={<Import />} />
</Routes>
```

#### 新增页面文件

- `src/pages/Home.tsx` - 首页，题库选择和练习入口
- `src/pages/Profile.tsx` - 我的页面
- `src/pages/Practice.tsx` - 练习页面，支持多种模式
- `src/pages/Exam.tsx` - 模拟考试页面
- `src/pages/Result.tsx` - 考试结果页面
- `src/pages/Records.tsx` - 测试记录页面
- `src/pages/Import.tsx` - 导入题库页面

#### 返回按钮导航逻辑

**修改前：** 固定返回首页
```tsx
<Link to="/">返回首页</Link>
```

**修改后：** 返回上一页，无历史记录时返回首页
```tsx
const handleGoBack = () => {
  if (window.history.length > 1 && location.key !== 'default') {
    navigate(-1);
  } else {
    navigate('/');
  }
};
```

#### 主题初始化

**修改文件：** `src/App.tsx`

```tsx
useEffect(() => {
  initTheme();
}, [initTheme]);
```

#### 统一 Header 布局

所有页面采用统一的 Header 结构：

```tsx
<header className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
  <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
    {/* 左侧：w-8 占位符或返回按钮 */}
    <h1 className="text-lg font-semibold">{title}</h1>
    {/* 右侧：w-8 占位符或功能按钮 */}
  </div>
</header>
```

#### 首页添加题库弹窗

点击首页 Header 的 + 按钮显示选择弹窗：

```tsx
{showAddModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-2xl p-5 w-full max-w-sm">
      <h2 className="text-lg font-semibold mb-4">添加题库</h2>
      <button onClick={() => setCurrentModal('create')}>新建题库</button>
      <button onClick={() => navigate('/import')}>导入题库</button>
    </div>
  </div>
)}
```

#### 内置题库配置

**文件：** `src/utils/builtInBanks.ts`

配置 10 个内置题库，从 `/banks/` 目录加载：

```typescript
const BUILT_IN_BANKS = [
  { file: '01 第一周考题（答案）.json', id: 'built-in-01' },
  { file: '02 第二周考题（答案）.json', id: 'built-in-02' },
  // ... 共 10 个
];
```

#### TypeScript 类型错误修复

**问题：** `correctAnswer` 字段可能是 `AnswerWithImages` 类型（包含 `text` 和 `images` 字段的对象），不能直接渲染为 ReactNode。

**修改文件：** `src/pages/Practice.tsx`、`src/pages/Result.tsx`

**修改前（错误代码）：**
```tsx
{Array.isArray(currentQuestion.correctAnswer)
  ? currentQuestion.correctAnswer.join('、')
  : currentQuestion.correctAnswer}  // ❌ 可能是 AnswerWithImages 对象
```

**修改后（正确代码）：**
```tsx
{(() => {
  const answer = currentQuestion.correctAnswer;
  if (typeof answer === 'object' && answer !== null && 'text' in answer) {
    return answer.text;  // ✅ 正确提取 text 字段
  }
  return Array.isArray(answer) ? answer.join('、') : answer;
})()}
```

**清理未使用的代码：**
- `Practice.tsx`: 删除未使用的 `handleToggleFavorite` 函数
- `Result.tsx`: 删除未使用的 `getCorrectAnswerDisplay` 函数和 `Question` 类型导入

---

## [0.1.0] - 2026-03-07

### 新增

- 填空题答案显示优化：正确填写的空只显示 "✓ 正确"，错误或漏填的空显示正确答案
- 确认答案按钮始终显示，允许在有空没填的情况下确认答案
- Android APK 签名配置，支持生成已签名的发布版 APK

### 修改

- 项目结构整理：将 `Test-System` 子目录的文件移动到项目根目录
- 简化项目结构，便于 GitHub 上传和构建

### 修复

- 修复填空题提交后正确答案冗余显示的问题
- 修复填空题确认按钮需要填写内容才能点击的问题
- 修复 Android 构建时符号链接失败的问题
- 修复 Gradle 构建时 rustBuild 任务失败的问题
- 修复 Gradle 找不到 Android SDK 的问题

### 技术细节

#### 填空题答案显示优化

**修改文件：** `src/pages/Exam.tsx`

```tsx
{isConfirmed && !isThisCorrect && (
  <div className="flex items-center gap-2">
    <span className="text-sm text-gray-600">正确答案：</span>
    <span className="text-sm font-medium text-green-600">{displayCorrectAnswer}</span>
    <span className="text-red-600">✗</span>
  </div>
)}
{isConfirmed && isThisCorrect && (
  <div className="flex items-center gap-2">
    <span className="text-green-600">✓ 正确</span>
  </div>
)}
```

#### 确认答案按钮逻辑优化

**修改前：**
```tsx
{!isConfirmed && blankAnswers.some(a => a && (a as string).trim()) && (
  <button>确认答案</button>
)}
```

**修改后：**
```tsx
{!isConfirmed && (
  <button>确认答案</button>
)}
```

#### Android APK 签名配置

**创建签名密钥：**
```bash
cd src-tauri/gen/android/app
keytool -genkey -v -keystore release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias release -storepass 123456 -keypass 123456 -dname "CN=Low Voltage Electrician Exam, OU=Development, O=Exam, L=Beijing, ST=Beijing, C=CN"
```

**创建 keystore.properties：**
```properties
storePassword=123456
keyPassword=123456
keyAlias=release
storeFile=release-key.jks
```

**修改 build.gradle.kts 添加签名配置：**
```kotlin
val keystoreProperties = Properties().apply {
    val propFile = file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storeFile = file(keystoreProperties.getProperty("storeFile"))
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

**禁用 rustBuild 任务（解决 Gradle 构建失败）：**
```kotlin
tasks.whenTaskAdded {
    if (name.contains("rustBuild")) {
        enabled = false
    }
}
```

#### 项目结构整理

**移动的文件：**
- `src/` - 前端源码
- `src-tauri/` - Tauri 后端
- `public/` - 静态资源
- `scripts/` - 工具脚本
- 配置文件（package.json, vite.config.ts 等）

**清理的文件：**
- `dist/` - Web 构建输出
- `src-tauri/target/` - Rust 编译缓存
- Android 构建缓存（.gradle, build 目录）

---

## 版本说明

- **[Unreleased]**: 开发中的功能
- **[0.3.4]**: 图片查看器增强、参考答案图片显示、滑动切换优化
- **[0.3.3]**: 应用内更新功能、页面头部固定
- **[0.3.2]**: 检查更新、下载题库、题库管理、UI 优化
- **[0.3.0]**: 设置页面重构、判题模式设置、模型下载管理、AI 判题接口预留
- **[0.2.2]**: vConsole 优化、自定义确认弹窗、滚动条美化、主题过渡优化、答题导航滚动、PC/Android 打包签名
- **[0.2.1]**: 全局错题记录、答题流程优化、输入显示修复
- **[0.2.0]**: 现代化移动应用风格布局重构、页面路由重构
- **[0.1.0]**: 首个发布版本
