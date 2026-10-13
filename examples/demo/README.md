# 原创日常英语示例

此目录包含 2 篇原创短文、双语文本、句子时间戳和 5 道题目，供开源版首次启动与离线播放使用。

- `A small change, a better morning`：34.412 秒，3 道题。
- `The little library on the corner`：35.172 秒，2 道题。

文字、译文、题目和录音在 `demo.json` 中标注为 `CC0-1.0`。它们不是六级真题。WAV 文件由 Windows `System.Speech` 的 `Microsoft Zira Desktop` 语音朗读这些原创英文文本后生成。

`audio.intensive` 和 `audio.exam` 使用相同录音，文章 ID 在两个模式间保持一致。公开包可以直接体验精听、隐藏原文、双语显示及做题反馈。

在项目根目录执行以下命令，生成只包含本目录示例的 Android 资源目录：

```sh
npm ci
npm run build:web
python tools/prepare-demo-assets.py
```

输出为 `.build/demo/main`。更多构建命令见项目根目录的 README。
