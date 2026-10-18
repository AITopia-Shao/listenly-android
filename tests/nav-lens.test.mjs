import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';

// Read the rendered geometry and screenshot pixels. No app-reported motion flags
// or animation implementation details decide whether these checks pass.
let playwright;
try{playwright=await import('playwright')}
catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(option('--web-root')||(args.includes('--demo')?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const output=path.resolve(option('--output')||'.build/nav-lens');
await mkdir(output,{recursive:true});
const result={entrySha256:createHash('sha256').update(await readFile(path.join(webRoot,'app.compat.js'))).digest('hex'),checks:[],pageErrors:[],passed:false};
const browser=await playwright.chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const page=await browser.newPage({viewport:{width:393,height:873},deviceScaleFactor:1,reducedMotion:'no-preference'});
page.on('pageerror',error=>result.pageErrors.push(error.message));
const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`;
const navButton=route=>`.bottom-nav [data-action="nav"][data-route="${route}"]`;
const click=async selector=>{await page.locator(selector).first().click();if(/set-filter|close-dialog/.test(selector))await page.waitForFunction(()=>!document.querySelector('.speed-shade.is-closing,.dialog-shade.is-closing'))};
function pass(label,details){result.checks.push({label,...(details?{details}:{})})}
const range=values=>Math.max(...values)-Math.min(...values);
function frameAssertAligned(frame,route,tolerance=.8){
 assert.equal(frame.route,route,'the destination route is current');
 assert.equal(frame.currentCount,1,'only one navigation destination is current');
 assert.ok(Math.abs(frame.lens.cx-frame.targets[route].cx)<tolerance,`lens aligns with ${route}: ${frame.lens.cx} / ${frame.targets[route].cx}`);
 assert.ok(Math.abs(frame.lens.cy-frame.targets[route].cy)<tolerance,'lens and button share their vertical center');
 assert.ok(Math.abs(frame.lens.width-(frame.targets[route].width-8))<tolerance,'settled lens has one button width less its inset');
 assert.ok(Math.abs(frame.lens.height-44)<tolerance,'settled lens returns to its neutral height');
}
async function installProbe(){await page.evaluate(()=>{
 const geometry=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}};
 window.__navLensFrame=()=>{
  const nav=document.querySelector('.bottom-nav'),lens=nav?.querySelector('.nav-lens');
  if(!nav||!lens)return null;
  const style=getComputedStyle(lens),targets={};
  for(const b of nav.querySelectorAll('.nav-item')){const copy=b.querySelector('.nav-label'),base=copy?.querySelector('.lens-copy-base'),emphasis=copy?.querySelector('.lens-copy-emphasis');targets[b.dataset.route]={...geometry(b),label:base&&emphasis?{text:copy.innerText,baseWeight:Number(getComputedStyle(base).fontWeight),strongWeight:Number(getComputedStyle(emphasis).fontWeight),baseOpacity:Number(getComputedStyle(base).opacity),strongOpacity:Number(getComputedStyle(emphasis).opacity),hidden:emphasis.getAttribute('aria-hidden'),duplicateText:emphasis.textContent,paintedText:getComputedStyle(emphasis,'::before').content}:null}}
  return {time:performance.now(),lens:geometry(lens),nav:geometry(nav),targets,route:nav.querySelector('[aria-current="page"]')?.dataset.route,currentCount:nav.querySelectorAll('[aria-current="page"]').length,transform:style.transform,backdropFilter:style.backdropFilter||style.webkitBackdropFilter,pointerEvents:style.pointerEvents};
 };
 window.__navLensClicks=[];
 document.addEventListener('click',event=>{
  const button=event.target.closest('.bottom-nav .nav-item');if(!button)return;
  const record={route:button.dataset.route,trusted:event.isTrusted,before:window.__navLensFrame()};
  window.__navLensClicks.push(record);
 },true);
 // A native event may run microtasks between capture and target listeners.
 // Observe the bubble after #app's delegated handler has changed the route.
 document.addEventListener('click',event=>{if(!event.target.closest('.bottom-nav .nav-item'))return;const record=window.__navLensClicks.at(-1);record.after=window.__navLensFrame();record.focus=document.activeElement?.dataset.route;record.views={home:!!document.querySelector('.focus-card'),library:!!document.querySelector('#library-list'),profile:!!document.querySelector('.statistics')}});
 window.__navLensFrames=[];
 window.__navLensCapture=false;
 const sample=()=>{if(window.__navLensCapture)window.__navLensFrames.push(window.__navLensFrame());requestAnimationFrame(sample)};
 requestAnimationFrame(sample);
})}
const frame=()=>page.evaluate(()=>window.__navLensFrame());
async function captureStart(){await page.evaluate(()=>{window.__navLensFrames=[];window.__navLensCapture=true})}
async function captureEnd(){return page.evaluate(()=>{window.__navLensCapture=false;return window.__navLensFrames.filter(Boolean)})}
async function frames(count=12){return page.evaluate(count=>new Promise(resolve=>{const values=[];const sample=()=>{values.push(window.__navLensFrame());if(values.length>=count)resolve(values);else requestAnimationFrame(sample)};requestAnimationFrame(sample)}),count)}
async function settled(route){
 await page.waitForFunction(route=>{const f=window.__navLensFrame();return f&&f.route===route&&Math.abs(f.lens.cx-f.targets[route].cx)<.4&&Math.abs(f.lens.width-(f.targets[route].width-8))<.4&&Math.abs(f.lens.height-44)<.4},route);
 const values=await frames(8);assert.ok(range(values.map(f=>f.lens.cx))<.7,'settled lens stays at its destination');return values.at(-1);
}
async function verifyContinuity(record){
 assert.equal(record.trusted,true,'a real pointer gesture triggered the route');
 assert.equal(record.after.route,record.route,'aria-current changes in the click turn');
 assert.equal(record.after.currentCount,1,'current destination remains unique during movement');
 assert.equal(record.views[record.route],true,'page content and navigation destination change together');
 assert.equal(record.focus,record.route,'stable navigation preserves the clicked button focus');
 assert.ok(Math.abs(record.before.lens.cx-record.after.lens.cx)<1,'retargeting cannot teleport the lens to a tab');
 assert.ok(Math.abs(record.before.lens.width-record.after.lens.width)<1,'retargeting cannot reset the lens deformation');
}
try{
 await page.goto(url);await page.locator('.focus-card').waitFor();await page.locator('.nav-lens').waitFor();await installProbe();
 const initial=await settled('home');frameAssertAligned(initial,'home');
 await page.evaluate(()=>{window.__navLensNodes={nav:document.querySelector('.bottom-nav'),lens:document.querySelector('.nav-lens'),buttons:[...document.querySelectorAll('.bottom-nav .nav-item')]}});
 const hitTargets=await page.locator('.bottom-nav .nav-item').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {route:b.dataset.route,width:r.width,height:r.height,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.nav-item')===b}}));
 assert.equal(initial.pointerEvents,'none','lens never intercepts navigation gestures');
 assert.ok(hitTargets.every(b=>b.width>=44&&b.height>=44&&b.hit),'every destination has an unobstructed 44px target');
 for(const [route,text] of Object.entries({home:'听力',library:'资料库',profile:'我的'})){
  const label=initial.targets[route].label;assert.ok(label,'each navigation destination has visible base and emphasis text layers');assert.equal(label.text,text,'visual emphasis does not duplicate the text content');assert.equal(label.baseWeight,400);assert.equal(label.strongWeight,600);assert.equal(label.hidden,'true');assert.equal(label.duplicateText,'');assert.ok(label.paintedText.includes(text),'the strong layer generates the same visible label');assert.equal(await page.getByRole('button',{name:text,exact:true}).count(),1,'one complete accessible destination name is exposed');assert.ok(route==='home'?label.strongOpacity>.99&&label.baseOpacity<.01:label.strongOpacity<.15&&label.baseOpacity>.85,'the settled lens gives its selected destination much stronger emphasis than its nearby neighbors');
 }
 pass('one accessible current destination and unobstructed touch targets',{initial,hitTargets});

 await captureStart();await click(navButton('profile'));const destination=await settled('profile');const motion=await captureEnd();frameAssertAligned(destination,'profile');
 const record=await page.evaluate(()=>window.__navLensClicks.at(-1));await verifyContinuity(record);
 const start=record.before.lens.cx,end=destination.lens.cx,distance=end-start;
 const changing=motion.filter(f=>Math.abs(f.lens.cx-start)>.35&&Math.abs(f.lens.cx-end)>.35);
 assert.ok(changing.length>=5,'multiple genuinely intermediate lens positions are painted');
 const active=[record.before,...changing,destination],first=active[0],last=active.at(-1),duration=last.time-first.time;
 // Trim stationary tails before comparing with a constant-velocity translation.
 const movingEnd=motion.findIndex((f,i)=>i>0&&Math.abs(f.lens.cx-end)<.35&&motion.slice(i).every(v=>Math.abs(v.lens.cx-end)<.6));
 const motionLast=movingEnd>=0?motion[movingEnd]:last;
 const nonlinearity=Math.max(...changing.map(f=>Math.abs((f.lens.cx-start)/distance-(f.time-first.time)/(motionLast.time-first.time))));
 assert.ok(nonlinearity>.065,`movement departs from constant velocity (${nonlinearity})`);
 assert.ok(Math.max(...motion.map(f=>f.lens.width))-initial.lens.width>2,'lens visibly stretches along its travel');
 assert.ok(initial.lens.height-Math.min(...motion.map(f=>f.lens.height))>.7,'lens compresses vertically during travel');
 assert.ok(duration<1800,'lens settles promptly without an endless motion tail');
 result.crossTabFrames=motion;const labels=motion.map(frame=>frame.targets.profile.label);assert.ok(labels.filter(label=>label.strongOpacity>.02&&label.strongOpacity<.98).length>=2,'the incoming label paints multiple significant intermediate bold-layer opacities');assert.ok(new Set(labels.filter(label=>label.strongOpacity>.001&&label.strongOpacity<.999).map(label=>label.strongOpacity.toFixed(4))).size>=4,'the optical emphasis passes through a sequence of distinct visible layer blends');assert.ok(labels.every(label=>label.baseWeight===400&&label.strongWeight===600),'optical emphasis keeps both font metrics fixed during travel');assert.ok(labels.every(label=>Math.abs(label.baseOpacity+label.strongOpacity-1)<.01),'normal and bold label layers cross-fade together');assert.ok(destination.targets.profile.label.strongOpacity>.99&&destination.targets.home.label.strongOpacity<.01,'emphasis follows the moving lens to its new destination');
 assert.ok(await page.evaluate(()=>{const n=window.__navLensNodes;return n.nav===document.querySelector('.bottom-nav')&&n.lens===document.querySelector('.nav-lens')&&n.buttons.every((b,i)=>b===document.querySelectorAll('.bottom-nav .nav-item')[i])}),'navigation, lens and button nodes survive the content route change');
 result.crossTabFrames=motion;pass('cross-tab movement has intermediate frames, nonlinear travel and elastic deformation',{duration,nonlinearity,record});

 await click(navButton('home'));await settled('home');await captureStart();await click(navButton('profile'));
 await page.waitForFunction(()=>{const f=window.__navLensFrame(),a=f.targets.home.cx,b=f.targets.profile.cx;return (f.lens.cx-a)/(b-a)>.18&&(f.lens.cx-a)/(b-a)<.78});
 await click(navButton('home'));const reversed=await page.evaluate(()=>window.__navLensClicks.at(-1));await verifyContinuity(reversed);const reversedDestination=await settled('home');frameAssertAligned(reversedDestination,'home');const reverseFrames=await captureEnd();
 assert.ok(reversed.before.lens.cx-initial.lens.cx>8,'reversal occurs during actual travel');
 assert.ok(reverseFrames.some(f=>f.time>reversed.after.time&&f.lens.cx<reversed.before.lens.cx-5),'the moving lens reverses toward its new destination');
 result.reverseFrames=reverseFrames;pass('rapid retargeting continues from the current lens geometry without a jump',{record:reversed});

 await click(navButton('home'));const repeated=await frames(16);assert.ok(range(repeated.map(f=>f.lens.cx))<.2&&range(repeated.map(f=>f.lens.width))<.2&&range(repeated.map(f=>f.lens.height))<.2,'selecting the current destination cannot replay the elastic effect');
 pass('reselecting the current destination keeps the settled lens still');

 await click(navButton('profile'));await settled('profile');await click('[data-action="theme"][data-theme="dark"]');const themed=await frames(16);frameAssertAligned(themed.at(-1),'profile');assert.ok(range(themed.map(f=>f.lens.cx))<.2&&range(themed.map(f=>f.lens.width))<.2,'theme changes cannot restart or move navigation');
 assert.ok(await page.evaluate(()=>window.__navLensNodes.lens===document.querySelector('.nav-lens')),'theme switch preserves the lens node');
 await page.screenshot({path:path.join(output,'profile-dark.png')});await click('[data-action="theme"][data-theme="light"]');await frames(3);
 pass('theme changes preserve the stable lens and its destination');

 // Theme interpolation and player capsule feedback are covered by glass-controls.test.mjs.
 for(const viewport of [{width:320,height:740},{width:873,height:393},{width:393,height:873}]){
  await page.setViewportSize(viewport);const resized=await settled('profile');frameAssertAligned(resized,'profile');
  assert.ok(resized.nav.left>=0&&resized.nav.right<=viewport.width+.5&&resized.nav.bottom<=viewport.height+.5,'navigation remains within the viewport');
  assert.ok(Object.values(resized.targets).every(t=>t.width>=44&&t.height>=44),'resized navigation maintains usable targets');
 }
 pass('narrow and landscape reflow keep the lens aligned and targets on screen');

 // Place real high-frequency background content behind the real lens, then
 // remove only its SVG refraction filter. Pixel differences prove that the
 // browser actually applies refraction rather than merely accepting CSS syntax.
 const optics=await page.evaluate(()=>{
  const nav=document.querySelector('.bottom-nav'),lens=document.querySelector('.nav-lens'),css=getComputedStyle(lens),filter=css.backdropFilter||css.webkitBackdropFilter;
  const without=filter.replace(/url\([^)]*\)\s*/g,'').trim()||'none';
  nav.style.background='repeating-linear-gradient(90deg,#163de8 0px,#163de8 4px,#fff 4px,#fff 8px,#fa4619 8px,#fa4619 12px,#111 12px,#111 16px)';
  const r=lens.getBoundingClientRect();window.__navOptics={nav:nav.style.cssText,lens:lens.style.cssText,filter,without};
  return {filter,without,clip:{x:Math.floor(r.left),y:Math.floor(r.top),width:Math.ceil(r.width),height:Math.ceil(r.height)}};
 });
 assert.notEqual(optics.filter,optics.without,'the real lens has an SVG refraction stage');await frames(3);
 const opticalOn=await page.screenshot({path:path.join(output,'refraction-on.png'),clip:optics.clip});
 await page.evaluate(()=>{const l=document.querySelector('.nav-lens'),f=window.__navOptics.without;l.style.setProperty('backdrop-filter',f);l.style.setProperty('-webkit-backdrop-filter',f)});await frames(3);
 const opticalOff=await page.screenshot({path:path.join(output,'refraction-off.png'),clip:optics.clip});
 const difference=await page.evaluate(async images=>{
  const pixels=async data=>{const bitmap=await createImageBitmap(await(await fetch(`data:image/png;base64,${data}`)).blob()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);return {width:bitmap.width,height:bitmap.height,data:context.getImageData(0,0,bitmap.width,bitmap.height).data}};
  const a=await pixels(images[0]),b=await pixels(images[1]);let sum=0,changed=0,count=0;
  for(let y=3;y<a.height-3;y++)for(let x=3;x<a.width-3;x++){const i=(y*a.width+x)*4,d=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);sum+=d;changed+=d>18?1:0;count++}
  return {width:a.width,height:a.height,pixels:count,changed,ratio:changed/count,meanChannelDifference:sum/(count*3)};
 },[opticalOn.toString('base64'),opticalOff.toString('base64')]);
 assert.ok(difference.ratio>.005&&difference.meanChannelDifference>.25,`actual refracted background differs from its unfiltered counterpart: ${JSON.stringify(difference)}`);
 await page.evaluate(()=>{document.querySelector('.nav-lens').style.cssText=window.__navOptics.lens;document.querySelector('.bottom-nav').style.background=''});await frames(3);
 pass('rendered background pixels demonstrate actual lens refraction',{...optics,difference});

 await click(navButton('home'));await settled('home');await click('.focus-open');assert.equal(await page.locator('.bottom-nav').count(),0,'reader does not retain navigation over its audio dock');assert.equal(await page.locator('.playback-card').count(),1);
 await click('[data-action="nav"][data-route="home"]');await page.locator('.focus-card').waitFor();frameAssertAligned(await settled('home'),'home');
 pass('reader replaces navigation with its audio dock and returns to the correct destination');

 await page.emulateMedia({reducedMotion:'reduce'});await frames(2);await click(navButton('profile'));const reducedRecord=await page.evaluate(()=>window.__navLensClicks.at(-1));frameAssertAligned(reducedRecord.after,'profile');const reduced=await frames(18);
 assert.ok(range(reduced.map(f=>f.lens.cx))<.2&&range(reduced.map(f=>f.lens.width))<.2&&range(reduced.map(f=>f.lens.height))<.2,'reduced motion settles immediately without a hidden spring animation');
 await click(navButton('home'));frameAssertAligned(await frame(),'home');
 pass('reduced motion uses immediate destination alignment with no elastic tail',{record:reducedRecord});
 assert.deepEqual(result.pageErrors,[]);result.passed=true;console.log(JSON.stringify({passed:true,checks:result.checks.length,entrySha256:result.entrySha256,output}));
}catch(error){result.failure={message:error.message,stack:error.stack};result.failureFrame=await page.evaluate(()=>window.__navLensFrame?.()).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
