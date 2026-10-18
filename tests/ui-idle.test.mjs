import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';
import {clickAppControl} from './library-navigation.mjs';

// Deterministic idle-work assertions, rather than machine-dependent FPS gates.
// No RAF sampler runs during the measured window, and the test's read-only
// observer never writes DOM, schedules frames or calls application functions.
let playwright;try{playwright=await import('playwright')}catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(option('--web-root')||(args.includes('--demo')?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const output=path.resolve(option('--output')||'.build/ui-idle');await mkdir(output,{recursive:true});
const result={passed:false,entrySha256:createHash('sha256').update(await readFile(path.join(webRoot,'app.compat.js'))).digest('hex'),checks:[],pageErrors:[]};
const browser=await playwright.chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const context=await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:1,reducedMotion:'no-preference'});
await context.addInitScript(()=>{
 const counters={raf:0,globalQueries:0,sourceObserverCallbacks:0,domWrites:0},raf=requestAnimationFrame.bind(window),NativeObserver=MutationObserver;
 window.requestAnimationFrame=callback=>raf(time=>{counters.raf++;callback(time)});
 for(const prototype of [Document.prototype,Element.prototype]){const original=prototype.querySelectorAll;prototype.querySelectorAll=function(selector){if(this===document||this===document.body||this.id==='app')counters.globalQueries++;return original.call(this,selector)}}
 window.MutationObserver=function(callback){return new NativeObserver(function(records,observer){counters.sourceObserverCallbacks++;callback.call(this,records,observer)})};window.MutationObserver.prototype=NativeObserver.prototype;Object.setPrototypeOf(window.MutationObserver,NativeObserver);
 new NativeObserver(records=>{counters.domWrites+=records.length}).observe(document,{attributes:true,characterData:true,childList:true,subtree:true});
 window.__idleRead=()=>({...counters});
});
const page=await context.newPage();page.on('pageerror',error=>result.pageErrors.push(error.message));const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`,click=selector=>clickAppControl(page,selector);
async function idle(label){
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1600);assert.equal(await page.locator('#audio').evaluate(audio=>audio.paused),true,'idle work is measured with playback paused');
 const before=await page.evaluate(()=>window.__idleRead());await page.waitForTimeout(1700);const after=await page.evaluate(()=>window.__idleRead()),counts=Object.fromEntries(Object.entries(after).map(([key,value])=>[key,value-before[key]]));result.checks.push({label,windowMs:1700,counts});
 assert.equal(counts.raf,0,`${label} leaves no application RAF loop running after motion settles`);assert.equal(counts.globalQueries,0,`${label} performs no idle full-tree synchronization scan`);assert.equal(counts.sourceObserverCallbacks,0,`${label} triggers no idle observer synchronization`);assert.equal(counts.domWrites,0,`${label} rewrites no unchanged DOM while idle`);
}
try{
 await page.goto(url);await page.locator('.focus-card').waitFor();await idle('home');await click('[data-action="nav"][data-route="profile"]');await idle('profile');await click('[data-action="nav"][data-route="library"]');await idle('library');await click('[data-action="nav"][data-route="home"]');await click('.focus-open');await click('[data-action="display"][data-display="bilingual"]');await idle('reader');
 assert.deepEqual(result.pageErrors,[]);result.passed=true;console.log(JSON.stringify({passed:true,checks:result.checks.length,entrySha256:result.entrySha256,output}));
}catch(error){result.failure={message:error.message,stack:error.stack};await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
