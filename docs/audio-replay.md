# 重复播放修复与验证（1.0.4）

用户在 realme GT7 / realme UI 7.0 上报告：内置六级音频首次播放正常，暂停后继续播放及退出后重开文章会失败。本次修复针对安卓资源读取和播放器错误恢复，保留 1.0.3 的紧凑阅读布局、材料编号与记录格式。

## 根因与旧包证据

旧版安卓宿主在响应 `Range: bytes=N-` 时，已跳过文件的前 N 字节并返回 206。Chromium 的安卓 WebView 拦截流读取器仍根据原始请求再次调用 `skip(N)`，造成二次跳过；它还使用 `available()` 校验范围。开头请求可以成功，非零位置的请求会得到错误内容、截短数据或读取失败。音频重新打开或解码器定位时会使用这样的请求。

本地 Android 16 / API 36、系统 WebView Chromium 133，对未修改的轻量版 1.0.3 做了两轮实际请求，逐字节哈希比较 APK 中的 M4A：

| 请求 | 原录音预期 | 旧版结果 |
| --- | --- | --- |
| `bytes=0-` | 1,119,140 字节 | 正确 |
| `bytes=8-127` | 120 字节及指定片段哈希 | 112 字节，哈希错误 |
| `bytes=839355-` | 279,785 字节及指定片段哈希 | 请求失败 |
| `bytes=-128` | 文件末尾 128 字节 | 正确 |

旧包 SHA-256 为 `3ab683b3ca5880f4cb7c4c396a6327db61ac6298acb1c96380a03ec51aa5c154`。独立操作回归中，切换文章再返回、向结尾定位均失败；退出重开在三轮中出现一次 `MEDIA_ERR_DECODE` / `PIPELINE_ERROR_DECODE`，其余两轮在缓存充分时成功。该模拟器的三轮普通暂停续播成功，不能据此声称已复现 GT7 上的每一种表现，也不能以一次正常播放排除读取错误。

浏览器另验证了两个恢复问题：一次实际音频 HTTP 503 后，旧版即使服务恢复，重复点击播放也不重新加载，`MediaError` 保持锁定；播放请求尚未完成就返回主页，正常的 `AbortError` 被误报为文件损坏。这是独立的故障注入验证，不是安卓真机根因的直接证据。

## 修改

- 为已有的 206 响应体添加只由 `skip()` 消耗的虚拟偏移，吸收 WebView 的额外跳过；真实读取直接返回指定范围的第一个字节。无需创建前缀文件或加载完整录音到内存。后续 WebView 若直接读取响应体，同样得到正确片段。
- 后缀范围保持原有切片，不添加虚拟偏移。每次请求仍单独打开资源；有限流严格限制读取及跳过的长度，并把关闭传递给原始文件。
- 播放出错、没有可用源或播放结束后，通过 `load()` 清除旧解码器状态，再按保存的位置或从头播放。自动恢复最多一次，失败后可再次点播放；普通暂停保留缓冲和当前位置。
- 忽略由正常取消或切换素材导致的旧播放承诺失败。元数据加载只消费本次待恢复的位置，已完成文章再次打开从零开始。

