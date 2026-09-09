# 开发总结：知识库动效优化与 AI 搜索题库总结

> 日期：2026-09-08
> 版本：v0.3.9（构建号 20260908）
> 涉及模块：知识库页面（KnowledgeBase）、AI 搜索（knowledgeAI）、内容总结（knowledgeSummary）、对话管理（chatStore）、值班表（DutySchedule）、题库管理（ManageBanks）、Tauri 打包

---

## 一、遇到的坑与解决经验

### 1.1 构建与打包环境

| 坑 | 现象 | 根因 | 解决方案 | 经验 |
|---|---|---|---|---|
| Cargo 不在 PATH | `failed to run 'cargo metadata': program not found` | Rust 装在 `C:\Users\Administrator\.cargo\bin`，终端会话 PATH 未包含 | 构建前显式 `$env:Path = "C:\Users\Administrator\.cargo\bin;" + $env:Path` | Windows 上调 Tauri/Cargo 前永远先确认 cargo 可访问，不假设环境变量已配好 |
| PowerShell 5 不支持 `&&`/`head` | `&&` 报「不是有效语句分隔符」，`head` 报「不是 cmdlet」 | PowerShell 5 语法与 bash 不同 | 用 `;` 串联或拆多次调用；`Select-Object -First N` 替代 `head -N` | 在 PowerShell 5 下永远不用 bash 风格的 `&&`、`head`、`grep` |
| `tauri android build` symlink 权限失败 | Windows 上创建符号链接权限不足 | Tauri CLI 的 Android 构建流程依赖 symlink | 手动工作流：前端 `npm run build` → 同步 `dist/` 到 assets → 直接 `gradlew.bat assembleRelease` | 当 `tauri android build` 失败时，检查 `.so` 是否已在 `jniLibs`；Rust 未改只需同步前端资源 + 跑 gradlew |
| 构建产物未更新（SO 过期） | 修改前端代码后 EXE/APK 行为不变 | Rust 侧 `lib.rs`/`main.rs` 未变更，cargo 增量编译跳过，前端资源未重新嵌入 | 每次构建前 `touch lib.rs main.rs` 强制 Rust 重编译，确保前端资源重新打包 | 改了前端但行为没变时，第一时间检查是否 touch 了 Rust 入口文件 |
| indexmap 1.9.3 build script 执行失败 | cargo 编译 indexmap 时 `could not execute ... build-script-build.exe: 拒绝访问 (os error 5)`，debug/release 都会偶发 | 本机 cargo 在创建 build script 产物副本环节异常（手动执行副本 exe 正常，同目录其他 crate 正常），多进程并发时更易触发 | 本地 vendor 副本 `src-tauri/vendor/indexmap-1.9.3`：build.rs 改为静态 `println!("cargo:rustc-cfg=has_std")`（去掉 autocfg 探测），Cargo.toml 删除 `[build-dependencies.autocfg]`；`src-tauri/Cargo.toml` 末尾加 `[patch.crates-io] indexmap = { path = "vendor/indexmap-1.9.3" }`；Windows release 下偶发复现时直接重试一次即可 | 环境性偶发错误优先找"绕开"路径而非重试；vendor patch 后 build script 无外部探测，稳定可用且不可回退（移除 patch 会重新触发） |
| NDK 环境变量缺失 | Android 构建报 `cc-rs: failed to find tool "clang.exe"` | NDK 位于项目内 `.android-sdk/ndk/26.3.11579264`，但 `ANDROID_NDK_HOME/ANDROID_NDK_ROOT/ANDROID_HOME` 均未设置，cargo 找不到 clang | 每次构建注入：`ANDROID_NDK_HOME/ROOT` = NDK 路径、`ANDROID_HOME` = `.android-sdk`、`Path` 前置 `toolchains\llvm\prebuilt\windows-x86_64\bin`、4 个 `CARGO_TARGET_*_LINUX_ANDROID_LINKER` 指向对应 `.cmd` wrapper | NDK 装在项目目录时不会有系统环境变量，构建命令必须自带完整工具链环境；wrapper 有 21/22/24 多版本，统一用 24 |
| armv7 的 ring 汇编编译失败 | `x25519-asm-arm.S` 报 `instruction requires: armv5te`/`thumb2`，cc-rs 找不到 `arm-linux-androideabi-clang`（NDK 26.3 只有 `armv7a-linux-androideabi24-clang`） | cc-rs 对 armv7 回退到裸 clang + `--target=arm-linux-androideabi`，默认指令集过低 | 注入 `CC_armv7_linux_androideabi` = NDK bin 的 `clang.exe` + `CFLAGS_armv7_linux_androideabi` = `--target=armv7a-linux-androideabi24` + `AR_armv7_linux_androideabi` = `llvm-ar.exe`（等价于 NDK wrapper 脚本行为） | NDK 26 的 clang wrapper 就是 `clang --target=<triple><api>`，用环境变量 CC/CFLAGS 复刻即可，无需软链 |
| tauri-plugin 构建目录竞争 | 4 ABI 并行 cargo build 时 `tauri-plugin-fs: failed to create directory ...android\.tauri\tauri-api: 当文件已存在时，无法创建该文件 (os error 183)` | tauri-plugin-fs 的 build script 会向 cargo registry 源码目录写入 `.tauri/tauri-api`，多 target 并行同时 create_dir 竞争 | 删除 registry 下 `tauri-plugin-fs-*/android/.tauri` 残留目录；4 个 ABI **改为串行构建**（一次一个 `--target`） | 涉及写共享源码目录的 build script 不能多 target 并行；先清理残留，再串行 |
| gradle 缓存未感知 .so 变化 | 替换 jniLibs 的 .so 后 `assembleRelease` 秒回 up-to-date，APK 还是旧包 | gradle 增量缓存判定未识别 Copy-Item 覆盖的文件变化 | `gradlew clean assembleRelease` 强制全量重打 | 换 .so 后如果 gradle 秒过，务必 clean 重打，否则交付旧包 |
| Windows release 偶发 os error 5 | `npm run tauri:build` 中 cargo release 偶发 indexmap build script `拒绝访问`，单独 `cargo build --release` 却成功 | 与 tauri CLI 多进程环境相关，非代码问题 | 先单独 `cargo build --release` 编译通过，再重跑 `tauri:build`（release 已缓存，增量很快） | 同一 crate 编译失败但手动/重试成功 = 环境偶发，换通道（先 cargo 后 tauri）绕开 |
| Android APK 前端资源过期 | 打出的 APK 里 assets 是旧 dist（chunk 名/时间戳落后），Android 端"打不开/功能不对" | 手动工作流下 `gradlew assembleRelease` 不会自动同步 `dist/` 到 `gen/android/app/src/main/assets/`，该目录停留在上一次手动同步时间 | 每次改前端后打包 Android 前，先把 `dist/`（index.html、assets/、models.json、banks/）同步覆盖到 `gen/android/app/src/main/assets/`，再跑 gradle；用 `Remove-Item assets/assets` 清旧 chunk 避免残留 | 双端打包时 Android 前端资源是"手动同步"通道，极易漏；打包后用 `unzip -l` 验证 APK 内 chunk 名与 dist 一致 |
| APK 白屏报 `Failed to request http://localhost:1420/` | Android APK 安装后白屏，Rust 侧报 devUrl 请求失败 | **`custom-protocol` feature 定义了但未加入 `default`**（`default = []`），手动 `cargo build --release --target aarch64-linux-android` 编译的 .so 处于 dev 模式：不内嵌前端资源，运行时去连 `devUrl`（localhost:1420） | `Cargo.toml` 改为 `default = ["custom-protocol"]`（tauri-build **没有** custom-protocol feature，只有 tauri 主 crate 有，不要误加），重编 .so + 重打 APK | 手动 cargo 编译 Android .so 时必须带 custom-protocol（默认启用最稳）；Windows 走 tauri CLI 会自动加该 feature 所以一直正常，这掩盖了问题；编译后用"二进制内能否搜到前端 chunk 名"验证是否内嵌 |

