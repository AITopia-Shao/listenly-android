/**
 * Real native Compose touch checks. CDP only observes the retained audio engine;
 * controls are located in Android's accessibility tree and tapped through ADB.
 * Installs over existing data, never clears app storage or wipes an AVD.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const [serial, apk, label = 'native-compose', ...flags] = process.argv.slice(2);
assert.match(serial || '', /^emulator-\d+$/, 'Only a project emulator may be used');
assert.ok(apk && /^[a-zA-Z0-9_.-]+$/.test(label), 'Supply an APK and safe evidence label');
assert.ok(flags.every(flag => ['--fixture', '--demo', '--lite'].includes(flag)));
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
const adb = process.env.ADB || (sdk ? path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb');
const output = path.resolve('.build/runtime-results', label);
await mkdir(output, { recursive: true });
const result = {
  serial, apk: path.resolve(apk), label, flags, startedAt: new Date().toISOString(),
  apkSha256: createHash('sha256').update(await readFile(apk)).digest('hex'),
  checks: [], nativeTouches: [],
  measurementScope: 'Emulator functional and frame evidence; not a GT7 120-fps measurement',
};
const run = (args, binary = false) => execFileSync(adb, ['-s', serial, ...args], {
  encoding: binary ? undefined : 'utf8', timeout: 60000, maxBuffer: 24 * 1024 * 1024, windowsHide: true,
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = url => new Promise((resolve, reject) => {
  http.get(url, response => {
    let body = '';
    response.on('data', chunk => body += chunk);
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});
let socket, forwarded = false, evaluate, snapshot;
const pass = (name, data = {}) => { result.checks.push({ name, passed: true, ...data }); console.log('PASS ' + name); };
const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let dumpNumber = 0;
async function tree(stage = 'ui') {
  run(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/listenly-native-ui.xml']);
  const xml = run(['shell', 'cat', '/sdcard/listenly-native-ui.xml']);
  await writeFile(path.join(output, String(++dumpNumber).padStart(3, '0') + '-' + stage + '.xml'), xml);
  assert.ok(!/isn.t responding|keeps stopping/i.test(xml), 'No app or system ANR dialog may be ignored');
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(match => {
    const node = {};
    for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) node[attr[1]] = decode(attr[2]);
    const bounds = (node.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (bounds) node.rect = bounds.slice(1).map(Number);
    return node;
  });
}
async function tap(predicate, name) {
  const nodes = await tree('before-' + name.replace(/[^a-z0-9-]/gi, '-'));
  const node = nodes.find(node => predicate(node) && node.rect && node.rect[2] > node.rect[0] && node.rect[3] > node.rect[1] && node.enabled !== 'false');
  assert.ok(node, 'Native touch target exists: ' + name + '; available: ' + nodes.map(n => n.text || n['content-desc']).filter(Boolean).join(' | '));
  const [left, top, right, bottom] = node.rect;
  const touch = { name, text: node.text, description: node['content-desc'], bounds: node.bounds, x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  run(['shell', 'input', 'tap', String(touch.x), String(touch.y)]);
  result.nativeTouches.push(touch);
  return touch;
}
const matches = (node, text) => node.text === text || node['content-desc'] === text;
const tapText = (text, name = text) => tap(node => matches(node, text), name);
async function poll(read, predicate, description, timeout = 15000) {
  const until = Date.now() + timeout;
  let value;
  while (Date.now() < until) {
    value = await read();
    if (predicate(value)) return value;
    await wait(150);
  }
  throw new Error('Timed out: ' + description + '; last=' + JSON.stringify(value));
}
const stateIs = (predicate, description) => poll(snapshot, value => predicate(value.state, value), description);
const shot = async name => writeFile(path.join(output, name + '.png'), run(['exec-out', 'screencap', '-p'], true));

try {
  assert.equal(run(['shell', 'getprop', 'ro.kernel.qemu']).trim(), '1');
  result.android = run(['shell', 'getprop', 'ro.build.version.release']).trim();
  result.api = Number(run(['shell', 'getprop', 'ro.build.version.sdk']).trim());
  result.avd = run(['emu', 'avd', 'name']).trim().split(/\r?\n/)[0];
  assert.ok(result.avd.startsWith('Listenly_'), 'Only this project AVD is used');
  result.install = run(['install', '-r', path.resolve(apk)]).trim();
  run(['logcat', '-c']);
  run(['shell', 'am', 'force-stop', 'cn.listenly.app']);
  result.launch = run(['shell', 'am', 'start', '-W', '-n', 'cn.listenly.app/.MainActivity']).trim();
  await wait(3500);
  result.pid = run(['shell', 'pidof', 'cn.listenly.app']).trim();
  assert.ok(result.pid);
  run(['forward', 'tcp:9333', 'localabstract:webview_devtools_remote_' + result.pid]);
  forwarded = true;
  const target = await poll(() => json('http://127.0.0.1:9333/json'), targets => targets.some(target => target.url.includes('listenly.local')), 'offline engine debug target');
  socket = new WebSocket(target.find(target => target.url.includes('listenly.local')).webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const requests = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const pending = requests.get(message.id);
    if (pending) { requests.delete(message.id); message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result); }
  });
  evaluate = async expression => {
    const response = await new Promise((resolve, reject) => {
      const id = ++sequence;
      requests.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      setTimeout(() => { if (requests.delete(id)) reject(new Error('Engine observation timed out')); }, 15000).unref();
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  snapshot = () => evaluate('window.listenlyNativeSnapshot&&window.listenlyNativeSnapshot()');
  await poll(snapshot, value => value?.state.ready, 'native engine ready');
  result.initial = await snapshot();
  assert.ok(await evaluate('Android.isNativeUiEnabled()&&!document.querySelector(".focus-card")'), 'Native UI owns the visible interface; legacy DOM is not mounted');
  const homeTree = await tree('home');
  assert.ok(homeTree.some(node => matches(node, '听力')) && homeTree.some(node => matches(node, '资料库')) && homeTree.some(node => matches(node, '我的')));
  assert.ok(!homeTree.some(node => matches(node, '日间') || matches(node, '夜间') || matches(node, '导入材料')));
  await shot('home');
  pass('real Miuix Compose launch and compact home');

  await tapText('播放', 'home-play');
  const firstPlay = await poll(snapshot, value => value.progress.playing && value.progress.time > 0, 'home audio playback');
  assert.equal(firstPlay.state.route, 'home');
  const firstTime = firstPlay.progress.time;
  await tapText('暂停', 'home-pause');
  await poll(snapshot, value => !value.progress.playing, 'home pause');
  await tapText('播放', 'home-replay');
  const replay = await poll(snapshot, value => value.progress.playing && value.progress.time > firstTime, 'second play succeeds');
  assert.equal(replay.state.active.paper, firstPlay.state.active.paper);
  await tapText('暂停', 'home-repause');
  await poll(snapshot, value => !value.progress.playing, 'audio paused for navigation');
  pass('real native home play, pause and repeated play', { firstTime, replayTime: replay.progress.time });

  await tapText('我的', 'profile');
  await stateIs(state => state.route === 'profile', 'profile route');
  const profileTree = await tree('profile');
  assert.ok(profileTree.some(node => matches(node, '日间')) && profileTree.some(node => matches(node, '夜间')));
  assert.ok(profileTree.some(node => matches(node, '学习活跃日历')));
  assert.ok(!profileTree.some(node => matches(node, '设置') || matches(node, '播放速度')));
  run(['shell', 'dumpsys', 'gfxinfo', 'cn.listenly.app', 'reset']);
  for (const theme of ['dark', 'light', 'dark', 'light']) {
    await tapText(theme === 'dark' ? '夜间' : '日间', 'theme-' + theme);
    await stateIs(state => state.theme === theme, 'native ' + theme + ' theme');
    await wait(320);
  }
  result.frameStats = run(['shell', 'dumpsys', 'gfxinfo', 'cn.listenly.app', 'framestats']);
  await writeFile(path.join(output, 'theme-framestats.txt'), result.frameStats);
  delete result.frameStats;
  result.motion = await evaluate('typeof Android.getNativeUiDiagnostics==="function"?JSON.parse(Android.getNativeUiDiagnostics()):null');
  assert.ok(result.motion?.enabled, 'Debug native animation diagnostics are available');
  const segments = result.motion.segments.filter(segment => segment.from !== segment.to && !segment.cancelled);
  assert.ok(segments.length >= 2, 'Native theme slider records several independent transitions');
  for (const segment of segments) {
    const low = Math.min(segment.from, segment.to), high = Math.max(segment.from, segment.to);
    assert.ok(segment.frames.some(frame => frame.position > low + .01 && frame.position < high - .01), 'Native slider has visible intermediate positions');
    assert.ok(segment.frames.every(frame => Number.isFinite(frame.position) && Number.isFinite(frame.velocity)));
  }
  await shot('profile-day');
  pass('native day/night control and profile; no old screenshot overlay', { motionAvailable: !!result.motion });

  await tapText('资料库', 'library');
  await stateIs(state => state.route === 'library', 'library route');
  const beforePreview = (await snapshot()).state.selectedPaper;
  const catalog = (await snapshot()).catalog;
  const paper = catalog.papers.find(p => p.id === beforePreview) || catalog.papers[0];
  const collection = paper.collection;
  await tapText(collection.title, 'expand-collection');
  await wait(500);
  let libraryTree = await tree('expanded-collection');
  assert.ok(libraryTree.some(node => (node.text || '').includes(paper.title) || (node['content-desc'] || '').includes(paper.title)));
  await tap(node => node['content-desc'] === '预览' + paper.title, 'expand-paper');
  await wait(500);
  assert.equal((await snapshot()).state.selectedPaper, beforePreview, 'Expanding a paper only previews it');
  await shot('library-expanded');
  await tapText(collection.title, 'collapse-collection');
  await wait(500);
  libraryTree = await tree('collapsed-collection');
  assert.ok(!libraryTree.some(node => node.text === paper.articles[0].title), 'Collapsed articles leave the accessibility tree');
  await tapText(collection.title, 'reexpand-collection');
  await wait(500);
  // Disclosure state survives hiding a collection; expand only when needed.
  libraryTree = await tree('library-before-open');
  if (!libraryTree.some(node => node.text === paper.articles[0].title || node['content-desc'] === paper.articles[0].title)) {
    await tap(node => node['content-desc'] === '预览' + paper.title, 'reexpand-paper');
    await wait(500);
  }
  const article = paper.articles[0];
  await tap(node => matches(node, article.title) || node['content-desc'] === '打开' + article.title, 'open-article');
  await stateIs(state => state.route === 'practice' && state.active.article === article.id, 'native reader');
  assert.equal((await snapshot()).state.display, 'hidden');
  await tapText('原文', 'show-transcript');
  await stateIs(state => state.display === 'original', 'original transcript');
  await shot('reader');
  const sentence = article.transcript.find(row => row.timed && Number.isFinite(row.start) && row.start > article.start);
  if (sentence) {
    const index = article.transcript.indexOf(sentence);
    await tap(node => node['content-desc'] === '第' + (index + 1) + '句' || node.text === sentence.en, 'sentence-seek');
    const seek = await poll(snapshot, value => value.progress.time >= sentence.start - .15 && value.progress.time < sentence.start + 5, 'sentence seeks full recording');
    pass('real native sentence tap seeks the full paper', { target: sentence.start, actual: seek.progress.time });
  }
  pass('native expandable library previews and hidden-by-default reader');

  await tapText('做题', 'exam-mode');
  await stateIs(state => state.mode === 'exam', 'exam mode');
  const questions = (await snapshot()).state.questions;
  assert.ok(questions.length);
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    if (question.submitted) continue;
    let nodes = await tree('question-' + index);
    const visibleOption = nodes.some(node => (node['content-desc'] || '').includes(question.options[0].text) || node.text === question.options[0].text);
    if (!visibleOption) {
      await tap(node => node['content-desc'] === '展开第' + question.number + '题选项' || node.text === String(question.number), 'expand-question-' + index);
    }
    const correct = question.options.find(option => option.id === question.answer);
    const wrong = question.options.find(option => option.id !== question.answer);
    const choice = index === 0 ? wrong : correct || question.options[0];
    await tap(node => node['content-desc'] === '第' + question.number + '题选项' + choice.key || node.text === choice.text, 'answer-' + index);
    await stateIs(state => state.questions[index].choice === choice.id, 'native answer selected');
  }
  const beforeSubmit = await snapshot();
  if (beforeSubmit.state.canSubmit) {
    await tapText('提交', 'submit-article');
    const graded = await stateIs(state => state.questions.some(q => q.submitted), 'graded feedback');
    const first = graded.state.questions[0];
    assert.ok(first.options.some(option => option.isWrong) && first.options.some(option => option.isCorrect), 'Wrong choice and correct option are both identified');
    await shot('graded-feedback');
    result.graded = graded;
    pass('native submit projects persistent red wrong / green correct feedback');
    if (paper.articles.length > 1) {
      const next = await stateIs(state => state.active.article !== article.id, 'automatic next article after feedback');
      pass('submitted article advances to the next article', { next: next.state.active.article });
    }
  } else {
    assert.ok(beforeSubmit.state.complete, 'An existing completed article remains graded on upgrade');
    pass('existing submitted answers survive installation and remain reviewable');
  }
  await shot('final');
  result.final = await snapshot();
  result.crashLog = run(['logcat', '-d', '-b', 'crash', '-v', 'threadtime']);
  assert.ok(!result.crashLog.includes('Process: cn.listenly.app'), 'No app fatal exception');
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = String(error.stack || error);
  console.error(result.error);
  try { await shot('failure'); } catch {}
  try { if (snapshot) result.failureSnapshot = await snapshot(); } catch {}
  process.exitCode = 1;
} finally {
  try { await writeFile(path.join(output, 'logcat.log'), run(['logcat', '-d', '-v', 'threadtime'])); } catch {}
  try { await writeFile(path.join(output, 'crash.log'), run(['logcat', '-d', '-b', 'crash', '-v', 'threadtime'])); } catch {}
  if (socket) socket.close();
  if (forwarded) try { run(['forward', '--remove', 'tcp:9333']); } catch {}
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}
