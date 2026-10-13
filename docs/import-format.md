# 成对听力材料的导入格式

在 App 的 `＋` 中分别选择“精听专属文件夹”和“做题专属文件夹”。可以选择整个模式目录，也可以选择单份套卷目录。Android 使用系统文件夹选择器读取并复制到应用私有存储，重启后仍可使用；浏览器预览将文件保存在 IndexedDB。

两个模式通过 **`paper.id + article.id`** 识别同一篇文章。稳定的题目 `id` 用于恢复答案。目录名与标题用于展示；推荐提供 `paper.json`，避免改名造成错配。

## 文件夹结构

下面是原创材料示例；用自己制作或已获授权的录音和文本替换内容：

```text
精听/
  original-park/
    paper.json
    conversation-1/
      audio.wav
      transcript.json
      questions.json
做题/
  original-park/
    paper.json
    conversation-1/
      audio.wav
      questions.json
      q01/audio.wav
      q02/audio.wav
```

音频扩展名可为 MP3、M4A、AAC、WAV、OGG、OPUS、FLAC 或 MP4，实际解码取决于设备的系统网页组件。最通用的选择是 MP3、M4A 或 PCM WAV。

## paper.json

精听和做题的清单使用相同的套卷与文章 ID，分别指定各自模式的音频。清单中的路径均相对于清单所在套卷目录：

```json
{
  "schemaVersion": 1,
  "id": "original-park",
  "title": "原创练习 · 公园计划",
  "source": { "title": "自制英语对话", "license": "MIT" },
  "articles": [
    {
      "id": "conversation-1",
      "title": "A morning in the park",
      "type": "conversation",
      "audio": { "intensive": "conversation-1/audio.wav" },
      "transcript": "conversation-1/transcript.json",
      "questions": "conversation-1/questions.json"
    }
  ]
}
```

做题清单把 `audio.intensive` 改为 `audio.exam`。两份文件夹都有文章音频时使用相同录音最容易对齐；也可使用不同录音并通过下面的时间字段映射。一个被选择的目录若包含两种模式音频，也可以同时提供两个字段。

只允许引用所选目录中的相对路径。绝对路径、外部网址、`..` 和所选目录之外的文件会被拒绝。JSON 使用 UTF-8 编码。单个文本文件最多 8 MiB，一次最多 25,000 个文件；较大的题库可按年份分批导入。

## 原文与译文

`transcript.json` 是句子数组。时间单位为秒，起点是当前文章音频的开头；下面的时间仅为格式示例，准备真实材料时必须按录音核对：

```json
[
  { "start": 0.4, "end": 3.6, "en": "Shall we meet at the park?", "zh": "我们在公园见面好吗？", "timed": true },
  { "start": 3.6, "end": 5.2, "en": "Let's meet at nine.", "zh": "我们九点见吧。", "timed": true }
]
```

`end` 用于确定单句循环终点。没有审核过时间戳的文本设置 `timed: false`，仍可阅读和整段听音，但不提供虚假的逐句定位。

也可使用 SRT、VTT、LRC 字幕，或 `transcript.txt` / `text.txt` 原文配合 `translation.txt` 译文。TXT 按非空行配对；原文与译文行数不同时保存完整译文并提示，不推测逐句关系。缺少译文时双语视图显示原文与缺失说明。

## 题目与分题音频

`questions.json` 是题目数组。题目音频路径相对于该题目 JSON 所在目录；`start/end` 是**完整文章**上的时间边界，而不是分题录音的本地时间：

```json
[
  {
    "id": "q01",
    "number": 1,
    "groupId": "conversation-1",
    "prompt": "When will they meet?",
    "options": [
      { "id": "A", "text": "At eight." },
      { "id": "B", "text": "At nine." },
      { "id": "C", "text": "At ten." },
      { "id": "D", "text": "At noon." }
    ],
    "answer": "B",
    "explanation": "对话约定九点见面。",
    "audio": "q01/audio.wav",
    "start": 0.4,
    "end": 5.2
  }
]
```

不知道标准答案时省略 `answer`，应用会记录选择和回看，但不判分。选项 `id` 必须唯一，答案必须对应一个选项。题目 `id` 不应因导入模式或文件名变化而改变。

单题子文件夹也可直接包含 `question.json` 与 `audio.wav`，并提供相同的 `groupId`，把多题归入同一文章。缺少清单时应用会尝试按目录名识别套卷和文章，并提示推断结果；这种方式更容易受改名影响，正式题库建议使用明确清单。

## 时间线与模式切换

同一音频使用相同文章坐标；单题切片使用 `start/end` 将题目进度映射回文章。没有可靠定位信息时，两种录音分别保存进度。

若一题的录音拼接了“文章上下文 + 本题问题”，中间跳过其他题目问题，使用 `audioTimeline` 逐段描述：

```json
{
  "audioTimeline": [
    { "clipStart": 0, "clipEnd": 100.08, "articleStart": 0 },
    { "clipStart": 100.08, "clipEnd": 118.52, "articleStart": 105.46 }
  ]
}
```

第一段分题录音对应文章 0–100.08 秒，第二段从分题录音的 100.08 秒开始，对应文章的 105.46 秒。每段必须满足 `clipEnd > clipStart`，时间非负；边界应按真实录音核验。不要把非连续录音当作简单的 `start + 播放进度`。

再次导入另一模式时，应用合并音频、原文、译文和题目。相同 ID 的年份、场次、原文、选项或答案冲突会显示提示并保留已有内容；不要用相同 ID 标记不同文章。来源信息和许可证应记录在 `source` 中；本应用的代码许可证不会改变导入材料的权利。
