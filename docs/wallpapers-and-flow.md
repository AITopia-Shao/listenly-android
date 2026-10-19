# 日夜壁纸与移动透镜

本地个人安装包使用用户指定的 [Ten Peaks 日间壁纸](https://basicappleguy.com/s/TenPeaksDayiPhone.png)和[夜间壁纸](https://basicappleguy.com/s/TenPeaksNightiPhone.png)，来源见 [Basic Apple Guy 原文](https://basicappleguy.com/basicappleblog/macos-ten-peaks)。图片保持原文件，随主题连续交叉渐变，固定铺满首页、资料库、个人页、正文与做题页面，播放器和弹窗共享同一背景。

第三方图片不属于本项目 MIT 代码资产，不上传到公共仓库或公开 APK。公开演示与云端测试使用项目原创 SVG 渐变背景；个人构建可先运行 `python tools/fetch-personal-wallpapers.py --download`，再执行普通或轻量构建。下载内容与来源摘要保存在被 Git 忽略的 `.build/personal-wallpapers`；`-Demo` 构建始终排除它们。旧缓存先备份到被忽略的 `.build/ten-peaks-performance`，新两图通过 PNG 完整性、尺寸和 SHA-256 校验后才一起替换；下载失败保留原缓存。

Ten Peaks 原图均为 1803 × 3900；个人暂存清单使用 `personal-ten-peaks`，公开清单继续使用 `original-gradients`。`python tools/fetch-personal-wallpapers.py --verify-cache` 可重新核对本地原文件；`--stage-web .build/指定候选/assets/web` 可将图片加入已有的个人候选，普通与轻量 APK 构建自动调用相同验证。原图约需 53.6 MiB 的两层 RGBA 解码空间，页面不复制额外背景节点。

| 原文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| TenPeaksDayiPhone.png | 3,674,408 | `213a5e8b5d77a8d8ee7e25e96ebd38892403752dbb00e2e85a11bb504c32c806` |
| TenPeaksNightiPhone.png | 4,399,853 | `83cc62c37e5ece85a548f1ee896620c58c5f96e15319ec4311d181759b213c93` |

普通控件使用半透明毛玻璃。选中区域使用单枚移动透镜，保留位置、尺寸和速度，快速反向承接当前运动；材质有轻微滞后形变。文字的对比度、字重与视觉比例随透镜位置变化，不额外添加勾选框。资料库点击套卷名称选择，右侧箭头只预览，预览不会更换首页。

首页与资料库使用细灰分隔线，移除整组大圆角外框、篇套计数与重复选择图标。正文只保留返回和收藏，个人页学习记录改为单行薄卡。所有界面隐藏可视滚动条，触控与键盘滚动仍保留。

逐句跳转与播放高亮依赖真实时间戳。新精听导入必须符合[分句格式](import-format.md)，整批校验失败时不进入资料库，也不改变既有学习记录。现有 100 篇本地旧资料中，14 篇有可信时间轴，86 篇缺少可信时间轴；后者中还有 14 篇缺正文。旧资料保留兼容，不能用均匀分配时长伪造跳句。带真实字幕重新导入同一材料编号可以补齐时间轴，同时保留题目与答案。

历史 1.0.12 版本使用 Tahoe 壁纸，通过 9 套浏览器回归。其中壁纸专项分别检查公开 SVG 背景和个人照片各 12 个页面场景，验证透镜连续位移、文字强调、真实材质透射、正文对比度、临界换行与减少动画设置；另通过 86 项真实六级音频播放回归。Android 16 原生专项使用实际点按和进度条拖动确认导航、套卷、首页与分句透镜的中间帧，核对当时两张照片的文件哈希与 1320 × 2868 解码尺寸；30 条既有答案、9 篇完成记录、导入存储、收藏、原主题及倍速保持不变。这些旧壁纸证据不充作 Ten Peaks 的验证结果。

Android 8／11／16 的云端结果见 [GitHub Actions](https://github.com/AITopia-Shao/listenly-android/actions/runs/39053760231)，公开安装包见 [1.0.12 发布页](https://github.com/AITopia-Shao/listenly-android/releases/tag/v1.0.12)。这些验证不能替代 realme GT7 真机复测，本版尚无该机型的直接复测结果。本文及 README 的最新截图仅使用公开 SVG 背景与原创英语示例。
