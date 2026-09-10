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

### 2.9 首页胶囊 + 全局毛玻璃（仅保留沉浸式）

- 首页题库选择移入 Hero 问候语"夜深了，今天想学点什么？"下方的椭圆胶囊（`im-hero-chip`）：胶囊内显示题库图标、名称（超长截断）、总题数，多题库时显示下拉箭头（展开后 rotate-180）
- 点击胶囊展开题库列表面板（`bg-white/95 dark:bg-gray-800/95 + backdrop-blur rounded-2xl`），面板顶部保留当前题库描述（`currentBank.description`，浅色 `bg-gray-50/80` / 深色 `dark:bg-gray-700/40`），下方题库列表 max-h-52 可滚动；无题库时胶囊显示"添加题库"
- **删除经典版布局，仅保留沉浸式**：
  - `themeStore.ts`：删除 `getStoredThemeStyle`；`initTheme` 强制 `'immersive'`，忽略旧 localStorage 中的 `theme-style: 'classic'`（老用户自动归一沉浸式）
  - `Profile.tsx`：删除"布局风格"选择区块与 `setThemeStyle` 解构（主题弹窗仅保留深浅色/跟随系统）
- 全局毛玻璃统一（`index.css` 7 处替换，选择器 `[data-theme="immersive"]` 全局生效）：
  - `.bg-white` → `rgba(255,255,255,0.72) + backdrop-filter blur(18px) saturate(160%)`
  - `.dark\:bg-gray-800` → `rgba(23,33,60,0.66)`（blur18）、`.dark\:bg-gray-700` → `rgba(30,41,59,0.7)`（blur16）
  - `.im-mode-card`/`.im-bank-card` 及 dark 版 → 半透明毛玻璃（浅色 0.75 + blur18 / 深色 0.66）
  - header 蓝渐变、底部浮动胶囊导航（blur22）、统计卡（blur14）、弹窗遮罩/本体、关于卡、日志面板原本已有毛玻璃，保持一致
- 深浅色适配：胶囊与展开面板均提供 `dark:` 变体，深色模式背景为半透明深蓝灰

### 2.10 双端打包与 .so 验证（本轮）

- 前端构建新 chunk：`index-c5Qy8OCF.js` / `Profile-D7AUWoJ8.js` / `Settings-D9vD85PK.js` / `index-CvoM7VXf.css`
- Windows：`npm run tauri:build`（先 taskkill Answer_Test.exe）→ `Answer_Test.exe`（12.4MB）+ `答题测试库_0.3.9_x64-setup.exe`（6.2MB）
- Android：timestamp 触发重编 .so（`cargo build --release --target aarch64-linux-android`）→ 覆盖 `jniLibs/arm64-v8a/` → 重建 assets（index.html + assets/ + banks/ 三部分分别拷贝）→ `gradlew clean assembleArm64Release`
- 验证：.so 内可搜到 `index-c5Qy8OCF.js`，APK 内解出 `lib/arm64-v8a/libanswer_test_lib.so` 同样命中新 chunk；APK 16.4MB

### 2.11 首页题库选择折叠面板重做（渐变突变/动画/毛玻璃/文字显示）

