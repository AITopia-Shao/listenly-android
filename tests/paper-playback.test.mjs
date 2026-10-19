import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
import {startPreview} from '../tools/preview.mjs';
import {clickAppControl,enterLibraryPaper} from './library-navigation.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(option('--web-root')||'.build/demo/main/assets/web');
const output=path.resolve(option('--output')||'.build/paper-playback');await mkdir(output,{recursive:true});
const result={passed:false,entrySha256:createHash('sha256').update(await readFile(path.join(webRoot,'app.compat.js'))).digest('hex'),checks:[],pageErrors:[]};
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
const page=await browser.newPage({viewport:{width:393,height:873},deviceScaleFactor:1});
page.on('pageerror',error=>result.pageErrors.push(error.message));
const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`;
const click=selector=>clickAppControl(page,selector);
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));
const media=()=>page.locator('#audio').evaluate(a=>({time:a.currentTime,src:a.currentSrc,duration:a.duration,paused:a.paused,error:a.error?.code||null}));
const ready=()=>page.waitForFunction(()=>{const a=document.querySelector('#audio');return a.readyState>=1&&!a.seeking&&Number.isFinite(a.duration)});
const pass=(label,details)=>{result.checks.push({label,...(details?{details}:{})});console.log('PASS '+label)};
async function answer(index,choice){const toggle=page.locator(`[data-action="toggle-question"][data-index="${index}"]`);if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await click(`.quiz-question[data-question-index="${index}"] [data-action="answer"][data-option="${choice}"]`)}
async function home(){await click('[data-action="nav"][data-route="home"]');await page.locator('.home-playback').waitFor()}
try{
 await page.goto(url);await page.locator('.home-playback').waitFor();
 const demo=JSON.parse(await readFile('examples/demo/demo.json','utf8')),second=demo.articles[1];
 assert.equal(await page.locator('.focus-card h2').innerText(),demo.title);
 assert.equal(await page.locator('.home-paper-row').count(),2);
 await click('.focus-play');await ready();await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>.1);
 const initial=await media();assert.ok(initial.src.endsWith('original-suite.wav'));assert.ok(Math.abs(initial.duration-demo.duration)<.05);
 await click('.focus-play');await page.evaluate(()=>{window.__paperAudio=document.querySelector('#audio');window.__paperResets=[];for(const type of ['emptied','loadstart'])window.__paperAudio.addEventListener(type,()=>window.__paperResets.push(type))});
 pass('home describes and plays the complete paper while retaining both chapter rows',initial);

 await click('[data-action="mark-paper"][data-article="library"]');await ready();const marked=await media();assert.ok(Math.abs(marked.time-second.start)<.1);assert.equal(marked.src,initial.src);assert.equal(marked.paused,true);assert.equal(await page.locator('.home-paper-row').count(),2);
 assert.ok(Math.abs(Number(await page.locator('#seek').inputValue())-second.start)<.1);
 assert.deepEqual(await page.evaluate(()=>window.__paperResets),[]);
 pass('a chapter tap seeks the one paper clock without reloading, playing, or removing its list row',marked);

 await click('.row-reader[data-article="library"]');assert.equal(await page.locator('[data-display="hidden"]').getAttribute('aria-pressed'),'true');await click('[data-display="original"]');
 await click('.sentence[data-index="1"]');await ready();const sentence=await media();assert.ok(Math.abs(sentence.time-(second.start+second.transcript[1].start))<1);assert.equal(sentence.src,initial.src);assert.equal(sentence.paused,false);
 await click('[data-action="play"]');const beforeMode=await media();await click('[data-mode="exam"]');const afterMode=await media();assert.ok(Math.abs(beforeMode.time-afterMode.time)<.1);assert.equal(afterMode.src,beforeMode.src);
 assert.deepEqual(await page.evaluate(()=>window.__paperResets),[]);
 pass('sentence navigation adds the chapter offset and both training modes preserve the same decoder position',{sentence,beforeMode,afterMode});

 await home();await click('[data-action="mark-paper"][data-article="morning"]');await click('.row-reader[data-article="morning"]');await click('[data-mode="exam"]');
 await click('[data-action="toggle-question"][data-index="1"]');assert.equal(await page.locator('.question-toggle[aria-expanded="true"]').count(),2);
 await answer(0,'B');await answer(1,'A');await answer(2,'C');await click('[data-action="submit-article"]');await ready();
 assert.match(await page.locator('.practice-title').innerText(),/little library/);assert.equal(await page.locator('.quiz-question').count(),2);assert.equal(await page.locator('.result-card').count(),0);assert.ok(Math.abs((await media()).time-second.start)<.1);
 const firstDone=await saved();assert.equal(Object.values(firstDone.answers).filter(a=>a.submitted).length,3);assert.ok(firstDone.articleCompletions[JSON.stringify([demo.id,'morning'])]);
 pass('submitting one complete article immediately opens the next article at its marker and keeps completed answers',firstDone.active);

 await answer(0,'A');await answer(1,'B');await click('[data-action="submit-article"]');await page.locator('.result-card').waitFor();
 await click('[data-action="nav"][data-route="profile"]');assert.equal(await page.locator('[data-stat="today-articles"]').innerText(),'2');assert.equal(await page.locator('.history-row').count(),2);assert.equal(await page.locator('[data-stat="today-listening-minutes"]').innerText(),'0','seeking through the paper must not manufacture complete listens');
 pass('the final article opens results; profile counts completed articles and excludes skipped listening');

 await click('[data-action="nav"][data-route="library"]');for(const id of ['cet6','ielts','toefl','original'])assert.equal(await page.locator(`[data-action="open-collection"][data-collection="${id}"]`).count(),1);
 assert.equal(await page.locator('[data-action="theme"],[data-action="import"]').count(),0);
 const selected=(await saved()).selectedPaper;await click('[data-action="open-collection"][data-collection="original"]');await click(`[data-action="open-paper"][data-paper="${demo.id}"]`);assert.equal((await saved()).selectedPaper,selected);await click('[data-action="library-back"]');await click('[data-action="library-back"]');assert.ok(await page.locator('.collection-row').count());
 pass('library has collection, paper and chapter levels, and previewing never selects a paper');

 await page.evaluate(()=>{let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>++n===1?'ffffffff-ffff-4fff-8fff-ffffffffffff':'00000000-0000-4000-8000-000000000000'})});
 const folder=path.join(output,'import','ielts-paper');await mkdir(folder,{recursive:true});await copyFile('examples/demo/media/original-suite.wav',path.join(folder,'paper.wav'));
 const imported={...demo,id:'ielts-one',title:'雅思 · 完整录音测试',collection:{id:'ielts',title:'雅思合集'},audio:'paper.wav',articles:demo.articles.map(a=>{const {audio,...chapter}=a;return chapter})};
 await writeFile(path.join(folder,'paper.json'),JSON.stringify(imported));await page.locator('#folder-input').setInputFiles(folder);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('listenly.state.v1')).lastImport?.count===1);
 if(await page.locator('.dialog-shade:not(.is-closing)').count())await click('[data-action="close-dialog"]');
 assert.equal((await saved()).selectedPaper,selected);await click('[data-action="open-collection"][data-collection="ielts"]');await page.locator('[data-action="select-paper"][data-paper="ielts-one"]').waitFor();await click('[data-action="open-paper"][data-paper="ielts-one"]');assert.equal((await saved()).selectedPaper,selected);await click('[data-action="library-back"]');await click('[data-action="select-paper"][data-paper="ielts-one"]');await home();assert.equal(await page.locator('.focus-card h2').innerText(),imported.title);
 await click('.focus-play');await ready();assert.ok((await media()).src.startsWith('blob:'));await click('.focus-play');
 pass('a single-recording folder imports with authored markers, enters its exam collection and changes home only when selected or played');

 await page.locator('#audio').evaluate(a=>a.currentTime=10);await ready();await page.reload();await page.locator('.home-playback').waitFor();await ready();assert.ok(Math.abs((await media()).time-10)<.3);assert.equal((await media()).paused,true);assert.equal(Object.values((await saved()).answers).filter(a=>a.submitted).length,5);
 pass('the absolute paper position, collection selection and all submitted answers survive reload');

 await page.evaluate(()=>Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>'00000000-0000-4000-8000-000000000000'}));
 const revisedFolder=path.join(output,'revised','ielts-paper-revised');await mkdir(revisedFolder,{recursive:true});await copyFile('examples/demo/media/original-suite.wav',path.join(revisedFolder,'paper.wav'));
 const revised=JSON.parse(JSON.stringify(imported));revised.articles[1].start+=1;revised.articles[1].transcript[0].start=.25;
 await writeFile(path.join(revisedFolder,'paper.json'),JSON.stringify(revised));await page.locator('#folder-input').setInputFiles(revisedFolder);await page.waitForFunction(()=>!document.querySelector('.busy')&&JSON.parse(localStorage.getItem('listenly.state.v1')).lastImport?.name==='ielts-paper-revised');
 if(await page.locator('.dialog-shade:not(.is-closing)').count())await click('[data-action="close-dialog"]');
 await click('[data-action="mark-paper"][data-article="library"]');await ready();assert.ok(Math.abs((await media()).time-revised.articles[1].start)<.1);
 await page.reload();await page.locator('.home-playback').waitFor();await ready();await click('[data-action="mark-paper"][data-article="library"]');await ready();assert.ok(Math.abs((await media()).time-revised.articles[1].start)<.1,'reload replays the newer import after the older import regardless of UUID lexical order');
 await click('.row-reader[data-article="library"]');await click('[data-display="original"]');await click('.sentence[data-index="0"]');await ready();assert.ok(Math.abs((await media()).time-(revised.articles[1].start+.25))<1);await click('[data-action="play"]');await home();
 pass('a later real folder import updates the full source and sentence markers atomically and remains latest after reload');


 await click('[data-action="nav"][data-route="profile"]');await click('[data-action="import"]');await click('[data-action="choose-folder"][data-mode="exam"]');const invalid=path.join(output,'invalid','bad-paper');await mkdir(invalid,{recursive:true});await copyFile('examples/demo/media/morning.wav',path.join(invalid,'short.wav'));await writeFile(path.join(invalid,'paper.json'),JSON.stringify({...imported,id:'bad-paper',audio:'short.wav',duration:demo.duration}));const beforeInvalid=await saved();await page.locator('#folder-input').setInputFiles(invalid);await page.waitForFunction(()=>!document.querySelector('.busy'));assert.equal((await saved()).lastImport.name,beforeInvalid.lastImport.name);assert.match(await page.locator('#toast').innerText(),/超出|无效|未导入/);
 pass('decoded full-recording duration rejects out-of-range markers atomically in exam import too');
 assert.deepEqual(result.pageErrors,[]);await home();await page.screenshot({path:path.join(output,'home-paper.png'),fullPage:true});await click('[data-action="nav"][data-route="library"]');await page.screenshot({path:path.join(output,'collections.png'),fullPage:true});result.passed=true;
}catch(error){result.failure={message:error.message,stack:error.stack};await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