### 1.2 AI 总结与搜索

| 坑 | 现象 | 根因 | 解决方案 | 经验 |
|---|---|---|---|---|
| AI 搜索总结"生成了却没用" | `triggerSummary` 调了 `getOrCreateSummary`，但 AI 回答仍像没看过题库 | `triggerSummary` 是 fire-and-forget，总结存了缓存但从未传入 AI prompt；`buildKnowledgePrompt` 只做关键词匹配 | 改为 `async` 返回总结内容，`handleSearch` 中 `await` 后传入 `searchKnowledgeAI`，prompt 中总结作为第一优先级注入 | 异步函数如果只"触发"不"消费"等于白做，数据必须沿调用链传到最终使用点 |
| 默认搜索源不含题库 | 知识库 Tab 搜题库问题答非所问 | 默认 `source='knowledge'`，只检索知识库条目 | 默认源改为 `'combined'`（知识库+题库） | 功能默认值要贴合用户预期，知识库 Tab 里用户自然期望能搜到所有内容 |
| 用户题库未被总结 | AI 总结只覆盖系统题库，用户自建题库遗漏 | `getOrCreateSummary` 读取数据时只取了系统题库 | 内部实时读 store 最新数据，`attachCoverage` 标注覆盖范围（题库数/题目数） | 总结类功能必须明确数据来源边界，用覆盖范围标注让用户可验证 |
| 大题库内容截断丢失 | 超 8000 字符的大题库总结内容不全 | AI 单次输入有上限 | `splitUnit` 行级切块，分批 AI 总结后合并，保证不切断单行 | 大文本处理必须考虑 token 上限，行级切块比字符级切块更不容易切断语义 |
| 进度 (1/3) 用户看不懂 | 只显示裸数字，用户多次追问含义 | 进度展示缺乏阶段上下文 | A+B 优化：阶段标识（准备中/分批总结 N/M/合并）+ 进度条 + 直白文案 | 面向非技术用户的进度必须说清"在做什么、做到哪了、还要多久"，裸数字是技术视角 |
| 一篇信息被切块拆分 | 大题库行级切块时完整信息跨两个块 | 切块粒度问题 | 行级切块保证不切断单行，合并阶段去重，`onProgress` 传 `parts.length` | 切块不可避免会拆分内容，必须在合并层去重并向用户说明机制 |
| 准备中"重新生成"可点击 | 总结准备中点击重新生成导致重复请求 | 禁用条件只判断了 `summaryProgress`，准备中（无进度无内容）未覆盖 | 新增 `summaryLoading` derived 变量（弹窗开且无内容无进度），按钮禁用条件改为 `!!summaryProgress \|\| summaryLoading` | 异步操作的按钮禁用要覆盖所有"进行中"状态，包括还没出现进度的准备阶段 |
| 合并文案"完整版"多余 | "正在合并为完整版"中"完整版"三字冗余 | 文案设计问题 | 改为"N 份总结已生成，正在合并..." | UI 文案要克制，去掉不增加信息量的修饰词 |
| AI 搜索回答来源不明 | 知识总结未记录详细参数，用户质疑 AI 如何回答出题内容 | 总结内容与原始题库的关联不透明 | 双通道回答：AI 总结作为参考 + 实时检索题库原文，回答附来源标注 | AI 回答必须可追溯，让用户能验证答案来自哪里 |