- **渐变背景突然变化的根因**：展开面板原来放在 Hero（`.im-hero`，CSS `overflow: hidden`）内部文档流中，点击胶囊后面板撑高 Hero，而 Hero 的 `linear-gradient` 是按容器尺寸计算的 → 高度变化导致渐变重绘，视觉上"背景突然变化"；同时面板被 `overflow: hidden` 裁剪，列表后半部分显示不全（看起来像被滚动截断）
- **修复方案**：面板改为 `absolute left-0 right-0 top-full mt-2`（相对 Hero 定位的浮层），Hero 移除 `overflow: hidden` → Hero 高度恒定、渐变不再重绘、面板不被裁剪、下方内容不再被挤压
- **进出动画**：新增 `bankListClosing` 状态，关闭时先播 `kb-panel-out 0.18s ease-in`（opacity + translateY + scale）再 180ms 延迟卸载；打开时 `kb-panel-in 0.22s cubic-bezier(0.22,1,0.36,1)`；点击胶囊或面板外透明遮罩（`fixed inset-0 z-10`，胶囊 `z-20`）触发关闭
- **面板毛玻璃（去"死气"）**：新增 `.im-bank-panel` 类，浅色 `rgba(255,255,255,0.72)+blur(24px) saturate(170%)`，深色 `rgba(23,33,60,0.66)`，替代原来 95% 不透明的 `bg-white/95 dark:bg-gray-800/95`（后者还因类名带 /95 不命中全局毛玻璃选择器，深色下尤其死板）；描述区背景同步半透明化
- **文字显示不全（不用滚动）**：胶囊名称去掉 `truncate max-w-[150px]` 截断，改 `min-w-0 break-words leading-snug` 完整换行显示；列表项名称同样 `break-words`；题库列表移除 `max-h-52 overflow-y-auto` 滚动，全部显示
- 统计卡 `im-stat-card` 0.92 → 0.78 更通透；胶囊背景 `blur(8px)` → `blur(12px) saturate(150%)`
- **踩坑**：手写 CSS 选择器引用 Tailwind 类名时斜杠/冒号必须转义（`.bg-gray-50\/80`、`.dark\:bg-gray-700\/40`），未转义会导致 PostCSS "Unexpected '/'" 构建失败；JS 字符串里写转义要用 `\\/` 才能落盘为 `\/`

- **修复（层级）**：面板浮层最初未设 z-index（z-auto），被"点击面板外关闭"用的透明遮罩 `fixed inset-0 z-10` 盖住 → 点面板 = 点到遮罩 = 关闭，选不中题库；面板补 `z-20`（与胶囊同层，高于遮罩）后点击正常

- **修复（滚动条占位挤压）**：此前为消除切换 tab 抖动给 `html` 加 `scrollbar-gutter: stable`，副作用是内容不足一屏的页面也常年被滚动条占位挤压；现移除该规则，滚动条改为 6px 细样式按需出现（内容短无占位，内容长仅 6px 宽度变化，抖动可忽略）
- **修复（题库选择框过高）**：上一轮按"不滚动、全部显示"去掉列表限高后，题库多时面板过高；现改为 `max-h-[60vh] + overflow-y-auto` 限高（描述区保留、列表内部滚动），面板内滚动条 4px 半透明细样式

- **微调**：面板限高再收紧一个条目高度（104px → 152px，少显示一行列表项）
- **修复（面板遮挡底部导航）**：60vh 限高在 Hero 位于屏幕上中部时仍会覆盖到底部导航；改为精确公式 `max-height: calc(100vh - 100% - 104px)`（100% = Hero 高度，104px = 底部导航 + 安全区 + 间距），面板改为纵向 flex，描述区固定、列表区 `flex-1 min-h-0 overflow-y-auto` 占剩余高度滚动，面板底部永远停在导航上方

### 2.12 双端打包与 .so 验证（本轮）

- 前端构建新 chunk：`index-DEPaXtNs.js` / `Profile-Bd3wnI34.js` / `Settings-fudS1xnS.js` / `index-BeeD-KXu.css`
- Windows：`npm run tauri:build`（先 taskkill）→ `Answer_Test.exe`（12.4MB）+ NSIS 安装包（6.2MB）
- Android：重编 .so → 覆盖 jniLibs → 重建 assets → `gradlew clean assembleArm64Release`；.so 与 APK 内 `lib/arm64-v8a/libanswer_test_lib.so` 均验证命中 `index-DEPaXtNs.js`；APK 16.4MB

### 2.13 全站弹窗统一 Modal 封装（毛玻璃 + 进出渐变）

