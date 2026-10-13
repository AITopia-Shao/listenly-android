# 1.0.2 开源发布验收

公开源码位于 [AITopia-Shao/listenly-android](https://github.com/AITopia-Shao/listenly-android)，原始应用代码和文档使用 MIT；`examples/demo/` 使用 CC0-1.0，第三方依赖保留其许可证。源码、提交历史和发布 APK 已检查；真实六级材料、用户导入文件、签名私钥及本机凭据辅助脚本未发布。

## 发布文件

`listenly-demo-1.0.2.apk`，3,208,488 字节，版本码 3，包名 `cn.listenly.app`，最低 API 26、目标 API 37。

SHA-256：

```text
dd62ccfe8fe1fb9fea53d32818fc38026a40c4f089303da4a2b596d480588500
```

包内只有两篇原创日常英语、五题和 `morning.wav` / `library.wav` 两个录音。WAV 与公开示例逐字节一致；套卷列表为空。`assets/web/LICENSE.txt`、`assets/web/THIRD_PARTY_NOTICES.txt` 与仓库许可证文件一致。签名 v2 / v3 有效，签名证书与此前本机轻量／完整版一致，可覆盖安装；公开版内置材料为原创示例。

Windows PowerShell 5 的旧 `.NET` 压缩流程曾将 `resources.arsc` 写成方法 8，即使使用 `NoCompression`。Android 16 实装拒绝该候选包，错误码 -124。已用 Python 流式 ZIP 规范化替换，明确将资源和录音存为方法 0，并在签名后验证方法及对齐；最终包安装成功。相关回归检查位于 `tests/test_normalize_apk.py`。

## 实际运行结果

[开源源码的云端运行 38430091913](https://github.com/AITopia-Shao/listenly-android/actions/runs/38430091913) 在提交 `d6ecc4c3eb81466334ca736af32a321e69dbf44a` 完成四个成功任务：原创英语演示包的 Linux SDK 构建和 Chromium 交互检查，以及 Android 8 / 11 / 16 的安装、启动、原生触摸播放、模式对齐、答题和页面重载回归。每个任务保存 APK 与相应证据。后续文档或测试脚本调整不改变安装包中的应用代码。

发布标签 `v1.0.2` 指向 `845e5f186f55cf96577189977b5a309736a6fbe8`，该提交的[最终运行 38431767735](https://github.com/AITopia-Shao/listenly-android/actions/runs/38431767735) 也完成上述四个成功任务。公开 APK 已无需登录下载，并验证下载文件的 SHA-256 与本地发布文件完全一致。

公开 Release APK 另外在本地 Android 16 / Chromium 133 上实际安装并冷启动：页面 412×915，无横向溢出；原创录音 34.412154 秒可解码、真实触摸播放时间递增；10 秒位置在两种模式间保留；选择 B 得到正确反馈，重载后答案保留；起止应用进程一致，崩溃日志为空。

本地原始证据保存在 `.build/runtime-results/public-demo-api36/`，完整云端证据可从上述运行的 Artifacts 下载。Playwright 另验证了 360 / 393 / 430 / 1280 像素宽度、三种文本显示、错误答案反馈、真实文件夹导入和 IndexedDB 重载恢复。

realme GT7 / realme UI 7.0 尚未直接测试。标准 Gradle wrapper 已通过 `--version`；完整 Gradle APK 构建在本机 Java 回环连接初始化处停止，尚未进入编译，故发布包及云端验收均采用已经验证的直接 SDK 构建链。
