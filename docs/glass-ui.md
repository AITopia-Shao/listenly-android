# 独立展开与玻璃界面（1.0.9）

同篇题目的下拉状态互相独立。可以同时展开多题，点击题目行只收起或展开这一题，选择答案后也只收起当前题。全部选项仍在正文同一页纵向排列；内容较长时，在底部播放器上方滚动。题干保持隐藏，整篇提交、草稿保存及完成统计沿用 [整篇下拉答题](compact-quiz.md) 的口径。

资料库的套卷标题用于预览，文章标题用于查看正文，这两种操作都保留首页原来的套卷与置顶文章。右侧选择标记明确更换套卷；资料库文章旁的独立播放键、正文播放键和首页播放键，在音频实际开始播放后更新首页选择与置顶。加载或播放失败保留原来的首页内容，重开应用后继续保持最后一次有效选择。

日间／夜间切换和文件夹导入加号集中在“我的”顶部。首页、套卷目录和文章目录保留内容及各自需要的操作，减少重复工具。

播放组件统一采用圆角方形触控区域、圆润的播放轮廓和一致的暂停图形。首页主播放、文章列表和正文播放器使用同一组图形与材质规则。按压反馈跟随手指，播放／暂停状态跟随真实音频事件；打开选项、切换播放速度和取消弹窗不增加装饰性的跳转或移动。

界面的卡片、底部导航、播放器、选择标记和弹出菜单统一使用浅色边缘、高光与细微阴影形成玻璃层次。日间保持黑白灰，夜间保持黑底橙字。套卷选择在原来的行与图标上过渡，不因切换状态重建列表，避免滚动位置或焦点跳动。支持背景模糊的 WebView 增加局部模糊；旧版环境保留可读的表面与边界。系统“减少动画”开启时停用过渡。

英文和数字随 APK 离线提供 Inter 4.1，支持可变字体的环境使用可变版本，较早的 WebView 使用 400／500／600 三个静态字重。中文继续由设备的中文系统字体显示。Inter 使用 SIL Open Font License 1.1，字体原文件、来源及许可位于应用资源的 `fonts/` 目录；应用未打包 Apple 的 SF 字体或 SF Symbols。官方字体来源及许可见 [Inter 仓库](https://github.com/rsms/inter)、[Inter 4.1 发布](https://github.com/rsms/inter/releases/tag/v4.1)。

设计参考 [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) 和 [Apple Design Resources](https://developer.apple.com/design/resources/) 的组件、层级及排版语言，同时研究 [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) 的折射与按压呈现、[shuding/liquid-glass](https://github.com/shuding/liquid-glass) 的 SVG 玻璃实现。本应用使用现有 Android／WebView 架构中的 CSS 和 SVG 组件实现；正文阅读、触控响应与兼容性优先于持续的折射动画。

## 验证状态

最终安装包与 Android 8／11／16 云端结果尚待绑定验证；此处不沿用 1.0.8 的通过记录。发布前需核对独立展开、预览与实际播放的首页选择、顶部工具位置、字体加载、手机安全区、重复播放及原有记录保留。最终结果由本地 `dist/test-results-1.0.9.json` 汇总。realme GT7／realme UI 7.0 本版尚未直接复测。
