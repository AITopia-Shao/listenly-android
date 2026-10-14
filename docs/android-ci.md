# Android 云端兼容性测试

`.github/workflows/android-compatibility.yml` 在 GitHub 托管的 Ubuntu 24.04 上构建并安装测试 APK，分别检查 Android 8.0 / 11 / 16（API 26 / 30 / 36）。手动运行方式：仓库 → Actions → Android compatibility → Run workflow。源码更新和 Pull Request 也会触发。

测试要求仓库已启用 Actions，允许固定提交的官方 GitHub Actions、`android-actions/setup-android` 和 `ReactiveCircus/android-emulator-runner`，运行器能访问 Google Android SDK 下载地址并使用 `/dev/kvm`。不需要 API 密钥、GitHub Secrets 或发布签名。工作流只有读取源码的权限。

工作流显式创建独立的 SDK 目录，并使用固定提交的 SDK 初始化 Action 安装 Google command-line tools 20.0（14742923）及构建包，将 `sdkmanager` / `avdmanager` / `adb` 加入 PATH。`ANDROID_HOME` 与 `ANDROID_SDK_ROOT` 设置为同一目录，直接构建器和模拟器 Action 共用它；不会依赖 Ubuntu 镜像碰巧预装或暴露 `sdkmanager`。路径和版本记录在 `sdk-environment.log`。

模拟器使用 Pixel 7 的现代竖屏比例、3 GiB 内存和 6 GiB 数据分区。模拟器首次启动 API ≥24 时会将数据分区提升到至少 6 GiB，并检查 1.2 倍可用空间，因此仅设置较小分区不能解决磁盘不足。工作流只在一次性的 GitHub 托管运行器中、确认当前 SDK 使用独立临时目录后，移除未使用的官方预装 SDK；路径必须准确等于 `/usr/local/lib/android/sdk`，否则中止。它不会清理本机或自托管运行器。启动前打印空间并要求至少 8 GiB 可用；KVM 配置等待 udev 生效，再确认设备权限。环境检查失败不会计为应用通过。

