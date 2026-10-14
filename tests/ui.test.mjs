import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';
import {verifyReaderLayout,verifyCompactPlayerControls,verifyReaderScrollAndArticleMenu} from './reader-layout.test.mjs';
import {enterLibraryPaper,openLibraryArticle} from './library-navigation.mjs';

let playwright;try{playwright=await import('playwright')}catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const {chromium}=playwright;

const root=process.cwd();
await mkdir(path.join(root,'dist'),{recursive:true});
const browser=await chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const page=await browser.newPage({viewport:{width:430,height:932},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const demo=process.argv.includes('--demo');
const webRoot=path.join(root,demo?'.build/demo/main/assets/web':'app/src/main/assets/web');
const server=await startPreview(0,webRoot);
const url=`http://127.0.0.1:${server.address().port}`;
const click=selector=>page.locator(selector).first().click();
try{
 await page.goto(url);await page.locator('.focus-card').waitFor();
 assert.doesNotMatch(await page.locator('#app').innerText(),/每一句，都听懂|放慢一点，让英语慢慢清晰|每份材料，都是下一次进步的开始/,'home removes decorative slogans');
 assert.equal(await page.locator('.brand').count(),0,'home has no oversized brand header');
 await page.screenshot({path:path.join(root,'dist/home-phone.png'),fullPage:true});
 // Open the original sample rather than depending on the bundled-paper order.
 await click('[data-action="nav"][data-route="library"]');
 assert.doesNotMatch(await page.locator('#app').innerText(),/听力资料库|每份材料，都是下一次进步的开始/,'library removes redundant headings');
 await openLibraryArticle(page,'listenly-original','morning');
 await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
 await verifyReaderLayout(page,path.join(root,'dist'));
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
 await click('[data-action="answer"][data-option="B"]');await click('[data-action="submit-answer"]');
 assert.match(await page.locator('.feedback').innerText(),/答对了/);
 await page.screenshot({path:path.join(root,'dist/quiz-phone.png'),fullPage:true});
 await click('[data-action="mode"][data-mode="intensive"]');
 assert.match(await page.locator('.practice-title').innerText(),/A small change/);
 await click('[data-action="bookmark"]');
 await page.screenshot({path:path.join(root,'dist/intensive-phone.png'),fullPage:true});
 await page.reload();await page.locator('.focus-card').waitFor();
 await click('[data-action="nav"][data-route="library"]');
 await openLibraryArticle(page,'listenly-original','morning');
 await click('[data-action="mode"][data-mode="exam"]');
 assert.match(await page.locator('.feedback').innerText(),/答对了/,'answer persists on restart');
 await click('[data-action="next-question"]');
 await click('[data-action="answer"][data-option="D"]');await click('[data-action="submit-answer"]');
 assert.match(await page.locator('.feedback').innerText(),/答案\s*(?:是\s*)?A/,'incorrect choice gets corrected');
 await click('[data-action="next-question"]');
 await click('[data-action="answer"][data-option="C"]');await click('[data-action="submit-answer"]');
 await click('[data-action="next-question"]');
 assert.match(await page.locator('.result-card').innerText(),/本套(?:材料已)?完成\s+3\s*\/\s*5/);
 await click('.result-card [data-action="open"]');
 assert.match(await page.locator('.practice-title').innerText(),/little library/);
 assert.equal(await page.locator('.option.selected').count(),0,'same question ID in another article retains its own answer');
 // A genuine directory-selection import; its nested paths must survive IndexedDB restoration.
 const fixture=path.join(root,'.build/ui-fixture');
 const material=path.join(fixture,'paper-ui','article-ui');await mkdir(material,{recursive:true});
 await writeFile(path.join(fixture,'paper-ui','paper.json'),JSON.stringify({id:'paper-ui',title:'UI导入验证',year:2025,articles:[{id:'article-ui',title:'Import and restart',audio:{intensive:'article-ui/audio.wav'},transcript:'article-ui/transcript.json',questions:'article-ui/questions.json'}]}));
 await writeFile(path.join(material,'transcript.json'),JSON.stringify([{start:0,en:'Original imported sentence.',zh:'导入原文。'}]));
 await writeFile(path.join(material,'questions.json'),JSON.stringify([{id:'q1',number:1,prompt:'Imported question?',options:[{id:'A',text:'One'},{id:'B',text:'Two'},{id:'C',text:'Three'},{id:'D',text:'Four'}],answer:'A'}]));
 await copyFile(path.join(webRoot,'media/morning.wav'),path.join(material,'audio.wav'));
 await click('[data-action="nav"][data-route="library"]');
 await page.locator('#folder-input').setInputFiles(fixture);
 await page.locator('[data-action="open-paper"][data-paper="paper-ui"]').waitFor();
 await page.reload();await page.locator('.focus-card').waitFor();
 await click('[data-action="nav"][data-route="library"]');
 await openLibraryArticle(page,'paper-ui','article-ui');
 await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
 assert.ok(await page.locator('#audio').evaluate(a=>a.duration>20),'imported audio restored');
 await click('[data-action="mode"][data-mode="intensive"]');
 await click('[data-action="display"][data-display="bilingual"]');
 assert.match(await page.locator('.transcript-card').innerText(),/Original imported sentence/);
 // Import a second mode and confirm one aligned article rather than duplicate papers.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('listenly-import',{detail:{mode:'exam',name:'做题',files:[{path:'paper-ui/paper.json',text:JSON.stringify({id:'paper-ui',title:'UI导入验证',articles:[{id:'article-ui',title:'Import and restart',audio:{exam:'article-ui/audio.wav'},questions:'article-ui/questions.json'}]})},{path:'paper-ui/article-ui/audio.wav',url:'media/morning.wav'},{path:'paper-ui/article-ui/questions.json',text:JSON.stringify([{id:'q1',number:1,prompt:'Imported question?',options:[{id:'A',text:'One'},{id:'B',text:'Two'},{id:'C',text:'Three'},{id:'D',text:'Four'}],answer:'A'}])}]}})));
 await page.waitForTimeout(200);await click('[data-action="nav"][data-route="library"]');
 await enterLibraryPaper(page,'paper-ui');
 assert.equal(await page.locator('[data-action="open"][data-paper="paper-ui"]').count(),1,'both modes merge into one article');
 // Exercise the real noncontiguous question clip: passage context + question prompt.
 const bundled=JSON.parse(await readFile(path.join(webRoot,'bundled-library.json'),'utf8'));
 const timed=bundled.papers.find(p=>p.id==='cet6-2013-06-set2');
 const passage=timed?.articles.find(a=>a.questions.some(q=>q.audioTimeline?.length>1));
 if(passage){
   await openLibraryArticle(page,timed.id,passage.id);
   await click('[data-action="mode"][data-mode="intensive"]');
   await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
   const question=passage.questions[0],segment=question.audioTimeline[1];
   await page.locator('#audio').evaluate((a,t)=>a.currentTime=t,segment.articleStart+1);
   await click('[data-action="mode"][data-mode="exam"]');
   await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
   assert.ok(Math.abs(await page.locator('#audio').evaluate(a=>a.currentTime)-(segment.clipStart+1))<.4,'real question prompt maps from full article');
   await click('[data-action="mode"][data-mode="intensive"]');
   await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);
   assert.ok(Math.abs(await page.locator('#audio').evaluate(a=>a.currentTime)-(segment.articleStart+1))<.4,'real sliced question maps back to article');
 }
 for(const viewport of [{width:360,height:800},{width:393,height:873},{width:430,height:932},{width:1280,height:900}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(100);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 }
 await page.setViewportSize({width:1280,height:900});await click('[data-action="nav"][data-route="home"]');
 await page.screenshot({path:path.join(root,'dist/home-desktop.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: compact reader on 3 phone sizes with/without safe areas, one bottom player, seek/skip/speed/sentence loop, article menu, reading/quiz scroll preservation, bilingual/original/hidden, mode alignment, grading, persistence, real folder import, merged materials, 4 viewport widths.');
}finally{await browser.close();server.close()}