### 1.3 动效与弹窗

| 坑 | 现象 | 根因 | 解决方案 | 经验 |
|---|---|---|---|---|
| 侧边栏/消息列表无退出动效 | 打开有过渡，关闭瞬间消失 | `{condition && <Component/>}` 条件渲染，关闭时 React 直接卸载 DOM，CSS transition 来不及执行 | 延迟卸载模式：`open` + `visible` 双状态，关闭时先 `visible=false`，280ms 后再 `open=false` | 需要退出动效的组件不能直接条件渲染，必须用"可见性状态 + 延迟卸载" |
| 弹窗关闭背景骤变 | Profile 弹窗关闭时背景从虚化突然变清晰 | 关闭时未触发背景过渡动画 | `closeModal` 显式关闭 + `animation` 关键帧，背景 opacity 过渡 300ms | 弹窗的进入和退出动效必须对称，不能只做进入不做退出 |
| Profile 弹窗概率闪烁 | 弹窗打开/关闭时有概率闪烁 | 共享 `modalVisible`/`isClosing`/`activeModal` 状态，useEffect 时序竞争 | 重构为独立 `aboutClosing`/`themeClosing` 状态，删除共享状态和 useEffect 时序 | 多个弹窗共享关闭状态是闪烁的温床，每个弹窗应有独立的 closing 状态 |
| 值班表演练弹窗无关闭动效 | 弹窗关闭时直接卸载无动画 | 缺少关闭动画 | 添加 `animation` 关键帧，关闭时先播动画再卸载 | 所有弹窗统一进入+退出动效，避免逐个遗漏 |
| 知识库侧边栏无遮罩 | 侧边栏打开/关闭时背景无遮罩层，视觉不聚焦 | 缺少遮罩层 | 双独立层：全屏 `bg-black/40` 遮罩 + 侧边栏面板，各自 `transition-opacity` 300ms | 侧边栏/抽屉必须有遮罩层，既聚焦视觉又提供点击外部关闭的交互区域 |

