# 贡献说明

欢迎修复问题、改进训练体验或补充兼容性证据。提交前先阅读 [README](README.md) 和 [导入格式](docs/import-format.md)。

## 开发流程

1. Fork 仓库并从 `main` 创建分支。
2. 执行 `npm ci`、`npm run prepare:demo`、`npm run start:demo`，使用原创示例预览。
3. 运行 `npm test`。涉及 Android 宿主、音频或模式切换时，附上对应系统版本的实际安装与交互验证；仓库的 Actions 提供 Android 8 / 11 / 16 模拟器回归。
4. 提交 Pull Request，说明触发条件、修改后的行为、已运行的验证和仍未验证的环境。

修改前端后要重新生成兼容脚本；`.build/`、`dist/`、`node_modules/` 和生成的 `app.compat.js` 不提交。源码中按系统版本隔离新版 Android API；材料 ID、文件导入和时间线映射变更应保留既有学习状态的兼容性。

## 报告问题

在 [Issues](https://github.com/AITopia-Shao/listenly-android/issues) 提供应用版本、手机型号、Android / 厂商系统版本、具体操作及实际表现。若进入诊断页，可使用“复制诊断信息”。日志与截图中的个人文件名或学习内容应先自行遮盖。

## 材料和许可证

新增示例应使用原创或明确允许再发布的内容，并记录来源及许可证。不要提交真实试卷、录音、译文、个人导入文件、学习记录或签名密钥。代码贡献按本仓库的 [MIT 许可证](LICENSE) 发布；第三方代码保持原有许可证和版权声明。