- **需求**：所有弹窗统一为"关于"页面同款效果——背景虚化有渐变（淡入/淡出），本体毛玻璃，用封装方式供全站统一调用。
- **新增统一组件** `src/components/Modal.tsx`：内部管理 visible/closing，遮罩动画 `modal-fade/modal-fade-out`，卡片动画 `modal-pop/modal-pop-out`；props：`open / onClose / children / className / containerClassName / zIndex(默认50) / overlayClose(默认true) / duration(默认220ms)`。
- **CSS** `src/index.css` 新增 `.app-modal-overlay`（rgba(0,0,0,.45) + blur(14px) saturate(130%)）与 `.app-modal-card`（浅色 rgba(255,255,255,.74) blur(26px) saturate(170%)，深色 `.dark .app-modal-card` rgba(23,33,60,.66)），插入到"关于弹窗信息卡片 毛玻璃"注释前。
- **替换范围（共 22 处旧弹窗）**：
  - `Home.tsx`：添加题库弹窗（5 处，删除 modalVisible/isClosing 状态与 useEffect）
  - `Profile.tsx`：关于/主题弹窗（7 处，删除 aboutClosing/themeClosing，closeModal 简化）
  - `ManageBanks.tsx`：删除确认/导出总结弹窗（删除 deleteModalClosing/exportModalClosing + 180ms setTimeout）
  - `Settings.tsx`：模型选择弹窗（删除 modelModalVisible 动画 effect + handleCloseModelModal/handleSelectModelWithClose 简化）
  - `KnowledgeBase.tsx`：对话管理（items-end 底部弹层用 containerClassName="items-end sm:items-center" 覆盖）、知识总结（原 safeArea.top+44 偏移改 className mt-12）、导入分类、帮我记转换设置（zIndex=60）
  - `DutySchedule.tsx`：添加/导入（原 isClosing transition 方式）、推算排班、演练名称（zIndex=60）、删除确认；并删除页面内联 `<style>` 里与全局同名的 modal-fade/modal-pop keyframes
  - `ConfirmModal.tsx` / `ExitConfirmModal.tsx` / `ResumePromptModal.tsx`：重写为内部 `open` state + Modal（挂载即显示，按钮触发关闭动画后 240ms 回调，overlayClose=false）
  - `ConfirmDialog.tsx`：重写为 open prop 直接驱动 Modal（zIndex=70），删除 closing state
- **保留不接 Modal**：KnowledgeBase 两个抽屉侧边栏遮罩（558/903，transition-opacity 抽屉遮罩，非弹窗）、Home 下拉关闭遮罩（170）、ImageViewer 全屏图片查看器（z-[100]，带手势缩放/拖拽/滑动与独立背景渐变，套 Modal 会破坏手势）。
- **踩坑**：
  1. **CRLF + 尾随空格**：Home 的 `bg-white `（`<div `）行带尾随空格，node 脚本第一次替换 MISS——必须在脚本里先 `file.replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'')` 规范化，写回时再 `.replace(/\n/g,'\r\n')`。
  2. **JS 模板字符串内嵌反引号**：Settings/DutySchedule 弹窗 open 的 className 是模板字符串（`${...}`），直接写进 JS 模板字符串导致 SyntaxError missing ) after argument list——改为普通字符串拼接 + 反引号转义。
  3. **替换后多出卡片闭合标签**：开头把卡片 `<div>` 换成 `<Modal>` 后，结尾原有的卡片 `</div>` 变多余（TS 报 'Modal' has no corresponding closing tag / ')' expected）——需同步删除卡片 close，仅保留内容区 close + `</Modal>`。
  4. **残留 state 引用**：DutySchedule DrillMarquee onClick 里残留 `setDrillClosing(false);`（TS2304）——替换弹窗后需全文件搜索删除所有 closing 相关 setter 引用。
  5. **ManageBanks 弹窗 `<div ` 尾随空格**：删除确认弹窗的开头两个 `<div` 带尾随空格，norm 后必须用无空格版本匹配。
### 2.14 UI 修复（侧边栏按钮溢出 + 浅色模式 header 文字）

- **知识库内容分类侧边栏"添加"按钮溢出被截断**：侧边栏 `w-64 + overflow-hidden`，底部 `flex gap-2` 中 `<input>` 有默认 `min-width:auto`（基于 size=20 约 160-180px），`flex-1` 无法收缩，把"添加"按钮挤出右边界被裁剪。修复：input className 加 `min-w-0`（`KnowledgeBase.tsx` 658 行）。
- **浅色模式沉浸式 header 蓝色背景上黑色字体看不清**：`index.css` 中 `[data-theme="immersive"] header` 用 `!important` 把所有页面 header 背景统一为蓝色渐变+毛玻璃，但未设置文字颜色。知识库/值班表 header 的 `<h1>` 用了 `text-gray-800 dark:text-white`（浅色模式黑色），子元素自身 color 覆盖了父元素继承的白色。修复：
  1. `[data-theme="immersive"] header` 加 `color: #fff !important;`
  2. 新增 `[data-theme="immersive"] header * { color: inherit !important; }`，强制所有子元素（h1/按钮/svg）继承白色
