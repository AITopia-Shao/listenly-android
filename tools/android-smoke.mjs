/** Real Android runtime check. Explicit emulator serial prevents accidental phone writes. */
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const [serial,apk,label='runtime']=process.argv.slice(2);
if(!serial?.startsWith('emulator-')||!apk)throw new Error('Usage: node tools/android-smoke.mjs emulator-5554 app.apk label');
const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME;
const adb=process.env.ADB||(sdk?path.join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'):
  process.platform==='win32'?'C:/Program Files (x86)/Android/android-sdk/platform-tools/adb.exe':'adb');
const root=path.resolve('.build/runtime-results',label);
await mkdir(root,{recursive:true});
const run=(args,binary=false)=>execFileSync(adb,['-s',serial,...args],{encoding:binary?undefined:'utf8',timeout:120000,windowsHide:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const httpJSON=url=>new Promise((resolve,reject)=>http.get(url,response=>{let body='';response.on('data',data=>body+=data);response.on('end',()=>{try{resolve(JSON.parse(body))}catch(error){reject(error)}})}).on('error',reject));
let socket,forwarded=false;
const result={serial,label,apk:path.resolve(apk),checkedAt:new Date().toISOString()};
try{
 result.android=run(['shell','getprop','ro.build.version.release']).trim();
 result.api=run(['shell','getprop','ro.build.version.sdk']).trim();
 result.install=run(['install','-r',path.resolve(apk)]).trim();
 run(['logcat','-c']);
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
 assert.ok(!crash.includes('FATAL EXCEPTION')&&!crash.includes('signal 11'),'No Java or native fatal exception');
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
 await evaluate('document.querySelector(".focus-card [data-action=open]").click()');
 await poll('document.querySelector("#audio").readyState >= 1');
 result.audio=await evaluate('({duration:document.querySelector("#audio").duration,source:document.querySelector("#audio").currentSrc})');
 assert.ok(result.audio.duration>10,'Bundled native-served audio metadata decodes');
 // Browser user-gesture requirements are satisfied through CDP Input, not JS autoplay bypass.
 const play=await evaluate('(()=>{var r=document.querySelector("[data-action=play]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await rpc('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:play.x,y:play.y}]});
 await rpc('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await wait(1500);
 result.playback=await evaluate('({paused:document.querySelector("#audio").paused,time:document.querySelector("#audio").currentTime})');
 assert.equal(result.playback.paused,false,'Native WebView audio plays after a touch');
 assert.ok(result.playback.time>0,'Native audio playback progresses');
 await evaluate('document.querySelector("#audio").pause();document.querySelector("#audio").currentTime=10;document.querySelector("[data-action=mode][data-mode=exam]").click()');
 await poll('document.querySelector(".quiz-card") && document.querySelector("#audio").readyState >= 1');
 result.modeTime=await evaluate('document.querySelector("#audio").currentTime');
 assert.ok(Math.abs(result.modeTime-10)<.5,'Native playback timeline preserved when changing mode');
 await evaluate('document.querySelector("[data-action=answer]").click();document.querySelector("[data-action=submit-answer]").click()');
 await poll('document.querySelector(".feedback")');
 result.answer=await evaluate('JSON.parse(localStorage.getItem("listenly.state.v1")).answers');
 await evaluate('document.querySelector("[data-action=nav][data-route=home]").click()');
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