### 1.3b 弹窗动效全局排查（v0.3.9）

| 坑 | 现象 | 根因 | 解决方案 | 经验 |
|---|---|---|---|---|
| 推算未来排班弹窗无关闭动效 | 打开有 modal-pop，关闭瞬间消失 | 条件渲染直接卸载，无退场动画 | `forecastClosing` 状态 + `closeForecastModal`（180ms 延迟卸载），关闭动画 `modal-fade-out/modal-pop-out 0.18s ease-in forwards` | 弹窗进出动效必须成对，全局用 Grep 扫 `animation: 'modal-` 逐文件核对关闭逻辑 |
| 值班表删除确认弹窗无关闭动效 | 同上一行，删除弹窗无退场 | 同上 | `deleteClosing` + `closeDeleteModal`，确认删除改为"先执行删除再播退场卸载" | 确认类弹窗的确认动作要在退场动画前完成业务，避免用户看到动画但状态未变 |
| 知识库对话管理弹窗无关闭动效 | 打开有动画，关闭立即卸载 | 同上 | `chatManageClosing` + `closeChatManageModal`（180ms） | 多弹窗页面逐一核对，别只修"最显眼"的那个 |
| 知识总结弹窗无关闭动效（且原本缺开启动效） | 打开关闭都突兀 | 无动画类名 | `summaryClosing` + `closeSummaryModal`，同时补上开启 `modal-fade/modal-pop` | 检查对称性时要双向看：可能连开启动效都缺失 |
| 导入分类选择弹窗无关闭动效 | 选中分类后弹窗直接消失才开文件选择器 | 无退场动画 | `importCategoryClosing` + `closeImportCategoryModal(true)`，退场完成后才触发 `fileRef.click()`（替代原 `setTimeout 50ms`） | 跨弹窗联动动作应挂在退场动画完成后，而不是猜一个 setTimeout |
| "帮我记"转换设置弹窗无关闭动效 | 打开有动画，关闭立即消失 | 同上 | `noteSettingsClosing` + `closeNoteSettingsModal`（180ms），遮罩补 `modal-fade-out` | 同页 4 个弹窗一次修完，避免反复返工 |
| 删除题库确认弹窗完全无动画 | 打开关闭都瞬间出现/消失 | 纯固定层无动画类名 | `deleteModalClosing` + `closeDeleteModal`，补 `modal-fade/modal-pop` 开启动效 + 对称关闭 | 有弹窗就得有进出动效，先扫 `fixed inset-0` 再扫 `animation: 'modal-` |
| 导出总结弹窗完全无动画 | 同上 | 同上 | `exportModalClosing` + `closeExportModal`，`handleExportSummary` finally 中播退场 | 异步完成后关闭的弹窗，退场也要走延迟卸载通道 |