- **踩坑**：color 是继承属性，但子元素直接设置 color（如 `.text-gray-800`）会覆盖父元素继承——仅给 header 设 color 不够，必须用 `header * { color: inherit !important }` 穿透子元素。

### 2.15 知识总结进度全面优化（全局 store + 后台不中断 + 旧文档可查看 + 滚动位置记忆）

- **需求**：①关闭弹窗/切换 tab 不中断生成，重新打开恢复进度/文档；②重新生成期间可查看旧文档，按钮在"查看进度"/"查看文档"间切换；③切份完成后立即显示进度，不等第一块 AI 总结；④点击重新生成立即显示进度动画；⑤文档滚动位置全局记录。
- **新增全局 store** `src/store/knowledgeSummaryStore.ts`（zustand，不 persist）：`summaryContent / summaryProgress / summaryViewMode('content'|'progress') / summaryRunning / summaryScrollTop` 及对应 setter + `resetSummary`。目的：切换 tab 卸载 KnowledgeBase 组件时，async 生成任务通过闭包引用 store setState 继续执行，状态不丢失。
- **`KnowledgeBase.tsx` 重构**：
  - 移除本地 `summaryContent/summaryProgress/summaryRunningRef` state，改为从全局 store 读取；`summaryOpen`（弹窗显示）保留本地。
  - `handleViewSummary`：打开弹窗不清空状态，已有文档/进度直接显示；都没有且未运行才开始生成；立即设置初始进度 `{done:0,total:0,phase:'summarize'}` 并切换 `viewMode='progress'`，避免"准备中"过久。
  - `handleRegenerateSummary`：保留旧文档（不清空 summaryContent），立即设置初始进度 + 切换进度视图；生成中按钮点击切换 `viewMode`（content↔progress），不再禁用。
  - 新增 `summaryScrollRef` + `useEffect([summaryOpen])`：弹窗打开时恢复 `summaryScrollTop`；滚动区域 `onScroll` 实时写入全局 store；重新生成时重置 `scrollTop=0`。
- **`knowledgeSummary.ts` 进度回调提前**：`aiSummarize` 中 `chunkRawText(rawText)` 切分完成后**立即调用** `onProgress(0, chunks.length, 'summarize')`，显示"内容已分为 N 份，即将开始总结..."。之前要等第一块 AI 总结完成（数秒到数十秒）才回调，用户长时间看到"准备中..."。
- **进度文案新增 `total===0` 分支**："正在分析内容..."（切分前的初始状态）。
- **重新生成图标方向**：刷新图标从逆时针（↺）改为顺时针（↻），SVG 加 `-scale-x-100` 水平翻转；生成中 `animate-spin` 与顺时针箭头方向一致。
- **版本号 0.3.9 → 0.4.0，构建号 20260908 → 20260910**（全文件更新，见 2.16）。

### 2.16 版本号与构建号全文件更新（v0.4.0 / 20260910）

- **版本号 0.4.0（共 9 处）**：`package.json`、`package-lock.json`（根版本第3行 + packages[""]第9行，第三方包如 traverse 0.3.9 不改）、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（Answer_Test 包版本，第三方依赖不改）、`src-tauri/tauri.conf.json`、`src/utils/updater.ts`（`currentVersion`）、`src/pages/Profile.tsx`（`currentVersion`，关于弹窗显示）、`src-tauri/gen/android/app/tauri.properties`（versionName）。
- **构建号 20260910（共 2 处）**：`src/utils/updater.ts`（`CURRENT_VERSION_HASH`，关于弹窗构建号 + 更新检查）、`src-tauri/gen/android/app/tauri.properties`（versionCode）。
- **关于弹窗显示**：Profile.tsx 导入 `CURRENT_VERSION_HASH`，显示"版本 0.4.0 / 构建 20260910"。
- **踩坑**：批量替换脚本中 package-lock.json 的 name 是大写 `Answer_Test`（不是小写 answer_test），匹配失败导致脚本提前 exit，后续文件未修改——需分两批执行，或用按行号精确替换根版本。

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