空间规则依据[官方模拟器启动源码](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp)，预装 SDK 路径依据[GitHub Ubuntu 24.04 运行器清单](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#android)。

构建直接使用 JDK 21 与官方 SDK 36 / Build Tools 36.0.0 的 AAPT2、javac、D8、zipalign、apksigner，不依赖当前 Gradle 插件下载。`minSdk`、`targetSdk` 和应用版本从工程文件读取；目前保持 API 26 / 37。使用 SDK 36 编译与面向 API 37 是明确的构建选择，并不作为闪退修复结论。

每台模拟器都会真正安装、启动 APK，检查进程仍存活、主页渲染、安卓原生资源拦截、音频解码、触摸播放、两种模式进度对齐和互动答题。结果不能只凭签名或 ZIP 检查判定通过。工作流不更新模拟器的系统 WebView；旧 WebView 的解析或行为问题会直接使测试失败。

API 26 / 30 使用 Google APIs 镜像，API 36 使用已在本地实际验证的 AOSP 镜像与内置系统 WebView。Android 16 的 Google 镜像曾出现系统界面、壁纸和输入法进程无响应，遮挡实际触摸；本应用完全离线，不依赖 Google Play 服务。测试在 Android 16 启动后等待系统稳定；若出现明确的 System UI 无响应对话框，会保留截图和 XML、点击“Wait”并要求恢复后才继续真实触摸。其他应用无响应仍使测试失败，播放和答题断言保持不变。

每次运行会保存 APK、构建日志、`result.json`、屏幕截图、crash buffer 和 logcat。失败也上传已经产生的证据，在 Actions 页面的 Artifacts 下载 `listenly-android-api-26/30/36-*`。若模拟器未能启动，APK 和构建日志仍会保留；不会把基础设施失败误报为应用通过。

1.0.4 起，各系统还执行三轮暂停续播、主页返回后重开、自然结束后重播、前后定位与两种模式往返，使用实际触摸和真实媒体时间前进。两轮音频 Range 请求逐一比较原始 APK 字节的长度及 SHA-256，已有答案和导入清单保持不变；Java 流契约测试检查 74 项边界。单篇合成音夹具不计为跨文章或英语句循环验证；这些场景由本地实际六级音频及浏览器原创示例回归另行覆盖。详见 [重复播放验收](audio-replay.md)。

## 测试 APK 和上传范围

云端 APK 仅包含源码和在运行时程序生成的原创 24 秒 PCM 测试音。界面明确标注该文件为测试夹具、非英语朗读、非六级真题，真实试卷列表为空。真题录音、试卷、原始下载、用户导入文件和本地安装签名不用于云端测试。

CI 使用临时生成的测试签名，无法覆盖安装本机签名的完整版或轻量版。**不要将云端夹具 APK 当作用户更新包安装。** 真机修复安装包仍使用本地原签名构建，保留已有学习记录。

公开仓库包含应用源码、标准 Gradle 工程、构建与测试脚本，以及 `examples/demo/` 内的原创朗读示例。`.build/`、`dist/`、任何 keystore、`materials/`、生产目录 `assets/web/media/` 和真实 `bundled-library.json` 均被忽略。工作流先构建兼容旧版 WebView 的前端，再由脚本生成独立资产。

另一个 `demo` 任务从公开源码构建原创英语演示测试 APK，校验两篇原文、录音和时间戳，再用 Chromium 测试播放、三种文本显示、模式对齐、评分、文件夹导入、重启恢复及四种屏幕宽度。该包也使用临时签名，仅供测试；Release 安装包在本机构建，沿用项目原签名，密钥不上传。

该任务另执行 `npm run test:replay`，检查真实结束后重播、完成后回文章、导入音频恢复、一次媒体读取错误后的重试及正常取消。测试证据位于 `.build/replay-browser/latest/result.json`。

1.0.5 增加 `npm run test:experience`，用真实点击检查首页播放、播放中切换主题、主题重载、收藏取消、默认精听／隐藏、实际提交与重做更新日历以及减少动画偏好。每台 Android 模拟器的实装检查也增加首页播放、主题记忆和收藏图案检查。活动统计模块与其他必需资产一起进入构建白名单，额外或缺少的资源仍使构建失败。

本地复现构建：

```bash
npm ci --no-audit --no-fund
npm run build:web
python3 tools/prepare-ci-assets.py
python3 tools/build-apk-ci.py --sdk "$ANDROID_HOME" --java-home "$JAVA_HOME"
node tools/android-smoke.mjs emulator-5554 dist/listenly-ci-fixture.apk local-ci
```

Windows 可用 `python`，并通过 `--sdk` / `--java-home` 指定本地 SDK 与 JDK；脚本不会读取 `.build/android/debug.keystore`。模拟器结果只证明所测试系统镜像上的行为，仍需 realme GT7 / realme UI 7.0 真机验证 OEM 行为。

可选恢复检查：先在本项目 `Listenly_` 前缀的 AVD 完成一次有答案记录的正常练习，再执行 `node tools/android-recovery-smoke.mjs emulator-5580 renderer-recovery`。脚本验证虚拟设备和 AVD 名后，主动使渲染进程退出，检查应用进程、原生诊断、触摸重试和原有答案；该测试的渲染进程崩溃日志属于故障注入结果。

工具依据：[Android D8](https://developer.android.com/tools/d8)、[AAPT2](https://developer.android.com/tools/aapt2)、[zipalign](https://developer.android.com/tools/zipalign)、[SDK 初始化 Action 源码](https://github.com/android-actions/setup-android/blob/be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd/src/main.ts)、[模拟器 SDK 安装源码](https://github.com/ReactiveCircus/android-emulator-runner/blob/a421e43855164a8197daf9d8d40fe71c6996bb0d/src/sdk-installer.ts)、[GitHub 固定 Action 提交的建议](https://docs.github.com/en/actions/reference/security/secure-use)。
