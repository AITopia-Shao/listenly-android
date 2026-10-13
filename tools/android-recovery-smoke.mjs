/** Optional fault-injection check, restricted to this project's emulator AVDs. */
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const [serial, label = 'renderer-recovery'] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('Explicit emulator serial required');
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
const adb = process.env.ADB || (sdk ? path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') :
  process.platform === 'win32' ? 'C:/Program Files (x86)/Android/android-sdk/platform-tools/adb.exe' : 'adb');
const output = path.resolve('.build/runtime-results', label);
await mkdir(output, {recursive: true});
const result = {serial, label, checkedAt: new Date().toISOString(), intentionalRendererCrash: true};
const run = (args, binary = false) => execFileSync(adb, ['-s', serial, ...args], {
  encoding: binary ? undefined : 'utf8', timeout: 45000, windowsHide: true
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let forwarded = false;
let socket;

async function connect() {
  const pid = run(['shell', 'pidof', 'cn.listenly.app']).trim();
  run(['forward', 'tcp:9334', `localabstract:webview_devtools_remote_${pid}`]);
  forwarded = true;
  const targets = await (await fetch('http://127.0.0.1:9334/json')).json();
  const target = targets.find(item => item.type === 'page' && item.url.includes('listenly.local'));
  assert.ok(target, 'The app WebView has loaded');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(callback.timer);
    message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result);
  });
  const rpc = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => {
      if (pending.delete(key)) reject(new Error(`${method} timed out`));
    }, timeout);
    pending.set(key, {resolve, reject, timer});
    socket.send(JSON.stringify({id: key, method, params}));
  });
  const evaluate = async expression => {
    const response = await rpc('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  return {pid, rpc, evaluate};
}

async function dumpUI(name) {
  run(['shell', 'uiautomator', 'dump', '/sdcard/listenly-recovery-ui.xml']);
  const xml = run(['shell', 'cat', '/sdcard/listenly-recovery-ui.xml']);
  await writeFile(path.join(output, name + '.xml'), xml);
  return xml;
}

try {
  assert.equal(run(['shell', 'getprop', 'ro.kernel.qemu']).trim(), '1', 'Fault injection requires an emulator');
  result.avd = run(['emu', 'avd', 'name']).trim().split(/\r?\n/)[0].trim();
  assert.ok(result.avd.startsWith('Listenly_'), 'Only this project AVD may be tested');
  result.android = run(['shell', 'getprop', 'ro.build.version.release']).trim();
  result.api = run(['shell', 'getprop', 'ro.build.version.sdk']).trim();
  run(['logcat', '-c']);
  result.launch = run(['shell', 'am', 'start', '-W', '-n', 'cn.listenly.app/.MainActivity']);
  await wait(5000);
  const before = await connect();
  result.pidBefore = before.pid;
  for (let i = 0; i < 30; i++) {
    if (await before.evaluate('!!document.querySelector(".focus-card")')) break;
    await wait(500);
    if (i === 29) throw new Error('Homepage did not load before fault injection');
  }
  result.answersBefore = await before.evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
  assert.ok(Object.keys(result.answersBefore).length, 'Use the previously completed quiz as the persistence evidence');
  await writeFile(path.join(output, 'before.png'), run(['exec-out', 'screencap', '-p'], true));
  try {
    await before.rpc('Page.crash', {}, 4000);
    result.crashResponse = 'returned';
  } catch (error) {
    // The intentional renderer exit normally disconnects the command transport.
    result.crashResponse = String(error.message);
  }
  socket.close();
  await wait(4000);
  const xml = await dumpUI('native-diagnostic');
  assert.ok(xml.includes('拾听 · 启动遇到问题'), 'Native recovery screen is displayed');
  assert.ok(xml.includes('页面运行进程已停止'), 'Recovery identifies the stopped renderer');
  assert.ok(xml.includes('didCrash=true'), 'The renderer actually crashed');
  result.pidDuringDiagnostic = run(['shell', 'pidof', 'cn.listenly.app']).trim();
  assert.equal(result.pidDuringDiagnostic, before.pid, 'App Activity remains alive after renderer crash');
  await writeFile(path.join(output, 'native-diagnostic.png'), run(['exec-out', 'screencap', '-p'], true));
  const button = xml.match(/<node\b[^>]*text="重试打开"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(button, 'Native retry button is accessible');
  const [, left, top, right, bottom] = button.map(Number);
  result.retryTap = {x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2)};
  run(['shell', 'input', 'tap', String(result.retryTap.x), String(result.retryTap.y)]);
  await wait(5000);
  const after = await connect();
  for (let i = 0; i < 30; i++) {
    if (await after.evaluate('!!document.querySelector(".focus-card")')) break;
    await wait(500);
    if (i === 29) throw new Error('Homepage did not recover after native retry');
  }
  result.homeAfterRetry = await after.evaluate('document.body.innerText');
  assert.ok(result.homeAfterRetry.includes('拾听'), 'Retry creates a functioning WebView');
  result.answersAfter = await after.evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
  assert.deepEqual(result.answersAfter, result.answersBefore, 'Existing submitted answers survive the renderer crash and retry');
  result.pidAfterRetry = after.pid;
  assert.equal(result.pidAfterRetry, result.pidBefore, 'Retry reuses the Activity process');
  await dumpUI('recovered-home');
  await writeFile(path.join(output, 'recovered-home.png'), run(['exec-out', 'screencap', '-p'], true));
  result.verified = true;
  console.log('PASS: intentional WebView renderer crash shows native diagnostics, Activity stays alive, retry restores the homepage and saved answers.');
} catch (error) {
  result.verified = false;
  result.error = String(error.stack || error);
  console.error(result.error);
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const [name, args, binary] of [
    ['crash.log', ['logcat', '-d', '-b', 'crash', '-v', 'threadtime'], false],
    ['logcat.log', ['logcat', '-d', '-v', 'threadtime'], false],
    ['screen.png', ['exec-out', 'screencap', '-p'], true]
  ]) {
    try { await writeFile(path.join(output, name), run(args, binary)); }
    catch (error) { result[name + 'Error'] = String(error.message); }
  }
  if (forwarded) try { run(['forward', '--remove', 'tcp:9334']); } catch (error) { result.cleanupError = String(error.message); }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
