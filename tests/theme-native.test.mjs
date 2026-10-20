import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';

// Protocol correctness against the real app bundle. PixelCopy and actual Android
// frame presentation are verified separately on the installed APK, not mocked here.
let playwright;try{playwright=await import('playwright')}catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(option('--web-root')||(args.includes('--demo')?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const output=path.resolve(option('--output')||'.build/theme-native/browser');await mkdir(output,{recursive:true});
const digest=b=>createHash('sha256').update(b).digest('hex');
const result={passed:false,entrySha256:digest(await readFile(path.join(webRoot,'app.compat.js'))),stylesSha256:digest(await readFile(path.join(webRoot,'styles.css'))),harnessSha256Normalized:digest((await readFile(new URL(import.meta.url),'utf8')).replace(/\r\n/g,'\n')),scope:'Native bridge protocol using real UI clicks and app bundle; does not measure native rendering or assert 120fps.',checks:[],pageErrors:[]};
const browser=await playwright.chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`;
const contexts=[];let activePage;
function pass(label,details){result.checks.push({label,details});console.log(`PASS ${label}`)}
async function setup(){
 const context=await browser.newContext({viewport:{width:393,height:873}});contexts.push(context);
 const page=await context.newPage();activePage=page;page.on('pageerror',error=>result.pageErrors.push(error.message));
 await page.addInitScript(()=>{
  const trace=window.__nativeThemeTest={begin:[],animate:[],finish:[],nativeThemes:[],viewTransitions:0,mutations:[],events:[]};
  window.Android={setTheme:theme=>trace.nativeThemes.push(theme),beginThemeTransition:id=>{trace.begin.push(id);return true},animateThemeTransition:(id,toOriginal)=>trace.animate.push({id,toOriginal}),finishThemeTransition:id=>trace.finish.push(id)};
  const start=document.startViewTransition?.bind(document);if(start)document.startViewTransition=(...args)=>{trace.viewTransitions++;return start(...args)};
  const observe=()=>new MutationObserver(records=>{for(const record of records)if(record.attributeName==='data-theme')trace.mutations.push({from:record.oldValue,to:document.documentElement.dataset.theme})}).observe(document.documentElement,{attributes:true,attributeOldValue:true,attributeFilter:['data-theme']});
  if(document.documentElement)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
  document.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(b)trace.events.push({action:b.dataset.action,trusted:event.isTrusted})},true);
 });
 await page.goto(url);await page.locator('.focus-card').waitFor();await page.evaluate(()=>document.fonts.ready);await page.locator('.bottom-nav [data-route=profile]').click();await page.locator('.statistics').waitFor();
 await page.evaluate(()=>{window.__nativeThemeTest.mutations=[];window.__nativeThemeTest.nativeThemes=[]});
 return page;
}
const theme=page=>page.evaluate(()=>document.documentElement.dataset.theme);
const trace=page=>page.evaluate(()=>window.__nativeThemeTest);
async function choose(page,value){await page.locator(`[data-action=theme][data-theme=${value}]`).click()}
const ready=(page,id,ok=true)=>page.evaluate(({id,ok})=>window.listenlyThemeNativeReady(id,ok),{id,ok});
const end=(page,id,toOriginal=false)=>page.evaluate(({id,toOriginal})=>window.listenlyThemeNativeEnd(id,toOriginal),{id,toOriginal});
async function settled(page,value){await page.waitForFunction(value=>!document.documentElement.dataset.themeTransition&&document.documentElement.dataset.theme===value,value)}
try{
 let page=await setup();await choose(page,'dark');let t=await trace(page),id=t.begin[0];assert.equal(t.begin.length,1);assert.equal(t.viewTransitions,0);assert.equal(await theme(page),'light');assert.equal(await page.evaluate(()=>document.documentElement.dataset.themeRenderer),'native');await ready(page,id);t=await trace(page);assert.equal(await theme(page),'dark');assert.deepEqual(t.animate,[{id,toOriginal:false}]);await end(page,id);await settled(page,'dark');t=await trace(page);assert.equal(t.finish.filter(n=>n===id).length,1);assert.equal(t.viewTransitions,0);pass('native capture precedes the single palette commit and avoids full-page ViewTransition',t);

 page=await setup();await choose(page,'dark');id=(await trace(page)).begin[0];await ready(page,id);await choose(page,'light');t=await trace(page);assert.equal(await theme(page),'dark','the old bitmap reverses over the unchanged new palette');assert.equal(t.animate.at(-1).toOriginal,true);await end(page,id,false);assert.equal(await page.evaluate(()=>document.documentElement.dataset.themeTransition),'true','an obsolete endpoint cannot complete a reversed request');assert.equal((await trace(page)).animate.at(-1).toOriginal,true);await end(page,id,true);await settled(page,'light');t=await trace(page);assert.equal(t.begin.length,1);assert.equal(t.finish.length,1);assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('listenly.state.v1'))).theme,'light');pass('rapid reverse reuses the captured bitmap and ignores a stale opposite endpoint',t);

 page=await setup();await choose(page,'dark');id=(await trace(page)).begin[0];await ready(page,id);await choose(page,'light');await choose(page,'dark');t=await trace(page);assert.equal(t.begin.length,1);assert.deepEqual(t.animate.map(row=>row.toOriginal),[false,true,false]);await end(page,id,true);assert.equal((await trace(page)).animate.at(-1).toOriginal,false);await end(page,id,false);await settled(page,'dark');pass('repeated direction changes retarget one native animation instead of recapturing',await trace(page));

 page=await setup();await choose(page,'dark');id=(await trace(page)).begin[0];await choose(page,'light');await ready(page,id);await settled(page,'light');t=await trace(page);assert.deepEqual(t.animate,[]);assert.deepEqual(t.finish,[id]);assert.equal(t.mutations.length,0);pass('a retap before PixelCopy completes cancels without painting the unwanted theme',t);

 page=await setup();await choose(page,'dark');id=(await trace(page)).begin[0];await ready(page,id,false);await settled(page,'dark');t=await trace(page);assert.deepEqual(t.animate,[]);assert.deepEqual(t.finish,[id]);assert.equal(t.viewTransitions,0);pass('capture failure settles safely without starting another expensive web transition',t);

 page=await setup();await page.emulateMedia({reducedMotion:'reduce'});await choose(page,'dark');await settled(page,'dark');assert.equal((await trace(page)).begin.length,0);await page.emulateMedia({reducedMotion:'no-preference'});await choose(page,'light');id=(await trace(page)).begin[0];await ready(page,id);await page.emulateMedia({reducedMotion:'reduce'});await settled(page,'light');assert.deepEqual((await trace(page)).finish,[id]);pass('reduced motion bypasses capture and cleans up an already active native transition',await trace(page));

 page=await setup();await choose(page,'dark');id=(await trace(page)).begin[0];await ready(page,id);await page.locator('[data-action=import]').click();await page.locator('.dialog-shade').waitFor();t=await trace(page);assert.equal(t.events.filter(row=>row.action==='import').length,1);assert.ok(t.events.find(row=>row.action==='import').trusted);assert.deepEqual(t.finish,[id]);assert.equal(await page.evaluate(()=>!!document.documentElement.dataset.themeTransition),false);pass('a genuine non-theme tap remains live and dismisses the snapshot before its action',t);

 page=await setup();await choose(page,'dark');id=(await trace(page)).begin[0];await ready(page,id);await page.setViewportSize({width:430,height:932});await settled(page,'dark');await ready(page,id);await end(page,id,true);await settled(page,'dark');assert.deepEqual((await trace(page)).finish,[id]);pass('resize releases the native image and late callbacks cannot revive the old transaction',await trace(page));

 page=await setup();await choose(page,'dark');id=(await trace(page)).begin[0];await settled(page,'dark');t=await trace(page);assert.deepEqual(t.finish,[id]);assert.equal(t.viewTransitions,0);pass('an unresponsive native bridge has a bounded cleanup and preserves the requested theme',t);
 assert.deepEqual(result.pageErrors,[]);result.passed=true;
}catch(error){result.error=error.stack;if(activePage){result.failureTrace=await trace(activePage);await activePage.screenshot({path:path.join(output,'failure.png')})}console.error(error);process.exitCode=1}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));for(const context of contexts)await context.close();await browser.close();await new Promise(resolve=>server.close(resolve))}
