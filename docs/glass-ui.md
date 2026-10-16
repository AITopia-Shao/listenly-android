# 独立展开与玻璃界面（1.0.9）

同篇题目的下拉状态互相独立。可以同时展开多题，点击题目行只收起或展开这一题，选择答案后也只收起当前题。全部选项仍在正文同一页纵向排列；内容较长时，在底部播放器上方滚动。题干保持隐藏，整篇提交、草稿保存及完成统计沿用 [整篇下拉答题](compact-quiz.md) 的口径。

资料库的套卷标题用于预览，文章标题用于查看正文，这两种操作都保留首页原来的套卷与置顶文章。右侧选择标记明确更换套卷；资料库文章旁的独立播放键、正文播放键和首页播放键，在音频实际开始播放后更新首页选择与置顶。加载或播放失败保留原来的首页内容，重开应用后继续保持最后一次有效选择。

日间／夜间切换和文件夹导入加号集中在“我的”顶部。首页、套卷目录和文章目录保留内容及各自需要的操作，减少重复工具。

播放组件统一采用圆角方形触控区域、圆润的播放轮廓和一致的暂停图形。首页主播放、文章列表和正文播放器使用同一组图形与材质规则。按压反馈跟随手指，播放／暂停状态跟随真实音频事件；打开选项、切换播放速度和取消弹窗不增加装饰性的跳转或移动。

界面的卡片、底部导航、播放器、选择标记和弹出菜单统一使用浅色边缘、高光与细微阴影形成玻璃层次。日间保持黑白灰，夜间保持黑底橙字。套卷选择在原来的行与图标上过渡，不因切换状态重建列表，避免滚动位置或焦点跳动。支持背景模糊的 WebView 增加局部模糊；旧版环境保留可读的表面与边界。系统“减少动画”开启时停用过渡。

英文和数字随 APK 离线提供 Inter 4.1，支持可变字体的环境使用可变版本，较早的 WebView 使用 400／500／600 三个静态字重。中文继续由设备的中文系统字体显示。Inter 使用 SIL Open Font License 1.1，字体原文件、来源及许可位于应用资源的 `fonts/` 目录；应用未打包 Apple 的 SF 字体或 SF Symbols。官方字体来源及许可见 [Inter 仓库](https://github.com/rsms/inter)、[Inter 4.1 发布](https://github.com/rsms/inter/releases/tag/v4.1)。

设计参考 [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) 和 [Apple Design Resources](https://developer.apple.com/design/resources/) 的组件、层级及排版语言，同时研究 [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) 的折射与按压呈现、[shuding/liquid-glass](https://github.com/shuding/liquid-glass) 的 SVG 玻璃实现。本应用使用现有 Android／WebView 架构中的 CSS 和 SVG 组件实现；正文阅读、触控响应与兼容性优先于持续的折射动画。

## 验证状态

1.0.9（versionCode 10）的最终轻量版、完整版与公开演示版中，`app.compat.js` 入口脚本的 SHA-256 均为 `08102edd0b108810571386f3173fb25df911cca02a11cb17430ad3aeb43565e8`。界面源文件、样式和字体也逐项绑定最终提交 [`75b3c36`](https://github.com/AITopia-Shao/listenly-android/commit/75b3c3675cf7c9c0b7755a55fd6c30eb73861961)：作者文本只允许 Git 的 CRLF／LF 换行转换，二进制字体逐字节相同，包内各资源的原始哈希分别记录。从工作树构建的安装包通过这些资源校验，绑定到该提交。

- 41 项源码、30 项活跃度逻辑、4 项原创示例／CI 资产契约检查通过；后两项分别属于源码测试子集和独立 Python 测试。
- 21 项主题／首页／资料库检查通过，包括离线字体实际加载、工具只出现在“我的”、预览和失败播放保留首页、成功播放与明确选择更新首页、套卷选择材质动画和图标过渡，以及原有统计与日历。
- 7 项整篇答题检查及 24 组手机布局通过。三题和四题文章覆盖三种尺寸、两种主题及全部收起／展开一题两种状态；另验证多题同时展开、逐题收起、选项全部可滚动触达。长内容在同一个文章页面滚动。
- 18 组正文／安全区布局及 86 项包含真实六级音频和切片的浏览器播放回归通过。
- 最终轻量 APK 在本地 Android 16／WebView 133.0.6943.137 实际触摸完成一篇 3 题六级文章，独立展开两题、整篇提交、完成数增加一篇；49 次受检查的原生触摸均记录到双帧稳定目标和一个匹配的可信点击。预览保留首页，资料库实际播放后更新首页，旧答案与重开记录保留。最终轻量版与公开演示版各通过 17 个原生播放场景和 8 项 Range 响应原始字节／哈希校验。
- [GitHub 云端运行 38863754801](https://github.com/AITopia-Shao/listenly-android/actions/runs/38863754801) 的 4 项作业全部通过。Android 8／11／16 各完成安装、启动、实际触摸、离线字体加载、16 个播放场景、8 项 Range 字节校验和 74 项 Java 流契约检查。云端使用两套各含一篇一道题的原创夹具，真实切换未选套卷、预览和跨套播放均覆盖；同套内多文章置顶和多题行为由本地原生及浏览器验证。
- 云端 Python 资产检查总计 7 项，包含 4 项原创示例／CI 资产契约与 3 项 ZIP 规范化契约；本地 `demo-contracts-dual-ci.log` 单独记录前 4 项。

中间失败作为诊断保存，不纳入通过数量。较早一轮 Android 8 首播曾在已交付点击后未推进，但当时未采集完整音频状态，未将其归因于环境；后续完整运行新增媒体事件与播放 Promise 诊断。原生导航的两次失败和启动系统读取超时也保留，最终通过记录来自重新完成的整段运行。详见本地 `dist/test-results-1.0.9.json`。realme GT7／realme UI 7.0 本版尚未直接复测。

个人轻量版及完整版的六级 JSON、录音 CRC 和长度均与 1.0.8 相同。公开仓库及公开 APK 仅包含两个原创示例、五道题、两段 CC0 录音，以及附 OFL 许可和来源的 Inter 字体。
