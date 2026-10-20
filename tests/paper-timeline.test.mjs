import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paperAudio, articleStart, articleEnd, paperDuration, sentenceTime, migrateLegacyPosition,
  articleAtTime, paperCollection, orderedImports, normalizePaperTimeline, validatePaperTimeline,
} from '../app/src/main/assets/web/paper-timeline.js';
import { mergePapers, parseFolder } from '../app/src/main/assets/web/importer.js';

const options = [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }];
const question = (id = 'q1') => ({ id, number: 1, prompt: 'Question', options: options.map(row => ({ ...row })), answer: 'A' });
const article = (id = 'a', start = 10, end = 30) => ({
  id, title: id, start, end, duration: end - start,
  audio: { intensive: 'old.mp3', exam: 'old.mp3' },
  transcript: [{ start: 1, end: 4, en: `This is ${id}.`, zh: `译文 ${id}` }],
  questions: [question(`${id}-q1`)],
});
const paper = (overrides = {}) => ({
  id: 'paper', title: 'Paper', year: 2025, session: '06-set1', schemaVersion: 2,
  audio: 'old.mp3', duration: 90, articles: [article('a', 10, 30), article('b', 40, 70)],
  ...overrides,
});
const clone = value => structuredClone(value);
const replacement = old => ({ ...clone(old), audio: 'new.mp3' });

test('a known chapter start migrates the old relative position into the full recording exactly once', () => {
  assert.equal(migrateLegacyPosition({ start: 34.41215419501134 }, 5.5), 39.91215419501134);
  assert.equal(migrateLegacyPosition({ start: 0 }, 12), 12, 'zero is an authored start too');
  assert.equal(migrateLegacyPosition({ start: 20 }, 0), 20, 'a saved beginning retains the chapter offset');
});

test('an unlocated historical chapter never promotes its clip position into a guessed full-paper position', () => {
  for (const row of [undefined, null, {}, { start: undefined }, { start: null }, { start: NaN }, { start: Infinity }, { start: -1 }])
    assert.equal(migrateLegacyPosition(row, 30), undefined);
});

test('invalid old relative positions remain unmigrated even when the chapter start is known', () => {
  for (const time of [undefined, null, NaN, Infinity, -Infinity, -1, '30'])
    assert.equal(migrateLegacyPosition({ start: 100 }, time), undefined);
});

test('one full recording owns chapter boundaries and sentence coordinates', () => {
  const suite = paper();
  assert.equal(paperAudio(suite), 'old.mp3');
  assert.equal(paperAudio({ audio: { url: 'full.mp3' } }), 'full.mp3');
  assert.equal(paperDuration(suite), 90);
  assert.equal(paperDuration({ articles: suite.articles }), 70);
  assert.equal(articleStart(suite.articles[0]), 10);
  assert.equal(articleEnd(suite.articles[0]), 30);
  assert.equal(sentenceTime(suite.articles[0], suite.articles[0].transcript[0]), 11);
  assert.equal(articleAtTime(suite, 9.99), null);
  assert.equal(articleAtTime(suite, 10)?.id, 'a');
  assert.equal(articleAtTime(suite, 29.99)?.id, 'a');
  assert.equal(articleAtTime(suite, 30), null, 'gaps do not select a previous chapter');
  assert.equal(articleAtTime(suite, 40)?.id, 'b');
  assert.equal(articleAtTime(suite, 70), null);
});

test('a fractional seek rounded by the audio decoder stays in the requested chapter', () => {
  const boundary = 34.41215419501134;
  const suite = paper({ articles: [article('a', 0, boundary), article('b', boundary, 70)] });
  assert.equal(articleAtTime(suite, 34.412154)?.id, 'b');
  assert.equal(articleAtTime(suite, boundary)?.id, 'b');
  assert.equal(articleAtTime(suite, boundary - .001)?.id, 'a');
  const gap = paper({ articles: [article('a', 0, 30), article('b', boundary, 70)] });
  assert.equal(articleAtTime(gap, 30), null);
  assert.equal(articleAtTime(gap, boundary - .001), null);
  for (const time of [NaN, Infinity, -Infinity, -1]) assert.equal(articleAtTime(suite, time), null);
});

