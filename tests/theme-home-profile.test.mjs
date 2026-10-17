import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';
import {enterLibraryPaper,openLibraryArticle,clickAppControl} from './library-navigation.mjs';

// Exercise the rendered app with genuine pointer gestures and decoded audio.
let playwright;
try{playwright=await import('playwright')}
catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const args=process.argv.slice(2),root=process.cwd();
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(option('--web-root')||path.join(root,args.includes('--demo')?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const output=path.resolve(option('--output')||'.build/theme-home-profile');
await mkdir(output,{recursive:true});
const result={entrySha256:createHash('sha256').update(await readFile(path.join(webRoot,'app.compat.js'))).digest('hex'),checks:[],pageErrors:[],passed:false};
const browser=await playwright.chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const page=await browser.newPage({viewport:{width:393,height:873},timezoneId:'Asia/Shanghai',deviceScaleFactor:1});
page.on('pageerror',error=>result.pageErrors.push(error.message));
const dateKeys=await page.evaluate(()=>{
 const format=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const now=new Date(),previous=new Date(now);previous.setDate(previous.getDate()-1);
 return {today:format(now),previous:format(previous)};
});
const legacyKey=JSON.stringify(['retired-paper','past-article','old-question']);
const legacyArticleKey=JSON.stringify(['retired-paper','past-article']);
const seed={theme:'light',mode:'exam',display:'bilingual',activityVersion:2,days:{[dateKeys.previous]:3600,[dateKeys.today]:180},completedListeningDays:{[dateKeys.today]:180},studyDays:{[dateKeys.previous]:3420},dailyQuestions:{[dateKeys.previous]:{[legacyKey]:1},[dateKeys.today]:{[legacyKey]:3}},dailyArticles:{[dateKeys.previous]:{[legacyArticleKey]:2},[dateKeys.today]:{[legacyArticleKey]:1}},answers:{[legacyKey]:{choice:'A',submitted:true,at:Date.now()-86400000}},activity:{[JSON.stringify(['listenly-original','morning'])]:{last:Date.now(),seconds:600}}};
await page.addInitScript(seed=>{if(!localStorage.getItem('listenly.state.v1'))localStorage.setItem('listenly.state.v1',JSON.stringify(seed))},seed);
const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`;
const click=selector=>clickAppControl(page,selector);
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));
const audioState=()=>page.locator('#audio').evaluate(a=>({time:a.currentTime,src:a.currentSrc,paused:a.paused,error:a.error?{code:a.error.code,message:a.error.message}:null}));
async function watchActualPlayback(){await page.locator('#audio').evaluate(audio=>{window.__actualPlayback=null;audio.addEventListener('playing',()=>{window.__actualPlayback={src:audio.currentSrc,time:audio.currentTime}},{once:true})})}
async function watchProductionEnd(){return page.locator('#audio').evaluate(audio=>{window.__productionEnds??=[];const before=window.__productionEnds.length;audio.addEventListener('ended',event=>window.__productionEnds.push({src:audio.currentSrc,time:audio.currentTime,duration:audio.duration,trusted:event.isTrusted}),{once:true,capture:true});return before})}
async function waitProductionEnd(before){await page.waitForFunction(before=>(window.__productionEnds||[]).length>before,before);await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.readyState>=1&&a.currentTime>.05});await click('[data-action="play"]');await page.waitForFunction(()=>document.querySelector('#audio').paused);return page.evaluate(()=>window.__productionEnds.at(-1))}
async function waitForActualPlayback(suffix){await page.waitForFunction(suffix=>{const a=document.querySelector('#audio'),played=window.__actualPlayback;return played&&played.src.endsWith(suffix)&&!a.paused&&!a.error&&a.currentSrc===played.src&&a.currentTime>played.time+.1},suffix)}
function pass(label,details){result.checks.push({label,...(details?{details}:{})})}
async function checkOutsideReader(route){
 assert.equal(await page.locator('[data-action="mode"]').count(),0,`${route} exposes no training mode selector`);
 const profile=route==='profile';
 assert.equal(await page.locator('.theme-control [data-action="theme"]').count(),profile?2:0,`${route} only exposes appearance controls on profile`);
 assert.equal(await page.locator('[data-action="import"]').count(),profile?1:0,`${route} only exposes folder import on the profile top bar`);
 assert.equal(await page.locator('.bottom-nav').count(),1,`${route} has bottom navigation`);
 pass(`${route}: training controls are absent and global settings only appear on profile`);
}
async function setTheme(theme,returnRoute='home'){await click('[data-action="nav"][data-route="profile"]');await click(`[data-action="theme"][data-theme="${theme}"]`);await page.waitForTimeout(600);if(returnRoute!=='profile')await click(`[data-action="nav"][data-route="${returnRoute}"]`)}
async function checkDefaultReader(){
 assert.equal(await page.locator('[data-mode="intensive"][aria-pressed="true"]').count(),1,'entering reader defaults to intensive');
 assert.equal(await page.locator('[data-display="hidden"][aria-pressed="true"]').count(),1,'entering reader defaults to hidden text');
 assert.equal(await page.locator('.sentence').count(),0,'hidden default does not reveal text');
 assert.equal(await page.locator('.bottom-nav').count(),0,'reader keeps the compact audio dock');
 assert.deepEqual(await page.locator('.display-controls [data-action="display"]').evaluateAll(buttons=>buttons.map(button=>button.dataset.display)),['hidden','original','bilingual'],'reader orders text display from hidden to original to bilingual');
}
async function bookmarkStyle(){return page.locator('[data-action="bookmark"]').evaluate(b=>{const css=getComputedStyle(b),svg=getComputedStyle(b.querySelector('svg path'));return {background:css.backgroundColor,shadow:css.boxShadow,outline:css.outlineStyle,fill:svg.fill,pressed:b.getAttribute('aria-pressed')}})}
const numberStat=async name=>Number((await page.locator(`[data-stat="${name}"]`).innerText()).replace(/[^\d.]/g,''));
async function day(date){return page.locator(`.calendar-day[data-date="${date}"]`).evaluate(b=>({date:b.dataset.date,count:Number(b.dataset.count),level:Number(b.dataset.level),background:getComputedStyle(b).backgroundColor,label:b.getAttribute('aria-label')||b.getAttribute('title')}))}
async function choose(index,choice){const toggle=page.locator(`[data-action="toggle-question"][data-index="${index}"]`);if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await click(`.quiz-question[data-question-index="${index}"] [data-action="answer"][data-option="${choice}"]`)}
async function submitArticle(){await click('[data-action="submit-article"]');assert.equal(await page.locator('[data-action="view-result"]').count(),1,'the whole article is submitted together')}
async function speedMenu(buttonSelector='[data-action="speed"]'){
 const control=page.locator(buttonSelector).first();
 const rate=await page.locator('#audio').evaluate(a=>a.playbackRate);
 await control.click();
 const menu=page.getByRole('menu',{name:'播放速度'});await menu.waitFor();
 assert.equal(await control.getAttribute('aria-expanded'),'true','the speed control reports its open menu');
 assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),rate,'opening the speed menu does not change playback speed');
 assert.deepEqual(await menu.locator('[role="menuitemradio"]').evaluateAll(buttons=>buttons.map(b=>Number(b.dataset.speed))),[.75,1,1.25,1.5],'speed is chosen from four labeled rates');
 const selected=menu.locator('[aria-checked="true"]');assert.equal(await selected.count(),1,'one applied speed is marked');
 assert.equal(Number(await selected.getAttribute('data-speed')),rate,'the speed check mark matches the actual audio rate');
 return menu;
}
async function chooseSpeed(value){
 await page.locator(`.speed-popover [data-action="set-speed"][data-speed="${value}"]`).click();await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing'));
 assert.equal(await page.locator('.speed-popover').count(),0,'a speed choice dismisses the menu');
 assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),value,'the audio applies the chosen rate');
 assert.equal((await saved()).speed,value,'the chosen rate is persisted');
 assert.equal(await page.locator('[data-action="speed"]').first().getAttribute('aria-expanded'),'false','the speed control closes with its menu');
 assert.match(await page.locator('[data-action="speed"]').first().innerText(),new RegExp(`^${String(value).replace('.','\\.')}\\s*×$`),'the displayed rate matches the selected rate');
}
function shortRecording(bytes,duration){
 assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
 let format,pcm;
 for(let offset=12;offset+8<=bytes.length;){const tag=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);if(tag==='fmt ')format=bytes.subarray(offset+8,offset+8+size);if(tag==='data'){pcm=bytes.subarray(offset+8,offset+8+size);break}offset+=8+size+(size%2)}
 assert.ok(format&&pcm,'original recording has PCM format and data');assert.equal(format.readUInt16LE(0),1,'original fixture is PCM');
 const align=format.readUInt16LE(12),byteRate=format.readUInt32LE(8),data=pcm.subarray(0,Math.floor(duration*byteRate/align)*align);
 const header=Buffer.alloc(28+format.length);header.write('RIFF');header.writeUInt32LE(header.length+data.length-8,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(format.length,16);format.copy(header,20);header.write('data',20+format.length);header.writeUInt32LE(data.length,24+format.length);
 return Buffer.concat([header,data]);
}
async function importSelectionFixture(){
 const folder=path.join(output,'selection-fixture','experience-selection');await mkdir(folder,{recursive:true});
 const recording=shortRecording(await readFile(path.join(webRoot,'media/morning.wav')),2);
 await writeFile(path.join(folder,'paper.json'),JSON.stringify({id:'experience-selection',title:'选择与统计验证',year:2001,articles:[{id:'first',title:'第1篇 · 1–4题',audio:{intensive:'first/audio.wav',exam:'first/audio.wav'},transcript:'first/transcript.json',questions:'first/questions.json'},{id:'second',title:'第2篇 · 5-8 题',audio:{intensive:'second/audio.wav',exam:'second/audio.wav'},transcript:'second/transcript.json',questions:'second/questions.json'}]}));
 for(const id of ['first','second']){
  const directory=path.join(folder,id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'audio.wav'),recording);
  await writeFile(path.join(directory,'transcript.json'),JSON.stringify([{start:0,end:2,en:'An original listening fixture.',zh:'原创听力验证。'}]));
  await writeFile(path.join(directory,'questions.json'),JSON.stringify([{id:'q1',number:id==='first'?1:5,prompt:'Choose the first option.',options:['A','B','C','D'].map(id=>({id,text:`Option ${id}`})),answer:'A'}]));
 }
 await page.locator('#folder-input').setInputFiles(path.dirname(folder));
 await page.locator('[data-action="open-paper"][data-paper="experience-selection"]').waitFor();
 if(await page.locator('[data-action="close-dialog"]').count())await click('[data-action="close-dialog"]');
}
try{
 const previewOnly=await browser.newPage({viewport:{width:393,height:873},timezoneId:'Asia/Shanghai'});previewOnly.on('pageerror',error=>result.pageErrors.push(error.message));
 await previewOnly.addInitScript(()=>{if(!localStorage.getItem('listenly.state.v1'))localStorage.setItem('listenly.state.v1',JSON.stringify({selectedPaper:'listenly-original',homeFocus:null}))});
 await previewOnly.goto(url);await previewOnly.locator('.focus-card').waitFor();assert.equal(await previewOnly.locator('.focus-play').getAttribute('data-article'),'morning','a fresh collection initially pins its first article');
 await previewOnly.locator('[data-action="nav"][data-route="library"]').click();await openLibraryArticle(previewOnly,'listenly-original','library');
 assert.equal(await previewOnly.locator('#audio').evaluate(audio=>audio.paused),true,'previewing an article never starts its recording');
 await previewOnly.locator('[data-action="nav"][data-route="home"]').click();assert.equal(await previewOnly.locator('.focus-play').getAttribute('data-article'),'morning','previewing another article before any playback preserves the first home article');
 const previewState=await previewOnly.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));assert.deepEqual(previewState.active,{paper:'listenly-original',article:'library'});assert.equal(previewState.homeFocus,null,'previewing preserves an explicit null played focus');
 await previewOnly.reload();await previewOnly.locator('.focus-card').waitFor();assert.equal(await previewOnly.locator('.focus-play').getAttribute('data-article'),'morning','reloading never promotes a preview when the saved played focus is explicitly null');assert.equal(await previewOnly.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')).homeFocus),null,'the explicit null played focus survives reload');await previewOnly.close();
 const legacyFocus=await browser.newPage({viewport:{width:393,height:873},timezoneId:'Asia/Shanghai'});legacyFocus.on('pageerror',error=>result.pageErrors.push(error.message));
 await legacyFocus.addInitScript(()=>{if(!localStorage.getItem('listenly.state.v1'))localStorage.setItem('listenly.state.v1',JSON.stringify({selectedPaper:'listenly-original',active:{paper:'listenly-original',article:'library'}}))});
 await legacyFocus.goto(url);await legacyFocus.locator('.focus-card').waitFor();assert.equal(await legacyFocus.locator('.focus-play').getAttribute('data-article'),'library','an older saved state without a homeFocus key migrates its previous active article');await legacyFocus.close();
 pass('an explicit null played focus survives preview and reload; only legacy states with the key absent migrate their active article');
 await page.goto(url);await page.locator('.focus-card').waitFor();
 const fontState=await page.evaluate(async()=>{await document.fonts.ready;return {body:getComputedStyle(document.body).fontFamily,control:getComputedStyle(document.querySelector('.focus-play')).fontFamily,loaded:[...document.fonts].filter(face=>face.status==='loaded').map(face=>({family:face.family,weight:face.weight,status:face.status}))}});
 assert.match(fontState.body,/Inter/,'the reading and interface typography uses the bundled Inter family');assert.match(fontState.control,/Inter/,'playback controls inherit the same interface type family');assert.ok(fontState.loaded.some(face=>/Inter/.test(face.family)),'the bundled offline font genuinely decodes instead of only being named as a CSS fallback');
 pass('offline Inter typography loads and is shared by interface and playback controls',fontState);
 await checkOutsideReader('home');
 assert.equal(await page.locator('.section-header [data-action="nav"]').count(),0,'home has no redundant all-materials entry');
 assert.equal(await page.locator('.section-header').count(),0,'home removes the redundant article count header');
 const homePlay=page.locator('.focus-card [data-action="home-play"]');
 assert.equal(await homePlay.count(),1,'home has its own audio button');
 assert.equal(await homePlay.locator('[data-action="open"]').count(),0,'the home audio button is independent of article entry');
 await homePlay.click();
 await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>.15&&!a.error},{},{timeout:15000});
 assert.equal(await page.locator('.practice-header').count(),0,'home playback does not navigate into the reader');
 assert.match(await homePlay.getAttribute('aria-label'),/暂停/);
 const start=await audioState();
 await click('[data-action="nav"][data-route="profile"]');await checkOutsideReader('profile');
 const profileAudio=await audioState();
 await page.evaluate(()=>window.__profileIdentity=document.querySelector('.profile-page')||document.querySelector('.statistics'));
 await click('[data-action="theme"][data-theme="dark"]');
 await page.waitForTimeout(600);
 assert.ok(await page.evaluate(()=>window.__profileIdentity===(document.querySelector('.profile-page')||document.querySelector('.statistics'))),'appearance changes keep the existing settings page and interaction targets');
 assert.equal((await audioState()).src,profileAudio.src,'profile appearance selection preserves the loaded recording');
 assert.ok(Math.abs((await audioState()).time-profileAudio.time)<.05,'profile appearance selection preserves the paused recording position');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 const darkHome=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color}));
 assert.equal(darkHome.background,'rgb(0, 0, 0)','dark theme uses the requested pure-black page foundation');
 const darkInk=rgb(darkHome.color);assert.ok(darkInk[0]>darkInk[1]&&darkInk[1]>darkInk[2],'dark theme uses warm orange ink');
 await click('[data-action="nav"][data-route="home"]');await checkOutsideReader('home');
 await homePlay.click();await page.waitForFunction(time=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>time+.2&&!a.error},profileAudio.time);
 await page.waitForTimeout(220); // Capture the selected theme after its 180 ms thumb transition.
 await page.screenshot({path:path.join(output,'home-dark.png'),fullPage:true});
 await homePlay.click();await page.waitForFunction(()=>document.querySelector('#audio').paused);
 const paused=await audioState();await page.waitForTimeout(250);
 assert.ok(Math.abs((await audioState()).time-paused.time)<.04,'homepage audio button pauses the real recording');
 pass('home plays/pauses real audio; profile theme selection preserves the loaded recording and resume position',{start,profileAudio,paused,darkHome});
 const previousFocus=await homePlay.getAttribute('data-article');
 const homeOrderBefore=await page.locator('.home-paper-row [data-action="home-play"]').evaluateAll(buttons=>buttons.map(b=>[b.dataset.paper,b.dataset.article]));
 const rowPlay=page.locator(`.home-paper-row [data-action="home-play"]:not([data-article="${previousFocus}"])`).first();
 const rowArticle=await rowPlay.getAttribute('data-article');
 const rowPaper=await rowPlay.getAttribute('data-paper');
 await rowPlay.click();await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.currentSrc.endsWith('/library.wav')&&a.currentTime>.15&&!a.error});
 assert.equal(await page.locator('.focus-play').getAttribute('data-article'),rowArticle,'playing a listed article immediately promotes it to the home focus');
 assert.equal(await page.locator('.focus-play').getAttribute('data-paper'),rowPaper,'the focus promotion identifies the same selected paper');
 assert.equal(await page.locator(`.home-paper-row [data-action="home-play"][data-article="${rowArticle}"]`).count(),1,'the promoted article remains in its original list row');
 assert.equal(await page.locator(`.home-paper-row [data-action="home-play"][data-article="${previousFocus}"]`).count(),1,'the previous focus remains in the full list');
 assert.deepEqual(await page.locator('.home-paper-row [data-action="home-play"]').evaluateAll(buttons=>buttons.map(b=>[b.dataset.paper,b.dataset.article])),homeOrderBefore,'playing a different article preserves every row and the paper order');
 assert.equal(await page.locator('.practice-header').count(),0,'promotion stays on home');
 await page.locator('.focus-play').click();await page.waitForFunction(()=>document.querySelector('#audio').paused);
 pass('playing a listed article updates the home focus while preserving the complete ordered list');
 await page.reload();await page.locator('.focus-card').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','dark theme persists on reload');
 await setTheme('light');
 const lightHome=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color}));
 assert.ok(rgb(lightHome.background).every(n=>n>235),'light theme uses a neutral white background');
 const dayInk=rgb(lightHome.color);assert.ok(dayInk.every(channel=>channel<75)&&Math.max(...dayInk)-Math.min(...dayInk)<40,'daytime text keeps a dark neutral ink over the wallpaper')
 await page.reload();await page.locator('.focus-card').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'light','day theme persists on reload');
 await page.screenshot({path:path.join(output,'home-light.png'),fullPage:true});
 pass('both themes persist on reload and use the requested palettes',{lightHome});
 await click('.focus-open[data-action="open"]');await checkDefaultReader();
 await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
 const speedBefore=await page.locator('#audio').evaluate(a=>a.playbackRate);
 await speedMenu();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing,.dialog-shade.is-closing'));
 assert.equal(await page.locator('.speed-popover').count(),0,'Escape dismisses the speed menu');
 assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),speedBefore,'cancelling speed selection keeps the rate');
 await speedMenu();await page.locator('.speed-shade').click({position:{x:4,y:4}});await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing'));
 assert.equal(await page.locator('.speed-popover').count(),0,'tapping outside dismisses speed selection');
 assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),speedBefore,'outside dismissal keeps the applied playback rate');
 await page.evaluate(()=>{window.__speedAudio=document.querySelector('#audio');window.__speedReader=document.querySelector('.main-panel')});
 await click('[data-action="play"]');await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>.15&&!a.error});
 const speedStart=await audioState();await speedMenu();await chooseSpeed(1.25);
 assert.ok(await page.evaluate(()=>window.__speedAudio===document.querySelector('#audio')&&window.__speedReader===document.querySelector('.main-panel')),'changing speed keeps audio and reading nodes intact');
 await page.waitForFunction(time=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>time+.2&&a.playbackRate===1.25&&!a.error},speedStart.time);
 await click('[data-action="play"]');await page.waitForFunction(()=>document.querySelector('#audio').paused);
 for(const viewport of [{width:360,height:800},{width:393,height:873},{width:430,height:932}]){
  await page.setViewportSize(viewport);await speedMenu();
  const bounds=await page.locator('.speed-popover').boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,'anchored speed menu stays inside the phone viewport');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'speed menu creates no horizontal page overflow');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing,.dialog-shade.is-closing'));
 }
 await page.setViewportSize({width:393,height:873});
 await page.emulateMedia({reducedMotion:'reduce'});await speedMenu();
 assert.equal(await page.locator('.speed-popover').evaluate(e=>e.getAnimations({subtree:true}).length),0,'reduced motion disables popup animation');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing,.dialog-shade.is-closing'));await page.emulateMedia({reducedMotion:'no-preference'});
 pass('explicit speed selection preserves playback, cancellation, reading position and phone layout',{speedBefore,chosenRate:1.25});
 const before=await bookmarkStyle();assert.equal(before.pressed,'false');assert.equal(before.fill,'none');
 await click('[data-action="bookmark"]');await page.waitForTimeout(220);
 const collected=await bookmarkStyle();assert.equal(collected.pressed,'true');assert.notEqual(collected.fill,'none','collected bookmark is filled');assert.equal(collected.background,before.background,'collecting does not darken a rectangle');
 await click('[data-action="bookmark"]');await page.waitForTimeout(220);
 const cancelled=await bookmarkStyle();assert.equal(cancelled.pressed,'false');assert.equal(cancelled.fill,'none');assert.deepEqual(cancelled,before,'second tap returns to the original hollow bookmark without a lingering box');
 assert.equal(await page.locator('#toast.visible').count(),0,'bookmark changes do not leave a notification box');
 for(let i=0;i<6;i++){await click('[data-action="bookmark"]');assert.equal(await page.locator('[data-action="bookmark"]').getAttribute('aria-pressed'),String(i%2===0),'rapid input updates the current bookmark state immediately')}
 await page.waitForTimeout(220);assert.deepEqual(await bookmarkStyle(),before,'rapid toggles settle at the latest hollow state');
 pass('bookmark toggles hollow/filled and cancels without a residual rectangle',{before,collected,cancelled});
 await page.emulateMedia({reducedMotion:'reduce'});await click('[data-action="mode"][data-mode="exam"]');await click('[data-action="mode"][data-mode="intensive"]');
 assert.equal(await page.locator('.main-panel').evaluate(e=>e.getAnimations({subtree:true}).length),0,'reduced motion retains immediate controls without content animations');
 assert.equal(await page.locator('.mode-control').evaluate(e=>getComputedStyle(e,'::before').animationName),'none','reduced motion also disables the mode indicator animation');
 await page.emulateMedia({reducedMotion:'no-preference'});pass('reduced-motion preference is respected');
 await click('[data-action="display"][data-display="bilingual"]');
 assert.equal(await page.locator('[data-action="article-list"]').count(),0,'reading has no article-selection entry');
 assert.equal(await page.locator('.practice-title button,.practice-title[role="button"]').count(),0,'the useful article title is static');
 await click('[data-action="mode"][data-mode="exam"]');
 await click('[data-action="nav"][data-route="home"]');await checkOutsideReader('returned home');
 await click('.focus-open[data-action="open"]');await checkDefaultReader();
 pass('reader has a static title; home re-entry resets intensive/hidden');
 await click('[data-action="nav"][data-route="library"]');await checkOutsideReader('library');
 await click('[data-action="nav"][data-route="profile"]');await checkOutsideReader('profile');
 assert.doesNotMatch(await page.locator('#app').innerText(),/学习天数/);
 assert.doesNotMatch(await page.locator('.activity-card').innerText(),/做题活跃度|过去一年|(?:^|\s)[少多](?:\s|$)/,'calendar omits visible decorative headings and legend prose');
 assert.ok(await page.locator('.activity-card').getAttribute('aria-label'),'calendar retains an accessible name');
 assert.ok(await page.locator('.activity-legend').getAttribute('aria-label'),'calendar color key retains an accessible description');
 assert.equal(await page.locator('.settings-card [data-action="speed"],#pref-speed').count(),0,'profile removes duplicate speed adjustment');
 assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),1.25,'entering profile preserves the player rate');
 await click('[data-action="nav"][data-route="home"]');await speedMenu();await chooseSpeed(.75);
 await page.reload();await page.locator('.focus-card').waitFor();
 assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),.75,'saved speed is applied after reload');
 await speedMenu();await chooseSpeed(1);await click('[data-action="nav"][data-route="profile"]');
 pass('speed exists only in the player and its selected rate survives reload');
 assert.equal(await numberStat('today-listening-minutes'),3,'listening minutes count today instead of all past days');
 assert.equal(await numberStat('today-articles'),1,'completed article count includes today only');
 assert.match(await page.locator('.statistics').innerText(),/今日完成\s*·\s*篇/,'today completion uses articles instead of question submissions');
 assert.equal(await page.locator('.settings-card [data-action="import"]').count(),0,'profile removes the duplicate import entry');
 assert.equal(await page.locator('.topbar [data-action="import"]').count(),1,'profile keeps the persistent top import button');
 await click('.topbar [data-action="import"]');await page.locator('.dialog .import-choice').first().waitFor();assert.equal(await page.locator('.dialog .import-choice').count(),2,'the remaining profile plus opens both import modes');await click('[data-action="close-dialog"]');
 assert.equal(await page.locator('.history-row').count(),0,'partial listening and partial question records do not appear as recent completed practice');
 assert.ok(Math.abs(await numberStat('total-study-hours')-2)<.05,'total study hours include listening and silent practice across all dates');
 assert.equal((await day(dateKeys.previous)).count,1,'previous-day activity remains separate');
 const todayBefore=await day(dateKeys.today);assert.equal(todayBefore.count,3);
 assert.ok(await page.locator('.calendar-day[data-date]').count()>=365,'activity calendar contains a full year');
 const calendarDates=await page.locator('.calendar-day[data-date]').evaluateAll(elements=>elements.map(e=>e.dataset.date));
 assert.equal(new Set(calendarDates).size,calendarDates.length,'calendar dates are unique');
 await page.screenshot({path:path.join(output,'profile-light.png'),fullPage:true});
 pass('daily statistics and yearly activity calendar reflect stored dated records',{todayBefore});
 await click('[data-action="nav"][data-route="library"]');
 await openLibraryArticle(page,'listenly-original','library');
 await click('[data-action="mode"][data-mode="exam"]');
 await choose(0,'B');
 assert.equal(Object.values((await saved()).dailyArticles[dateKeys.today]).reduce((a,n)=>a+n,0),1,'one of two selected questions does not complete an article');
 await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="profile"]');
 assert.equal(await numberStat('today-articles'),1,'partial quiz leaves today article statistic unchanged');
 assert.equal(await page.locator('.history-row').count(),0,'partial quiz stays out of recent practice');
 await click('[data-action="nav"][data-route="library"]');await openLibraryArticle(page,'listenly-original','library');await click('[data-action="mode"][data-mode="exam"]');
 await choose(1,'A');await submitArticle();
 assert.equal(Object.values((await saved()).dailyArticles[dateKeys.today]).reduce((a,n)=>a+n,0),2,'the final submission credits one completed article without requiring a result-page visit');
 await click('[data-action="view-result"]');await page.locator('.result-card').waitFor();await click('[data-action="restart-quiz"]');await choose(0,'B');
 assert.equal(Object.values((await saved()).dailyArticles[dateKeys.today]).reduce((a,n)=>a+n,0),2,'partial redo retains previous completion but does not add another');
 await choose(1,'A');await submitArticle();
 const afterRepeating=await saved();assert.equal(Object.values(afterRepeating.dailyQuestions[dateKeys.today]).reduce((a,n)=>a+n,0),7,'repeating all questions adds activity without erasing earlier submissions');
 assert.equal(Object.values(afterRepeating.dailyArticles[dateKeys.today]).reduce((a,n)=>a+n,0),3,'a fully completed redo adds one article completion');
 assert.equal(afterRepeating.articleCompletions[JSON.stringify(['listenly-original','library'])].count,2,'the completed article record tracks the two full attempts');
 await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="profile"]');
 assert.equal(await numberStat('today-articles'),3,'daily completion statistic counts complete articles');
 assert.equal(await page.locator('.history-row').count(),1,'recent practice lists a fully completed article once');
 assert.equal(await page.locator('.history-row small').count(),0,'recent practice has no listening minute suffix');
 assert.doesNotMatch(await page.locator('.history-row').innerText(),/分钟/);
 const todayAfter=await day(dateKeys.today);assert.equal(todayAfter.count,7);assert.ok(todayAfter.level>=todayBefore.level,'more completed questions increase activity level');
 const lightDay=todayAfter.background;const lightRgb=rgb(lightDay);assert.ok(lightRgb[1]>lightRgb[0]&&lightRgb[1]>lightRgb[2],'daytime activity uses green');
 await click('[data-action="theme"][data-theme="dark"]');
 await page.waitForTimeout(600);
 const darkDay=await day(dateKeys.today),darkRgb=rgb(darkDay.background);assert.ok(darkRgb[0]>darkRgb[1]&&darkRgb[1]>darkRgb[2],'nighttime activity uses orange');
 assert.equal(darkDay.count,7,'changing palette retains the activity count');
 await page.waitForTimeout(220);
 await page.screenshot({path:path.join(output,'profile-dark.png'),fullPage:true});
 pass('real submissions and repeated practice update activity; palettes use green/orange',{todayBefore,todayAfter,darkDay});
 for(const viewport of [{width:360,height:800},{width:393,height:873},{width:430,height:932}]){
  await page.setViewportSize(viewport);
  await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="profile"]');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'profile fits phone viewport without horizontal page overflow');
  const calendar=page.locator('.calendar-day[aria-current="date"]');assert.ok(await calendar.isVisible(),'profile initially shows today while future padding remains hidden');
  const geometry=await calendar.evaluate(cell=>{const r=cell.getBoundingClientRect(),v=document.querySelector('.activity-calendar').getBoundingClientRect(),css=getComputedStyle(cell),ring=Math.max(0,(parseFloat(css.outlineWidth)||0)+(parseFloat(css.outlineOffset)||0));return {cell:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},clip:{left:v.left,right:v.right,top:v.top,bottom:v.bottom},ring}});
  assert.ok(geometry.cell.left-geometry.ring>=geometry.clip.left-.5&&geometry.cell.right+geometry.ring<=geometry.clip.right+.5,'the entire current-day cell and outline fit within the scrolling calendar');
  assert.ok(geometry.cell.top-geometry.ring>=geometry.clip.top-.5&&geometry.cell.bottom+geometry.ring<=geometry.clip.bottom+.5,'the current-day outline is also clear of the calendar top and bottom edges');
 }
 pass('the current-day calendar cell and outline remain completely visible on all three phone widths');
 await page.setViewportSize({width:393,height:873});await click('[data-action="nav"][data-route="library"]');await importSelectionFixture();
 assert.equal(await page.locator('#library-list [data-action="open"]').count(),0,'library root displays paper directories instead of individual articles');
 assert.ok(await page.locator('.paper-group-row').count()>=2,'original and imported papers each have one first-level directory');
 assert.equal(await page.locator('select').count(),0,'library filters use the app menu instead of native select controls');
 const materialFilter=page.locator('[data-action="filter-menu"][data-filter="kind"]');
 await materialFilter.click();await page.locator('.filter-popover').waitFor();
 assert.deepEqual((await page.locator('.filter-popover [data-action="set-filter"][data-filter="kind"]').evaluateAll(buttons=>buttons.map(b=>b.dataset.value))).sort(),['all','real','saved'],'material menu retains all, real and bookmarked choices');
 await click('.filter-popover [data-action="set-filter"][data-filter="kind"][data-value="saved"]');
 assert.equal(await page.locator('.paper-group-row').count(),0,'bookmarked filter excludes papers without bookmarked articles');
 await materialFilter.click();await click('.filter-popover [data-action="set-filter"][data-filter="kind"][data-value="all"]');
 assert.ok(await page.locator('.paper-group-row').count()>=2,'all materials restores the paper directories');
 const filter=page.locator('[data-action="filter-menu"][data-filter="year"]');
 for(const viewport of [{width:360,height:800},{width:393,height:873},{width:430,height:932}]){
  await page.setViewportSize(viewport);await filter.click();await page.locator('.filter-popover').waitFor();
  const bounds=await page.locator('.filter-popover').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,'the custom year menu fits the phone viewport');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing,.dialog-shade.is-closing'));
 }
 await page.setViewportSize({width:393,height:873});
 await filter.click();await page.locator('.filter-popover').waitFor();
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing,.dialog-shade.is-closing'));assert.equal(await page.locator('.filter-popover').count(),0,'Escape dismisses the filter without changing the selection');
 assert.equal(await filter.evaluate(b=>getComputedStyle(b).outlineStyle),'none','filter focus adds no outer rounded rectangle');
 await filter.click();await page.locator('.filter-shade').click({position:{x:3,y:3}});await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing'));assert.equal(await page.locator('.filter-popover').count(),0,'outside tap cancels filter selection');
 await filter.click();await click('.filter-popover [data-action="set-filter"][data-filter="year"][data-value="2001"]');
 assert.equal(await filter.getAttribute('aria-expanded'),'false','applying a year dismisses its menu');
 assert.equal((await filter.locator('.filter-value').innerText()).trim(),'2001','the year filter displays its applied value');
 assert.equal(await page.locator('.paper-group-row').count(),1,'year selection filters paper directories');
 assert.equal(await page.locator('[data-action="open-paper"][data-paper="experience-selection"]').count(),1,'year selection retains the matching imported paper');
 const selectedControl=page.locator('[data-action="select-paper"][data-paper="experience-selection"]');
 await selectedControl.evaluate(button=>{window.__selectionControl=button;window.__selectionRow=button.closest('.paper-group-row');window.__selectionLens=document.querySelector('[data-flow-list="library"] .flow-lens');window.__selectionMotion=[];window.__selectionSampling=true;const sample=()=>{if(!window.__selectionSampling)return;const lens=document.querySelector('[data-flow-list="library"] .flow-lens'),r=lens?.getBoundingClientRect();if(r)window.__selectionMotion.push({time:performance.now(),left:r.left,top:r.top,width:r.width,height:r.height});requestAnimationFrame(sample)};sample()});
 await selectedControl.click();assert.equal(await selectedControl.getAttribute('aria-pressed'),'true','the suite title selects the paper immediately');
 assert.ok(await selectedControl.evaluate(button=>window.__selectionControl===button&&window.__selectionRow===button.closest('.paper-group-row')&&window.__selectionLens===document.querySelector('[data-flow-list="library"] .flow-lens')),'selecting a suite preserves the row, title control and shared moving lens');
 assert.equal(await page.locator('.selection-indicator,.paper-select svg rect').count(),0,'selection is expressed by the moving lens without a duplicate checkbox');
 const selectedStyle=await selectedControl.evaluate(b=>({background:getComputedStyle(b).backgroundColor,outline:getComputedStyle(b).outlineStyle,shadow:getComputedStyle(b).boxShadow}));
 assert.equal(selectedStyle.outline,'none','pointer selection adds no outer focus rectangle');
 await page.waitForFunction(()=>{const row=document.querySelector('.paper-group-row.is-selected'),lens=document.querySelector('[data-flow-list="library"] .flow-lens');if(!row||!lens)return false;const a=row.getBoundingClientRect(),b=lens.getBoundingClientRect();return Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1&&Number(getComputedStyle(lens).opacity)>.98});
 const selectionMotion=await selectedControl.evaluate(()=>{window.__selectionSampling=false;return window.__selectionMotion});
 const nightGlass=await page.locator('[data-flow-list="library"] .flow-lens').evaluate(e=>({opacity:Number(getComputedStyle(e).opacity),image:getComputedStyle(e).backgroundImage,filter:getComputedStyle(e).backdropFilter||getComputedStyle(e).webkitBackdropFilter}));
 assert.match(nightGlass.filter,/url\(/,'selected paper uses actual optical refraction');assert.match(nightGlass.image,/gradient/,'selected suite retains the glass material highlight');
 const selectedTitle=page.locator('.paper-group-row.is-selected .paper-group-copy h3');
 const nightSelection=rgb(await selectedTitle.evaluate(e=>getComputedStyle(e).color));assert.ok(nightSelection[0]>nightSelection[1]&&nightSelection[1]>nightSelection[2],'night mode identifies the selected suite with orange');
 await setTheme('light','library');
 await page.waitForFunction(()=>document.querySelector('[data-flow-list="library"] .flow-lens')&&Number(getComputedStyle(document.querySelector('[data-flow-list="library"] .flow-lens')).opacity)>.98);
 const daySelection=await page.locator('[data-flow-list="library"] .flow-lens').evaluate(e=>({image:getComputedStyle(e).backgroundImage,filter:getComputedStyle(e).backdropFilter||getComputedStyle(e).webkitBackdropFilter}));assert.match(daySelection.filter,/url\(/,'day mode retains the selected suite refraction layer');
 await page.screenshot({path:path.join(output,'library-papers-light.png'),fullPage:true});
 await setTheme('dark','library');
 await page.waitForTimeout(180);await page.screenshot({path:path.join(output,'library-papers-dark.png'),fullPage:true});
 await filter.click();await click('.filter-popover [data-action="set-filter"][data-filter="year"][data-value=""]');
 assert.equal(await page.locator('.paper-group-row.is-selected').count(),1,'one suite is selected at a time');
 assert.equal(await page.locator('[data-action="select-paper"][data-paper="listenly-original"]').getAttribute('aria-pressed'),'false','choosing another suite removes the previous selection');
 await filter.click();await click('.filter-popover [data-action="set-filter"][data-filter="year"][data-value="2001"]');
 await enterLibraryPaper(page,'experience-selection');
 assert.deepEqual(await page.locator('#library-list .paper-copy h3').allTextContents(),['第1篇','第2篇'],'material choices omit their question-range title suffixes');
 await click('[data-action="library-back"]');assert.equal(await page.locator('.paper-group-row').count(),1,'detail back returns to the retained paper filter');
 await click('[data-action="nav"][data-route="home"]');
 assert.ok((await page.locator('[data-action="home-play"]').evaluateAll(buttons=>buttons.map(b=>b.dataset.paper))).every(id=>id==='experience-selection'),'the selected paper supplies all home materials');
 assert.equal((await saved()).selectedPaper,'experience-selection','paper selection is saved');
 await page.reload();await page.locator('.focus-card').waitFor();
 assert.ok((await page.locator('[data-action="home-play"]').evaluateAll(buttons=>buttons.map(b=>b.dataset.paper))).every(id=>id==='experience-selection'),'the selected paper and imported articles survive a page reload');
 assert.doesNotMatch((await page.locator('.paper-list,.focus-card').allTextContents()).join(' '),/[1-8]\s*[–-]\s*[1-8]\s*题/,'home material titles omit question ranges');
 await click('.home-paper-row [data-action="home-play"][data-article="second"]');
 await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>.2});
 assert.equal(await page.locator('.focus-play').getAttribute('data-article'),'second','playing another selected-paper article immediately moves it to the focus card');
 await click('.focus-play');await page.waitForFunction(()=>document.querySelector('#audio').paused);
 assert.equal((await saved()).completedListeningDays[dateKeys.today],180,'a partially heard article does not increase completed listening');
 await click('.focus-open');await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
 assert.equal((await page.locator('.practice-title').innerText()).trim(),'第2篇','reader title omits question ranges');
 assert.equal(await page.locator('[data-action="article-list"]').count(),0,'reader omits the removed article picker');
 const partialEndBefore=await watchProductionEnd();await page.locator('#audio').evaluate(a=>a.currentTime=a.duration-.25);await page.waitForFunction(()=>!document.querySelector('#audio').seeking);
 await click('[data-action="play"]');const partialEnd=await waitProductionEnd(partialEndBefore);assert.equal(partialEnd.trusted,true,'the actual decoder reaches its endpoint before queue advance');
 assert.equal((await saved()).completedListeningDays[dateKeys.today],180,'seeking past an unheard section and reaching genuine ended does not credit a complete article');
 await click('[data-action="nav"][data-route="library"]');await openLibraryArticle(page,'experience-selection','second');await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1&&!document.querySelector('#audio').seeking);const fullEndBefore=await watchProductionEnd();await click('[data-action="play"]');await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>.2});const fullEnd=await waitProductionEnd(fullEndBefore);assert.equal(fullEnd.trusted,true);
 const fullListening=await saved();assert.ok(fullListening.completedListeningDays[dateKeys.today]>181,'a full recording genuinely played from start to ended credits its listening time');
 await click('[data-action="nav"][data-route="library"]');await openLibraryArticle(page,'experience-selection','second');
 await click('[data-action="mode"][data-mode="exam"]');assert.match(await page.locator('[data-action="toggle-question"]').first().innerText(),/第\s*5\s*题/,'cleaning material titles preserves the original question number inside the quiz');
 await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="profile"]');
 assert.equal(await numberStat('today-listening-minutes'),3,'completed listening displays floor minutes while preserving the newly credited seconds');
 assert.equal(await numberStat('today-articles'),3,'audio completion and reload do not add quiz article completions');
 assert.equal(await page.locator('.history-row').count(),1,'completing only audio does not create a recent completed quiz');
 assert.doesNotMatch(await page.locator('.history-row').innerText(),/[1-8]\s*[–-]\s*[1-8]\s*题|分钟/);
 pass('paper selection, custom filters, clean titles and full-play listening credit follow completed user actions',{selectedStyle,selectionMotion,creditedListeningSeconds:fullListening.completedListeningDays[dateKeys.today]});
 await click('[data-action="nav"][data-route="library"]');
 await click('[data-action="filter-menu"][data-filter="year"]');await click('.filter-popover [data-action="set-filter"][data-filter="year"][data-value=""]');
 const beforePreview=await saved();
 const homeBeforePreview={paper:await page.locator('[data-action="select-paper"][aria-pressed="true"]').getAttribute('data-paper'),focus:beforePreview.homeFocus};
 await enterLibraryPaper(page,'listenly-original');
 assert.equal((await saved()).selectedPaper,homeBeforePreview.paper,'opening an unselected paper only previews its articles');
 assert.equal(await page.locator('[data-action="theme"],[data-action="import"]').count(),0,'paper detail has no appearance or import controls');
 await click('[data-action="open"][data-paper="listenly-original"][data-article="morning"]');
 assert.equal((await saved()).selectedPaper,homeBeforePreview.paper,'opening an unplayed article does not select its paper');
 assert.deepEqual((await saved()).homeFocus,homeBeforePreview.focus,'previewing an article preserves the last actually played home focus');
 await click('[data-action="nav"][data-route="home"]');
 assert.equal(await page.locator('.focus-play').getAttribute('data-paper'),homeBeforePreview.paper,'home keeps the selected paper after another paper preview');
 assert.equal(await page.locator('.focus-play').getAttribute('data-article'),homeBeforePreview.focus.article,'home keeps the last played article after another paper preview');
 await page.reload();await page.locator('.focus-card').waitFor();
 assert.equal(await page.locator('.focus-play').getAttribute('data-paper'),homeBeforePreview.paper,'paper preview cannot change the persisted home collection');
 assert.equal(await page.locator('.focus-play').getAttribute('data-article'),homeBeforePreview.focus.article,'article preview cannot replace the persisted played focus');
 const otherChosenArticle=homeBeforePreview.focus.article==='first'?'second':'first';await click('[data-action="nav"][data-route="library"]');await enterLibraryPaper(page,'experience-selection');await click(`[data-action="open"][data-paper="experience-selection"][data-article="${otherChosenArticle}"]`);await click('[data-action="nav"][data-route="home"]');
 assert.equal(await page.locator('.focus-play').getAttribute('data-article'),homeBeforePreview.focus.article,'previewing another article inside the chosen paper also keeps the last played focus');
 await click('[data-action="nav"][data-route="library"]');await enterLibraryPaper(page,'listenly-original');
 const libraryPlay=page.locator('[data-action="material-play"][data-paper="listenly-original"][data-article="morning"]');
 assert.equal(await libraryPlay.count(),1,'each library article has an independent playback control');
 await watchActualPlayback();await libraryPlay.click();await waitForActualPlayback('/morning.wav');
 assert.equal(await page.locator('.practice-header').count(),0,'library playback stays in the paper preview');
 assert.equal((await saved()).selectedPaper,'listenly-original','actual playback selects the library article paper');
 assert.deepEqual((await saved()).homeFocus,{paper:'listenly-original',article:'morning'},'actual playback records the article for the home focus');
 await libraryPlay.click();await page.waitForFunction(()=>document.querySelector('#audio').paused);
 await click('[data-action="nav"][data-route="home"]');assert.equal(await page.locator('.focus-play').getAttribute('data-paper'),'listenly-original');assert.equal(await page.locator('.focus-play').getAttribute('data-article'),'morning');
 await click('[data-action="nav"][data-route="library"]');await click('[data-action="select-paper"][data-paper="experience-selection"]');await click('[data-action="nav"][data-route="home"]');
 assert.equal(await page.locator('.focus-play').getAttribute('data-paper'),'experience-selection','the explicit right-hand paper selector changes the home collection without playback');
 assert.equal((await audioState()).paused,true,'explicit paper selection does not start audio');
 const selectionBeforeFailure=await saved();
 await click('[data-action="nav"][data-route="library"]');await enterLibraryPaper(page,'listenly-original');
 const failedMedia=`${url}/media/library.wav`;let rejectedMediaReads=0;
 await page.route(failedMedia,async route=>{rejectedMediaReads++;await route.fulfill({status:503,contentType:'text/plain',body:'Deliberate unavailable original recording'})});
 await click('[data-action="material-play"][data-paper="listenly-original"][data-article="library"]');await page.waitForFunction(()=>Boolean(document.querySelector('#audio').error));
 assert.ok(rejectedMediaReads>0,'the failure regression rejects a genuine original media request');
 assert.equal((await saved()).selectedPaper,selectionBeforeFailure.selectedPaper,'a playback request that fails before playing cannot replace the selected home paper');
 assert.deepEqual((await saved()).homeFocus,selectionBeforeFailure.homeFocus,'a failed recording cannot replace the last played home focus');
 await page.unroute(failedMedia);
 await click('[data-action="nav"][data-route="home"]');assert.equal(await page.locator('.focus-play').getAttribute('data-paper'),'experience-selection','home still displays its chosen collection after failed playback');
 await click('[data-action="nav"][data-route="library"]');await openLibraryArticle(page,'listenly-original','library');
 assert.equal((await saved()).selectedPaper,'experience-selection','reader preview still preserves the chosen collection');
 await watchActualPlayback();await click('[data-action="play"]');await waitForActualPlayback('/library.wav');
 assert.equal((await saved()).selectedPaper,'listenly-original','actual reader playback selects its article paper');
 assert.deepEqual((await saved()).homeFocus,{paper:'listenly-original',article:'library'},'reader playback records the played article as home focus');
 await click('[data-action="play"]');await page.waitForFunction(()=>document.querySelector('#audio').paused);await click('[data-action="nav"][data-route="home"]');
 assert.equal(await page.locator('.focus-play').getAttribute('data-article'),'library','home promotes an article genuinely played in the reader');
 pass('paper and article previews and failed playback preserve home across reload; actual library/reader playback or the right-hand selector changes the home collection',{rejectedMediaReads});
 assert.deepEqual(result.pageErrors,[]);result.passed=true;
 console.log(JSON.stringify({passed:true,checks:result.checks.length,entrySha256:result.entrySha256,output}));
}catch(error){result.failure={message:error.message,stack:error.stack};result.failureFlow=await page.locator('[data-flow-list]').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect(),lens=element.querySelector('.flow-lens'),b=lens?.getBoundingClientRect(),s=lens?getComputedStyle(lens):null;return {key:element.dataset.flowList,top:r.top,height:r.height,lens:b?{top:b.top,height:b.height,width:b.width,opacity:s.opacity,transform:s.transform}:null,selected:[...element.querySelectorAll('[data-flow-item].is-selected,[data-flow-item].active')].map(item=>{const a=item.getBoundingClientRect();return {key:item.dataset.flowKey,top:a.top,height:a.height}})}})).catch(()=>[]);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}

function rgb(color){const values=color.match(/[\d.]+/g);assert.ok(values&&values.length>=3,`computed RGB color: ${color}`);return values.slice(0,3).map(value=>Number(value)*(color.startsWith('color(srgb')?255:1))}
