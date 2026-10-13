import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const importerPath = new URL('../app/src/main/assets/web/importer.js', import.meta.url);
const importer = await readFile(importerPath, 'utf8');
const { parseFolder, mergePapers, parseSubtitle, parseLrc } = await import(`data:text/javascript;base64,${Buffer.from(importer).toString('base64')}`);
const file = (path, text, url = `local:${path}`) => ({ path, text: typeof text === 'object' ? JSON.stringify(text) : text, url });
const options = ['First', 'Second', 'Third', 'Fourth'].map((text, index) => ({ id: String.fromCharCode(65 + index), text }));

function material(mode, transcript, questions = []) {
  return { mode, name: mode === 'intensive' ? '精听' : '做题', files: [
    file('paper-1/paper.json', { id: 'paper-1', title: 'Paper one', year: 2025, session: '12-set1', articles: [
      { id: 'conversation-1', title: 'Conversation one', audio: { [mode]: 'conversation-1/audio.mp3' },
        transcript: 'conversation-1/transcript.json', questions: 'conversation-1/questions.json' },
    ] }),
    file('paper-1/conversation-1/audio.mp3', undefined, `local:${mode}`),
    file('paper-1/conversation-1/transcript.json', transcript),
    file('paper-1/conversation-1/questions.json', questions),
  ] };
}

test('two separately imported mode folders align by canonical IDs and retain role audio', async () => {
  const intensive = await parseFolder(material('intensive', [{ start: 2.1, end: 4.5, en: 'Hello.', zh: '你好。' }]));
  const exam = await parseFolder(material('exam', [], [{ id: 'q01', number: 1, prompt: 'What was said?', options, answer: 'B', start: 4.5, end: 6 }]));
  const merged = mergePapers(intensive.papers, exam.papers);
  assert.equal(merged.papers.length, 1);
  const article = merged.papers[0].articles[0];
  assert.deepEqual(article.audio, { intensive: 'local:intensive', exam: 'local:exam' });
  assert.equal(article.transcript[0].zh, '你好。');
  assert.equal(article.questions[0].answer, 'B');
  assert.equal(article.questions[0].start, 4.5);
  assert.equal(intensive.papers[0].articles[0].questions.length, 0, 'merge must not modify saved library');
  assert.equal(merged.warnings.length, 0);
});

test('per-question folders retain sliced audio and use groupId to align their passage', async () => {
  const result = await parseFolder({ mode: 'exam', name: '做题', files: [
    file('paper-a/passage-1/q01/audio.mp3'),
    file('paper-a/passage-1/q01/question.json', { id: 'q01', groupId: 'passage-1', number: 1, prompt: 'First?', options, answer: '' }),
    file('paper-a/passage-1/q02/audio.mp3'),
    file('paper-a/passage-1/q02/question.json', { id: 'q02', groupId: 'passage-1', number: 2, prompt: 'Second?', options, answer: 'D' }),
  ] });
  const article = result.papers[0].articles[0];
  assert.equal(article.id, 'passage-1');
  assert.equal(article.questions.length, 2);
  assert.equal(article.questions[0].audioUrl, 'local:paper-a/passage-1/q01/audio.mp3');
  assert.equal(article.questions[0].answer, undefined, 'missing answers must not become correct answers');
  assert.deepEqual(article.audio, {}, 'question slice must not replace shared passage audio');
});

test('only selected relative files can supply content or audio', async () => {
  const input = material('exam', [], [{ id: 'q01', number: 1, prompt: 'Question', options, audioUrl: 'https://unselected.example/audio.mp3' }]);
  input.files.push(file('../secret.txt', 'secret'), file('C:\\outside\\secret.txt', 'secret'), file('%2e%2e/private.txt', 'secret'));
  input.files[0].text = JSON.stringify({ id: 'paper-1', articles: [{ id: 'conversation-1', audio: '../outside.mp3', transcript: '/secret.txt', questions: 'conversation-1/questions.json' }] });
  const result = await parseFolder(input);
  assert.equal(result.warnings.filter(item => item.code === 'UNSAFE_PATH').length, 3);
  assert.ok(result.warnings.some(item => item.code === 'UNSAFE_REFERENCE'));
  assert.deepEqual(result.papers[0].articles[0].audio, {});
  assert.equal(result.papers[0].articles[0].questions[0].audioUrl, undefined);
});

test('conflicting identity and question content report collisions without overwriting answers', async () => {
  const first = await parseFolder(material('exam', [], [{ id: 'q01', number: 1, prompt: 'Same', options, answer: 'A' }]));
  const second = await parseFolder(material('exam', [], [{ id: 'q01', number: 1, prompt: 'Same', options, answer: 'D' }]));
  const result = mergePapers(first.papers, second.papers);
  assert.equal(result.papers[0].articles[0].questions[0].answer, 'A');
  assert.ok(result.warnings.some(item => item.code === 'QUESTION_ID_COLLISION'));
  second.papers[0].year = 2011;
  assert.ok(mergePapers(first.papers, second.papers).warnings.some(item => item.code === 'PAPER_ID_COLLISION'));
});

test('different transcripts cannot bind a different mode recording to the same material identity', async () => {
  const first = await parseFolder(material('intensive', [{ start: 1, en: 'The correct passage.', zh: '' }]));
  const other = await parseFolder(material('exam', [{ start: 1, en: 'An unrelated passage.', zh: '' }], [{ id: 'q01', number: 1, prompt: 'Wrong passage?', options }]));
  const result = mergePapers(first.papers, other.papers);
  assert.ok(result.warnings.some(item => item.code === 'TRANSCRIPT_CONFLICT'));
  assert.deepEqual(result.papers[0].articles[0].audio, { intensive: 'local:intensive' });
  assert.equal(result.papers[0].articles[0].questions.length, 0);
});

test('malformed explicit manifests are not silently reinterpreted', async () => {
  const result = await parseFolder({ mode: 'intensive', name: 'paper', files: [file('paper.json', '{broken'), file('article/audio.mp3')] });
  assert.equal(result.papers.length, 0);
  assert.ok(result.warnings.some(item => item.code === 'INVALID_JSON'));
});

test('SRT and authored LRC timestamps remain seekable; untimed TXT does not acquire synthetic timestamps', async () => {
  const srt = parseSubtitle('1\n00:00:02,500 --> 00:00:04,100\nHello there.\n你好。\n\n2\n00:00:04,100 --> 00:00:05,000\nGoodbye.');
  assert.equal(srt[0].start, 2.5);
  assert.equal(srt[0].zh, '你好。');
  assert.equal(srt[1].timed, true);
  assert.equal(parseLrc('[00:12.34]Hello\n[00:15.90]Next')[0].end, 15.9);
  const result = await parseFolder({ name: 'paper', mode: 'intensive', files: [file('article/audio.mp3'), file('article/transcript.txt', 'First line.\nSecond line.'), file('article/translation.txt', '第一句。')] });
  assert.ok(result.papers[0].articles[0].transcript.every(row => row.timed === false));
  assert.ok(result.warnings.some(item => item.code === 'TRANSLATION_ALIGNMENT'));
});

test('noncontiguous question clips preserve piecewise passage mapping', async () => {
  const timeline = [{ clipStart: 0, clipEnd: 100.08, articleStart: 0 }, { clipStart: 100.08, clipEnd: 118.52, articleStart: 105.46 }];
  const result = await parseFolder(material('exam', [], [{ id: 'q09', number: 9, prompt: 'Question', options, answer: 'A', audioTimeline: timeline }]));
  assert.deepEqual(result.papers[0].articles[0].questions[0].audioTimeline, timeline);
});