### 1.4 UI 统一与布局

| 坑 | 现象 | 根因 | 解决方案 | 经验 |
|---|---|---|---|---|
| 四个 tab header 不统一 | 高度 36px/44px 不一，字号 text-lg/text-base 不一，标题受按钮宽度影响偏移 | 各页面 header 独立实现，无统一规范 | 统一 `h-12`（48px）高度、`text-base font-semibold` 字号、`absolute left-1/2 -translate-x-1/2` 标题居中、内容区 `paddingTop` 统一 `safeArea.top + 48` | 多页面共享的 UI 元素必须抽统一规范，标题居中用 absolute 不受兄弟元素影响 |
| 窄屏按钮文字竖排 | "添加分类"按钮窄屏文字竖排 | flex 容器中按钮被挤压，未设置 shrink 和 nowrap | 加 `flex-shrink-0 whitespace-nowrap` |  flex 容器中的文字按钮必须防挤压，`whitespace-nowrap` 是底线 |
| 底部导航图标不一致 | 四个 tab 页面底部导航知识库图标不统一 | 各页面独立定义图标 | 统一为 book-open 书图标（Home 两处 + Duty + Profile + KnowledgeBase） | 底部导航是全局组件，图标必须在所有页面保持一致 |
| 值班表页面白边 | 页面边缘填充不完整，有白边 | 主页面 `bg-white` 与内容区背景不一致 | 主页面改 `bg-gray-50`，日历格子改 `bg-white + border` | 页面背景与卡片背景要有层次区分，不能全用同一种白色 |
| 知识库顶部图标不合适 | 原三条杠菜单图标与分类功能不匹配 | 图标语义错误 | 换为分类网格图标（四宫格） | 图标必须准确表达功能，菜单图标不等于分类 |
| 滚动条占位切换抖动 | 首页/值班表内容过长出现垂直滚动条，切换 tab 时挤压抖动 | 滚动条出现/消失导致页面宽度变化 | 全局 `html { scrollbar-gutter: stable; }`，始终预留滚动条位置 | 跨页面布局抖动优先考虑滚动条宽度变化，`scrollbar-gutter` 一行 CSS 解决 |

### 1.5 交互与功能

| 坑 | 现象 | 根因 | 解决方案 | 经验 |
|---|---|---|---|---|
| 搜索框置顶后被遮盖 | 搜索框固定后跟随回答文字向上滚动被遮盖 | 搜索框未脱离文本流 | 搜索框 `fixed` 置顶脱离文本流，不随内容滚动 | fixed 元素必须脱离文档流，否则仍会被内容推动 |
| 切换月份当天名单错位 | 切换日历月份未选日期，当天值班名单月份也变化 | 标题月份从 `viewYear/viewMonth` 读取，而非已选日期 | 改为从 `selectedDateObj` 读取，只有实际选择日期后才更新名单月份 | 显示用的数据必须来自"已确认的选择"，而非"正在浏览的视图" |
| 对话管理功能缺失 | 只有删除当前对话，无法切换多会话、删除指定会话 | 单会话设计 | `chatStore` version 2 多会话重构 + 数据迁移，对话管理弹窗支持切换/删除，本地持久化；图标改为带加号的聊天气泡 | 对话类功能从第一天就应考虑多会话，单会话改多会话需要数据迁移 |
| 综合总结题库列表过长 | 知识总结中题库清单全部展开，占用大量空间 | 无折叠机制 | 装 `rehype-raw`，`MarkdownView` 启用 HTML 解析，`attachCoverage` 改 `details` 折叠框；`SUMMARY_FORMAT_VERSION` 升 3 | 用户基本不看的详细清单默认折叠，用 `details/summary` 原生标签无需额外 JS |

### 1.6 导入与分类

