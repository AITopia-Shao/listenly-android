import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const importerPath = new URL('../app/src/main/assets/web/importer.js', import.meta.url);
const importer = await readFile(importerPath, 'utf8');
const { parseFolder, mergePapers, parseSubtitle, parseLrc, validateIntensiveTranscript, normalizePaper } = await import(importerPath.href);
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

test('SRT and authored LRC timestamps remain seekable; new untimed TXT is rejected without inventing timestamps', async () => {
  const srt = parseSubtitle('1\n00:00:02,500 --> 00:00:04,100\nHello there.\n你好。\n\n2\n00:00:04,100 --> 00:00:05,000\nGoodbye.');
  assert.equal(srt[0].start, 2.5);
  assert.equal(srt[0].zh, '你好。');
  assert.equal(srt[1].timed, true);
  assert.equal(parseLrc('[00:12.34]Hello\n[00:15.90]Next')[0].end, 15.9);
  const input = { name: 'paper', mode: 'intensive', files: [file('article/audio.mp3'), file('article/transcript.txt', 'First line.\nSecond line.'), file('article/translation.txt', '第一句。')] };
  const result = await parseFolder(input);
  assert.equal(result.rejected, true);
  assert.deepEqual(result.papers, []);
  assert.ok(result.warnings.some(item => item.code === 'TRANSLATION_ALIGNMENT'));
  assert.ok(result.warnings.some(item => item.code === 'TIMED_TRANSCRIPT_REQUIRED' && /article/.test(item.message)));
  const restored = await parseFolder(input, { restore: true });
  assert.ok(restored.papers[0].articles[0].transcript.every(row => row.timed === false));
  assert.equal(restored.rejected, undefined, 'an existing imported library must survive upgrade');
});

test('noncontiguous question clips preserve piecewise passage mapping', async () => {
  const timeline = [{ clipStart: 0, clipEnd: 100.08, articleStart: 0 }, { clipStart: 100.08, clipEnd: 118.52, articleStart: 105.46 }];
  const result = await parseFolder(material('exam', [], [{ id: 'q09', number: 9, prompt: 'Question', options, answer: 'A', audioTimeline: timeline }]));
  assert.deepEqual(result.papers[0].articles[0].questions[0].audioTimeline, timeline);
});

test('new intensive folders accept real JSON, SRT and LRC sentence coordinates', async () => {
  const json = await parseFolder(material('intensive', [{ start: 0, en: 'First sentence.' }, { start: 2.5, end: 4, en: 'Second sentence.' }]));
  assert.equal(json.papers.length, 1);
  assert.deepEqual(json.papers[0].articles[0].transcript.map(row => row.start), [0, 2.5]);
  for (const [extension, text] of [
    ['srt', '1\n00:00:00,000 --> 00:00:02,500\nFirst sentence.\n第一句。\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond sentence.'],
    ['lrc', '[00:00.00]First sentence.\n[00:02.50]Second sentence.'],
  ]) {
    const result = await parseFolder({ name: 'paper', mode: 'intensive', files: [file('article/audio.mp3'), file(`article/transcript.${extension}`, text)] });
    assert.equal(result.papers.length, 1, extension);
    assert.deepEqual(result.papers[0].articles[0].transcript.map(row => row.start), [0, 2.5]);
    assert.ok(result.papers[0].articles[0].transcript.every(row => row.timed));
  }
  const single = await parseFolder(material('intensive', [{ start: 0, en: 'A complete short utterance.' }]));
  assert.equal(single.papers.length, 1, 'one genuinely authored sentence starting at zero is valid');
});

test('every new intensive sentence must contain English and a distinct valid time', async t => {
  const cases = [
    ['untimed marker', [{ start: 1, en: 'First.', timed: false }]],
    ['missing time', [{ en: 'First.' }]],
    ['negative time', [{ start: -1, en: 'First.' }]],
    ['negative alias time', [{ startTime: -1, en: 'First.' }]],
    ['negative end', [{ start: 0, end: -1, en: 'First.' }]],
    ['equal end', [{ start: 1, end: 1, en: 'First.' }]],
    ['duplicate time', [{ start: 2, en: 'First.' }, { start: 2, en: 'Second.' }]],
    ['synthetic zero times', [{ start: 0, en: 'First.' }, { start: 0, en: 'Second.' }]],
    ['missing English', [{ start: 0, zh: '只有译文。' }]],
    ['empty sentence', [{ start: 0, en: ' ' }, { start: 1, en: 'Valid sentence.' }]],
    ['invalid sentence object', [null, { start: 1, en: 'Valid sentence.' }]],
    ['string-only text', ['First sentence.', 'Second sentence.']],
  ];
  for (const [label, transcript] of cases) await t.test(label, async () => {
    const result = await parseFolder(material('intensive', transcript));
    assert.equal(result.rejected, true);
    assert.deepEqual(result.papers, []);
    assert.ok(result.warnings.some(item => item.code === 'TIMED_IMPORT_REJECTED'));
  });
});

