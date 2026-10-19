# 整套听力材料导入格式（2.0）

在“我的”顶部点 `＋` 导入。精听和做题共用一份套卷清单与整套音频；两个模式可分别补充正文或题目，但 `paper.id`、篇章 `id` 和题目 `id` 必须一致，才能保留答案与收藏。

```text
六级合集/
  cet6-example/
    paper.json
    paper.mp3
```

`paper.json` 的音频路径相对于该文件，只能引用所选文件夹中的文件。也可在一个清单的 `papers` 数组中包含多套。支持MP3、M4A、AAC、PCM WAV等设备可解码格式，不再要求篇章或分题音频。

```json
{
  "schemaVersion": 2,
  "id": "cet6-example",
  "title": "示例套卷",
  "year": 2026,
  "collection": { "id": "cet6", "title": "六级合集" },
  "audio": "paper.mp3",
  "duration": 100,
  "articles": [
    {
      "id": "section-a-1",
      "title": "Section A · 第1篇",
      "start": 10,
      "end": 40,
      "transcript": [
        { "start": 0, "end": 6, "en": "The first sentence.", "zh": "第一句。" },
        { "start": 6, "end": 13, "en": "The second sentence.", "zh": "第二句。" }
      ],
      "questions": [
        {
          "id": "q1", "number": 1,
          "options": [
            { "id": "A", "text": "First option." },
            { "id": "B", "text": "Second option." },
            { "id": "C", "text": "Third option." },
            { "id": "D", "text": "Fourth option." }
          ],
          "answer": "A"
        }
      ]
    },
    {
      "id": "section-a-2", "title": "Section A · 第2篇",
      "start": 45, "end": 80,
      "transcript": [{ "start": 0, "en": "Another passage." }],
      "questions": []
    }
  ]
}
```

`duration` 是完整录音时长；篇章 `start`／`end` 是整套录音中的秒数，按时间递增且不得重叠，允许题间空隙。分句 `start`／`end` 相对于所属篇章，例中第二句实际跳到整套第16秒。分句必须使用真实、严格递增的时间，不平均分配、不猜测；`transcript` 也可引用同目录JSON、SRT、VTT或LRC文件。

新精听导入要求每篇具有英文分句与有效时间；纯TXT、只有译文、未计时文字或重复零时间会整批拒绝。做题导入可以不含原文，但必须有整套音频和有效篇章标记。题干字段可以保留在资料中，六级答题页只呈现选项。

导入会用独立音频元素读取实际时长，核对篇章边界与分句坐标。时长不可读、标记超出录音或任何套卷无效时，不保存本次文件及材料，也不会改动已有答案、正在播放的音频、进度或倍速。清单中的音频位置必须对应同一完整录音；正文或题目内容冲突时，同ID的新录音与标记一起拒绝。

收藏、草稿、答案和完成记录绑定ID，修改标题不改变关联。重新导入同一内容的正确整套录音时，可以原子更新时间标记和分句坐标。旧分篇文件夹仍可恢复查看资料；请用同ID补充整套录音来更新播放。

雅思、托福及自定义合集只需替换 `collection.id` 和 `collection.title`，应用不会把示例或其他考试伪装成真题。单个文本文件最多8MiB，一次最多25,000个文件。Android会复制到应用私有目录，浏览器预览使用IndexedDB，重启后仍可读取。

兼容与已知资料缺口见[整套播放与迁移说明](paper-timeline.md)。
