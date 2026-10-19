import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startPreview } from '../tools/preview.mjs';

let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import(pathToFileURL(path.join(process.env.LOCALAPPDATA, 'ms-playwright-go/1.57.0/package/index.mjs')).href); }
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const output = path.resolve(option('--output') || '.build/import-media-browser');
const web = path.join(output, 'web');
await mkdir(web, { recursive: true });
for (const name of ['import-media.js', 'importer.js', 'paper-timeline.js']) await copyFile(path.join('app/src/main/assets/web', name), path.join(web, name));
// Locally generated original PCM tones test media decoding without private material.
function pcm(seconds) {
  const rate = 8000, length = Math.round(rate * seconds), result = Buffer.alloc(44 + length * 2);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(rate, 24); result.writeUInt32LE(rate * 2, 28); result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34); result.write('data', 36); result.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) result.writeInt16LE(Math.round(Math.sin(i * Math.PI * 440 / rate) * 400), 44 + i * 2);
  return result;
}
for (const name of ['probe-a.wav', 'probe-b.wav', 'probe-c.wav']) await writeFile(path.join(web, name), pcm(1.25));
await writeFile(path.join(web, 'main.wav'), pcm(30));
await writeFile(path.join(web, 'index.html'), '<!doctype html><meta charset="utf-8"><audio id="main-audio" src="main.wav" preload="auto"></audio>');
const result = { checks: [], errors: [], passed: false };
const server = await startPreview(0, web);
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  ...(process.env.LISTENLY_BROWSER_CHANNEL ? { channel: process.env.LISTENLY_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
  headless: true, args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', error => result.errors.push(error.message));
const pass = (label, details) => result.checks.push({ label, details });
try {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#main-audio').readyState >= 1);
  await page.evaluate(async () => {
    window.validate = (await import('./import-media.js')).validateImportedIntensiveMedia;
    const main = document.querySelector('#main-audio');
    main.currentTime = .2; main.playbackRate = 1.25; main.volume = .25;
    await new Promise(resolve => main.addEventListener('seeked', resolve, { once: true }));
    await main.play();
    window.mainEvents = [];
    for (const event of ['emptied', 'loadstart', 'pause', 'seeking', 'ratechange']) main.addEventListener(event, () => window.mainEvents.push(event));
    window.inspectMain = () => ({ src: main.currentSrc, paused: main.paused, rate: main.playbackRate, volume: main.volume, time: main.currentTime, events: [...window.mainEvents] });
    window.article = (id, audio, transcript = [{ start: 0, end: 1, en: 'An original timing fixture.' }]) => ({ id, title: id, audio: { intensive: audio }, transcript });
  });
  const valid = await page.evaluate(async () => {
    const before = window.inspectMain();
    const papers = [{ articles: [window.article('valid', 'probe-a.wav')] }];
    const check = await window.validate(papers);
    return { check, duration: papers[0].articles[0].duration, before, after: window.inspectMain() };
  });
  assert.equal(valid.check.rejected, false); assert.ok(Math.abs(valid.duration - 1.25) < .001);
  assert.equal(valid.after.src, valid.before.src); assert.equal(valid.after.paused, false);
  assert.equal(valid.after.rate, valid.before.rate); assert.equal(valid.after.volume, valid.before.volume);
  assert.ok(valid.after.time >= valid.before.time); assert.deepEqual(valid.after.events, []);
  assert.equal(await page.locator('audio').count(), 1, 'probes never enter the document');
  pass('valid PCM supplies actual duration while the original player keeps playing unchanged', valid);

  const outOfBounds = await page.evaluate(async () => {
    const papers = [{ articles: [window.article('valid', 'probe-a.wav'), window.article('outside', 'probe-b.wav', [{ start: 2, en: 'Outside the actual recording.' }])] }];
    return { check: await window.validate(papers), mutated: papers[0].articles.some(article => article.duration !== undefined) };
  });
  assert.equal(outOfBounds.check.rejected, true); assert.equal(outOfBounds.mutated, false);
  assert.ok(outOfBounds.check.warnings.some(warning => /outside/.test(warning.message)));
  pass('missing declared duration cannot hide a cue beyond decoded audio; failure commits no durations', outOfBounds);

  const unreadable = await page.evaluate(async () => window.validate([{ articles: [window.article('missing', 'does-not-exist.wav')] }]));
  assert.equal(unreadable.rejected, true);
  assert.ok(unreadable.warnings.some(warning => /无法读取/.test(warning.message)));
  pass('a real media error atomically rejects the selection', unreadable);

  await page.route('**/probe-*.wav', async route => { await new Promise(resolve => setTimeout(resolve, 80)); await route.continue(); });
  const bounded = await page.evaluate(async () => {
    const RealAudio = window.Audio;
    const probes = []; let active = 0, maximum = 0, playCalls = 0;
    window.Audio = function () {
      const element = new RealAudio(), record = { element, active: false };
      probes.push(record);
      const load = element.load.bind(element);
      element.load = () => {
        if (element.getAttribute('src') && !record.active) { record.active = true; maximum = Math.max(maximum, ++active); }
        if (!element.getAttribute('src') && record.active) { record.active = false; active--; }
        return load();
      };
      element.play = () => { playCalls++; throw new Error('A metadata probe must never play.'); };
      return element;
    };
    try {
      const articles = [window.article('one', 'probe-a.wav'), window.article('same', 'probe-a.wav'), window.article('two', 'probe-b.wav'), window.article('three', 'probe-c.wav')];
      const check = await window.validate([{ articles }]);
      return { check, count: probes.length, maximum, active, playCalls, cleaned: probes.every(record => !record.element.getAttribute('src') && !record.element.isConnected), durations: articles.map(article => article.duration) };
    } finally { window.Audio = RealAudio; }
  });
  assert.equal(bounded.check.rejected, false); assert.equal(bounded.count, 3);
  assert.equal(bounded.maximum, 2); assert.equal(bounded.active, 0); assert.equal(bounded.playCalls, 0); assert.equal(bounded.cleaned, true);
  assert.ok(bounded.durations.every(duration => Math.abs(duration - 1.25) < .001));
  pass('shared URLs use one probe, at most two decoders run, and every detached probe is released', bounded);
  await page.unroute('**/probe-*.wav');

  await page.route('**/stall.wav', async () => {});
  const timeout = await page.evaluate(async () => {
    const before = window.inspectMain(), start = performance.now();
    const check = await window.validate([{ articles: [window.article('stall', 'stall.wav')] }]);
    return { check, elapsed: performance.now() - start, before, after: window.inspectMain() };
  });
  assert.equal(timeout.check.rejected, true); assert.ok(timeout.elapsed >= 7900 && timeout.elapsed < 12000);
  assert.ok(timeout.check.warnings.some(warning => /超时/.test(warning.message)));
  assert.equal(timeout.after.src, timeout.before.src); assert.equal(timeout.after.paused, false);
  assert.equal(timeout.after.rate, timeout.before.rate); assert.deepEqual(timeout.after.events, []);
  pass('an unresponsive source times out after eight seconds without disturbing the playing article', timeout);
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, output: path.join(output, 'results.json') }));
