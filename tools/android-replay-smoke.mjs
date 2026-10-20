/** Observe repeat playback with real Android taps. No device reset or synthetic ended event. */
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installReplayEndIsolation,replayIsolationDescription} from '../tests/replay-isolation.mjs';

const [serial,apk,label='audio-replay',...flags]=process.argv.slice(2);
const demo=flags.includes('--demo'),fixture=flags.includes('--fixture');
if(!serial?.startsWith('emulator-')||!apk||flags.some(v=>!['--demo','--fixture'].includes(v))||(demo&&fixture))throw new Error('Usage: node tools/android-replay-smoke.mjs emulator-5580 app.apk label [--demo|--fixture]');
const paperId=fixture?'listenly-original-ci':demo?'listenly-original':'cet6-2025-12-set1';
const firstArticle=fixture?'ci-playback':demo?'morning':'lt-1';
const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME;
const adb=process.env.ADB||(sdk?path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'):'adb');
const root=path.resolve('.build/runtime-results',label);
await mkdir(root,{recursive:true});
const run=(args,binary=false)=>execFileSync(adb,['-s',serial,...args],{encoding:binary?undefined:'utf8',timeout:120000,maxBuffer:32*1024*1024,windowsHide:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const getJSON=url=>new Promise((resolve,reject)=>http.get(url,res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>{try{resolve(JSON.parse(body))}catch(error){reject(error)}})}).on('error',reject));
const result={serial,apk:path.resolve(apk),label,checkedAt:new Date().toISOString(),scenarios:[],network:[],console:[]};
result.queueIsolation=replayIsolationDescription;
result.apkSha256=createHash('sha256').update(await readFile(apk)).digest('hex');
result.harnessSha256Normalized=createHash('sha256').update((await readFile(new URL(import.meta.url),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
let socket,forwarded=false,evaluate,rpc;
const stateExpr=`(()=>{var a=document.querySelector('#audio'),error=document.querySelector('#audio-error'),toast=document.querySelector('#toast');return {src:a.currentSrc,attributeSrc:a.getAttribute('src'),duration:Number.isFinite(a.duration)?a.duration:null,currentTime:a.currentTime,paused:a.paused,ended:a.ended,seeking:a.seeking,networkState:a.networkState,readyState:a.readyState,error:a.error?{code:a.error.code,message:a.error.message}:null,buffered:[...Array(a.buffered.length)].map((_,i)=>[a.buffered.start(i),a.buffered.end(i)]),seekable:[...Array(a.seekable.length)].map((_,i)=>[a.seekable.start(i),a.seekable.end(i)]),panelError:error&&!error.hidden?error.textContent:null,toast:toast&&toast.classList.contains('visible')?toast.textContent:null}})()`;
const snapshot=()=>evaluate(stateExpr);
async function poll(expression,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){const value=await evaluate(expression);if(value)return value;await wait(200)}throw new Error(`Condition timed out: ${expression}`)}
async function tap(selector){
 const target=await poll(`(async()=>{var selector=${JSON.stringify(selector)},b=document.querySelector(selector);if(!b||b.disabled)return null;await document.fonts.ready;await new Promise(requestAnimationFrame);var before=b.getBoundingClientRect();await new Promise(requestAnimationFrame);if(!b.isConnected)return null;var r=b.getBoundingClientRect();if(Math.abs(before.left-r.left)>.5||Math.abs(before.top-r.top)>.5||Math.abs(before.width-r.width)>.5||Math.abs(before.height-r.height)>.5)return null;var sentence=b.matches('.sentence'),x=sentence?r.left+Math.min(20,r.width/2):r.left+r.width/2,y=sentence?r.top+4:r.top+r.height/2,h=document.elementFromPoint(x,y);if(!h||h.closest(selector)!==b)return null;var probe={selector:selector,events:[]};window.__nativeReplayTap=probe;var listener=function(event){var record={type:event.type,trusted:event.isTrusted,time:performance.now(),matches:!!event.target.closest&&event.target.closest(selector)===b};probe.events.push(record);if(event.type==='click'||event.type==='contextmenu')['pointerdown','pointerup','click','contextmenu'].forEach(function(type){document.removeEventListener(type,listener,true)})};['pointerdown','pointerup','click','contextmenu'].forEach(function(type){document.addEventListener(type,listener,true)});return {x:x*devicePixelRatio,y:y*devicePixelRatio,visible:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:true,stableFrames:2,landing:sentence?'button-padding':'center'}})()`);
 assert.ok(target?.visible&&target.hit,`Touch target is visible: ${selector}`);
 const delivery={selector,target};(result.nativeTouches??=[]).push(delivery);
 run(['shell','input','tap',String(Math.round(target.x)),String(Math.round(target.y))]);
 try{await poll('window.__nativeReplayTap.events.some(event=>event.type==="click"||event.type==="contextmenu")')}
 finally{delivery.events=await evaluate('window.__nativeReplayTap.events')}
 assert.ok(delivery.events.some(event=>event.type==='click'&&event.trusted&&event.matches),`A real native tap clicks its intended control: ${selector}`);
 return target;
}
async function pause(){if(!(await snapshot()).paused){await tap('[data-action=play]');await poll('document.querySelector("#audio").paused')} }
async function playAndProgress(){const before=await snapshot();await tap('[data-action=play]');await wait(300);const first=await snapshot();await wait(1100);const after=await snapshot();const playback={before,first,after};try{assert.equal(after.error,null,'Audio has no media error');assert.equal(after.paused,false,'Audio is playing');assert.ok(after.currentTime>first.currentTime+.3,`Playback advances: ${first.currentTime} → ${after.currentTime}`)}catch(error){error.playback=playback;throw error}return playback}
const closeDialog='(()=>{var shade=document.querySelector(".dialog-shade");if(shade)shade.remove()})()';
const importsExpr='window.Android&&window.Android.getImports?JSON.parse(window.Android.getImports()).map(x=>({mode:x.mode,name:x.name,fileCount:x.files?x.files.length:0})):[]';
async function scenario(name,fn){const item={name};result.scenarios.push(item);try{await evaluate(closeDialog);item.before=await snapshot();const details=await fn(item);if(details!==undefined)item.details=details;item.after=await snapshot();item.status='passed'}catch(error){item.status='failed';item.error=String(error.stack||error);if(error.playback)item.failedPlayback=error.playback;try{item.after=await snapshot();await writeFile(path.join(root,`${name}.png`),run(['exec-out','screencap','-p'],true))}catch{}}await writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(`${name}: ${item.status}`)}
async function openArticle(id,paper=paperId){
 const collection=paper.startsWith('cet6')?'cet6':paper.startsWith('ielts')?'ielts':paper.startsWith('toefl')?'toefl':paper.startsWith('listenly-original')?'original':'imported';
 await evaluate(`(()=>{if(!document.querySelector('[data-action=nav][data-route=library]'))document.querySelector('[data-action=nav][data-route=home]').click();document.querySelector('[data-action=nav][data-route=library]').click()})()`);
 for(const selector of [`[data-action=open-collection][data-collection="${collection}"]`,`[data-action=open-paper][data-paper="${paper}"]`]){
  await poll(`!!document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(`(()=>{var b=document.querySelector(${JSON.stringify(selector)});if(b.getAttribute('aria-expanded')!=='true')b.click()})()`);
  await poll(`(()=>{var b=document.querySelector(${JSON.stringify(selector)}),p=document.getElementById(b.getAttribute('aria-controls'));return p&&p.dataset.motionState==='open'})()`);
 }
 const selector=`[data-action=open][data-paper="${paper}"][data-article="${id}"]`;await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await evaluate(closeDialog);await poll('document.querySelector("#audio").readyState>=1');return snapshot()
}

async function recoverSystemUi(stage){
 let xml;
 for(let attempt=0;attempt<3;attempt++){
  try{run(['shell','uiautomator','dump','/sdcard/listenly-audio-ui.xml']);xml=run(['shell','cat','/sdcard/listenly-audio-ui.xml']);break}
  catch(error){(result.uiDumpRetries??=[]).push({stage,attempt,error:String(error)});if(attempt===2)throw error;await wait(1500)}
 }
 if(!xml.includes("System UI isn't responding")){assert.ok(!xml.includes("isn't responding"),'Do not dismiss an application ANR');return false}
 await writeFile(path.join(root,`system-ui-${stage}.xml`),xml);await writeFile(path.join(root,`system-ui-${stage}.png`),run(['exec-out','screencap','-p'],true));const button=xml.match(/<node\b[^>]*text="Wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(button,'Known emulator System UI dialog has a Wait action');const [,l,t,r,b]=button.map(Number);run(['shell','input','tap',String(Math.round((l+r)/2)),String(Math.round((t+b)/2))]);(result.systemUiRecoveries??=[]).push({stage,action:'Wait',process:'System UI'});await wait(15000);return true
}
try{
 assert.equal(run(['shell','getprop','ro.kernel.qemu']).trim(),'1','Only an Android emulator may be changed');
 result.avd=run(['emu','avd','name']).trim().split(/\r?\n/)[0];assert.ok(result.avd.startsWith('Listenly_'),'Only this project AVD may be changed');
 result.android=run(['shell','getprop','ro.build.version.release']).trim();result.api=run(['shell','getprop','ro.build.version.sdk']).trim();
 if(Number(result.api)>=36){await wait(15000);for(let i=0;i<3;i++)if(!await recoverSystemUi(`startup-${i}`))break}
 result.install=run(['install','-r',path.resolve(apk)]).trim();run(['shell','am','force-stop','cn.listenly.app']);
 // Older system images can read logcat but reject clearing its main buffer.
 // Retain that collection limitation; it does not waive any runtime checks.
 result.logcatCleared=true;
 try{run(['logcat','-c'])}catch(error){result.logcatCleared=false;result.logcatClearError=String(error.message)}
 result.launch=run(['shell','am','start','-W','-n','cn.listenly.app/.MainActivity']).trim();await wait(5000);if(Number(result.api)>=36)for(let i=0;i<3;i++)if(!await recoverSystemUi(`launch-${i}`))break;
 result.pid=run(['shell','pidof','cn.listenly.app']).trim();assert.ok(result.pid,'Application remains running');
 const remote=`webview_devtools_remote_${result.pid}`;run(['forward','tcp:9334',`localabstract:${remote}`]);forwarded=true;
 const target=(await getJSON('http://127.0.0.1:9334/json')).find(t=>t.type==='page'&&t.url.includes('listenly.local'));assert.ok(target,'App WebView is available');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
 let id=0;const pending=new Map();socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const callback=pending.get(message.id);pending.delete(message.id);message.error?callback.reject(new Error(JSON.stringify(message.error))):callback.resolve(message.result)}else if(message.method?.startsWith('Network.')){if(['Network.requestWillBeSent','Network.responseReceived','Network.loadingFailed'].includes(message.method))result.network.push(message)}else if(message.method==='Runtime.consoleAPICalled'||message.method==='Runtime.exceptionThrown')result.console.push(message)});
 rpc=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));setTimeout(()=>{if(pending.delete(key))reject(new Error(`${method} timed out`))},15000).unref()});
 evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await rpc('Runtime.enable');await rpc('Network.enable');result.webview=await evaluate('navigator.userAgent');
 await poll('document.querySelector(".focus-card")');
 result.savedStateBefore=await evaluate('localStorage.getItem("listenly.state.v1")');
 result.importsBefore=await evaluate(importsExpr);
 await openArticle(firstArticle);
 await poll('document.querySelector("#audio").readyState>=1');
 await evaluate(`(${installReplayEndIsolation.toString()})()`);
 await evaluate(`(()=>{window.__audioEvents=[];var a=document.querySelector('#audio');for(var name of ['loadstart','loadedmetadata','canplay','playing','play','pause','ended','seeking','seeked','stalled','waiting','error','emptied','abort'])a.addEventListener(name,e=>window.__audioEvents.push({type:e.type,at:Date.now(),time:a.currentTime,paused:a.paused,ended:a.ended,ready:a.readyState,network:a.networkState,error:a.error?{code:a.error.code,message:a.error.message}:null}));a.pause();a.currentTime=0})()`);
 result.initial=await snapshot();assert.ok(result.initial.duration>10,'Audio metadata has a valid duration');
 // Compare native WebView responses to original APK bytes, independent of decoder behaviour.
 const asset=`assets/web/${new URL(result.initial.src).pathname.slice('/assets/'.length)}`;
 const zipBytes=execFileSync(process.env.PYTHON||'python',['-c','import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',path.resolve(apk),asset],{maxBuffer:32*1024*1024,windowsHide:true});
 result.resourceBytes={asset,length:zipBytes.length,sha256:createHash('sha256').update(zipBytes).digest('hex')};result.rangeChecks=[];
 const ranges=[{range:'bytes=0-',start:0,end:zipBytes.length-1},{range:'bytes=8-127',start:8,end:127},{range:`bytes=${Math.floor(zipBytes.length*.75)}-`,start:Math.floor(zipBytes.length*.75),end:zipBytes.length-1},{range:'bytes=-128',start:zipBytes.length-128,end:zipBytes.length-1}];
 for(let round=1;round<=2;round++)for(const spec of ranges){const expected={length:spec.end-spec.start+1,sha256:createHash('sha256').update(zipBytes.subarray(spec.start,spec.end+1)).digest('hex')};const check={round,...spec,expected};result.rangeChecks.push(check);try{check.actual=await evaluate(`(async()=>{var controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{var response=await fetch(${JSON.stringify(result.initial.src+`?replay-range=${round}-${spec.start}`)},{headers:{Range:${JSON.stringify(spec.range)}},signal:controller.signal}),bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join(''),headers={};response.headers.forEach((value,key)=>{headers[key]=value});return {status:response.status,length:bytes.byteLength,sha256:hash,headers:headers}}catch(error){return {error:String(error)}}finally{clearTimeout(timer)}})()`);check.passed=check.actual.length===expected.length&&check.actual.sha256===expected.sha256}catch(error){check.error=String(error);check.passed=false}await writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(`Range round ${round} ${spec.range}: ${check.passed?'passed':'failed'}`)}
 for(let round=1;round<=3;round++){
   await scenario(`round-${round}-first-and-second-play`,async item=>{await pause();await openArticle(firstArticle);await evaluate('document.querySelector("#audio").load()');await poll('document.querySelector("#audio").readyState>=4&&!document.querySelector("#audio").seeking');item.details={setup:'fresh media load at zero, no storage reset'};item.details.first=await playAndProgress();await pause();item.details.second=await playAndProgress();await pause()});
   await scenario(`round-${round}-exit-and-reopen`,async item=>{await pause();item.details={};item.details.initialPlayback=await playAndProgress();await pause();await evaluate('window.listenlyBack()');await poll('document.querySelector(".focus-card")');await openArticle(firstArticle);item.details.playback=await playAndProgress();await pause()});
   await scenario(`round-${round}-natural-end-and-replay`,async()=>{await pause();await evaluate('document.querySelector("#audio").currentTime=document.querySelector("#audio").duration-.65');await poll('!document.querySelector("#audio").seeking');await tap('[data-action=play]');await poll('document.querySelector("#audio").ended',10000);const ended=await snapshot();assert.equal(ended.ended,true,'Browser reached a real natural ended state');const replay=await playAndProgress();assert.ok(replay.after.currentTime<10,'Replay restarts near the beginning');await pause();return {ended,replay}});
   if(!fixture)await scenario(`round-${round}-switch-and-return`,async()=>{await pause();const alternate=await openArticle(demo?'library':'lt-5');const alternatePlayback=await playAndProgress();await pause();const returned=await openArticle(firstArticle);const playback=await playAndProgress();await pause();return {alternate,alternatePlayback,returned,playback}});
   else await scenario(`round-${round}-mode-and-return`,async()=>{await pause();await tap('[data-action=mode][data-mode=exam]');await poll('document.querySelector(".quiz-card")');const examPlayback=await playAndProgress();await pause();await tap('[data-action=mode][data-mode=intensive]');await poll('document.querySelector(".transcript-card")');const playback=await playAndProgress();await pause();return {examPlayback,playback}});
   await scenario(`round-${round}-relative-seek`,async()=>{await pause();await evaluate('document.querySelector("#audio").currentTime=12');await tap('[data-action=seek-relative][data-seconds="-5"]');await poll('Math.abs(document.querySelector("#audio").currentTime-7)<.2');const seeked=await snapshot();assert.ok(seeked.currentTime>=6.8&&seeked.currentTime<=7.2,'The backward control seeks by five seconds');const playback=await playAndProgress();await tap('[data-action=seek-relative][data-seconds="5"]');await wait(1100);const forward=await snapshot();assert.equal(forward.error,null);assert.ok(forward.currentTime>playback.after.currentTime+4);await pause();return {seeked,playback,forward}});
 }
 await scenario('whole-article-question-dropdown',async()=>{
  await pause();await openArticle(firstArticle);await evaluate('document.querySelector("#audio").currentTime=0');await poll('!document.querySelector("#audio").seeking');await tap('[data-action=mode][data-mode=exam]');
  await poll('document.querySelector(".quiz-questions")&&document.querySelector("#audio").readyState>=1');
  const paper=fixture?await evaluate('fetch("demo.json").then(r=>r.json())'):JSON.parse(await readFile(demo?'examples/demo/demo.json':'app/src/main/assets/web/bundled-library.json','utf8'));
  const article=(fixture||demo?paper:paper.papers.find(p=>p.id===paperId)).articles.find(a=>a.id===firstArticle);
  assert.ok(article?.questions.length,'The replay article has known questions');
  assert.equal(await evaluate('document.querySelectorAll(".quiz-question[data-question-index]").length'),article.questions.length,'All article questions are present without a pager');
  assert.equal(await evaluate('document.querySelectorAll(".question-dot,[data-action=next-question],.quiz-card h3").length'),0,'The compact exam contains neither page controls nor written question headings');
  for(const q of article.questions)if(q.prompt)assert.ok(!await evaluate(`document.querySelector('.quiz-card').textContent.includes(${JSON.stringify(q.prompt)})`),'The question prompt is not rendered in the listening exam');
  const showQuestion=async index=>{
   const selector=`[data-action=toggle-question][data-index="${index}"]`;
   await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
   if(!await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')==='true'`))await tap(selector);
   await poll(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')==='true'`);await wait(220);
  };
  await showQuestion(0);await poll('document.querySelector("#audio").readyState>=1');
  const first=await playAndProgress(),before=await snapshot(),nextIndex=article.questions.length>1?1:0;
  let independentDropdowns;
  if(nextIndex!==0){
   await showQuestion(nextIndex);
   independentDropdowns=await evaluate('[...document.querySelectorAll(".quiz-question.is-open")].map(row=>Number(row.dataset.questionIndex))');
   assert.ok(independentDropdowns.includes(0)&&independentDropdowns.includes(nextIndex),'Opening another option dropdown leaves the first expanded');
  }
  else{
   await tap('[data-action=toggle-question][data-index="0"]');
   await poll('document.querySelectorAll(".quiz-question.is-open").length===0');await wait(220);await showQuestion(0);
  }
  await poll('document.querySelector("#audio").readyState>=1');
  const selected=await snapshot();let after;
  assert.equal(selected.attributeSrc,before.attributeSrc,'Question dropdowns retain the complete paper recording');
  await wait(900);after=await snapshot();assert.equal(after.paused,false,'Shared paper audio keeps playing while an option dropdown changes');assert.ok(after.currentTime>before.currentTime+.3,'Opening and closing dropdowns preserves the advancing paper timeline');
  assert.equal(after.error,null,'Dropdown interaction leaves native media error-free');
  await pause();
  const expanded=await evaluate('[...document.querySelectorAll(".quiz-question.is-open")].map(row=>Number(row.dataset.questionIndex))');
  const remainingOpen=new Set(expanded),collapseStates=[];
  for(const index of expanded){
   const selector=`[data-action=toggle-question][data-index="${index}"]`;
   await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await tap(selector);
   await poll(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')==='false'`);await wait(220);
   remainingOpen.delete(index);
   const actualOpen=await evaluate('[...document.querySelectorAll(".quiz-question.is-open")].map(row=>Number(row.dataset.questionIndex))');
   assert.deepEqual(actualOpen,[...remainingOpen],'Collapsing one question preserves every remaining open question');
   collapseStates.push({closed:index,remaining:actualOpen});
  }
  await poll('document.querySelectorAll(".quiz-question.is-open").length===0');await wait(220);
  const geometry=await evaluate('(()=>{var p=document.querySelector(".main-panel").getBoundingClientRect(),rows=[...document.querySelectorAll(".quiz-question")].map(b=>{var r=b.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}});return {panel:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},rows:rows}})()');
  for(const row of geometry.rows)assert.ok(row.left>=geometry.panel.left-1&&row.right<=geometry.panel.right+1&&row.top>=geometry.panel.top-1&&row.bottom<=geometry.panel.bottom+1,'The collapsed whole-article question list fits above the audio dock');
  await tap('[data-action=mode][data-mode=intensive]');await poll('document.querySelector(".transcript-card")&&document.querySelector("#audio").readyState>=1');
  const returned=await snapshot();assert.equal(returned.error,null,'Returning from the complete question list retains playable article audio');
  assert.equal(returned.attributeSrc,before.attributeSrc,'Intensive and exam modes share one complete paper source');
  return {questionCount:article.questions.length,nextIndex,independentDropdowns:independentDropdowns||{status:'not-applicable',reason:'This fixture has only one question'},expandedBeforeCollapse:expanded,collapseStates,first,before,selected,after,geometry,returned};
 });
 // The original demo has timestamps, unlike the real untimed CET article used above.
 if(!fixture)await scenario('timed-sentence-continuation',async()=>{await openArticle('morning','listenly-original');await tap('[data-action=display][data-display=bilingual]');await pause();await evaluate('document.querySelector("#audio").currentTime=0');await tap('[data-action=sentence][data-index="0"]');await poll('!document.querySelector("#audio").paused');assert.equal(await evaluate('document.querySelectorAll("[data-action=loop]").length'),0,'The obsolete sentence-loop control is absent');const next=await evaluate('Number(document.querySelector(\'.sentence[data-index="1"] .timestamp\').textContent.split(":").reduce((v,n)=>v*60+Number(n),0))');await evaluate(`document.querySelector('#audio').currentTime=${next-.3}`);await poll(`document.querySelector('#audio').currentTime>${next+.2}`);const continued=await snapshot();assert.equal(continued.error,null);assert.equal(continued.paused,false);await pause();return {boundary:next,continued}});
 result.events=await evaluate('window.__audioEvents');result.isolatedReplayEnds=await evaluate('window.__isolatedReplayEnds||[]');result.savedStateAfter=await evaluate('localStorage.getItem("listenly.state.v1")');
 result.importsAfter=await evaluate(importsExpr);
 assert.deepEqual(JSON.parse(result.savedStateAfter||'{}').answers||{},JSON.parse(result.savedStateBefore||'{}').answers||{},'Existing answer records survive repeated playback');
 assert.deepEqual(result.importsAfter,result.importsBefore,'Existing imported folders survive repeated playback');
 result.pidAfter=run(['shell','pidof','cn.listenly.app']).trim();assert.equal(result.pidAfter,result.pid,'Parent Android process is stable');result.verified=result.scenarios.every(s=>s.status==='passed')&&result.rangeChecks.every(c=>c.passed);
 await writeFile(path.join(root,'screen.png'),run(['exec-out','screencap','-p'],true));
}catch(error){result.error=String(error.stack||error);result.verified=false;process.exitCode=1}
finally{
 try{await writeFile(path.join(root,'logcat.log'),run(['logcat','-d','-v','threadtime']));await writeFile(path.join(root,'crash.log'),run(['logcat','-d','-b','crash','-v','threadtime']))}catch(error){result.logError=String(error.message)}
 await writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));socket?.close();if(forwarded)try{run(['forward','--remove','tcp:9334'])}catch{}
}
console.log(JSON.stringify({verified:result.verified,scenarios:result.scenarios.map(s=>({name:s.name,status:s.status,error:s.error})),result:path.join(root,'result.json')}));
if(!result.verified)process.exitCode=1;
