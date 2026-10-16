/** Real Android runtime check. Explicit emulator serial prevents accidental phone writes. */
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const [serial,apk,label='runtime',...flags]=process.argv.slice(2);
const publicDemo=flags.includes('--demo'),localReal=flags.includes('--real');
if(!serial?.startsWith('emulator-')||!apk||flags.some(flag=>!['--demo','--real'].includes(flag))||(publicDemo&&localReal))throw new Error('Usage: node tools/android-smoke.mjs emulator-5554 app.apk label [--demo|--real]');
const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME;
const adb=process.env.ADB||(sdk?path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'):
  process.platform==='win32'?'C:/Program Files (x86)/Android/android-sdk/platform-tools/adb.exe':'adb');
const root=path.resolve('.build/runtime-results',label);
await mkdir(root,{recursive:true});
const run=(args,binary=false)=>execFileSync(adb,['-s',serial,...args],{encoding:binary?undefined:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const httpJSON=url=>new Promise((resolve,reject)=>http.get(url,response=>{let body='';response.on('data',data=>body+=data);response.on('end',()=>{try{resolve(JSON.parse(body))}catch(error){reject(error)}})}).on('error',reject));
let socket,forwarded=false;
const result={serial,label,apk:path.resolve(apk),checkedAt:new Date().toISOString(),...(publicDemo?{content:'original-public-demo'}:{})};
async function recoverSystemUiDialog(stage){
 run(['shell','uiautomator','dump','/sdcard/listenly-smoke-ui.xml']);
 const xml=run(['shell','cat','/sdcard/listenly-smoke-ui.xml']);
 if(!xml.includes("System UI isn't responding")){
  assert.ok(!xml.includes("isn't responding"),'An application ANR must not be dismissed');
  return false;
 }
 await writeFile(path.join(root,`system-ui-${stage}.xml`),xml);
 await writeFile(path.join(root,`system-ui-${stage}.png`),run(['exec-out','screencap','-p'],true));
 const button=xml.match(/<node\b[^>]*text="Wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
 assert.ok(button,'Known emulator System UI ANR has an accessible Wait button');
 const [,left,top,right,bottom]=button.map(Number);
 run(['shell','input','tap',String(Math.round((left+right)/2)),String(Math.round((top+bottom)/2))]);
 (result.systemUiRecoveries??=[]).push({stage,action:'Wait',process:'System UI'});
 await wait(15000);
 run(['shell','uiautomator','dump','/sdcard/listenly-smoke-ui.xml']);
 const after=run(['shell','cat','/sdcard/listenly-smoke-ui.xml']);
 assert.ok(!after.includes("isn't responding"),'Emulator System UI must recover before app interaction');
 return true;
}
try{
 if(publicDemo||localReal){
  assert.equal(run(['shell','getprop','ro.kernel.qemu']).trim(),'1','Demo interaction must run on an emulator');
  result.avd=run(['emu','avd','name']).trim().split(/\r?\n/)[0].trim();
  assert.ok(result.avd.startsWith('Listenly_'),'Public demo check uses this project AVD');
 }
 result.android=run(['shell','getprop','ro.build.version.release']).trim();
 result.api=run(['shell','getprop','ro.build.version.sdk']).trim();
 if(Number(result.api)>=36){await wait(30000);await recoverSystemUiDialog('startup')}
 result.install=run(['install','-r',path.resolve(apk)]).trim();
 try{run(['logcat','-c'])}catch(error){result.logClearWarning=String(error.message)}
 run(['shell','am','force-stop','cn.listenly.app']);
 result.launch=run(['shell','am','start','-W','-n','cn.listenly.app/.MainActivity']).trim();
 await wait(5000);
 result.pid=run(['shell','pidof','cn.listenly.app']).trim();
 const crash=run(['logcat','-d','-b','crash','-v','threadtime']);
 await writeFile(path.join(root,'crash.log'),crash);
 const log=run(['logcat','-d','-v','threadtime']);
 await writeFile(path.join(root,'logcat.log'),log);
 await writeFile(path.join(root,'screen.png'),run(['exec-out','screencap','-p'],true));
 assert.ok(result.pid,'App process must remain alive after launch');
 const appCrash=crash.split('\n').filter(line=>new RegExp(`\\s${result.pid}\\s`).test(line)||line.includes('cn.listenly.app')).join('\n');
 assert.ok(!appCrash.includes('FATAL EXCEPTION')&&!appCrash.includes('signal 11'),'No app Java or native fatal exception');
 const unix=run(['shell','cat','/proc/net/unix']);
 const remote=`webview_devtools_remote_${result.pid}`;
 assert.ok(unix.includes(remote),'Loaded WebView exposes debug target');
 run(['forward','tcp:9333',`localabstract:${remote}`]);forwarded=true;
 const targets=await httpJSON('http://127.0.0.1:9333/json');
 const target=targets.find(target=>target.type==='page'&&target.url.includes('listenly.local'));
 assert.ok(target,'Local app page must load');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 let id=0;const pending=new Map();
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const callback=pending.get(message.id);pending.delete(message.id);message.error?callback.reject(new Error(JSON.stringify(message.error))):callback.resolve(message.result)}});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));setTimeout(()=>{if(pending.delete(key))reject(new Error(`${method} timed out`))},15000).unref()});
 const evaluate=async expression=>{const response=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value};
 const poll=async expression=>{for(let i=0;i<30;i++){const value=await evaluate(expression);if(value)return value;await wait(500)}throw new Error(`UI readiness failed: ${expression}`)};
 const tapControl=async selector=>{
  const tap=await evaluate(`(()=>{var selector=${JSON.stringify(selector)},b=document.querySelector(selector),r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x:x,y:y,scale:devicePixelRatio,visible:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:hit&&hit.closest(selector)===b}})()`);
  assert.ok(tap.visible&&tap.hit,`Visible native touch target: ${selector}`);
  run(['shell','input','tap',String(Math.round(tap.x*tap.scale)),String(Math.round(tap.y*tap.scale))]);
  return tap;
 };
 result.home=await poll('document.querySelector(".focus-card") && document.body.innerText');
 assert.ok(await evaluate('!!document.querySelector(".focus-card [data-action=open],.focus-card [data-action=import]")'),'Homepage has an actionable listening material entry');
 result.fontState=await evaluate('(async()=>{await document.fonts.ready;return {body:getComputedStyle(document.body).fontFamily,control:getComputedStyle(document.querySelector(".focus-play")).fontFamily,loaded:[...document.fonts].filter(face=>face.status==="loaded").map(face=>({family:face.family,weight:face.weight,status:face.status}))}})()');
 assert.match(result.fontState.body,/Inter/,'Native interface typography uses the bundled Inter family');
 assert.match(result.fontState.control,/Inter/,'Native playback controls inherit the same type family');
 assert.ok(result.fontState.loaded.some(face=>/Inter/.test(face.family)&&face.status==='loaded'),'At least one offline Inter face genuinely decodes on the native WebView');
 result.webview=await evaluate('navigator.userAgent');
 result.viewport=await evaluate('({width:innerWidth,height:innerHeight,contentWidth:document.documentElement.scrollWidth})');
 assert.ok(result.viewport.contentWidth<=result.viewport.width+1,'Mobile page fits the viewport');
 assert.equal(await evaluate('document.querySelectorAll("[data-action=mode]").length'),0,'Home has no training mode controls');
 assert.equal(await evaluate('document.querySelectorAll(".theme-control button,[data-action=import]").length'),0,'Home reserves appearance and folder import controls for profile');
 assert.equal(await evaluate('document.querySelectorAll(".section-header button").length'),0,'Home has no redundant All entrance');
 await tapControl('.focus-card [data-action=home-play]');
 result.homePlayback=await poll('(()=>{var a=document.querySelector("#audio");return !a.paused&&a.currentTime>0&&!a.error?{time:a.currentTime,paused:a.paused}:null})()');
 assert.ok(!await evaluate('!!document.querySelector(".practice-header")'),'Home audio does not open the reader');
 await tapControl('[data-action=nav][data-route=profile]');
 await poll('document.querySelector(".statistics")&&document.querySelector("#audio").paused');
 assert.equal(await evaluate('document.querySelectorAll(".topbar .theme-control button").length'),2,'Only profile exposes day and night appearance controls');
 assert.equal(await evaluate('document.querySelectorAll(".topbar [data-action=import]").length'),1,'Only profile exposes the folder import plus');
 await tapControl('[data-action=theme][data-theme=dark]');
 await poll('document.documentElement.dataset.theme==="dark"');
 await wait(900);
 result.profileAppearance=await evaluate('({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color,paused:document.querySelector("#audio").paused,error:document.querySelector("#audio").error})');
 assert.equal(result.profileAppearance.background,'rgb(0, 0, 0)','Night mode uses the requested pure-black background on profile');
 assert.ok(result.profileAppearance.paused&&!result.profileAppearance.error,'Changing profile appearance keeps the naturally paused audio error-free');
 await evaluate('window.__appearanceReloadProbe=true');await rpc('Page.reload');
 await poll('!window.__appearanceReloadProbe&&document.querySelector(".focus-card")');
 assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark','Night mode survives a page reload');
 assert.equal(await evaluate('document.querySelectorAll(".theme-control button,[data-action=import]").length'),0,'Reloaded home keeps appearance and import controls in profile');
 await tapControl('.focus-card [data-action=home-play]');
 await poll('!document.querySelector("#audio").paused&&document.querySelector("#audio").currentTime>0&&!document.querySelector("#audio").error');
 await wait(900);
 result.darkHome=await evaluate('({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color,playing:!document.querySelector("#audio").paused,time:document.querySelector("#audio").currentTime})');
 assert.ok(result.darkHome.playing&&result.darkHome.time>0,'Home playback works after changing appearance from profile and reloading');
 assert.equal(result.darkHome.background,'rgb(0, 0, 0)','Night mode uses the requested pure-black background');
 await writeFile(path.join(root,'home-dark.png'),run(['exec-out','screencap','-p'],true));
 await tapControl('.focus-card [data-action=home-play]');await poll('document.querySelector("#audio").paused');
 const homeRow=await evaluate('(()=>{var b=document.querySelector(".home-paper-row [data-action=home-play]");return b?{paper:b.dataset.paper,article:b.dataset.article}:null})()');
 if(homeRow){
  await tapControl(`.home-paper-row [data-action=home-play][data-paper="${homeRow.paper}"][data-article="${homeRow.article}"]`);
  result.homePromotion=await poll(`(()=>{var b=document.querySelector('.focus-play'),a=document.querySelector('#audio');return b.dataset.paper==="${homeRow.paper}"&&b.dataset.article==="${homeRow.article}"&&!a.paused&&!a.error?{paper:b.dataset.paper,article:b.dataset.article,playing:!a.paused}:null})()`);
  assert.equal(await evaluate(`document.querySelectorAll('.home-paper-row [data-action=home-play][data-paper="${homeRow.paper}"][data-article="${homeRow.article}"]').length`),0,'A native home play tap immediately promotes the article and removes its duplicate row');
  assert.ok(!await evaluate('!!document.querySelector(".practice-header")'),'The native focus promotion stays on home');
  await tapControl('.focus-play');await poll('document.querySelector("#audio").paused');
 }
 await tapControl('[data-action=nav][data-route=profile]');
 await poll('document.querySelector(".statistics")');
 await tapControl('[data-action=theme][data-theme=light]');await poll('document.documentElement.dataset.theme==="light"');
 await tapControl('[data-action=nav][data-route=home]');await poll('document.querySelector(".focus-card")');
 await writeFile(path.join(root,'home-light.png'),run(['exec-out','screencap','-p'],true));
 let realSelection;
 if(localReal){
  const library=JSON.parse(await readFile('app/src/main/assets/web/bundled-library.json','utf8'));
  const paper=library.papers.find(p=>p.id==='cet6-2025-12-set1');assert.ok(paper,'Local real check needs the lite built-in paper');
  const answers=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
  const article=paper.articles.find(a=>(a.questions||[]).some(q=>!answers[JSON.stringify([paper.id,a.id,q.id])]?.submitted));
  assert.ok(article,'The project emulator has an unanswered real question');
  realSelection={paper,article};
  await evaluate(`document.querySelector('[data-action=nav][data-route=library]').click();document.querySelector('[data-action=open-paper][data-paper="${paper.id}"]').click();document.querySelector('[data-action=open][data-paper="${paper.id}"][data-article="${article.id}"]').click()`);
 }else await evaluate(publicDemo?'document.querySelector("[data-action=nav][data-route=library]").click();document.querySelector("[data-action=open-paper][data-paper=listenly-original]").click();document.querySelector("[data-action=open][data-paper=listenly-original][data-article=morning]").click();document.querySelector("[data-action=mode][data-mode=intensive]").click()':'document.querySelector(".focus-card [data-action=open]").click()');
 assert.ok(await evaluate('!!document.querySelector("[data-mode=intensive][aria-pressed=true]")&&!!document.querySelector("[data-display=hidden][aria-pressed=true]")'),'Opening the reader defaults to intensive and hidden');
 assert.ok(await evaluate('!/[0-9]+\\s*[-–—~～至]\\s*[0-9]+\\s*题/.test(document.querySelector(".practice-title").innerText)'),'Native article titles omit their question range');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".display-controls [data-action=display]")].map(b=>b.dataset.display)'),['hidden','original','bilingual'],'Native text choices are ordered hidden, original, bilingual');
 const bookmarkSnapshot=()=>evaluate('(()=>{var b=document.querySelector("[data-action=bookmark]");return {pressed:b.getAttribute("aria-pressed"),background:getComputedStyle(b).backgroundColor,fill:getComputedStyle(b.querySelector("svg path")).fill}})()');
 result.bookmarkBefore=await bookmarkSnapshot();
 await tapControl('[data-action=bookmark]');await wait(220);result.bookmarkToggled=await bookmarkSnapshot();
 assert.notEqual(result.bookmarkToggled.pressed,result.bookmarkBefore.pressed,'First touch toggles the bookmark');
 assert.equal(result.bookmarkToggled.fill==='none',result.bookmarkToggled.pressed==='false','Bookmark state changes the glyph fill');
 assert.equal(result.bookmarkToggled.background,result.bookmarkBefore.background,'No rectangular bookmark background is added');
 await tapControl('[data-action=bookmark]');await wait(220);result.bookmarkRestored=await bookmarkSnapshot();
 assert.deepEqual(result.bookmarkRestored,result.bookmarkBefore,'Second touch restores the original glyph and background');
 assert.equal(await evaluate('document.querySelector("#toast").classList.contains("visible")'),false,'Bookmark toggle leaves no notification box');

 await poll('document.querySelector("#audio").readyState >= 1');
 result.audio=await evaluate('({duration:document.querySelector("#audio").duration,source:document.querySelector("#audio").currentSrc})');
 assert.ok(result.audio.duration>10,'Bundled native-served audio metadata decodes');
 if(publicDemo)assert.ok(result.audio.source.endsWith('/media/morning.wav'),'The original public demo recording is served');
 {
  result.practiceGeometry=await evaluate('(()=>{var player=document.querySelector(".playback-card").getBoundingClientRect(),text=document.querySelector(".main-panel").getBoundingClientRect(),css=getComputedStyle(document.documentElement);var rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});return {width:innerWidth,height:innerHeight,safeTop:parseFloat(css.getPropertyValue("--safe-top"))||0,safeBottom:parseFloat(css.getPropertyValue("--safe-bottom"))||0,contentWidth:document.documentElement.scrollWidth,navCount:document.querySelectorAll(".bottom-nav").length,player:rect(player),text:rect(text),controls:[...document.querySelectorAll(".player-buttons button")].map(b=>({action:b.dataset.action,...rect(b.getBoundingClientRect())}))}})()');
  const geometry=result.practiceGeometry;
  const availableHeight=geometry.height-geometry.safeTop-geometry.safeBottom;
  assert.equal(geometry.navCount,0,'Practice replaces bottom navigation with the audio player');
  assert.ok(geometry.contentWidth<=geometry.width+1,'Practice fits the native viewport horizontally');
  assert.ok(geometry.player.bottom<=geometry.height+1&&geometry.player.left>=-1&&geometry.player.right<=geometry.width+1,'Compact player fits the native viewport');
  assert.ok(geometry.text.bottom<=geometry.player.top+1,'Article text stays above the fixed player');
  assert.ok(geometry.player.height-geometry.safeBottom<=110,'The audio player uses a compact row below the progress bar');
  if(geometry.width>=360&&geometry.height>=700&&geometry.height>geometry.width)assert.ok(geometry.text.height>=availableHeight*.6,'Article text receives at least 60 percent of the available portrait screen');
  for(const control of geometry.controls)assert.ok(control.left>=geometry.player.left-1&&control.right<=geometry.player.right+1&&control.top>=geometry.player.top-1&&control.bottom<=geometry.player.bottom+1,'Player touch targets fit inside the dock');
  await writeFile(path.join(root,'practice.png'),run(['exec-out','screencap','-p'],true));
 }
 if(publicDemo){
  result.playbackStart=await evaluate('(()=>{var a=document.querySelector("#audio");a.pause();a.currentTime=0;return a.currentTime})()');
  assert.equal(result.playbackStart,0,'Original demo starts at zero so playback progression is measurable');
 }
 // Use an Android input event so WebView receives the same gesture as a real screen tap.
 const tapPlay=async()=>{result.tap=await tapControl('[data-action=play]')};
 const playing='(()=>{var a=document.querySelector("#audio");return !a.paused&&a.currentTime>0?{paused:a.paused,time:a.currentTime}:null})()';
 await tapPlay();
 try{result.playback=await poll(playing)}catch(error){
  if(!await recoverSystemUiDialog('playback'))throw error;
  assert.ok(await evaluate('document.querySelector("#audio").paused'),'Retry only a tap blocked by the system dialog');
  await tapPlay();result.playback=await poll(playing);
 }
 assert.equal(result.playback.paused,false,'Native WebView audio plays after a touch');
 assert.ok(result.playback.time>0,'Native audio playback progresses');
 result.speedBefore=await evaluate('document.querySelector("#audio").playbackRate');
 await evaluate('window.__speedAudio=document.querySelector("#audio");window.__speedReader=document.querySelector(".main-panel")');
 result.speedMenuTap=await tapControl('[data-action=speed]');
 await poll('document.querySelector(".speed-popover")&&document.querySelector("[data-action=speed]").getAttribute("aria-expanded")==="true"');
 assert.equal(await evaluate('document.querySelector("#audio").playbackRate'),result.speedBefore,'Opening the native speed menu keeps the current rate');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".speed-popover [role=menuitemradio]")].map(b=>Number(b.dataset.speed))'),[.75,1,1.25,1.5],'Native popup has explicit playback rate choices');
 result.speedChoiceTap=await tapControl('.speed-popover [data-action=set-speed][data-speed="1.25"]');
 result.speedPlayback=await poll(`(()=>{var a=document.querySelector("#audio");return !document.querySelector(".speed-popover")&&!a.paused&&a.playbackRate===1.25&&!a.error&&a.currentTime>${result.playback.time}+.1?{time:a.currentTime,rate:a.playbackRate}:null})()`);
 assert.ok(result.speedPlayback.time>result.playback.time,'Playback continues while the native menu changes speed');
 assert.ok(await evaluate('window.__speedAudio===document.querySelector("#audio")&&window.__speedReader===document.querySelector(".main-panel")'),'Native speed adjustment retains the existing audio and reader');
 assert.equal(await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).speed'),1.25,'Native speed selection is saved');
 await tapControl('[data-action=speed]');
 run(['shell','input','keyevent','4']);
 await poll('!document.querySelector(".speed-popover")&&document.querySelector(".practice-header")');
 assert.equal(await evaluate('document.querySelector("#audio").playbackRate'),1.25,'Android back dismisses the popup without changing rate or leaving the reader');
 await tapControl('[data-action=speed]');
 await poll('document.querySelector(".speed-popover")&&document.querySelector("[data-action=speed]").getAttribute("aria-expanded")==="true"');
 await tapControl(`.speed-popover [data-action=set-speed][data-speed="${result.speedBefore}"]`);
 await poll(`!document.querySelector(".speed-popover")&&document.querySelector("#audio").playbackRate===${result.speedBefore}`);
 if(publicDemo){
  await tapPlay();
  result.pause=await poll('(()=>{var a=document.querySelector("#audio");return a.paused?{paused:a.paused,time:a.currentTime}:null})()');
  assert.equal(result.pause.paused,true,'Compact player pauses after a second native touch');
 }
 await evaluate('document.querySelector("#audio").pause();document.querySelector("#audio").currentTime=10');
 if(publicDemo){
  result.seekForwardTap=await tapControl('[data-action=seek-relative][data-seconds="5"]');
  result.seekForward=await poll('Math.abs(document.querySelector("#audio").currentTime-15)<.5&&document.querySelector("#audio").currentTime');
  result.seekBackwardTap=await tapControl('[data-action=seek-relative][data-seconds="-5"]');
  result.seekBackward=await poll('Math.abs(document.querySelector("#audio").currentTime-10)<.5&&document.querySelector("#audio").currentTime');
 }
 await evaluate('document.querySelector("[data-action=mode][data-mode=exam]").click()');
 await poll('document.querySelector(".quiz-card") && document.querySelector("#audio").readyState >= 1');
 result.modeTime=await evaluate('document.querySelector("#audio").currentTime');
 assert.ok(Math.abs(result.modeTime-10)<.5,'Native playback timeline preserved when changing mode');
 const interactionPaper=localReal?realSelection.paper:publicDemo?JSON.parse(await readFile(path.resolve('examples/demo/demo.json'),'utf8')):await evaluate('fetch("demo.json").then(r=>r.json())');
 const interactionActive=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).active');
 const interactionArticle=interactionPaper.articles.find(article=>article.id===interactionActive.article);
 assert.ok(interactionArticle,'Native interaction uses a known bundled article');
 const qs=interactionArticle.questions;
 result.answersBeforeInteraction=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
 const completionKey=JSON.stringify([interactionPaper.id,interactionArticle.id]);
 result.articleCompletionBefore=await evaluate(`JSON.parse(localStorage.getItem('listenly.state.v1')).articleCompletions[${JSON.stringify(completionKey)}]||null`);
 const keyFor=q=>JSON.stringify([interactionPaper.id,interactionArticle.id,q.id]);
 const pendingQuestions=qs.map((q,index)=>({q,index,key:keyFor(q)})).filter(({key})=>!result.answersBeforeInteraction[key]?.submitted);
 assert.ok(pendingQuestions.length,'The project emulator has an unanswered article for a real whole-article submission');
 assert.equal(await evaluate('document.querySelectorAll(".quiz-question[data-question-index]").length'),qs.length,'Every question in the article is present on the same page');
 assert.equal(await evaluate('document.querySelectorAll(".question-dot,[data-action=next-question],[data-action=submit-answer],.quiz-card h3").length'),0,'The article has no question pager, individual submit action or written question heading');
 for(const q of qs)if(q.prompt)assert.ok(!await evaluate(`document.querySelector('.quiz-card').textContent.includes(${JSON.stringify(q.prompt)})`),'Written listening questions are absent from the exam DOM');
 const expandedIndices=await evaluate('[...document.querySelectorAll(".quiz-question.is-open")].map(row=>row.dataset.questionIndex)');
 for(const expandedIndex of expandedIndices){
  const selector=`[data-action=toggle-question][data-index="${expandedIndex}"]`;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  await tapControl(selector);await poll(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')==='false'`);await wait(220);
 }
 if(qs.length>1){
  for(const index of [0,1]){
   const selector=`[data-action=toggle-question][data-index="${index}"]`;
   await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await tapControl(selector);
   await poll(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')==='true'`);await wait(220);
  }
  result.independentDropdowns=await evaluate('[...document.querySelectorAll(".quiz-question.is-open")].map(row=>Number(row.dataset.questionIndex))');
  assert.deepEqual(result.independentDropdowns,[0,1],'Native taps can leave two option dropdowns expanded together');
  for(const index of [0,1]){
   const selector=`[data-action=toggle-question][data-index="${index}"]`;
   await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await tapControl(selector);
   await poll(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')==='false'`);await wait(220);
   if(index===0)assert.equal(await evaluate('document.querySelector(\'[data-action=toggle-question][data-index="1"]\').getAttribute("aria-expanded")'),'true','Collapsing one question leaves the other expanded');
  }
 }else result.independentDropdowns={status:'not-applicable',reason:'This fixture has only one question'};
 result.quizGeometry=await evaluate('(()=>{var panel=document.querySelector(".main-panel"),p=panel.getBoundingClientRect(),rows=[...document.querySelectorAll(".quiz-question")],submit=document.querySelector("[data-action=submit-article]"),s=submit.getBoundingClientRect();return {width:innerWidth,height:innerHeight,panel:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,rows:rows.map(row=>{var r=row.getBoundingClientRect();return {index:row.dataset.questionIndex,left:r.left,right:r.right,top:r.top,bottom:r.bottom}}),submit:{top:s.top,bottom:s.bottom}}})()');
 for(const row of result.quizGeometry.rows)assert.ok(row.left>=result.quizGeometry.panel.left-1&&row.right<=result.quizGeometry.panel.right+1&&row.top>=result.quizGeometry.panel.top-1&&row.bottom<=result.quizGeometry.panel.bottom+1,'Every collapsed question row fits above the audio dock');
 assert.ok(result.quizGeometry.submit.bottom<=result.quizGeometry.panel.bottom+1,'The whole-article submit control fits on the same compact page');
 const changedKeys=new Set();result.articleChoices=[];
 for(const {q,index,key} of pendingQuestions){
  const toggle=`[data-action=toggle-question][data-index="${index}"]`,optionId=publicDemo?q.answer:q.options[0].id;
  await evaluate(`document.querySelector(${JSON.stringify(toggle)}).scrollIntoView({block:'center'})`);
  const opened=await tapControl(toggle);
  await poll(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')==='true'`);await wait(220);
  let otherToggle;
  if(!result.articleChoices.length&&qs.length>1){
   const otherIndex=index===0?1:0;otherToggle=`[data-action=toggle-question][data-index="${otherIndex}"]`;
   await evaluate(`document.querySelector(${JSON.stringify(otherToggle)}).scrollIntoView({block:'center'})`);await tapControl(otherToggle);
   await poll(`document.querySelector(${JSON.stringify(otherToggle)}).getAttribute('aria-expanded')==='true'&&document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')==='true'`);await wait(220);
  }
  const option=`[data-action=answer][data-index="${index}"][data-option="${optionId}"]`;
  await evaluate(`document.querySelector(${JSON.stringify(option)}).scrollIntoView({block:'center'})`);
  const choice=await tapControl(option);
  await poll(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')==='false'`);await wait(220);
  if(otherToggle){
   assert.equal(await evaluate(`document.querySelector(${JSON.stringify(otherToggle)}).getAttribute('aria-expanded')`),'true','Choosing an option collapses only that question');
   result.choiceLeavesOtherExpanded=true;
   await evaluate(`document.querySelector(${JSON.stringify(otherToggle)}).scrollIntoView({block:'center'})`);await tapControl(otherToggle);
   await poll(`document.querySelector(${JSON.stringify(otherToggle)}).getAttribute('aria-expanded')==='false'`);await wait(220);
  }
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(toggle)}).innerText.includes(${JSON.stringify(q.options.find(o=>o.id===optionId).text)})`),'The collapsed row shows the complete chosen option');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('listenly.state.v1')).answers[${JSON.stringify(key)}].submitted`),false,'Choosing an option saves a draft without grading or advancing');
  const remainingUnchosen=pendingQuestions.some(item=>item.key!==key&&!changedKeys.has(item.key)&&!item.q.options.some(o=>o.id===result.answersBeforeInteraction[item.key]?.choice));
  if(remainingUnchosen){assert.ok(await evaluate('document.querySelector("[data-action=submit-article]").disabled'),'A partially answered article cannot be submitted');result.partialSubmissionPrevented=true}
  changedKeys.add(key);result.articleChoices.push({index,id:q.id,choice:optionId,opened,choiceTap:choice});
 }
 await poll('document.querySelector("[data-action=submit-article]")&&!document.querySelector("[data-action=submit-article]").disabled');
 await evaluate('document.querySelector("[data-action=submit-article]").scrollIntoView({block:"center"})');
 result.submitTap=await tapControl('[data-action=submit-article]');
 await poll('document.querySelector("[data-action=view-result]")&&document.querySelectorAll(".quiz-question.is-open").length===0');
 result.answer=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
 result.articleCompletionAfter=await evaluate(`JSON.parse(localStorage.getItem('listenly.state.v1')).articleCompletions[${JSON.stringify(completionKey)}]||null`);
 assert.equal(result.articleCompletionAfter?.count,(result.articleCompletionBefore?.count||0)+1,'Finishing the article credits exactly one complete article');
 for(const q of qs)assert.ok(result.answer[keyFor(q)]?.submitted,'One whole-article submission commits all question choices');
 for(const chosen of result.articleChoices){
  const q=qs[chosen.index],key=keyFor(q);
  assert.equal(result.answer[key].choice,chosen.choice,'The selected choice is retained after grading');
  if(publicDemo)assert.ok(await evaluate(`!!document.querySelector('.quiz-question[data-question-index="${chosen.index}"] .question-state.is-correct')`),'The original demo answer has a correct-state glyph after submission');
 }
 for(const [savedKey,savedAnswer] of Object.entries(result.answersBeforeInteraction))if(!changedKeys.has(savedKey))assert.deepEqual(result.answer[savedKey],savedAnswer,'Previously submitted answers and other article records remain unchanged');
 const reviewIndex=result.articleChoices[0].index,reviewToggle=`[data-action=toggle-question][data-index="${reviewIndex}"]`;
 await evaluate(`document.querySelector(${JSON.stringify(reviewToggle)}).scrollIntoView({block:'center'})`);await tapControl(reviewToggle);await wait(220);
 assert.ok(await evaluate(`!!document.querySelector('.quiz-question[data-question-index="${reviewIndex}"] .question-feedback')`),'An expanded submitted question exposes answer feedback');
 assert.ok(await evaluate(`Array.from(document.querySelectorAll('.quiz-question[data-question-index="${reviewIndex}"] [data-action=answer]')).every(b=>b.disabled)`),'Submitted answer choices cannot be changed');
 await tapControl(reviewToggle);await wait(220);
 await evaluate('document.querySelector("[data-action=view-result]").scrollIntoView({block:"center"})');await tapControl('[data-action=view-result]');
 await poll('document.querySelector(".result-card")');
 await evaluate('document.querySelector("[data-action=nav][data-route=home]").click()');
 await evaluate('window.__listenlyReloadProbe=true');
 await rpc('Page.reload');
 await poll('!window.__listenlyReloadProbe && document.querySelector(".focus-card")');
 result.restoredAnswers=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
 assert.deepEqual(result.restoredAnswers,result.answer,'Answers survive WebView page reload');
 const savedHomeExpression='(()=>{var s=JSON.parse(localStorage.getItem("listenly.state.v1"));return {selectedPaper:s.selectedPaper,homeFocus:s.homeFocus||null}})()';
 const homeSnapshotExpression='(()=>{var s=JSON.parse(localStorage.getItem("listenly.state.v1")),b=document.querySelector(".focus-play");return {selectedPaper:s.selectedPaper,homeFocus:s.homeFocus||null,hero:{paper:b.dataset.paper,article:b.dataset.article}}})()';
 const homeBeforePreview=await evaluate(homeSnapshotExpression);
 await tapControl('[data-action=nav][data-route=library]');
 await poll('document.querySelector(".paper-group-row")');
 assert.equal(await evaluate('document.querySelectorAll(".theme-control button,[data-action=import]").length'),0,'The library paper directory has no appearance or import controls');
 assert.equal(await evaluate('document.querySelectorAll("#library-list [data-action=open]").length'),0,'Library first level lists papers instead of individual articles');
 result.filterTap=await tapControl('[data-action=filter-menu][data-filter=year]');
 await poll('document.querySelector(".filter-popover")');
 assert.ok(await evaluate('document.querySelectorAll(".filter-popover [data-action=set-filter]").length>0'),'Year filter provides explicit choices');
 run(['shell','input','keyevent','4']);
 await poll('!document.querySelector(".filter-popover")&&document.querySelector(".paper-group-row")');
 const paperProbe=await evaluate(`(()=>{var rows=[...document.querySelectorAll('[data-action=open-paper]')],other=rows.find(b=>b.dataset.paper!==${JSON.stringify(homeBeforePreview.selectedPaper)});return (other||rows[0]).dataset.paper})()`);
 const paperOpenSelector=`[data-action=open-paper][data-paper="${paperProbe}"]`;
 await evaluate(`document.querySelector(${JSON.stringify(paperOpenSelector)}).scrollIntoView({block:'center'})`);await tapControl(paperOpenSelector);
 await poll('document.querySelector("[data-action=library-back]")&&document.querySelector("#library-list [data-action=open]")');
 assert.equal(await evaluate('document.querySelectorAll(".theme-control button,[data-action=import]").length'),0,'The library article directory has no appearance or import controls');
 const selectionAfterPaperPreview=await evaluate(savedHomeExpression);
 assert.deepEqual(selectionAfterPaperPreview,{selectedPaper:homeBeforePreview.selectedPaper,homeFocus:homeBeforePreview.homeFocus},'Previewing a paper does not choose it or change the home focus');
 const previewArticle=await evaluate(`(()=>{var rows=[...document.querySelectorAll('#library-list [data-action=open]')],other=rows.find(b=>b.dataset.paper!==${JSON.stringify(homeBeforePreview.hero.paper)}||b.dataset.article!==${JSON.stringify(homeBeforePreview.hero.article)}),b=other||rows[0];return {paper:b.dataset.paper,article:b.dataset.article}})()`);
 const previewArticleSelector=`#library-list [data-action=open][data-paper="${previewArticle.paper}"][data-article="${previewArticle.article}"]`;
 await evaluate(`document.querySelector(${JSON.stringify(previewArticleSelector)}).scrollIntoView({block:'center'})`);await tapControl(previewArticleSelector);
 await poll('document.querySelector(".practice-header")&&document.querySelector("#audio").readyState>=1');
 const selectionAfterArticlePreview=await evaluate(savedHomeExpression);
 assert.deepEqual(selectionAfterArticlePreview,selectionAfterPaperPreview,'Previewing article text does not select its paper or replace the pinned article');
 run(['shell','input','keyevent','4']);await poll('document.querySelector(".focus-card")');
 const homeAfterPreview=await evaluate(homeSnapshotExpression);
 assert.deepEqual(homeAfterPreview,homeBeforePreview,'Returning home after a paper and article preview preserves the chosen suite and pinned article');
 result.libraryPreview={paper:paperProbe,article:previewArticle.article,alternatePaper:paperProbe!==homeBeforePreview.selectedPaper,before:homeBeforePreview,afterPaper:selectionAfterPaperPreview,afterArticle:selectionAfterArticlePreview,homeAfter:homeAfterPreview};
 await tapControl('[data-action=nav][data-route=library]');await poll('document.querySelector(".paper-group-row")');
 await evaluate(`document.querySelector(${JSON.stringify(paperOpenSelector)}).scrollIntoView({block:'center'})`);await tapControl(paperOpenSelector);
 await poll('document.querySelector(".library-paper-row .row-play[data-action=material-play]")');
 const materialPlaySelector=`.library-paper-row .row-play[data-action=material-play][data-paper="${previewArticle.paper}"][data-article="${previewArticle.article}"]`;
 await evaluate(`document.querySelector(${JSON.stringify(materialPlaySelector)}).scrollIntoView({block:'center'})`);
 result.libraryMaterialPlayTap=await tapControl(materialPlaySelector);
 result.libraryMaterialPlayback=await poll(`(()=>{var a=document.querySelector('#audio'),s=JSON.parse(localStorage.getItem('listenly.state.v1'));return !a.paused&&a.currentTime>0&&!a.error&&s.selectedPaper===${JSON.stringify(previewArticle.paper)}?{time:a.currentTime,playing:!a.paused,selectedPaper:s.selectedPaper,homeFocus:s.homeFocus||null}:null})()`);
 assert.ok(await evaluate('!!document.querySelector("[data-action=library-back]")'),'The library play button starts audio without opening article text');
 await tapControl('[data-action=nav][data-route=home]');await poll('document.querySelector(".focus-card")');
 result.libraryPlayHome=await evaluate(homeSnapshotExpression);
 assert.deepEqual(result.libraryPlayHome.hero,previewArticle,'Actually playing a library article selects its paper and pins that article on home');
 assert.equal(result.libraryPlayHome.selectedPaper,previewArticle.paper,'Library playback persists the chosen suite');
 await tapControl('[data-action=nav][data-route=library]');await poll('document.querySelector(".paper-group-row")');
 await evaluate(`document.querySelector(${JSON.stringify(paperOpenSelector)}).scrollIntoView({block:'center'})`);await tapControl(paperOpenSelector);
 await poll('document.querySelector("[data-action=library-back]")');
 run(['shell','input','keyevent','4']);
 await poll('document.querySelector(".paper-group-row")&&!document.querySelector("[data-action=library-back]")');
 const circlePaper=await evaluate(`(()=>{var rows=[...document.querySelectorAll('[data-action=select-paper]')],other=rows.find(b=>b.dataset.paper!==${JSON.stringify(previewArticle.paper)});return (other||rows[0]).dataset.paper})()`);
 await evaluate(`document.querySelector('[data-action=select-paper][data-paper="${circlePaper}"]').scrollIntoView({block:'center'})`);
 result.paperSelectionTap=await tapControl(`[data-action=select-paper][data-paper="${circlePaper}"]`);
 assert.equal(await evaluate(`document.querySelector('[data-action=select-paper][data-paper="${circlePaper}"]').getAttribute('aria-pressed')`),'true','The right circular selection button updates the chosen paper');
 await tapControl('[data-action=nav][data-route=home]');
 await poll('document.querySelector(".focus-card")');
 result.selectedPaperHome=await evaluate('({paper:document.querySelector(".focus-play").dataset.paper,listed:[...document.querySelectorAll(".home-paper-row [data-action=home-play]")].map(b=>b.dataset.paper),saved:JSON.parse(localStorage.getItem("listenly.state.v1")).selectedPaper})');
 assert.equal(result.selectedPaperHome.paper,circlePaper,'The explicitly selected paper supplies the home focus');
 assert.ok(result.selectedPaperHome.listed.every(paper=>paper===circlePaper),'Home lists only articles in the chosen paper');
 assert.equal(result.selectedPaperHome.saved,circlePaper,'Paper choice is persisted');
 await tapControl('[data-action=nav][data-route=profile]');
 await poll('document.querySelector(".activity-calendar")');
 assert.equal(await evaluate('document.querySelectorAll(".settings-card [data-action=import]").length'),0,'Profile removes the duplicate folder-import entry');
 assert.equal(await evaluate('document.querySelectorAll(".topbar [data-action=import]").length'),1,'The top folder-import button remains available on profile');
 assert.equal(await evaluate('document.querySelectorAll(".topbar .theme-control button").length'),2,'Profile retains the day/night control beside folder import');
 await tapControl('.topbar [data-action=import]');await poll('document.querySelectorAll(".dialog .import-choice").length===2');
 run(['shell','input','keyevent','4']);await poll('!document.querySelector(".dialog-shade")&&document.querySelector(".statistics")');
 assert.ok(await evaluate('document.querySelector(".statistics").innerText.includes("今日完成 · 篇")'),'Today completion is labeled in articles');
 await wait(220);
 result.calendarGeometry=await evaluate('(()=>{var cell=document.querySelector(".calendar-day[aria-current=date]"),clip=document.querySelector(".activity-calendar"),r=cell.getBoundingClientRect(),v=clip.getBoundingClientRect(),css=getComputedStyle(cell),ring=Math.max(0,(parseFloat(css.outlineWidth)||0)+(parseFloat(css.outlineOffset)||0));return {cell:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},clip:{left:v.left,right:v.right,top:v.top,bottom:v.bottom},ring:ring}})()');
 const calendar=result.calendarGeometry;
 assert.ok(calendar.cell.left-calendar.ring>=calendar.clip.left-.5&&calendar.cell.right+calendar.ring<=calendar.clip.right+.5,'The native calendar shows the entire current-day cell and selection ring');
 await writeFile(path.join(root,'profile.png'),run(['exec-out','screencap','-p'],true));
 result.after=run(['shell','pidof','cn.listenly.app']).trim();
 assert.equal(result.after,result.pid);
 result.verified=true;
 console.log(`PASS Android ${result.android} (API ${result.api}): install, launch, page, native assets/audio, touch playback, mode alignment and answer interaction.`);
}catch(error){result.verified=false;result.error=String(error?.stack||error);console.error(result.error);process.exitCode=1}
finally{
 socket?.close();
 for(const [name,args,binary] of [['crash.log',['logcat','-d','-b','crash','-v','threadtime'],false],['logcat.log',['logcat','-d','-v','threadtime'],false],['screen.png',['exec-out','screencap','-p'],true]]){
   try{await writeFile(path.join(root,name),run(args,binary))}catch(error){result[name+'Error']=String(error.message)}
 }
 if(forwarded){try{run(['forward','--remove','tcp:9333'])}catch(error){result.cleanupError=String(error.message)}}
 await writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));
}
