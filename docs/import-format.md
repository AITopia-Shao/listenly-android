# 成对听力材料的导入格式

在 App 的 `＋` 中分别选择“精听专属文件夹”和“做题专属文件夹”。可以选择整个模式目录，也可以选择单份套卷目录。Android 使用系统文件夹选择器读取并复制到应用私有存储，重启后仍可使用；浏览器预览将文件保存在 IndexedDB。

两个模式通过 **`paper.id + article.id`** 识别同一篇文章。稳定的题目 `id` 用于恢复答案。目录名与标题用于展示；推荐提供 `paper.json`，避免改名造成错配。

**新精听材料必须逐句定位。** 每篇都需文章音频和经过核对的分句原文，使用带时间的 JSON、SRT、VTT 或 LRC。纯 TXT、只有译文、`timed: false`、缺少时间、重复时间或把多句全部写成 `0` 的精听材料不能新导入；应用不会平均分配或猜测时间。选择的目录内任一篇不符合标准，本次精听导入整体取消，已有材料不受影响。做题文件夹不强制原文，仍可只含题目与分题音频。

导入前会单独读取音频元数据，以实际时长检查分句坐标；省略或错填清单中的 `duration` 也不能让超出录音的句子通过。音频不可读或读取超时会取消整批导入，可重试；校验不占用正在播放的音频，也不改变它的进度或倍速。

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
  "schemaVersion": 2,
  "id": "original-park",
  "title": "原创练习 · 公园计划",
  "source": { "title": "自制英语对话", "license": "MIT" },
  "articles": [
    {
      "id": "conversation-1",
      "title": "A morning in the park",
      "type": "conversation",
      "duration": 5.2,
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

`transcript.json` 是句子数组。每个元素对应一个可独立点击播放的英文句子或短语；译文可以缺省。时间单位为秒，起点是当前文章精听音频的开头；下面的时间仅为格式示例，准备真实材料时必须按录音核对：

```json
[
  { "start": 0.4, "end": 3.6, "en": "Shall we meet at the park?", "zh": "我们在公园见面好吗？", "timed": true },
  { "start": 3.6, "end": 5.2, "en": "Let's meet at nine.", "zh": "我们九点见吧。", "timed": true }
]
```

每句 `start` 必须是有限的非负时间，按顺序严格递增；`end` 可省略，提供时必须大于本句 `start`。只有一句的短录音从 `0` 开始完全合法。推荐在文章清单填写实测 `duration`，它必须为正数；所有 `start` 必须小于时长，`end` 不应超过时长。导入器只校验已提供的时长，不会把文件大小或句数换算成录音时长。音频必须存在且非空，实际编解码能力由设备决定。

字幕也可以写成 `transcript.srt`，并在清单 `transcript` 中引用：

```srt
1
00:00:00,400 --> 00:00:03,600
Shall we meet at the park?
我们在公园见面好吗？

2
00:00:03,600 --> 00:00:05,200
Let's meet at nine.
我们九点见吧。
```

SRT/VTT 每句都需合法起止时间、非空英文，句间空行分隔。LRC 例如 `[00:00.400]Shall we meet at the park?`，每句必须有不同的实际时间；最后一句的结束时间可由音频决定。原文和译文可放在同一 SRT/VTT 句块内；LRC 的译文建议单独使用 `translation.txt`。

`translation.txt` 仍按非空行与分句配对；行数不同时保存完整译文并提示，不推测逐句关系。缺少译文不影响导入。`transcript.txt` / `text.txt` 不能替代新精听导入的时间字幕。

升级前已导入的无时间文本仍保留，支持阅读与整篇播放，不会被删除，也不会生成虚假的分句时间。通过相同 `paper.id + article.id` 重新导入英文分句内容完全相同、时间正确的精听文件夹，可以补齐分句定位；已保存题目仍保留。若重新切分了句子，需核对文章身份及原文冲突提示，避免将不同录音或文章合并。

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