| 坑 | 现象 | 根因 | 解决方案 | 经验 |
|---|---|---|---|---|
| 导入格式杂乱增加总结难度 | 支持 xlsx/xls/json/txt/md，无格式的杂乱内容增加 AI 总结难度 | 导入格式过宽 | 限制为只允许 `.txt` 和 `.md` 导入，文件选择器 `accept=".txt,.md"` | 导入格式要服务于下游功能，AI 总结需要有结构的文本，应限制格式 |
| 导入时无法指定分类 | 导入后用关键词自动分类（`autoDetectCategory`），用户无法手动指定 | 缺少分类选择流程 | 导入流程改为：先弹分类选择弹窗 → 用户选分类或新建 → 再打开文件选择器；导入时用户选的分类覆盖自动分类 | 用户对分类有明确预期时，应提供手动选择，自动分类只能作为兜底 |
| 无分类时无法导入 | 分类选择弹窗如果没有已有分类，用户无法继续 | 缺少新建入口 | 弹窗底部始终有新建分类输入框 + 新建按钮（支持回车）；无分类时中间显示"暂无分类，请新建分类"提示 | 分类选择弹窗必须同时支持"选已有"和"新建"，不能让用户卡在空状态 |
| 选分类后触发文件选择时序问题 | 选分类后立即 `fileRef.click()` 可能读不到最新分类 | `setState` 异步 | 用 `useRef`（`pendingImportCategoryRef`）传递分类，设置后立即生效；`setTimeout 50ms` 后触发文件选择确保弹窗关闭 | 跨异步操作传递即时数据用 `useRef` 比 `useState` 可靠 |
| 侧边栏空状态提示误导 | "暂无分类，导入知识内容后自动按专业领域分类"暗示有自动分类功能，实际不存在 | 文案承诺了不存在的功能 | 改为"暂无内容"，居中显示，不做功能承诺 | UI 文案不能承诺不存在的功能，误导比空白更糟 |

---

## 二、功能更新记录

### 2.1 AI 总结与搜索

- 知识库 AI 总结覆盖全部题库（含用户自建题库），`getOrCreateSummary` 内部实时读 store 最新数据
- 大题库分批 AI 总结：`splitUnit` 行级切块，超 8000 字符切碎，内容零丢失
- 总结覆盖范围标注：`attachCoverage` 标注覆盖题库数、题目数、知识库篇数
- 知识总结弹窗添加"重新生成"按钮，准备中和总结中均禁用
- 进度显示优化：阶段标识（准备中/分批总结 N/M/合并）+ 进度条 + 直白文案，替代裸数字 (1/3)
- 合并阶段文案去掉"完整版"，改为"N 份总结已生成，正在合并..."
- AI 搜索双通道回答：知识总结作为参考 + 实时检索题库原文，回答附来源标注
- 综合总结题库列表可折叠：`details/summary` 折叠框，summary 左右分布（左生成时间，右 N 知识库/M 题库），展开后显示覆盖范围和题库清单
- `SUMMARY_FORMAT_VERSION` 升 3，旧总结自动重新生成
- 默认搜索源改为 `combined`（知识库+题库），总结内容作为 prompt 第一优先级注入

### 2.2 Markdown 渲染

- 知识库和总结弹窗适配 Markdown 格式显示：`react-markdown` + `remark-gfm` + `rehype-raw`
- 新增 `MarkdownView` 组件，`.markdown-body` 全套样式
- 支持 HTML 解析（折叠框 `details/summary` 依赖）

### 2.3 动效与弹窗

- 左侧分类抽屉滑入滑出（translate-x）+ 淡入淡出（opacity），延迟卸载
- 对话记录清空淡出 + 上移动效，300ms 后清空
- Profile 弹窗关闭背景渐变：`closeModal` 显式关闭 + `animation` 关键帧
- Profile 弹窗闪烁修复：重构为独立 `aboutClosing`/`themeClosing` 状态
- 值班表演练名称弹窗添加关闭动效
- 知识库侧边栏双独立层遮罩：全屏 `bg-black/40` 遮罩 + 侧边栏面板

### 2.3b 弹窗动效全局排查（v0.3.9）