test('new intensive transcript coordinates honor declared positive audio duration and nonempty audio files', async () => {
  for (const [duration, transcript] of [
    [0, [{ start: 0, en: 'First.' }]],
    [-1, [{ start: 0, en: 'First.' }]],
    ['invalid', [{ start: 0, en: 'First.' }]],
    [4, [{ start: 4, en: 'First.' }]],
    [4, [{ start: 0, end: 5, en: 'First.' }]],
  ]) {
    const input = material('intensive', transcript);
    const manifest = JSON.parse(input.files[0].text);
    manifest.articles[0].duration = duration;
    input.files[0].text = JSON.stringify(manifest);
    assert.equal((await parseFolder(input)).rejected, true, String(duration));
  }
  const emptyAudio = material('intensive', [{ start: 0, en: 'First.' }]);
  emptyAudio.files[1].size = 0;
  assert.equal((await parseFolder(emptyAudio)).rejected, true);
  const noAudio = material('intensive', [{ start: 0, en: 'First.' }]);
  noAudio.files.splice(1, 1);
  assert.equal((await parseFolder(noAudio)).rejected, true);
});

test('invalid cues are not silently dropped to make a partially timed new folder pass', async () => {
  for (const [extension, text] of [
    ['srt', '1\n00:00:00,000 --> 00:00:02,000\nValid sentence.\n\n2\n00:00:03,000 --> 00:00:01,000\nInvalid sentence.'],
    ['lrc', '[00:00]Valid sentence.\n[00:70]Invalid sentence.'],
    ['lrc', '[00:00]Valid sentence.\nUntimed sentence.'],
  ]) {
    const result = await parseFolder({ mode: 'intensive', name: 'paper', files: [file('article/audio.mp3'), file(`article/transcript.${extension}`, text)] });
    assert.equal(result.rejected, true, extension);
    assert.deepEqual(result.papers, []);
  }
});

test('one invalid intensive article rejects the whole selection atomically and leaves the saved library intact', async () => {
  const existing = await parseFolder(material('exam', [], [{ id: 'q01', number: 1, options, answer: 'D' }]));
  const saved = JSON.stringify(existing.papers);
  const input = material('intensive', [{ start: 0, en: 'Valid sentence.' }]);
  const manifest = JSON.parse(input.files[0].text);
  manifest.articles.push({ id: 'invalid-article', title: 'Needs timing', audio: 'invalid-article/audio.mp3', transcript: 'invalid-article/transcript.txt' });
  input.files[0].text = JSON.stringify(manifest);
  input.files.push(file('paper-1/invalid-article/audio.mp3'), file('paper-1/invalid-article/transcript.txt', 'Untimed sentence.'));
  const parsed = await parseFolder(input);
  assert.equal(parsed.rejected, true);
  assert.deepEqual(parsed.papers, []);
  assert.ok(parsed.warnings.some(item => /Needs timing/.test(item.message)));
  assert.deepEqual(mergePapers(existing.papers, parsed.papers).papers, existing.papers);
  assert.equal(JSON.stringify(existing.papers), saved);
});

test('stored legacy papers stay readable and can receive a correctly timed import without losing quiz answers', async () => {
  const input = material('intensive', [{ start: 0, en: 'First.', timed: false }, { start: 0, en: 'Second.', timed: false }], [{ id: 'q01', number: 1, options, answer: 'C' }]);
  const restored = await parseFolder(input, { restore: true });
  const normalized = normalizePaper(restored.papers[0]);
  assert.equal(normalized.paper.articles[0].transcript.length, 2);
  assert.ok(normalized.paper.articles[0].transcript.every(row => row.timed === false));
  assert.equal(normalized.paper.articles[0].questions[0].answer, 'C');
  assert.ok(validateIntensiveTranscript(normalized.paper.articles[0]).length);
  const fresh = await parseFolder(material('intensive', [{ start: 0, en: 'First.' }, { start: 2, en: 'Second.' }]));
  const merged = mergePapers(restored.papers, fresh.papers);
  assert.equal(merged.papers[0].articles[0].questions[0].answer, 'C');
  assert.deepEqual(merged.papers[0].articles[0].transcript.map(row => row.start), [0, 2]);
  assert.deepEqual(validateIntensiveTranscript(merged.papers[0].articles[0]), []);
  assert.ok(restored.papers[0].articles[0].transcript.every(row => row.timed === false), 'merging an upgrade never mutates saved data');
});
