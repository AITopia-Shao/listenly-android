import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';

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
const seed={theme:'light',mode:'exam',display:'bilingual',activityVersion:1,days:{[dateKeys.previous]:3600,[dateKeys.today]:180},studyDays:{[dateKeys.previous]:3420},dailyQuestions:{[dateKeys.previous]:{[legacyKey]:1},[dateKeys.today]:{[legacyKey]:3}},answers:{[legacyKey]:{choice:'A',submitted:true,at:Date.now()-86400000}}};
await page.addInitScript(seed=>{if(!localStorage.getItem('listenly.state.v1'))localStorage.setItem('listenly.state.v1',JSON.stringify(seed))},seed);
const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`;
const click=selector=>page.locator(selector).first().click();
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));
const audioState=()=>page.locator('#audio').evaluate(a=>({time:a.currentTime,src:a.currentSrc,paused:a.paused,error:a.error?{code:a.error.code,message:a.error.message}:null}));
function pass(label,details){result.checks.push({label,...(details?{details}:{})})}
async function checkOutsideReader(route){
 assert.equal(await page.locator('[data-action="mode"]').count(),0,`${route} exposes no training mode selector`);
 assert.equal(await page.locator('.theme-control [data-action="theme"]').count(),2,`${route} has light/dark controls`);
 assert.equal(await page.locator('.bottom-nav').count(),1,`${route} has bottom navigation`);
 pass(`${route}: theme controls replace training modes`);
}
async function checkDefaultReader(){
 assert.equal(await page.locator('[data-mode="intensive"][aria-pressed="true"]').count(),1,'entering reader defaults to intensive');
 assert.equal(await page.locator('[data-display="hidden"][aria-pressed="true"]').count(),1,'entering reader defaults to hidden text');
 assert.equal(await page.locator('.sentence').count(),0,'hidden default does not reveal text');
 assert.equal(await page.locator('.bottom-nav').count(),0,'reader keeps the compact audio dock');
}
async function bookmarkStyle(){return page.locator('[data-action="bookmark"]').evaluate(b=>{const css=getComputedStyle(b),svg=getComputedStyle(b.querySelector('svg path'));return {background:css.backgroundColor,shadow:css.boxShadow,outline:css.outlineStyle,fill:svg.fill,pressed:b.getAttribute('aria-pressed')}})}
const numberStat=async name=>Number((await page.locator(`[data-stat="${name}"]`).innerText()).replace(/[^\d.]/g,''));
async function day(date){return page.locator(`.calendar-day[data-date="${date}"]`).evaluate(b=>({date:b.dataset.date,count:Number(b.dataset.count),level:Number(b.dataset.level),background:getComputedStyle(b).backgroundColor,label:b.getAttribute('aria-label')||b.getAttribute('title')}))}
async function submit(choice){await click(`[data-action="answer"][data-option="${choice}"]`);await click('[data-action="submit-answer"]');await page.locator('.feedback').waitFor()}
try{
 await page.goto(url);await page.locator('.focus-card').waitFor();
 await checkOutsideReader('home');
 assert.equal(await page.locator('.section-header [data-action="nav"]').count(),0,'home has no redundant all-materials entry');
 assert.doesNotMatch(await page.locator('.section-header').innerText(),/全部/);
 const homePlay=page.locator('.focus-card [data-action="home-play"]');
 assert.equal(await homePlay.count(),1,'home has its own audio button');
 assert.equal(await homePlay.locator('[data-action="open"]').count(),0,'the home audio button is independent of article entry');
 await homePlay.click();
 await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>.15&&!a.error},{},{timeout:15000});
 assert.equal(await page.locator('.practice-header').count(),0,'home playback does not navigate into the reader');
 assert.match(await homePlay.getAttribute('aria-label'),/暂停/);
 const start=await audioState();
 await page.evaluate(()=>window.__homeIdentity=document.querySelector('.focus-card'));
 await click('[data-action="theme"][data-theme="dark"]');
 assert.ok(await page.evaluate(()=>window.__homeIdentity===document.querySelector('.focus-card')),'appearance changes keep the existing page and interaction targets');
 await page.waitForFunction(time=>{const a=document.querySelector('#audio');return !a.paused&&a.currentTime>time+.2&&!a.error},start.time);
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 const darkHome=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color}));
 assert.ok(rgb(darkHome.background).every(n=>n<50),'dark theme has a near-black background');
 const darkInk=rgb(darkHome.color);assert.ok(darkInk[0]>darkInk[1]&&darkInk[1]>darkInk[2],'dark theme uses warm orange ink');
 await page.waitForTimeout(220); // Capture the selected theme after its 180 ms thumb transition.
 await page.screenshot({path:path.join(output,'home-dark.png'),fullPage:true});
 await homePlay.click();await page.waitForFunction(()=>document.querySelector('#audio').paused);
 const paused=await audioState();await page.waitForTimeout(250);
 assert.ok(Math.abs((await audioState()).time-paused.time)<.04,'homepage audio button pauses the real recording');
 pass('home plays/pauses real audio; theme changes preserve playback',{start,paused,darkHome});
 const rowPlay=page.locator('.home-paper-row [data-action="home-play"]').first();
 const rowBefore=await rowPlay.boundingBox();
 const orderBefore=await page.locator('.home-paper-row [data-action="home-play"]').evaluateAll(items=>items.map(b=>b.dataset.article));
 await rowPlay.click();await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.paused&&a.currentSrc.endsWith('/library.wav')&&a.currentTime>.15&&!a.error});
 const rowAfter=await rowPlay.boundingBox();assert.deepEqual(rowAfter,rowBefore,'playing a list item keeps its button under the same finger position');
 assert.deepEqual(await page.locator('.home-paper-row [data-action="home-play"]').evaluateAll(items=>items.map(b=>b.dataset.article)),orderBefore,'home audio playback does not reorder the list');
 await rowPlay.click();await page.waitForFunction(()=>document.querySelector('#audio').paused);
 pass('list audio plays in place and the same button pauses it');
 await page.reload();await page.locator('.focus-card').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','dark theme persists on reload');
 await click('[data-action="theme"][data-theme="light"]');
 const lightHome=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color}));
 assert.ok(rgb(lightHome.background).every(n=>n>235),'light theme uses a neutral white background');
 for(const value of Object.values(lightHome)){const color=rgb(value);assert.ok(Math.max(...color)-Math.min(...color)<=1,'daytime foundation uses grayscale')}
 await page.reload();await page.locator('.focus-card').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'light','day theme persists on reload');
 await page.screenshot({path:path.join(output,'home-light.png'),fullPage:true});
 pass('both themes persist on reload and use the requested palettes',{lightHome});
 await click('.focus-open[data-action="open"]');await checkDefaultReader();
 await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
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
 await click('[data-action="article-list"]');await click('.dialog [data-action="open"][data-article="library"]');
 assert.equal(await page.locator('[data-display="bilingual"][aria-pressed="true"]').count(),1,'same-reader article menu preserves display choice');
 await click('[data-action="mode"][data-mode="exam"]');
 await click('[data-action="article-list"]');await click('.dialog [data-action="open"][data-article="morning"]');
 assert.equal(await page.locator('[data-mode="exam"][aria-pressed="true"]').count(),1,'same-reader article menu preserves training mode');
 await click('[data-action="nav"][data-route="home"]');await checkOutsideReader('returned home');
 await click('.focus-open[data-action="open"]');await checkDefaultReader();
 pass('home re-entry resets intensive/hidden; reader article menu preserves selected mode/display');
 await click('[data-action="nav"][data-route="library"]');await checkOutsideReader('library');
 await click('[data-action="nav"][data-route="profile"]');await checkOutsideReader('profile');
 assert.doesNotMatch(await page.locator('#app').innerText(),/学习天数/);
 assert.equal(await numberStat('today-listening-minutes'),3,'listening minutes count today instead of all past days');
 assert.equal(await numberStat('today-questions'),3,'question count includes today only');
 assert.ok(Math.abs(await numberStat('total-study-hours')-2)<.05,'total study hours include listening and silent practice across all dates');
 assert.equal((await day(dateKeys.previous)).count,1,'previous-day activity remains separate');
 const todayBefore=await day(dateKeys.today);assert.equal(todayBefore.count,3);
 assert.ok(await page.locator('.calendar-day[data-date]').count()>=365,'activity calendar contains a full year');
 const calendarDates=await page.locator('.calendar-day[data-date]').evaluateAll(elements=>elements.map(e=>e.dataset.date));
 assert.equal(new Set(calendarDates).size,calendarDates.length,'calendar dates are unique');
 await page.screenshot({path:path.join(output,'profile-light.png'),fullPage:true});
 pass('daily statistics and yearly activity calendar reflect stored dated records',{todayBefore});
 await click('[data-action="nav"][data-route="library"]');
 await click('[data-action="open"][data-paper="listenly-original"][data-article="library"]');
 await click('[data-action="mode"][data-mode="exam"]');
 await submit('B');await click('[data-action="next-question"]');await submit('A');await click('[data-action="next-question"]');
 await page.locator('.result-card').waitFor();await click('[data-action="restart-quiz"]');await submit('B');
 const afterRepeating=await saved();assert.equal(Object.values(afterRepeating.dailyQuestions[dateKeys.today]).reduce((a,n)=>a+n,0),6,'repeating a question adds activity without erasing earlier attempts');
 await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="profile"]');
 assert.equal(await numberStat('today-questions'),6,'daily question statistic updates after real submissions');
 const todayAfter=await day(dateKeys.today);assert.equal(todayAfter.count,6);assert.ok(todayAfter.level>=todayBefore.level,'more completed questions increase activity level');
 const lightDay=todayAfter.background;const lightRgb=rgb(lightDay);assert.ok(lightRgb[1]>lightRgb[0]&&lightRgb[1]>lightRgb[2],'daytime activity uses green');
 await click('[data-action="theme"][data-theme="dark"]');
 const darkDay=await day(dateKeys.today),darkRgb=rgb(darkDay.background);assert.ok(darkRgb[0]>darkRgb[1]&&darkRgb[1]>darkRgb[2],'nighttime activity uses orange');
 assert.equal(darkDay.count,6,'changing palette retains the activity count');
 await page.waitForTimeout(220);
 await page.screenshot({path:path.join(output,'profile-dark.png'),fullPage:true});
 pass('real submissions and repeated practice update activity; palettes use green/orange',{todayBefore,todayAfter,darkDay});
 for(const viewport of [{width:360,height:800},{width:393,height:873},{width:430,height:932}]){
  await page.setViewportSize(viewport);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'profile fits phone viewport without horizontal page overflow');
  const calendar=page.locator('.calendar-day[aria-current="date"]');await calendar.scrollIntoViewIfNeeded();assert.ok(await calendar.isVisible(),'today is reachable; future padding remains hidden');
 }
 assert.deepEqual(result.pageErrors,[]);result.passed=true;
 console.log(JSON.stringify({passed:true,checks:result.checks.length,entrySha256:result.entrySha256,output}));
}catch(error){result.failure={message:error.message,stack:error.stack};await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}

function rgb(color){const values=color.match(/[\d.]+/g);assert.ok(values&&values.length>=3,`computed RGB color: ${color}`);return values.slice(0,3).map(Number)}
