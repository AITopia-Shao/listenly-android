import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';
import {clickAppControl} from './library-navigation.mjs';
import {playbackRates,assertSpeed,cycleSpeedTo} from './playback-speed.mjs';

let playwright;try{playwright=await import('playwright')}catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(option('--web-root')||(args.includes('--demo')?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const output=path.resolve(option('--output')||'.build/speed-cycle/browser');await mkdir(output,{recursive:true});
const result={passed:false,entrySha256:createHash('sha256').update(await readFile(path.join(webRoot,'app.compat.js'))).digest('hex'),checks:[],pageErrors:[],events:[]};
const browser=await playwright.chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const context=await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:1,reducedMotion:'no-preference'}),page=await context.newPage();page.on('pageerror',error=>result.pageErrors.push(error.message));
const key=JSON.stringify(['listenly-original','morning','intensive','passage']),answerKey=JSON.stringify(['listenly-original','morning','q1']);
await context.addInitScript(({key,answerKey})=>{
 if(!localStorage.getItem('listenly.state.v1'))localStorage.setItem('listenly.state.v1',JSON.stringify({speed:.75,active:{paper:'listenly-original',article:'morning'},homeFocus:null,selectedPaper:'listenly-original',positions:{[key]:8},answers:{[answerKey]:{choice:'B',submitted:false}},bookmarks:[JSON.stringify(['listenly-original','morning'])]}));
 window.__speedMediaEvents=[];document.addEventListener('DOMContentLoaded',()=>{const audio=document.querySelector('#audio');for(const type of ['play','playing','pause','seeking','seeked','emptied','loadstart','ended','ratechange','error'])audio.addEventListener(type,event=>window.__speedMediaEvents.push({type,trusted:event.isTrusted,at:performance.now(),time:audio.currentTime,rate:audio.playbackRate,src:audio.currentSrc}))});
},{key,answerKey});
const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`,click=selector=>clickAppControl(page,selector);
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));
const snapshot=()=>page.locator('#audio').evaluate(audio=>({at:performance.now(),time:audio.currentTime,rate:audio.playbackRate,paused:audio.paused,seeking:audio.seeking,src:audio.currentSrc,error:audio.error?.code||null}));
const metadata=()=>page.waitForFunction(()=>{const audio=document.querySelector('#audio');return audio.readyState>=1&&Number.isFinite(audio.duration)&&!audio.seeking});
const events=()=>page.evaluate(()=>window.__speedMediaEvents.slice());
function pass(label,details){result.checks.push({label,...(details?{details}:{})});console.log(`PASS ${label}`)}
async function cycle(expected,playing=false){
 const before=await snapshot(),beforeEvents=await events();await click('[data-action="speed"]');await assertSpeed(page,expected);const after=await snapshot();assert.equal(after.src,before.src,'rate cycling preserves the recording');assert.equal(after.error,null);assert.equal(after.seeking,false,'rate cycling does not initiate a seek');assert.equal(after.paused,before.paused,'rate cycling never changes paused/playing state');
 if(playing){assert.ok(after.time>=before.time-.04);assert.ok(after.time-before.time<=(after.at-before.at)/1000*2+.35,'the position advances only by ordinary playback');const emitted=(await events()).slice(beforeEvents.length);assert.ok(!emitted.some(event=>['pause','emptied','loadstart','ended','seeking','error'].includes(event.type)),'changing rate does not pause, reload, seek or replace the recording')}
 else assert.ok(Math.abs(after.time-before.time)<.04,'a paused rate change leaves the precise position intact');
 return {expected,before,after};
}
try{
 await page.goto(url);await page.locator('.home-playback').waitFor();await metadata();await assertSpeed(page,1);assert.ok(Math.abs((await snapshot()).time-8)<.15);const initial=await saved();assert.equal(initial.answers[answerKey].choice,'B');pass('legacy 0.75 speed migrates to 1 while preserving saved playback and draft answers');
 const paused=[];for(const expected of [1.25,1.5,1.75,2,1])paused.push(await cycle(expected));assert.deepEqual(paused.map(row=>row.expected),[1.25,1.5,1.75,2,1]);pass('five direct taps expose the complete cycle and wrap once, with no popup or position change',{paused});
 await page.evaluate(()=>window.__speedAudioNode=document.querySelector('#audio'));await click('.focus-play');await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>8.1);const playing=[];for(const expected of [1.25,1.5,1.75,2,1])playing.push(await cycle(expected,true));assert.equal(await page.evaluate(()=>window.__speedAudioNode===document.querySelector('#audio')),true);pass('the full five-rate cycle preserves real decoding and uninterrupted playback on the same audio node',{playing});
 const atHome=await snapshot();await click('.focus-open');await metadata();assert.equal(await page.evaluate(()=>window.__speedAudioNode===document.querySelector('#audio')),true);assert.equal((await snapshot()).paused,false);assert.ok((await snapshot()).time>=atHome.time-.05);await assertSpeed(page,1);await cycleSpeedTo(page,2);await assertSpeed(page,2);assert.equal((await snapshot()).paused,false);pass('opening the same article retains the playing recording and reader speed changes update the shared rate');
 await click('[data-action="play"]');await page.waitForFunction(()=>document.querySelector('#audio').paused);await cycle(1);await cycleSpeedTo(page,1.75);await click('[data-action="nav"][data-route="home"]');await assertSpeed(page,1.75);await cycle(2);const beforeReload=await saved();await page.reload();await page.locator('.home-playback').waitFor();await metadata();await assertSpeed(page,2);assert.equal((await snapshot()).paused,true);assert.deepEqual((await saved()).answers,initial.answers);assert.deepEqual((await saved()).bookmarks,initial.bookmarks);assert.ok(Math.abs((await snapshot()).time-beforeReload.positions[key])<.2);pass('reader and home share the selected rate; 2× persists through a real reload without autoplay or record changes');
 const button=page.locator('[data-action="speed"]');await button.focus();await page.keyboard.press('Enter');await assertSpeed(page,1);await page.keyboard.press('Space');await assertSpeed(page,1.25);await page.emulateMedia({reducedMotion:'reduce'});await cycle(1.5);assert.equal(await button.evaluate(element=>element.getAnimations({subtree:true}).length),0);await page.emulateMedia({reducedMotion:'no-preference'});pass('keyboard activation cycles once per action and reduced motion keeps direct controls immediate');
 const restored=[];for(const speed of playbackRates){const alternate=await browser.newContext({viewport:{width:393,height:873}});try{await alternate.addInitScript(speed=>localStorage.setItem('listenly.state.v1',JSON.stringify({speed,active:{paper:'listenly-original',article:'morning'},selectedPaper:'listenly-original'})),speed);const tab=await alternate.newPage();tab.on('pageerror',error=>result.pageErrors.push(error.message));await tab.goto(url);await tab.locator('.home-playback').waitFor();await tab.waitForFunction(()=>document.querySelector('#audio').readyState>=1);await assertSpeed(tab,speed);restored.push(speed)}finally{await alternate.close()}}assert.deepEqual(restored,playbackRates);pass('all five valid persisted rates are restored on a new application document',{restored});
 result.events=await events();assert.deepEqual(result.pageErrors,[]);result.passed=true;await page.screenshot({path:path.join(output,'direct-speed.png')});console.log(JSON.stringify({passed:true,checks:result.checks.length,entrySha256:result.entrySha256,output}));
}catch(error){result.failure={message:error.message,stack:error.stack};result.finalAudio=await snapshot().catch(()=>null);result.events=await events().catch(()=>[]);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
