/** Real Android runtime check. Explicit emulator serial prevents accidental phone writes. */
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const [serial,apk,label='runtime',...flags]=process.argv.slice(2);
const publicDemo=flags.includes('--demo');
if(!serial?.startsWith('emulator-')||!apk||flags.some(flag=>flag!=='--demo'))throw new Error('Usage: node tools/android-smoke.mjs emulator-5554 app.apk label [--demo]');
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
 if(publicDemo){
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
 result.home=await poll('document.querySelector(".focus-card") && document.body.innerText');
 assert.ok(result.home.includes('拾听'));
 result.webview=await evaluate('navigator.userAgent');
 result.viewport=await evaluate('({width:innerWidth,height:innerHeight,contentWidth:document.documentElement.scrollWidth})');
 assert.ok(result.viewport.contentWidth<=result.viewport.width+1,'Mobile page fits the viewport');
 await evaluate(publicDemo?'document.querySelector("[data-action=open][data-paper=listenly-original][data-article=morning]").click();document.querySelector("[data-action=mode][data-mode=intensive]").click()':'document.querySelector(".focus-card [data-action=open]").click()');
 await poll('document.querySelector("#audio").readyState >= 1');
 result.audio=await evaluate('({duration:document.querySelector("#audio").duration,source:document.querySelector("#audio").currentSrc})');
 assert.ok(result.audio.duration>10,'Bundled native-served audio metadata decodes');
 if(publicDemo)assert.ok(result.audio.source.endsWith('/media/morning.wav'),'The original public demo recording is served');
 // Use an Android input event so WebView receives the same gesture as a real screen tap.
 const tapPlay=async()=>{
  await evaluate('document.querySelector("[data-action=play]").scrollIntoView({block:"center"})');
  result.tap=await evaluate('(()=>{var b=document.querySelector("[data-action=play]"),r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x:x,y:y,scale:devicePixelRatio,hit:document.elementFromPoint(x,y).closest("[data-action=play]")===b}})()');
  assert.ok(result.tap.hit,'Visible touch target is the play button');
  run(['shell','input','tap',String(Math.round(result.tap.x*result.tap.scale)),String(Math.round(result.tap.y*result.tap.scale))]);
 };
 const playing='(()=>{var a=document.querySelector("#audio");return !a.paused&&a.currentTime>0?{paused:a.paused,time:a.currentTime}:null})()';
 await tapPlay();
 try{result.playback=await poll(playing)}catch(error){
  if(!await recoverSystemUiDialog('playback'))throw error;
  assert.ok(await evaluate('document.querySelector("#audio").paused'),'Retry only a tap blocked by the system dialog');
  await tapPlay();result.playback=await poll(playing);
 }
 assert.equal(result.playback.paused,false,'Native WebView audio plays after a touch');
 assert.ok(result.playback.time>0,'Native audio playback progresses');
 await evaluate('document.querySelector("#audio").pause();document.querySelector("#audio").currentTime=10;document.querySelector("[data-action=mode][data-mode=exam]").click()');
 await poll('document.querySelector(".quiz-card") && document.querySelector("#audio").readyState >= 1');
 result.modeTime=await evaluate('document.querySelector("#audio").currentTime');
 assert.ok(Math.abs(result.modeTime-10)<.5,'Native playback timeline preserved when changing mode');
 if(publicDemo)await evaluate('document.querySelector("[data-action=question][data-index=0]").click()');
 await evaluate(publicDemo?'document.querySelector("[data-action=answer][data-option=B]").click();document.querySelector("[data-action=submit-answer]").click()':'document.querySelector("[data-action=answer]").click();document.querySelector("[data-action=submit-answer]").click()');
 await poll('document.querySelector(".feedback")');
 if(publicDemo){
  result.feedback=await evaluate('document.querySelector(".feedback").innerText');
  assert.ok(result.feedback.includes('答对了'),'Choosing original demo answer B grades correctly');
 }
 result.answer=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
 if(publicDemo){
  const answered=Object.entries(result.answer).filter(([key])=>{const [paper,article]=JSON.parse(key);return paper==='listenly-original'&&article==='morning'}).map(([,answer])=>answer);
  assert.ok(answered.some(answer=>answer.choice==='B'&&answer.submitted),'The original demo answer B is saved');
 }
 await evaluate('document.querySelector("[data-action=nav][data-route=home]").click()');
 await evaluate('window.__listenlyReloadProbe=true');
 await rpc('Page.reload');
 await poll('!window.__listenlyReloadProbe && document.querySelector(".focus-card")');
 result.restoredAnswers=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
 assert.deepEqual(result.restoredAnswers,result.answer,'Answers survive WebView page reload');
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
