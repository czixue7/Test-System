# GGUF 本地模型方案与踩坑总结

> 整合自：GGUF 构建与运行方案、本地导入卡顿原因说明
> 整理时间：2026-09-09

---

## 一、模型运行框架

- 使用 **llama.cpp 的 `llama-cli`** 进行推理（执行二进制），已替换 Candle/tokenizers。
- 后端通过 Rust 调用 `llama-cli`，不再需要 tokenizer。

### 推理调用方式

```
llama-cli -m <model_path> -n <max_tokens> -ngl 0 "<prompt>"
```

- Rust 在 `generate_text` 中执行并读取 stdout。

### 可调整参数

| 调整内容 | 位置 |
|----------|------|
| 推理参数（`-n`、`-ngl`、`--temp` 等） | Rust `generate_text` 命令参数 |
| 默认模型地址 | 前端 `GGUF_MODELS` 列表的 `url/fileName` |
| 模型保存目录 | `ensureGgufModelDir` 内的目录名 |
| llama-cli 路径 | Rust `llama_bin_name` / `ensure_llama_bin` |

---

## 二、模型加载方式

### 方式一：在线下载（主方式）

- 通过 `fetch` 从 HuggingFace 下载 GGUF。
- 保存到 `appDataDir/gguf-models/`。
- 使用 `*.part` 临时文件，下载完成后重命名为 `.gguf`。

**断点续传**：
1. 如果存在 `.part` 文件，读取其大小。
2. 使用 HTTP `Range` 继续下载：`Range: bytes=<downloaded>-`。
3. 下载完成后重命名为正式模型文件。

### 方式二：本地导入（备用）⚠️ 已知卡顿

- 使用系统文件选择器选取 `.gguf`。
- 通过**前端 JS 流式复制**到 `appDataDir/gguf-models/imports/`。

**现有实现位置**：
- 前端导入逻辑：`src/pages/Settings.tsx`
- 复制函数：`copyFileStream`（1MB 分块循环读写）

---

## 三、本地导入卡顿问题（踩坑）

### 3.1 现象

- 选择本地 GGUF 文件后，导入时间很长。
- 导入过程中界面明显卡顿甚至短暂无响应。

### 3.2 根本原因

当前实现是**在前端用 JS 持续循环读写大文件**：

```
openFile → 每次读 1MB → 写入 AppData 目录 → 循环直到复制完成
```

导致三个问题：

| 问题 | 说明 |
|------|------|
| 主线程被长时间占用 | JS 在前端不停读写循环，UI 线程无法及时刷新 |
| I/O 竞争 + 设备速度限制 | 手机存储写入速度较慢，几百 MB 文件会明显拖慢 |
| 频繁分配与 GC 抖动 | 大量循环读写带来频繁内存分配与 GC |

### 3.3 为什么一定会慢

- GGUF 本身是大文件（通常 500MB～数 GB），复制时间不可避免。
- 现有逻辑又把复制放在前端执行，卡顿更加明显。

### 3.4 建议优化方向（未实施）

| 方向 | 说明 |
|------|------|
| **后端 Rust 执行拷贝** | 避免阻塞前端 UI |
| **后台线程 + 进度回调** | 前端仅显示进度，不参与复制 |
| **能直连路径则不复制** | 直接记录原路径（但 Android 需处理 URI 权限） |

---

## 四、Android 文件权限问题

- APK 内 `assets` 中的二进制不可直接执行。
- 需要复制到可执行目录（`appDataDir/gguf/bin/llama-cli`）并 `chmod 755`。
- 已在 Rust 中处理复制与权限设置。

---

## 五、编译方式与命令

| 步骤 | 命令 |
|------|------|
| 前端构建 | `npm run build` |
| Android 打包 | `npm run tauri:android:build` |
| APK 输出路径 | `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` |

---

## 六、可能失败原因汇总

| # | 失败原因 | 排查方向 |
|---|----------|----------|
| 1 | `llama-cli` 未找到或无执行权限 | 检查 `appDataDir/gguf/bin/` 下是否存在且 `chmod 755` |
| 2 | GGUF 文件不存在或下载不完整 | 检查 `gguf-models/` 下是否有 `.part` 残留 |
| 3 | GGUF 与 `llama-cli` 版本不兼容 | 确认模型量化格式与 llama.cpp 版本匹配 |
| 4 | 设备内存不足，进程被杀 | 查看系统 OOM 日志，尝试减小 `-n` 或换小模型 |
| 5 | Android 资源目录不能直接执行 | 确认 Rust 已将二进制复制到可执行路径 |
| 6 | 本地导入时 UI 卡死 | 前端 `copyFileStream` 阻塞主线程，需迁移到 Rust 后端 |