test('unlocated historical chapters do not gain seekable boundaries', () => {
  const legacy = { id: 'cet6-legacy', articles: [
    { id: 'a', duration: 20, audio: { intensive: 'a.mp3' }, questions: [question()] },
    { id: 'b', duration: 30, audio: { intensive: 'b.mp3' }, questions: [] },
  ] };
  const before = clone(legacy);
  const normalized = normalizePaperTimeline(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(paperAudio(normalized), null, 'clip concatenation is not inferred');
  assert.equal(normalized.articles[0].start, undefined);
  assert.equal(normalized.articles[1].end, undefined);
  assert.equal(articleAtTime(normalized, 5), null);
  assert.equal(normalized.articles[0].questions[0].id, 'q1');
  assert.deepEqual(paperCollection(normalized), { id: 'cet6', title: '六级合集' });
});

test('a trusted single old recording can become its own complete paper without changing IDs', () => {
  const source = { id: 'original-one', articles: [{ ...article('only', 0, 20), start: undefined, end: undefined, duration: 20 }] };
  const result = normalizePaperTimeline(source);
  assert.equal(result.audio, 'old.mp3');
  assert.equal(result.duration, 20);
  assert.equal(result.articles[0].start, 0);
  assert.equal(result.articles[0].end, 20);
  assert.equal(result.articles[0].questions[0].id, 'only-q1');
  assert.equal(source.articles[0].start, undefined);
});

test('timeline validation accepts authored gaps but rejects overlap and out-of-range chapters', () => {
  assert.deepEqual(validatePaperTimeline(paper()), []);
  for (const [start, end] of [[-1, 30], [40, 40], [40, 95], [Infinity, 70], [NaN, 70]]) {
    const suite = paper(); suite.articles[1].start = start; suite.articles[1].end = end;
    assert.ok(validatePaperTimeline(suite).length, `${start}..${end} must be rejected`);
  }
  const overlap = paper(); overlap.articles[1].start = 20;
  assert.ok(validatePaperTimeline(overlap).length);
});

test('full timeline validation rejects empty chapters, invalid sources and malformed sentence ends', () => {
  assert.equal(paperAudio({ audio: { url: 42 } }), null);
  assert.equal(paperAudio({ audio: '   ' }), null);
  for (const next of [paper({ articles: [] }), paper({ audio: null }), paper({ duration: NaN }), paper({ duration: 0 })])
    assert.ok(validatePaperTimeline(next).length);
  for (const end of [Infinity, NaN, -1, 1, 31]) {
    const next = paper(); next.articles[0].transcript[0].end = end;
    assert.ok(validatePaperTimeline(next).length, `sentence end ${end} must be rejected`);
  }
});

test('invalid full recording replacement cannot alter even an earlier valid chapter', () => {
  const old = paper(); const before = clone(old); const next = replacement(old);
  next.articles[0].start = 0;
  next.articles[1].end = 99;
  const merged = mergePapers([old], [next]);
  assert.deepEqual(merged.papers[0], old);
  assert.deepEqual(old, before);
  assert.ok(merged.warnings.some(row => row.code === 'INVALID_PAPER_TIMELINE'));
});

test('paper identity conflicts reject the complete source and chapter replacement', () => {
  for (const change of [
    next => { next.year = 2024; },
    next => { next.session = '12-set1'; },
    next => { next.source = { checksum: 'other' }; },
  ]) {
    const old = paper({ source: { checksum: 'original' } });
    const next = replacement(old); change(next);
    const merged = mergePapers([old], [next]);
    assert.deepEqual(merged.papers[0], old);
    assert.ok(merged.warnings.some(row => row.code === 'PAPER_ID_COLLISION'));
  }
});

test('shared article text or checksum conflicts reject the entire incoming recording', () => {
  for (const change of [
    next => { next.articles[1].transcript[0].en = 'An unrelated recording.'; },
    next => { next.articles[1].source = { checksum: 'different' }; },
  ]) {
    const old = paper(); old.articles[1].source = { checksum: 'known' };
    const next = replacement(old); next.articles[0].start = 0; change(next);
    const merged = mergePapers([old], [next]);
    assert.deepEqual(merged.papers[0], old);
    assert.ok(merged.warnings.some(row => ['TRANSCRIPT_CONFLICT', 'ARTICLE_ID_COLLISION'].includes(row.code)));
  }
});

test('a question conflict rejects the new full recording before any markers are applied', () => {
  const old = paper(); const next = replacement(old);
  next.articles[0].start = 0;
  next.articles[1].questions[0].answer = 'B';
  const merged = mergePapers([old], [next]);
  assert.deepEqual(merged.papers[0], old);
  assert.ok(merged.warnings.some(row => row.code === 'QUESTION_ID_COLLISION'));
});

test('same-content corrected recording atomically replaces coordinates while preserving translations and IDs', () => {
  const old = paper(); const before = clone(old); const next = replacement(old);
  next.articles[0].start = 0; next.articles[0].end = 32;
  next.articles[1].start = 42; next.articles[1].end = 75;
  for (const row of next.articles) {
    row.transcript[0].start = 3; row.transcript[0].end = 6; row.transcript[0].zh = '';
    row.questions[0].answer = undefined;
  }
  const merged = mergePapers([old], [next]);
  assert.deepEqual(merged.warnings, []);
  assert.equal(merged.papers[0].audio, 'new.mp3');
  assert.deepEqual(merged.papers[0].articles.map(row => [row.id, row.start, row.end, row.duration]), [['a', 0, 32, 32], ['b', 42, 75, 33]]);
  assert.equal(merged.papers[0].articles[0].transcript[0].start, 3, 'old start must not leak into new recording');
  assert.equal(merged.papers[0].articles[0].transcript[0].end, 6);
  assert.equal(merged.papers[0].articles[0].transcript[0].zh, '译文 a');
  assert.equal(merged.papers[0].articles[0].questions[0].id, 'a-q1');
  assert.equal(merged.papers[0].articles[0].questions[0].answer, 'A');
  assert.deepEqual(merged.papers[0].articles[0].audio, { intensive: 'new.mp3', exam: 'new.mp3' });
  assert.deepEqual(old, before, 'existing library is immutable until importer commits the complete merge');
  assert.equal(next.articles[0].transcript[0].zh, '', 'incoming metadata is immutable too');
});

test('same prose can be resegmented without carrying old sentence positions into the replacement', () => {
  const old = paper(); const next = replacement(old);
  old.articles[0].transcript = [{ start: 1, end: 4, en: 'This is a. Another sentence.', zh: '旧的整段翻译' }];
  next.articles[0].transcript = [
    { start: 0, end: 3, en: 'This is a.', zh: '新译文' },
    { start: 5, end: 8, en: 'Another sentence.', zh: '' },
  ];
  const merged = mergePapers([old], [next]);
  assert.deepEqual(merged.warnings, []);
  assert.deepEqual(merged.papers[0].articles[0].transcript, next.articles[0].transcript);
});

test('a full replacement must include every existing located chapter marker', () => {
  const old = paper(); const next = replacement(old); next.articles.pop();
  const merged = mergePapers([old], [next]);
  assert.deepEqual(merged.papers[0], old);
  assert.ok(merged.warnings.some(row => row.code === 'INVALID_PAPER_TIMELINE'));
});

test('old unlocated chapter and question identities survive a complete authored import', () => {
  const old = paper();
  const unlocated = article('historical'); delete unlocated.start; delete unlocated.end;
  old.articles.push(unlocated);
  const next = replacement(paper());
  const merged = mergePapers([old], [next]);
  assert.deepEqual(merged.warnings, []);
  assert.equal(merged.papers[0].audio, 'new.mp3');
  const retained = merged.papers[0].articles.find(row => row.id === 'historical');
  assert.equal(retained.start, undefined);
  assert.equal(retained.end, undefined);
  assert.equal(retained.questions[0].id, 'historical-q1');
  assert.equal(articleAtTime(merged.papers[0], 5), null);
});

test('duplicate chapter IDs and empty full imports cannot replace saved content', () => {
  const old = paper();
  const duplicate = replacement(old); duplicate.articles[1].id = 'a';
  const empty = replacement(old); empty.articles = [];
  for (const next of [duplicate, empty]) {
    const merged = mergePapers([old], [next]);
    assert.deepEqual(merged.papers[0], old);
    assert.ok(merged.warnings.length);
  }
});

test('a schema-v2 folder resolves one source and normalizes clock-form chapter markers before duration validation', async () => {
  const parsed = await parseFolder({ mode: 'intensive', name: 'Whole paper', files: [
    { path: 'suite/paper.json', text: JSON.stringify({ schemaVersion: 2, id: 'suite', audio: 'full.wav', duration: '01:00',
      articles: [{ id: 'one', start: '00:10', end: '00:30', transcript: [{ start: 0, end: 3, en: 'First timed sentence.' }], questions: [question()] }] }) },
    { path: 'suite/full.wav', url: 'local:whole-paper', size: 1024 },
  ] });
  assert.notEqual(parsed.rejected, true);
  assert.equal(parsed.papers.length, 1);
  assert.equal(parsed.papers[0].audio, 'local:whole-paper');
  assert.equal(parsed.papers[0].duration, 60);
  assert.equal(parsed.papers[0].articles[0].start, 10);
  assert.equal(parsed.papers[0].articles[0].end, 30);
  assert.equal(parsed.papers[0].articles[0].duration, 20);
  assert.deepEqual(parsed.papers[0].articles[0].audio, { intensive: 'local:whole-paper', exam: 'local:whole-paper' });
});

test('an explicit new full recording with invalid markers is rejected rather than silently reinterpreted as clips', async () => {
  const parsed = await parseFolder({ mode: 'intensive', name: 'Bad whole paper', files: [
    { path: 'suite/paper.json', text: JSON.stringify({ schemaVersion: 2, id: 'suite', audio: 'full.wav', duration: 60,
      articles: [{ id: 'one', start: 50, end: 70, transcript: [{ start: 0, en: 'First timed sentence.' }] }] }) },
    { path: 'suite/full.wav', url: 'local:whole-paper', size: 1024 },
  ] });
  assert.equal(parsed.rejected, true);
  assert.deepEqual(parsed.papers, []);
  assert.ok(parsed.warnings.some(row => row.code === 'INVALID_PAPER_TIMELINE'));
});

test('restoring imports uses authored creation order rather than random UUID key order and preserves undated legacy order', () => {
  const rows = [
    { id: '000-newest', createdAt: 300 },
    { id: 'old-undated-b' },
    { id: 'native-middle', importedAt: 200 },
    { id: 'old-undated-a' },
    { id: 'ffff-oldest', createdAt: 100 },
    { id: 'same-time-last', createdAt: 300 },
  ];
  const before = clone(rows);
  assert.deepEqual(orderedImports(rows).map(row => row.id), ['old-undated-b', 'old-undated-a', 'ffff-oldest', 'native-middle', '000-newest', 'same-time-last']);
  assert.deepEqual(rows, before, 'the IndexedDB result is not sorted in place');
  assert.deepEqual(orderedImports(null), []);
});

test('newest same-content full-recording correction survives chronological restore even with reverse-sorted UUIDs', () => {
  const original = paper(), older = replacement(original), newer = replacement(original);
  older.audio = 'older-correction.mp3'; older.articles[0].start = 0;
  newer.audio = 'newest-correction.mp3'; newer.articles[0].start = 5; newer.articles[0].transcript[0].start = 3;
  const diskOrder = [{ id: '000-newer', createdAt: 200, paper: newer }, { id: 'ffff-older', createdAt: 100, paper: older }];
  const restored = orderedImports(diskOrder).reduce((papers, record) => mergePapers(papers, [record.paper]).papers, [original]);
  assert.equal(restored[0].audio, 'newest-correction.mp3');
  assert.equal(restored[0].articles[0].start, 5);
  assert.equal(restored[0].articles[0].transcript[0].start, 3);
  assert.equal(restored[0].articles[0].questions[0].id, 'a-q1');
});