`WebViewRangeInputStream` 是本项目独立实现。机制依据 Chromium 的 [InputStreamReader](https://chromium.googlesource.com/chromium/src/+/main/components/embedder_support/android/util/input_stream_reader.cc) 和 [AndroidStreamReaderURLLoader](https://chromium.googlesource.com/chromium/src/+/main/components/embedder_support/android/util/android_stream_reader_url_loader.cc)，同类问题也可参见 [Wry 的修复讨论](https://github.com/tauri-apps/wry/pull/1865)。播放器错误和取消语义依据 [HTML 媒体标准](https://html.spec.whatwg.org/multipage/media.html#dom-media-play)。

## 验证与复现

Java 流契约检查通过 74 项断言，覆盖二次跳过、直接读取、有界与开放范围、后缀切片、重复新流、整数边界、空读取、越界和关闭。执行：

```bash
python tools/test-range-stream.py --java-home "$JAVA_HOME"
```

新版浏览器回归使用真实媒体解码，原创 WAV、内置 M4A 和导入的 Blob 音频均检查实际时间前进。原创示例检查 62 个播放状态，实际六级材料检查 86 个；包含三轮暂停续播、自然结束后重播、返回主页、切篇、题目切片、单句循环、完成后返回零、一次 503 恢复和正常取消。最终两份结果均通过，入口脚本 SHA-256 为 `eda8dc6ef90c9f50488fae4e00693381a6e88e4d9cec7b556a66832613c36a89`。503 恢复前后的答案、收藏及位置保持，导入材料经 IndexedDB 重载后继续可播放。

```bash
npm run prepare:demo
npm run test:replay
# 有本地合法材料时可额外运行：
node tests/audio-replay.test.mjs --real
```

安卓回归脚本只允许本项目 `Listenly_` 前缀的模拟器。实际 ADB 触摸播放、暂停、跳转，取样播放时间；结束场景先定位到末尾再等待真实 `ended`，不伪造结束事件。两轮 Range 请求的长度与 SHA-256 必须匹配 APK 原始字节，已有答案和导入清单必须保持一致。

```bash
node tools/android-replay-smoke.mjs emulator-5554 app.apk local-replay --demo
# Actions 的原创合成音夹具：
node tools/android-replay-smoke.mjs emulator-5554 dist/listenly-ci-fixture.apk api-replay --fixture
```

本地 Android 16 / Chromium 133 的实际六级轻量包三轮回归全部通过，共 16 个场景（含原创示例句循环）及 8 个精确范围检查，已有答案与导入清单保持一致。修复包 SHA-256 为 `13734bb1fe4240f6e11a4344dbc0ab995a4547626c11a06b859f25093ae29d18`。第一次运行因 Android `uiautomator` 进程异常未能进入测试，不计为通过；保留故障记录后，加入有上限的框架重试并完成上述回归。

[本次 GitHub Actions](https://github.com/AITopia-Shao/listenly-android/actions/runs/38519217979) 的四项任务全部通过：Android 8 / API 26、Android 11 / API 30、Android 16 / API 36，以及原创示例浏览器回归。发布标签 `v1.0.4` 对应提交 `940fe6eccf714b18604da0b8ff8dfc27e0898fcc`，包含每台模拟器三轮重复播放和两轮精确范围校验。

已下载并核对 Actions 结果文件。各系统均通过 15 个真实播放场景及 8 项音频范围长度／哈希检查，答案与导入清单一致，应用进程保持稳定：

| 系统 | WebView Chromium | 结果 |
| --- | --- | --- |
| Android 8 / API 26 | 69.0.3497.100 | 15 场景 + 8 范围检查通过 |
| Android 11 / API 30 | 83.0.4103.106 | 同上 |
| Android 16 / API 36 | 133.0.6943.137 | 同上 |

云端浏览器另通过 62 个重复播放状态与 18 组阅读布局检查；实际构建入口哈希与本地最终安装包一致。公开 APK 已完成匿名下载，文件大小与 SHA-256 均匹配本地已测试的原创示例包。

首次云端运行的 Android 8 在进入播放检查前，因系统拒绝 `logcat -c` 而中断；启动和原有单次播放检查成功。修正采集脚本后，不能清理的日志保留并记录限制，全部实际播放与字节断言仍必须通过。上述成功链接对应修正后的完整新运行。

云端只使用原创合成音和原创英语示例；真实六级录音、题目和本地签名不上传。公开 [1.0.4 Release](https://github.com/AITopia-Shao/listenly-android/releases/tag/v1.0.4) 的原创示例 APK 为 `bc28a5f847fd8219a873411502dc490273d7b85b2ca8f5a63f6b0c8592fd8429`。realme GT7 未直接测试新版，模拟器检查不保证所有 OEM 行为。
