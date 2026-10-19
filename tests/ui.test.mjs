import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';
import {verifyReaderLayout,verifyCompactPlayerControls,verifyReaderScrollAndArticleMenu} from './reader-layout.test.mjs';
import {enterLibraryPaper,openLibraryArticle,clickAppControl} from './library-navigation.mjs';
import {createHash} from 'node:crypto';

let playwright;try{playwright=await import('playwright')}catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const {chromium}=playwright;

const root=process.cwd();
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const output=path.resolve(option('--output')||path.join(root,'dist'));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const page=await browser.newPage({viewport:{width:430,height:932},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const demo=process.argv.includes('--demo');
const webRoot=path.resolve(option('--web-root')||path.join(root,demo?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const result={entrySha256:createHash('sha256').update(await readFile(path.join(webRoot,'app.compat.js'))).digest('hex'),pageErrors:errors,passed:false};
const server=await startPreview(0,webRoot);
const url=`http://127.0.0.1:${server.address().port}`;
const click=selector=>clickAppControl(page,selector);
async function openQuestion(index){const control=page.locator(`[data-action="toggle-question"][data-index="${index}"]`);if(await control.getAttribute('aria-expanded')!=='true')await control.click()}
async function choose(index,option){await openQuestion(index);await click(`.quiz-question[data-question-index="${index}"] [data-action="answer"][data-option="${option}"]`)}
try{
 await page.goto(url);await page.locator('.focus-card').waitFor();
 assert.equal(await page.locator('[data-action="theme"],[data-action="import"]').count(),0,'home keeps global appearance and import actions on profile');
 assert.doesNotMatch(await page.locator('#app').innerText(),/每一句，都听懂|放慢一点，让英语慢慢清晰|每份材料，都是下一次进步的开始/,'home removes decorative slogans');
 assert.equal(await page.locator('.brand').count(),0,'home has no oversized brand header');
 await page.screenshot({path:path.join(output,'home-phone.png'),fullPage:true});
 // Open the original sample rather than depending on the bundled-paper order.
 await click('[data-action="nav"][data-route="library"]');
 assert.equal(await page.locator('[data-action="theme"],[data-action="import"]').count(),0,'library keeps global appearance and import actions on profile');
 assert.doesNotMatch(await page.locator('#app').innerText(),/听力资料库|每份材料，都是下一次进步的开始/,'library removes redundant headings');
 await openLibraryArticle(page,'listenly-original','morning');
 await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
 result.layouts=await verifyReaderLayout(page,output);
 await verifyCompactPlayerControls(page);
 await verifyReaderScrollAndArticleMenu(page);
 assert.equal(await page.locator('.sentence .zh').count(),6);
 await click('[data-display="original"]');assert.equal(await page.locator('.sentence .zh').count(),0);
 await click('[data-display="hidden"]');assert.equal(await page.locator('.sentence').count(),0);
 await click('[data-display="bilingual"]');
 await click('[data-action="play"]');await page.waitForTimeout(300);
 assert.equal(await page.locator('#audio').evaluate(a=>a.paused),false);
 await click('[data-action="play"]');
 await page.locator('#audio').evaluate(a=>a.currentTime=12);
 await click('[data-action="mode"][data-mode="exam"]');
 assert.ok(Math.abs(await page.locator('#audio').evaluate(a=>a.currentTime)-12)<.4,'same article progress aligned');
 assert.equal(await page.locator('.quiz-question').count(),3,'one article displays all three question rows');
 await choose(0,'B');await choose(1,'D');await choose(2,'C');await click('[data-action="submit-article"]');
 assert.match(await page.locator('.practice-title').innerText(),/little library/,'submission automatically advances to the next article');
 await click('[data-action="nav"][data-route="library"]');await openLibraryArticle(page,'listenly-original','morning');await click('[data-action="mode"][data-mode="exam"]');
 await openQuestion(0);assert.match(await page.locator('.quiz-question[data-question-index="0"] .question-feedback').innerText(),/答对了/);
 await page.screenshot({path:path.join(output,'quiz-phone.png'),fullPage:true});
 await click('[data-action="mode"][data-mode="intensive"]');
 assert.match(await page.locator('.practice-title').innerText(),/A small change/);
 await click('[data-action="bookmark"]');
 await page.screenshot({path:path.join(output,'intensive-phone.png'),fullPage:true});
 await page.reload();await page.locator('.focus-card').waitFor();
 await click('[data-action="nav"][data-route="library"]');
 await openLibraryArticle(page,'listenly-original','morning');
 await click('[data-action="mode"][data-mode="exam"]');
 await openQuestion(0);assert.match(await page.locator('.quiz-question[data-question-index="0"] .question-feedback').innerText(),/答对了/,'answer persists on restart');
 await openQuestion(1);assert.match(await page.locator('.quiz-question[data-question-index="1"] .question-feedback').innerText(),/答案\s*(?:是\s*)?A/,'incorrect choice gets corrected');
 await click('[data-action="view-result"]');
 assert.match(await page.locator('.result-card').innerText(),/本套(?:材料已)?完成\s+3\s*\/\s*5/);
 await click('.result-card [data-action="open"]');
 assert.match(await page.locator('.practice-title').innerText(),/little library/);
 assert.equal(await page.locator('.option.selected').count(),0,'same question ID in another article retains its own answer');
 // A genuine directory-selection import; its nested paths must survive IndexedDB restoration.
 const fixture=path.join(root,'.build/ui-fixture');
 const material=path.join(fixture,'paper-ui','article-ui');await mkdir(material,{recursive:true});
 await writeFile(path.join(fixture,'paper-ui','paper.json'),JSON.stringify({id:'paper-ui',title:'UI导入验证',year:2025,schemaVersion:2,audio:'article-ui/audio.wav',duration:69.58403628117914,articles:[{start:0,end:69.58403628117914,id:'article-ui',title:'Import and restart',audio:{intensive:'article-ui/audio.wav'},transcript:'article-ui/transcript.json',questions:'article-ui/questions.json'}]}));
 await writeFile(path.join(material,'transcript.json'),JSON.stringify([{start:0,en:'Original imported sentence.',zh:'导入原文。'}]));
 await writeFile(path.join(material,'questions.json'),JSON.stringify([{id:'q1',number:1,prompt:'Imported question?',options:[{id:'A',text:'One'},{id:'B',text:'Two'},{id:'C',text:'Three'},{id:'D',text:'Four'}],answer:'A'}]));
 await copyFile(path.resolve('examples/demo/media/original-suite.wav'),path.join(material,'audio.wav'));
 await click('[data-action="nav"][data-route="library"]');
 await page.locator('#folder-input').setInputFiles(fixture);
 await enterLibraryPaper(page,'paper-ui');
 await page.reload();await page.locator('.focus-card').waitFor();
 await click('[data-action="nav"][data-route="library"]');
 await openLibraryArticle(page,'paper-ui','article-ui');
 await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
 assert.ok(await page.locator('#audio').evaluate(a=>a.duration>20),'imported audio restored');
 await click('[data-action="mode"][data-mode="intensive"]');
 await click('[data-action="display"][data-display="bilingual"]');
 assert.match(await page.locator('.transcript-card').innerText(),/Original imported sentence/);
 // Import a second mode and confirm one aligned article rather than duplicate papers.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('listenly-import',{detail:{mode:'exam',name:'做题',files:[{path:'paper-ui/paper.json',text:JSON.stringify({id:'paper-ui',title:'UI导入验证',schemaVersion:2,audio:'article-ui/audio.wav',duration:69.58403628117914,articles:[{start:0,end:69.58403628117914,id:'article-ui',title:'Import and restart',audio:{exam:'article-ui/audio.wav'},questions:'article-ui/questions.json'}]})},{path:'paper-ui/article-ui/audio.wav',url:'media/original-suite.wav'},{path:'paper-ui/article-ui/questions.json',text:JSON.stringify([{id:'q1',number:1,prompt:'Imported question?',options:[{id:'A',text:'One'},{id:'B',text:'Two'},{id:'C',text:'Three'},{id:'D',text:'Four'}],answer:'A'}])}]}})));
 await page.waitForTimeout(200);await click('[data-action="nav"][data-route="library"]');
 await enterLibraryPaper(page,'paper-ui');
 assert.equal(await page.locator('[data-action="open"][data-paper="paper-ui"]').count(),1,'both modes merge into one article');
 // Private builds additionally exercise an authored real exam timeline.
 const bundled=JSON.parse(await readFile(path.join(webRoot,'bundled-library.json'),'utf8'));
 const timed=bundled.papers.find(p=>p.audio&&p.articles.some(a=>Number.isFinite(a.start)&&a.questions?.length));
 const passage=timed?.articles.find(a=>Number.isFinite(a.start)&&a.questions?.length);
 if(passage){
   await openLibraryArticle(page,timed.id,passage.id);await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
   const target=passage.start+Math.min(1,(passage.end-passage.start)/2);await page.locator('#audio').evaluate((a,t)=>a.currentTime=t,target);await page.waitForFunction(()=>!document.querySelector('#audio').seeking);const source=await page.locator('#audio').evaluate(a=>a.currentSrc);
   for(const mode of ['exam','intensive']){await click(`[data-action="mode"][data-mode="${mode}"]`);assert.equal(await page.locator('#audio').evaluate(a=>a.currentSrc),source);assert.ok(Math.abs(await page.locator('#audio').evaluate(a=>a.currentTime)-target)<.4,'real exam modes preserve the absolute full-paper clock')}
 }
 for(const viewport of [{width:360,height:800},{width:393,height:873},{width:430,height:932},{width:1280,height:900}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(100);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 }
 await page.setViewportSize({width:1280,height:900});await click('[data-action="nav"][data-route="home"]');
 await page.screenshot({path:path.join(output,'home-desktop.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 result.passed=true;
 console.log('PASS: compact reader on 3 phone sizes with/without safe areas, one bottom player, seek/skip/speed/three playback modes, no reader article picker, reading/quiz scroll preservation, bilingual/original/hidden, mode alignment, grading, persistence, real folder import, merged materials, 4 viewport widths.');
}catch(error){result.failure={message:error.message,stack:error.stack};await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'ui-result.json'),JSON.stringify(result,null,2));await browser.close();server.close()}
