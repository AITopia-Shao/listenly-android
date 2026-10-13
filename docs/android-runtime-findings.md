# Android 启动故障与兼容性验证

排查日期：2026-10-13。用户报告：realme GT7、realme UI 7.0，轻量版点击后立即闪退；本次没有连接这台真机。

## 已确认的启动缺陷

初轮云端 Android 11（API 30）的原生日志记录了 `PhoneWindow.getInsetsController()` 空指针异常：`DecorView` 尚未创建，调用发生在 `MainActivity.onCreate()` → `configureWindow()`，早于 `setContentView()`。1.0.1 的异常保护让应用继续运行，但没有消除错误的调用顺序。

随后在本地 Android 16（API 36）上直接安装旧轻量 APK，同样复现点击后立即闪退：`PhoneWindow.getInsetsController()` → `MainActivity.configureWindow:137` → `onCreate:71`，异常内容相同。原始日志保存为 `.build/regression/original-api36-crash.log` 和 `original-api36-logcat.log`。

旧轻量 APK 的 DEX 同样在创建 WebView、设置内容视图之前直接调用系统栏配置，而且没有对应异常保护。1.0.2 在读取控制器之前先通过 `getDecorView()` 创建窗口视图，并保留系统栏兼容降级。同步安全区域的 JavaScript 也会等待根 DOM 存在。

证据：[云端初轮运行](https://github.com/AITopia-Shao/listenly-android/actions/runs/38351744813)，本地摘录 `.build/github-runs/38351744813/api30-startup-exception.txt`，旧包 DEX `.build/startup-diagnosis/old-dexdump.txt`。这个缺陷已得到运行日志和旧包代码的共同支持；GT7 还可能存在额外的厂商组件问题，不能将模拟器结果表述为该手机的实测结果。

## 系统组件不可用时的恢复

本地 AOSP Android 8（API 26）镜像的 WebView 提供者不可用，旧包直接抛出 `MissingWebViewPackageException`。覆盖安装 1.0.1 后应用进程持续运行，显示原生诊断页；点击“复制诊断信息”和“重试打开”后进程仍存活。最终 1.0.2 也已在同一环境验证恢复界面，增加启用或更新系统网页组件的说明。恢复不清除导入文件或学习记录。

本地证据位于 `.build/regression/`：旧包崩溃日志、`candidate-api26-ui.xml`、`candidate-api26.png` 和运行日志，最终版的 `final-api26-ui.xml`、`final-api26.png`、`final-api26-logcat.log`。

最终 1.0.2 还在本地 Android 16 完成了主动渲染进程故障测试：`Page.crash` 使 WebView 退出，原生诊断页显示 `didCrash=true`，应用 PID 始终为 2011；触摸重试按钮后首页恢复，原先提交的六级 q01 答案和时间戳完全一致。证据位于 `.build/runtime-results/final-api36-renderer-recovery/`，其中 crash 日志包含这次主动注入的渲染进程故障。测试完成后已关闭本任务模拟器，保留 SDK/AVD 缓存。

## 广泛兼容性的实现

- 最低系统仍为 Android 8.0；新版系统 API 按系统版本分支调用。
- 前端改为 Chromium 58 语法的经典脚本，补齐所用标准库方法，以及文件读取、随机编号和旧版布局的降级。
- WebView 初始化失败或渲染进程退出时显示原生恢复界面。
- 更新包使用原应用包名和原签名，版本 1.0.2 / versionCode 3；覆盖安装保留原有数据。

云端回归使用与更新包相同的原生代码和前端代码、原创 24 秒测试音和互动题目。真实六级资料与本地签名不上传。测试要求实际安装、启动、页面显示、音频解码、安卓触摸播放、模式进度对齐、答题和重新加载后的答案保留；构建成功或基础设施失败均不会计为功能通过。

## 1.0.2 回归结果

[最终云端运行 38424901772](https://github.com/AITopia-Shao/listenly-android/actions/runs/38424901772) 的三个工作流均完整成功，源码提交 `c00ef7e3466acd0bd792cc178c3243f835187697`。应用代码与本地 1.0.2 更新包一致，云端只更换为原创测试数据和临时签名。

| 系统 | 系统 WebView | 触摸播放时实际时间 | 模式切换位置 | 结果 |
| --- | --- | --- | --- | --- |
| Android 8 / API 26 | Chromium 69 | 0.381672 秒 | 10 秒 | 通过 |
| Android 11 / API 30 | Chromium 83 | 0.502052 秒 | 10 秒 | 通过 |
| Android 16 / API 36，AOSP | Chromium 133 | 0.214037 秒 | 10 秒 | 通过 |

三组均完成安装、启动、首页渲染、24 秒测试音解码、真实安卓触摸播放、模式进度对齐、提交答案、页面重新加载后的答案保留。页面为 412×915，内容宽度 412，无横向溢出；起止应用 PID 相同，崩溃日志为空，没有应用空指针或 Listenly 初始化告警。原始 ZIP 和完整证据保存在 `.build/github-runs/38424901772/`，每个 `verified-api26/30/36` 根目录都有 `result.json`、`logcat.log`、`crash.log` 和 `screen.png`。

最终 Android 16 在安装应用前记录了一次模拟器 System UI 启动弹窗，等待恢复后继续正常检查；没有跳过播放或答题。其他应用无响应会使测试失败。初期 KVM、磁盘容量、测试脚本作用域、Google 镜像系统界面无响应的失败记录仍保留；未把这些环境失败写成应用通过。早期 run `38383443607` 的三个应用运行检查也都通过，最终工作流同时修正了其环境预检错误。

本地 Android 16 还直接安装并验证了用户轻量更新包，系统 WebView 133.0.6943.137，播放真实六级录音 `lt-1.m4a`，时长 183.82475 秒，实际触摸播放后时间增长，切换模式保留 10 秒位置，答题与重新加载后的答案恢复通过。更新包 SHA-256 为 `9771F8B98634FAF9E6222D0C4A40FAF425E02089DA82456EDAA0E096BB7813FD`，证据位于 `.build/runtime-results/final-api36-clean-ui/`。

两版的元数据和哈希保存为 `dist/apk-artifacts-1.0.2.json` 与 `dist/SHA256SUMS-1.0.2.txt`，机器可读验收汇总为 `dist/test-results-1.0.2.json`。默认安装包文件也已更新到 1.0.2；原轻量和完整版保留在 `.build/regression/`，用于追溯。

GT7 真机、Android 系统文件夹选择器完整导入及实体扬声器听音尚未直接验收。最低支持系统为 Android 8.0；上述结果证明所列系统和 WebView 上的行为，不能表述为每款手机的实测结果。