- 8 处弹窗补齐对称关闭动效（`modal-fade-out/modal-pop-out 0.18s ease-in forwards` + 180ms 延迟卸载），全部替换遮罩/取消/确认关闭入口：
  - `DutySchedule.tsx`：推算未来排班弹窗（`forecastClosing`）、删除确认弹窗（`deleteClosing`）
  - `KnowledgeBase.tsx`：对话管理（`chatManageClosing`）、知识总结（`summaryClosing`，补开启动效）、导入分类选择（`importCategoryClosing`，退场后才开文件选择器）、"帮我记"转换设置（`noteSettingsClosing`）
  - `ManageBanks.tsx`：删除确认弹窗（`deleteModalClosing`，补开启动效）、导出总结弹窗（`exportModalClosing`，补开启动效）
- 已确认进出对称无需处理：值班表添加/导入弹窗（`isClosing`）、演练名称弹窗（`drillClosing`）、知识库左右侧边栏（双 rAF + 280ms）、Profile 关于/主题弹窗、Home 添加题库弹窗、Settings 模型选择弹窗、ImageViewer（`isVisible/isClosing`）、ConfirmDialog、ConfirmModal/ExitConfirmModal/ResumePromptModal（`visible` + 300ms）

### 2.4 UI 统一与布局

- 四个 tab 顶部 header 统一：`h-12` 高度、`text-base font-semibold` 字号、`absolute` 居中标题、内容区 `paddingTop` 统一 `safeArea.top + 48`
- 知识库顶部图标换为分类网格图标（四宫格）
- "添加分类"按钮窄屏文字横向显示（`flex-shrink-0 whitespace-nowrap`）
- 底部导航知识库 tab 四页面统一为 book-open 书图标
- 值班表页面白边修复：主页面 `bg-gray-50`，日历格子 `bg-white + border`
- 全局 `scrollbar-gutter: stable`，解决滚动条占位导致切换页面抖动

### 2.5 交互优化

- AI 搜索框 `fixed` 置顶脱离文本流，不随回答文字滚动被遮盖
- 对话管理：多会话切换/删除，`chatStore` version 2 + 数据迁移，本地持久化；右上角图标改为带加号的聊天气泡
- 值班表切换月份时当天值班名单月份错位修复：标题从 `selectedDateObj` 读取
- 综合总结题库列表折叠，减少占用空间

### 2.6 导入与分类管理

- 导入文件类型限制为只允许 `.txt` 和 `.md`，避免无格式杂乱内容
- 导入流程改为先选分类再选文件：分类选择弹窗列出已有分类，选中后自动打开文件选择器
- 无分类时提供新建分类按钮：弹窗底部输入框 + 新建按钮（支持回车），无分类时显示提示
- 导入时用户选择的分类优先覆盖文件解析时的关键词自动分类
- 侧边栏空状态提示改为"暂无内容"，居中显示
- 用 `useRef` 传递分类避免异步 state 时序问题

### 2.7 打包产物

| 平台 | 产物 |
|------|------|
| Windows | 答题测试库_0.3.9_x64-setup.exe（NSIS 安装包）+ Answer_Test.exe（绿色版，版本资源 0.3.9） |
| Android arm64 | Answer_Test_v0.3.9-arm64-release.apk（本轮仅产出 arm64） |

### 2.8 版本号与构建（v0.3.9）

- 版本号统一升级 0.3.8 → 0.3.9：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/gen/android/app/tauri.properties`（versionName）
- Android 构建号（versionCode）3008 → 20260908
- **关于弹窗版本显示修正**：`src/pages/Profile.tsx` 的 `currentVersion` 与 `src/utils/updater.ts` 的 `currentVersion`（更新检查用）均硬编码，同步改为 `'0.3.9'`；`updater.ts` 的 `CURRENT_VERSION_HASH` 同步为 `'20260908'`（关于弹窗显示"版本 0.3.9 / 构建 20260908"）
- 构建方式：Android 仅编 **arm64-v8a**（`cargo build --release --target aarch64-linux-android` + `gradlew assembleArm64Release`），Windows 走 `npm run tauri:build`（先杀 Answer_Test 进程）
- **修复**：Android APK 前端资源过期——同步 `dist/` 到 `gen/android/app/src/main/assets/` 后重打 APK（arm64 APK 已验证内嵌 `KnowledgeBase-DwGotwVd` + 入口 `index-B7eYLyhm`，旧 chunk 已清除）
- **修复（关键）**：APK 白屏 `Failed to request http://localhost:1420/`——`Cargo.toml` 的 `default = ["custom-protocol"]` 启用内嵌资源模式，重编 .so（验证 .so 内可搜到 chunk 字符串）后重打 APK
- 产物验证：EXE 内嵌最新 chunk `KnowledgeBase-DwGotwVd`，EXE/NSIS PE 版本资源 0.3.9，APK 文件名 v0.3.9 且时间戳为本轮

