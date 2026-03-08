# 更新日志

本文档记录项目的所有重要更改。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased]

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
- **[0.2.2]**: vConsole 优化、自定义确认弹窗、滚动条美化、主题过渡优化、答题导航滚动、PC/Android 打包签名
- **[0.2.1]**: 全局错题记录、答题流程优化、输入显示修复
- **[0.2.0]**: 现代化移动应用风格布局重构、页面路由重构
- **[0.1.0]**: 首个发布版本
