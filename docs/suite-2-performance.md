# 2.0 日夜切换性能记录

2026-10-19 的12轮桌面对照中，新转场降低了这组日夜切换的绘制与 Task 耗时；普通CPU下的帧间隔P95略有增加，快照捕获也增加了布局和脚本成本。这里没有真机120Hz结论。

新路径使用 View Transitions 对旧画面与新画面进行透明度混合。浏览器会捕获两端状态，并提供可动画的伪元素；旧画面是快照，新画面保持实时表示。这一机制和捕获过程见 [Chrome 官方说明](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)。

同一 Windows 主机运行 headless Edge **155.0.4283.45**，视口 **393×873、DPR 1**。基线在同一2.0前端快照中替换为改动前留存的 `theme.js`、`styles.css` 后重建，其余模块一致。两侧都使用相同字节的两张 **1803×3900 Ten Peaks PNG**，等待照片解码、字体就绪及500ms空闲后开始。照片用于个人本地构建和缓存，不随公开仓库或示例包分发；公开示例使用原创SVG，本表没有测量该SVG场景。

CPU1为不限速，CPU4为DevTools的4倍CPU限速，并不对应某款手机。每个条件按“基线→新版”交替3次，每轮真实点击日夜切换6次，每次点击后等待640ms；12轮依次执行，无并行浏览器测试。以下每格都是3个独立样本的中位数。

| 指标（每轮6次切换） | CPU1：基线 → 新版 | CPU4：基线 → 新版 |
| --- | ---: | ---: |
| Task耗时，ms | 1903.16 → 815.86（−57.1%） | 4663.20 → 3877.59（−16.8%） |
| Paint耗时，ms | 396.53 → 52.53（−86.8%） | 701.71 → 236.42（−66.3%） |
| rAF间隔P50，ms | 16.7 → 16.7 | 16.8 → 16.7 |
| rAF间隔P95，ms | 17.0 → 17.3 | 133.1 → 49.7 |
| Layout次数 | 9 → 42 | 9 → 42 |
| Layout耗时，ms | 1.10 → 6.08 | 7.82 → 33.67 |
| Script耗时，ms | 59.80 → 61.17（+2.3%） | 225.51 → 299.46（+32.8%） |

Task、Script和Layout取CDP `Performance.getMetrics` 测量前后的时长差，秒乘1000换算为ms。Paint为trace中 `ph="X"、name="Paint"` 事件的 `dur` 总和，微秒除1000。rAF间隔取相邻回调时间戳之差；单轮排序后以 `floor(样本数×0.95)` 下标取P95，再对3轮取中位数。变化率为 `(新版中位数 / 基线中位数 − 1) × 100%`。

rAF统计覆盖捕获、动画和640ms等待的整个窗口，不能直接换算为动画实际显示帧率；Task也不代表整台设备的CPU占用或耗电。普通CPU的P95从17.0ms变为17.3ms，不能据此声称所有场景帧率都提升。额外的Layout与Script成本已保留在表中。[Android硬件加速文档](https://developer.android.com/develop/ui/views/graphics/hardware-accel)也说明了图层的资源成本及减少重叠绘制的重要性，硬件加速本身不等于零渲染成本。

本机rAF采样约为60Hz。120Hz每帧预算约8.33ms；Android官方对120fps的预算说明为约8ms，并建议在目标设备上分析卡顿，见 [Android渲染性能文档](https://developer.android.com/topic/performance/issues/render)。**realme GT7 / realme UI 7.0尚未直接复测，本次桌面结果不能证明其达到120Hz。** 本文只记录这12轮浏览器测量，不作云端或原生验收结论。

本地原始证据位于 `.build/ten-peaks-performance/performance-comparison.json`、`perf-final02-runner.json` 及12个 `perf-final02-*` 目录；每轮保留报告、trace、日志和测量脚本预运行哈希。汇总器重新核对文件字节并计算中位数，旧失败报告继续保留。

本轮前端SHA-256为 `75d6eb93f6753900d41d3b6a038dd55969924eba4aff463b331d620b2b338cb8`，样式为 `347b529feddc792870acb0fc5596416d324a8177e9e3a9b9ece9318b28ae5243`；对比JSON的SHA-256为 `31be41fde5c8a94ef610b39b34e82db752e94df54219620a7da151076599a764`。