---

## 三、修改文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/pages/KnowledgeBase.tsx` | 大改 | 动效、AI 搜索、总结弹窗、折叠框、header 统一、导入分类选择、滚动条 |
| `src/pages/Home.tsx` | 修改 | header 统一、底部导航书图标 |
| `src/pages/DutySchedule.tsx` | 修改 | header 统一、白边修复、月份错位修复 |
| `src/pages/Profile.tsx` | 修改 | header 统一、弹窗独立 closing 状态重构 |
| `src/utils/knowledgeSummary.ts` | 大改 | 分批总结、实时读 store、attachCoverage 折叠框、SUMMARY_FORMAT_VERSION 3 |
| `src/utils/knowledgeAI.ts` | 修改 | prompt 支持 summary 参数并优先注入 |
| `src/utils/knowledgeParser.ts` | 修改 | 行级切块、自动分类 |
| `src/components/MarkdownView.tsx` | 新增 | react-markdown + remark-gfm + rehype-raw |
| `src/store/chatStore.ts` | 重构 | 多会话 version 2 + 数据迁移 |
| `src/store/knowledgeStore.ts` | 修改 | 分类管理、导入 |
| `src/index.css` | 修改 | markdown-body 样式、折叠框样式、scrollbar-gutter |
| `package.json` | 修改 | 新增 react-markdown、remark-gfm、rehype-raw 依赖 |
| `src/pages/DutySchedule.tsx` | 修改（v0.3.9） | 推算排班/删除确认弹窗对称关闭动效（forecastClosing/deleteClosing） |
| `src/pages/KnowledgeBase.tsx` | 修改（v0.3.9） | 对话管理/知识总结/导入分类/转换设置 4 弹窗对称动效 |
| `src/pages/ManageBanks.tsx` | 修改（v0.3.9） | 删除确认/导出总结弹窗进出动效 |
| `src-tauri/Cargo.toml` | 修改（v0.3.9） | 版本 0.3.9 + `[patch.crates-io] indexmap` 指向 vendor |
| `src-tauri/vendor/indexmap-1.9.3/` | 新增（v0.3.9） | indexmap 本地 vendor 副本（build.rs 静态 has_std，去 autocfg） |
| `src-tauri/tauri.conf.json` | 修改（v0.3.9） | 版本 0.3.9 |
| `src-tauri/gen/android/app/tauri.properties` | 修改（v0.3.9） | versionName 0.3.9、versionCode 20260908 |

---

## 四、后续待办

- [ ] 真正的 AI 自动分类：导入后 AI 自动建议分类标签（当前需手动选）
- [ ] 知识总结增量更新：修改题库后只总结变更部分（当前全量重生成）
- [ ] 导入进度提示：大文件导入时无进度反馈，可添加解析进度条
- [ ] 知识库分类拖拽排序：当前按字母排序，可支持手动拖拽调整
- [ ] 总结缓存失效策略优化：新增题库后自动触发重生成
- [ ] APK 签名 keystore 规范化（消除签名验证警告）
- [ ] 搜索框键盘快捷键
- [ ] 持久化 Android 构建环境变量：把 NDK 工具链环境写成脚本，避免每次构建手动注入
- [ ] 评估升级 ring 版本或配置，彻底消除 armv7 汇编对 CC 环境变量的依赖
