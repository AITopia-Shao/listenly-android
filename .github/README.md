# 拾听 Android 云端构建与兼容性测试

此私有仓库存放应用原生宿主、听力界面、导入与时间映射代码，以及可复现的构建和测试脚本。真实六级材料、用户文件、手机更新 APK 和本地签名密钥保留在本机，未上传。

[Android compatibility](https://github.com/AITopia-Shao/listenly-android/actions/workflows/android-compatibility.yml) 在 Android 8 / 11 / 16 上实际安装应用，验证启动、页面、触摸播放、模式进度对齐、答题和页面重新加载后的答案保留。运行结束后下载 Artifacts，可查看 `result.json`、日志、截图和测试 APK。

1.0.2 的三版本云端验收已[完整成功](https://github.com/AITopia-Shao/listenly-android/actions/runs/38424901772)。本地还用手机更新包验证了真实六级音频，并通过了渲染进程故障恢复检查。

云端 APK 只含原创测试音和题目，使用临时签名，供模拟器验证。手机更新请使用本机 `dist/拾听-轻量版-1.0.2.apk` 或 `dist/拾听-完整版-1.0.2.apk`，它们保留原签名。

1.0.2 已修复 Android 启动时提前读取系统栏控制器造成的空指针，并增加旧版 WebView 兼容和原生异常恢复。实际验证范围见[故障与运行验证](../docs/android-runtime-findings.md)，构建方式和运行器要求见[云端测试说明](../docs/android-ci.md)。
