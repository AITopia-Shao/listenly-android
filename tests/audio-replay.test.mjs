import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';

// All playback uses the actual app buttons and a real browser media pipeline.
// Seeking to a recording's final second shortens the test without faking ended.
let playwright;
try{playwright=await import('playwright')}
catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const root=process.cwd();
const args=process.argv.slice(2);
const arg=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(arg('--web-root')||path.join(root,args.includes('--demo')?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const output=path.resolve(arg('--output')||path.join(root,'.build/replay-browser/latest'));
await mkdir(output,{recursive:true});
const entry=await readFile(path.join(webRoot,'app.compat.js'));
const result={webRoot,entrySha256:createHash('sha256').update(entry).digest('hex'),browser:'',checks:[],pageErrors:[],requestFailures:[],mediaRequests:[],mediaEvents:[],passed:false};
const browser=await playwright.chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:1});
page.on('pageerror',error=>result.pageErrors.push(error.message));
page.on('requestfailed',request=>result.requestFailures.push({url:request.url(),failure:request.failure()?.errorText}));
page.on('response',response=>{if(/\.(wav|m4a|mp3)(?:[?#]|$)/i.test(response.url()))result.mediaRequests.push({url:response.url(),status:response.status(),requestRange:response.request().headers().range||null,contentRange:response.headers()['content-range']||null})});
await page.addInitScript(()=>{
  window.replayMediaEvents=[];
  document.addEventListener('DOMContentLoaded',()=>{
    const audio=document.querySelector('#audio');
    for(const name of ['loadstart','loadedmetadata','canplay','play','playing','pause','seeking','seeked','ended','error','stalled','waiting','abort','emptied']){
      audio.addEventListener(name,()=>window.replayMediaEvents.push({name,at:performance.now(),src:audio.currentSrc,time:audio.currentTime,duration:audio.duration,paused:audio.paused,ended:audio.ended,seeking:audio.seeking,readyState:audio.readyState,networkState:audio.networkState,error:audio.error?{code:audio.error.code,message:audio.error.message}:null}));
    }
  });
});
const server=await startPreview(0,webRoot);
const base=`http://127.0.0.1:${server.address().port}`;
const click=selector=>page.locator(selector).first().click();
const snapshot=()=>page.locator('#audio').evaluate(audio=>({src:audio.getAttribute('src'),currentSrc:audio.currentSrc,time:audio.currentTime,duration:audio.duration,readyState:audio.readyState,networkState:audio.networkState,seeking:audio.seeking,paused:audio.paused,ended:audio.ended,error:audio.error?{code:audio.error.code,message:audio.error.message}:null}));
async function record(label){const state=await snapshot();assert.equal(state.error,null,label);result.checks.push({label,state});return state}
async function metadata(){await page.waitForFunction(()=>{const a=document.querySelector('#audio');return a.readyState>=1&&Number.isFinite(a.duration)&&a.duration>1&&!a.seeking},{},{timeout:15000})}
async function pause(){if(!(await snapshot()).paused){await click('[data-action="play"]');await page.waitForFunction(()=>document.querySelector('#audio').paused)}}
async function play(label){
  const before=await snapshot();assert.ok(before.paused,`${label}: starts paused`);
  await click('[data-action="play"]');
  const threshold=before.ended?0:before.time;
  await page.waitForFunction(t=>{const a=document.querySelector('#audio');return !a.paused&&!a.ended&&!a.error&&!a.seeking&&a.currentTime>t+.1},threshold,{timeout:15000});
  await record(label);
}
async function finishAndReplay(label,repeats=3){
  for(let i=0;i<repeats;i++){
    await pause();
    await page.locator('#audio').evaluate(a=>a.currentTime=a.duration-.7);
    await page.waitForFunction(()=>!document.querySelector('#audio').seeking);
    await play(`${label}: finish ${i+1}`);
    await page.waitForFunction(()=>{const a=document.querySelector('#audio');return a.ended&&a.paused},{},{timeout:15000});
    await record(`${label}: genuine ended ${i+1}`);
    await play(`${label}: replay after ended ${i+1}`);
  }
  await pause();
}
async function open(paper,article){
  await pause();
  if(await page.locator('[data-action="nav"][data-route="library"]').count())await click('[data-action="nav"][data-route="library"]');
  else{await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="library"]')}
  await click(`[data-action="open"][data-paper="${paper}"][data-article="${article}"]`);
  if(await page.locator('[data-action="mode"][data-mode="intensive"][aria-pressed="false"]').count())await click('[data-action="mode"][data-mode="intensive"]');
  await metadata();
}
async function seek(time){await pause();await page.locator('#audio').evaluate((a,t)=>a.currentTime=t,time);await page.waitForFunction(()=>!document.querySelector('#audio').seeking)}
function slicePcmWave(bytes,start,end){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
  let fmt,data;
  for(let offset=12;offset+8<=bytes.length;){const tag=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);if(tag==='fmt ')fmt=bytes.subarray(offset+8,offset+8+size);if(tag==='data'){data=bytes.subarray(offset+8,offset+8+size);break}offset+=8+size+(size%2)}
  assert.ok(fmt&&data,'recording includes PCM format and data');assert.equal(fmt.readUInt16LE(0),1,'original demo is PCM');
  const blockAlign=fmt.readUInt16LE(12),byteRate=fmt.readUInt32LE(8);
  const sliced=data.subarray(Math.floor(start*byteRate/blockAlign)*blockAlign,Math.floor(end*byteRate/blockAlign)*blockAlign);
  const head=Buffer.alloc(20+fmt.length+8);head.write('RIFF');head.writeUInt32LE(head.length+sliced.length-8,4);head.write('WAVE',8);head.write('fmt ',12);head.writeUInt32LE(fmt.length,16);fmt.copy(head,20);head.write('data',20+fmt.length);head.writeUInt32LE(sliced.length,24+fmt.length);
  return Buffer.concat([head,sliced]);
}
async function createImportedFixture(){
  const directory=path.join(output,'import-fixture','replay-import','article');await mkdir(directory,{recursive:true});
  const recording=await readFile(path.join(webRoot,'media/morning.wav'));
  await writeFile(path.join(directory,'full.wav'),recording);
  await writeFile(path.join(directory,'question.wav'),slicePcmWave(recording,11.268,22.675));
  await writeFile(path.join(path.dirname(directory),'paper.json'),JSON.stringify({id:'replay-import',title:'Repeated playback import',articles:[{id:'article',title:'Original imported audio',audio:{intensive:'article/full.wav',exam:'article/full.wav'},transcript:'article/transcript.json',questions:'article/questions.json'}]}));
  await writeFile(path.join(directory,'transcript.json'),JSON.stringify([{start:0,end:5.329,en:'For years, Emma began every morning by checking her phone.',zh:'多年来，艾玛每天早晨的第一件事就是看手机。'},{start:5.329,end:11.268,en:'Before she even got out of bed, she was already thinking about work.'},{start:11.268,end:16.921,en:'One Monday, she decided to leave her phone in the kitchen overnight.'},{start:16.921,end:22.675,en:'The next morning, she opened the window and made herself a cup of tea.'}]));
  await writeFile(path.join(directory,'questions.json'),JSON.stringify([{id:'q1',number:1,prompt:'Where did Emma leave her phone?',options:[{id:'A',text:'In the kitchen'},{id:'B',text:'In the bedroom'},{id:'C',text:'At work'},{id:'D',text:'Outside'}],answer:'A',audio:'question.wav',start:11.268,end:22.675,audioTimeline:[{clipStart:0,clipEnd:11.407,articleStart:11.268}]}]));
  return path.dirname(path.dirname(directory));
}
async function transientReadFailure(){
  await open('listenly-original','morning');
  await click('[data-action="mode"][data-mode="exam"]');
  await click('[data-action="answer"][data-option="B"]');
  await click('[data-action="submit-answer"]');
  await click('[data-action="mode"][data-mode="intensive"]');
  if(await page.locator('.bookmark:not(.active)').count())await click('[data-action="bookmark"]');
  await seek(6);await play('transient read failure: first playback succeeds');await pause();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));
  const first=await snapshot();
  await open('listenly-original','library');
  const mediaUrl=`${base}/media/morning.wav`;
  let failedRequests=0;
  await page.route(mediaUrl,async route=>{
    if(failedRequests===0){failedRequests++;await route.fulfill({status:503,contentType:'text/plain',body:'Temporary recording read failure'})}
    else await route.continue();
  });
  await click('[data-action="nav"][data-route="library"]');
  await click('[data-action="open"][data-paper="listenly-original"][data-article="morning"]');
  await page.waitForFunction(()=>Boolean(document.querySelector('#audio').error),{},{timeout:15000});
  const failed=await snapshot();
  result.transientReadFailure={purpose:'Fault recovery regression; does not reproduce or identify the GT7-specific cause',first,failed,failedRequests,savedAnswers:saved.answers,savedBookmarks:saved.bookmarks};
  assert.equal(failedRequests,1,'one real media request fails');
  assert.ok(await page.locator('#audio-error').isVisible(),'a real HTTP failure is displayed');
  await page.unroute(mediaUrl);
  await play('transient read failure: click retries with a fresh real media read');
  const recoveredInitial=await snapshot();
  await page.waitForFunction(time=>{const a=document.querySelector('#audio');return !a.paused&&!a.error&&!a.seeking&&a.currentTime>time+.12},recoveredInitial.time,{timeout:15000});
  const recovered=await snapshot();
  assert.ok(recovered.time>=first.time-.2,'recovery retains the saved article position');
  assert.ok(await page.locator('#audio-error').isHidden(),'successful metadata loading clears the error');
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));
  assert.deepEqual(restored.answers,saved.answers,'saved answers survive decoder recovery');
  assert.deepEqual(restored.bookmarks,saved.bookmarks,'bookmarks survive decoder recovery');
  result.transientReadFailure.recoveredInitial=recoveredInitial;result.transientReadFailure.recovered=recovered;result.transientReadFailure.passed=true;
  await pause();
}
async function cancelPendingPlayback(){
  await open('listenly-original','library');
  const mediaUrl=`${base}/media/morning.wav`;
  let delayedRequests=0;
  await page.route(mediaUrl,async route=>{
    delayedRequests++;
    // Delay a real media response so Play is pending when the user leaves.
    await new Promise(resolve=>setTimeout(resolve,750));
    await route.continue().catch(()=>{});
  });
  await click('[data-action="nav"][data-route="library"]');
  await click('[data-action="open"][data-paper="listenly-original"][data-article="morning"]');
  await click('[data-action="play"]');
  await click('[data-action="nav"][data-route="home"]');
  await page.locator('.focus-card').waitFor();
  await page.waitForTimeout(1100);
  const toast=await page.locator('#toast').innerText();
  result.pendingPlaybackCancellation={delayedRequests,toast,state:await snapshot()};
  assert.ok(delayedRequests>0,'a genuine media response was delayed');
  assert.doesNotMatch(toast,/暂时无法播放|无法读取|读取失败|播放失败/,'leaving while playback is pending must not report a broken recording');
  await page.unroute(mediaUrl);
  await open('listenly-original','morning');await metadata();await play('real media playback after cancelling a pending request');await pause();
  result.pendingPlaybackCancellation.passed=true;
}
async function reopenCompletedArticle(){
  await open('listenly-original','morning');await pause();
  await page.locator('#audio').evaluate(a=>a.currentTime=a.duration-.7);
  await page.waitForFunction(()=>!document.querySelector('#audio').seeking);
  await play('completed article: play the real final second');
  await page.waitForFunction(()=>{const a=document.querySelector('#audio');return a.ended&&a.paused},{},{timeout:15000});
  const completed=await record('completed article: real ended position is saved');
  await click('[data-action="nav"][data-route="home"]');
  await open('listenly-original','morning');
  const reopened=await snapshot();
  result.completedArticleReopening={completed,reopened};
  assert.ok(reopened.time<.25&&!reopened.ended,'a completed article starts again at its beginning when reopened');
  await play('completed article: actual playback after reopening');await pause();
  await page.locator('#audio').evaluate(a=>a.currentTime=a.duration-.7);
  await page.waitForFunction(()=>!document.querySelector('#audio').seeking);
  await play('completed article: play the final second before switching material');
  await page.waitForFunction(()=>{const a=document.querySelector('#audio');return a.ended&&a.paused},{},{timeout:15000});
  await record('completed article: genuine ended before switching material');
  await open('listenly-original','library');await play('completed article: another material plays');await pause();
  await open('listenly-original','morning');
  result.completedArticleReopening.afterAnotherArticle=await snapshot();
  assert.ok(result.completedArticleReopening.afterAnotherArticle.time<.25&&!result.completedArticleReopening.afterAnotherArticle.ended,'returning from another material restarts the completed article at zero');
  await play('completed article: actual playback after another material');await pause();
  result.completedArticleReopening.passed=true;
}
try{
  await page.goto(base);await page.locator('.focus-card').waitFor();result.browser=await page.evaluate(()=>navigator.userAgent);
  await open('listenly-original','morning');await seek(0);
  for(let i=0;i<5;i++){await play(`WAV pause and resume ${i+1}`);await pause()}
  await finishAndReplay('WAV');
  await open('listenly-original','library');await play('second WAV source');await pause();
  await open('listenly-original','morning');await play('WAV return from different article');await pause();
  await click('[data-action="nav"][data-route="home"]');await open('listenly-original','morning');await play('WAV return from home');await pause();
  await click('.sentence[data-index="1"]');await page.waitForFunction(()=>!document.querySelector('#audio').paused);await record('sentence selection starts actual playback');
  await click('[data-action="loop"]');await page.locator('#audio').evaluate(a=>a.currentTime=11.19);
  await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&!a.seeking&&a.currentTime>=5.329&&a.currentTime<7},{},{timeout:15000});
  await record('sentence loop crosses boundary and returns');await click('[data-action="loop"]');await pause();await play('ordinary play after sentence loop');await pause();
  await click('[data-action="mode"][data-mode="exam"]');await metadata();await play('WAV switch to exam');await pause();await click('[data-action="mode"][data-mode="intensive"]');await metadata();await play('WAV return from exam');await pause();
  const fixture=await createImportedFixture();await click('[data-action="nav"][data-route="library"]');await page.locator('#folder-input').setInputFiles(fixture);
  await page.locator('[data-action="open"][data-paper="replay-import"]').waitFor();
  if(await page.locator('[data-action="close-dialog"]').count())await click('[data-action="close-dialog"]');
  await click('[data-action="open"][data-paper="replay-import"]');await metadata();assert.match((await snapshot()).src,/^blob:/);
  await seek(0);await play('Blob first playback');await pause();await finishAndReplay('Blob full recording');
  await seek(12);await click('[data-action="mode"][data-mode="exam"]');await metadata();
  const clip=await snapshot();assert.match(clip.src,/^blob:/);assert.ok(clip.duration<12&&clip.duration>10,'question uses a genuine cut PCM recording');assert.ok(Math.abs(clip.time-(12-11.268))<.2,'clip preserves the article position');
  await play('Blob genuine question clip');await pause();await finishAndReplay('Blob question clip');
  await seek(1);await click('[data-action="mode"][data-mode="intensive"]');await metadata();assert.ok(Math.abs((await snapshot()).time-12.268)<.2);await play('Blob full recording after question clip');await pause();
  await open('listenly-original','library');await play('WAV switch away from Blob');await pause();await open('replay-import','article');await play('Blob return after another article');await pause();
  result.mediaEvents.push(...await page.evaluate(()=>window.replayMediaEvents.map(event=>({...event,document:1}))));
  await page.reload();await page.locator('.focus-card').waitFor();await open('replay-import','article');assert.match((await snapshot()).src,/^blob:/);await play('Blob restored from IndexedDB after reload');await pause();await finishAndReplay('restored Blob',2);
  if(args.includes('--real')){
    const library=JSON.parse(await readFile(path.join(webRoot,'bundled-library.json'),'utf8'));
    const real=library.papers.find(p=>p.id==='cet6-2025-12-set1');assert.ok(real,'--real requires local 2025 M4A corpus');
    await open(real.id,'lt-1');await seek(0);await play('M4A first actual playback');await pause();await finishAndReplay('M4A 2025');
    const timed=library.papers.find(p=>p.id==='cet6-2013-06-set2');assert.ok(timed,'--real requires local 2013 cut M4A');
    await open(timed.id,'conversation-01');await seek(10);await play('M4A timed article');await pause();
    await click('[data-action="mode"][data-mode="exam"]');await metadata();assert.match((await snapshot()).src,/-q09\.m4a$/);await play('M4A genuine cut question');await pause();await finishAndReplay('M4A cut question');
    await click('[data-action="question"][data-index="1"]');await metadata();assert.match((await snapshot()).src,/-q10\.m4a$/);await play('M4A next cut question');await pause();
    await click('[data-action="question"][data-index="0"]');await metadata();await play('M4A return to previous cut question');await pause();
    await click('[data-action="mode"][data-mode="intensive"]');await metadata();await play('M4A return to full article');await pause();
  }
  if(!args.includes('--skip-read-failure'))await transientReadFailure();
  if(!args.includes('--skip-rapid-cancel'))await cancelPendingPlayback();
  if(!args.includes('--skip-completed-reopen'))await reopenCompletedArticle();
  assert.deepEqual(result.pageErrors,[]);assert.equal(result.checks.filter(c=>c.state.error).length,0);
  assert.deepEqual(result.requestFailures.filter(request=>request.failure!=='net::ERR_ABORTED'),[],'source changes may abort streams; other failed requests must not occur');
  assert.ok(result.mediaRequests.length>=2&&result.mediaRequests.every(response=>[200,206].includes(response.status)||(result.transientReadFailure&&response.status===503)),'media requests return complete or partial content, except the deliberate transient failure');
  result.passed=true;console.log(JSON.stringify({passed:true,checks:result.checks.length,entrySha256:result.entrySha256,output}));
}catch(error){result.failure={message:error.message,stack:error.stack};result.finalState=await snapshot().catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{
  result.mediaEvents.push(...await page.evaluate(()=>(window.replayMediaEvents||[]).map(event=>({...event,document:2}))).catch(()=>[]));
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
