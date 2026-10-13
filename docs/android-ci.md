# Android 云端兼容性测试

`.github/workflows/android-compatibility.yml` 在 GitHub 托管的 Ubuntu 24.04 上构建并安装测试 APK，分别检查 Android 8.0 / 11 / 16（API 26 / 30 / 36）。手动运行方式：仓库 → Actions → Android compatibility → Run workflow。源码更新和 Pull Request 也会触发。

测试要求仓库已启用 Actions，允许固定提交的官方 GitHub Actions 和 `ReactiveCircus/android-emulator-runner`，运行器能访问 Google Android SDK 下载地址并使用 `/dev/kvm`。不需要 API 密钥、GitHub Secrets 或发布签名。工作流只有读取源码的权限。

构建直接使用 JDK 21 与官方 SDK 36 / Build Tools 36.0.0 的 AAPT2、javac、D8、zipalign、apksigner，不依赖当前 Gradle 插件下载。`minSdk`、`targetSdk` 和应用版本从工程文件读取；目前保持 API 26 / 37。使用 SDK 36 编译与面向 API 37 是明确的构建选择，并不作为闪退修复结论。

每台模拟器都会真正安装、启动 APK，检查进程仍存活、主页渲染、安卓原生资源拦截、音频解码、触摸播放、两种模式进度对齐和互动答题。结果不能只凭签名或 ZIP 检查判定通过。工作流不更新模拟器的系统 WebView；旧 WebView 的解析或行为问题会直接使测试失败。

每次运行会保存 APK、构建日志、`result.json`、屏幕截图、crash buffer 和 logcat。失败也上传已经产生的证据，在 Actions 页面的 Artifacts 下载 `listenly-android-api-26/30/36-*`。若模拟器未能启动，APK 和构建日志仍会保留；不会把基础设施失败误报为应用通过。

## 测试 APK 和上传范围

云端 APK 仅包含源码和在运行时程序生成的原创 24 秒 PCM 测试音。界面明确标注该文件为测试夹具、非英语朗读、非六级真题，真实试卷列表为空。真题录音、试卷、原始下载、用户导入文件和本地安装签名不用于云端测试。

CI 使用临时生成的测试签名，无法覆盖安装本机签名的完整版或轻量版。**不要将云端夹具 APK 当作用户更新包安装。** 真机修复安装包仍使用本地原签名构建，保留已有学习记录。

上传源码时，只需 `.github/workflows/android-compatibility.yml`、`app/build.gradle`、`app/src/main/AndroidManifest.xml`、`app/src/main/java/`、`app/src/main/res/`、`app/src/main/assets/web/` 中的 `.html/.js/.css` 模块、`package.json` / `package-lock.json`、`tools/build-web-compat.mjs`、`tools/android-smoke.mjs`、两个 CI Python 脚本以及 `tests/alignment.test.mjs` / `tests/importer.test.mjs`。不要上传 `.build/`、`dist/`、任何 keystore、`materials/`、`assets/web/media/` 或真题 `bundled-library.json`。工作流先构建兼容旧版 WebView 的前端，再由脚本重新生成测试 JSON 和音频。

本地复现构建：

```bash
npm ci --no-audit --no-fund
npm run build:web
python3 tools/prepare-ci-assets.py
python3 tools/build-apk-ci.py --sdk "$ANDROID_HOME" --java-home "$JAVA_HOME"
node tools/android-smoke.mjs emulator-5554 dist/listenly-ci-fixture.apk local-ci
```

Windows 可用 `python`，并通过 `--sdk` / `--java-home` 指定本地 SDK 与 JDK；脚本不会读取 `.build/android/debug.keystore`。模拟器结果只证明所测试系统镜像上的行为，仍需 realme GT7 / realme UI 7.0 真机验证 OEM 行为。

工具依据：[Android D8](https://developer.android.com/tools/d8)、[AAPT2](https://developer.android.com/tools/aapt2)、[zipalign](https://developer.android.com/tools/zipalign)、[模拟器 Action 官方仓库](https://github.com/ReactiveCircus/android-emulator-runner)、[GitHub 固定 Action 提交的建议](https://docs.github.com/en/actions/reference/security/secure-use)。
