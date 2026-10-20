import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreview} from '../tools/preview.mjs';
import {clickAppControl,enterLibraryPaper,expandLibraryCollection,collapseLibraryPaper} from './library-navigation.mjs';
import {installThemeAppearanceReader} from './theme-appearance.mjs';

// Check painted pixels and geometry after genuine gestures. An accepted CSS
// filter name or an app-owned "moving" flag alone cannot pass these checks.
let playwright;
try{playwright=await import('playwright')}
catch{playwright=await import(pathToFileURL(path.join(process.env.LOCALAPPDATA,'ms-playwright-go/1.57.0/package/index.mjs')).href)}
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const webRoot=path.resolve(option('--web-root')||(args.includes('--demo')?'.build/demo/main/assets/web':'app/src/main/assets/web'));
const output=path.resolve(option('--output')||'.build/tahoe/wallpaper-flow');
await mkdir(output,{recursive:true});
const result={passed:false,entrySha256:createHash('sha256').update(await readFile(path.join(webRoot,'app.compat.js'))).digest('hex'),checks:[],routes:[],pageErrors:[],failedImages:[]};
const browser=await playwright.chromium.launch({...(process.env.LISTENLY_BROWSER_CHANNEL?{channel:process.env.LISTENLY_BROWSER_CHANNEL}:(process.platform==='win32'?{channel:'msedge'}:{})),headless:true});
const page=await browser.newPage({viewport:{width:393,height:873},deviceScaleFactor:1,hasTouch:true,reducedMotion:'no-preference'});
await installThemeAppearanceReader(page);
page.on('pageerror',error=>result.pageErrors.push(error.message));
page.on('requestfailed',request=>{if(request.resourceType()==='image')result.failedImages.push({url:request.url(),error:request.failure()?.errorText})});
const server=await startPreview(0,webRoot),url=`http://127.0.0.1:${server.address().port}`;
const click=selector=>clickAppControl(page,selector);
const frames=count=>page.evaluate(count=>new Promise(resolve=>{let n=0;const tick=()=>{if(++n>=count)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)}),count);
const settled=()=>page.waitForFunction(()=>!document.querySelector('[data-theme-transition="true"],.speed-shade.is-closing,.dialog-shade.is-closing'));
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('listenly.state.v1')));
function pass(label,details){result.checks.push({label,...(details?{details}:{})})}
const rect=selector=>page.locator(selector).first().evaluate(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}});

async function pixels(buffer){
 return page.evaluate(async base64=>{const bitmap=await createImageBitmap(await(await fetch(`data:image/png;base64,${base64}`)).blob()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;return {width:canvas.width,height:canvas.height,data:Array.from(bytes)}},buffer.toString('base64'));
}
function difference(a,b){
 assert.equal(a.data.length,b.data.length);let sum=0,changed=0;
 for(let i=0;i<a.data.length;i+=4){const d=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);sum+=d;changed+=d>18}
 return {pixels:a.data.length/4,changed,ratio:changed/(a.data.length/4),meanChannelDifference:sum/(a.data.length/4)/3};
}
async function wallpaper(name){
 await settled();await frames(4);
 const layers=await page.locator('#wallpaper-scene').evaluate(element=>{const r=element.getBoundingClientRect();return {rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},day:Number(getComputedStyle(element.querySelector('.wallpaper-day')).opacity),night:Number(getComputedStyle(element.querySelector('.wallpaper-night')).opacity)}});
 assert.ok(layers.rect.left<=0&&layers.rect.top<=0&&layers.rect.right>=393&&layers.rect.bottom>=873,'one fixed wallpaper covers every visible edge');
 const edge=await pixels(await page.screenshot({path:path.join(output,`${name}-wallpaper-edge.png`),clip:{x:0,y:80,width:7,height:690}}));
 let colorful=0;const colors=new Set();
 for(let i=0;i<edge.data.length;i+=4){const channels=edge.data.slice(i,i+3);colorful+=Math.max(...channels)-Math.min(...channels)>5;colors.add(channels.join(':'))}
 result.routes.push({name,layers,colorful,colors:colors.size});
 // The supplied night photograph is deliberately almost monochrome at the
 // left edge. Spatial image detail, rather than a minimum saturation, proves
 // that its very dark water/sky still paints behind the app.
 assert.ok(colors.size>12,`${name} paints spatial wallpaper detail instead of a flat white/black surface`);
 return edge;
}
async function setTheme(theme){await click('[data-action="nav"][data-route="profile"]');await click(`[data-action="theme"][data-theme="${theme}"]`);await settled()}
async function startProbe(list){
 await page.evaluate(list=>{
  const read=()=>{
   const container=document.querySelector(list),lens=container?.querySelector(':scope > .flow-lens');if(!lens)return null;
   const box=lens.getBoundingClientRect(),parent=container.getBoundingClientRect(),css=getComputedStyle(lens);
   const items=[...container.querySelectorAll('[data-flow-item]')].filter(item=>item.closest('[data-flow-list]')===container).map(item=>{
    const r=item.getBoundingClientRect(),copy=item.querySelector('[data-flow-copy]')||item,s=getComputedStyle(copy.querySelector('h3,.en')||copy),c=copy.getBoundingClientRect();
    return {key:item.dataset.flowKey,center:r.top-parent.top+r.height/2,height:r.height,selected:item.classList.contains('is-selected')||item.classList.contains('active'),weight:Number(s.fontWeight),color:s.color,scale:copy.offsetWidth?c.width/copy.offsetWidth:1,emphasis:Number(getComputedStyle(item).getPropertyValue('--lens-emphasis'))};
   });
   return {time:performance.now(),center:box.top-parent.top+box.height/2,width:box.width,height:box.height,transform:css.transform,opacity:Number(css.opacity),items};
  };
  window.__flowProbe={running:true,read,samples:[]};const sample=()=>{const p=window.__flowProbe;if(!p.running)return;const value=p.read();if(value)p.samples.push(value);requestAnimationFrame(sample)};sample();
 },list);
}
async function endProbe(){return page.evaluate(()=>{window.__flowProbe.running=false;return window.__flowProbe.samples})}
async function waitFlow(list){
 await page.waitForFunction(list=>{const container=document.querySelector(list),item=[...(container?.querySelectorAll('[data-flow-item].is-selected,[data-flow-item].active')||[])].find(item=>item.closest('[data-flow-list]')===container),lens=container?.querySelector(':scope > .flow-lens');if(!item||!lens)return false;const a=item.getBoundingClientRect(),b=lens.getBoundingClientRect();return Math.abs(a.top+a.height/2-b.top-b.height/2)<.5&&Number(getComputedStyle(lens).opacity)>.98},list);await frames(14);
}
function verifyTravel(samples,label){
 result.latestMotion={label,samples};
 const first=samples[0],last=samples.at(-1),distance=last.center-first.center;
 assert.ok(Math.abs(distance)>15,`${label} truly moves to a different row`);
 const moving=samples.filter(sample=>Math.abs(sample.center-first.center)>.4&&Math.abs(sample.center-last.center)>.4);
 assert.ok(moving.length>=4,`${label} paints intermediate positions`);
 const finish=samples.find(sample=>sample.time>first.time&&Math.abs(sample.center-last.center)<.4)||last,duration=finish.time-first.time;
 const nonlinearity=Math.max(...moving.map(sample=>Math.abs((sample.center-first.center)/distance-(sample.time-first.time)/duration)));
 assert.ok(nonlinearity>.045,`${label} follows a spring instead of constant-velocity travel`);
 const neutralHeight=last.height,nearRest=samples.filter(sample=>sample!==last&&Math.abs(sample.center-last.center)<2.5);
 const strain=Math.max(...samples.map(sample=>Math.abs(sample.height-neutralHeight)));
 assert.ok(strain>.25,`${label} paints viscous shape deformation`);
 assert.ok(nearRest.some(sample=>Math.abs(sample.height-neutralHeight)>.08),`${label} releases its shape after its position nears the destination`);
 const selected=last.items.find(item=>item.selected),others=last.items.filter(item=>!item.selected);
 assert.ok(selected&&selected.scale>1.012,`${label} magnifies the selected text`);
 assert.ok(selected.weight>=500,`${label} strengthens the selected text weight`);
 assert.ok(!others.length||selected.weight>Math.min(...others.map(item=>item.weight)),`${label} transfers emphasis to its new selected row`);
 const incoming=samples.map(sample=>sample.items.find(item=>item.key===selected.key)).filter(Boolean);
 assert.ok(incoming.filter(item=>item.weight>402&&item.weight<575).length>=3,`${label} transfers font weight continuously as the lens approaches`);
 assert.ok(new Set(incoming.map(item=>item.color)).size>=4,`${label} transfers text contrast progressively with the lens`);
 return {distance,duration,nonlinearity,strain,samples};
}
async function transmission(selector,name,triangle=false){
 await frames(35);
 const geometry=await page.locator(selector).first().evaluate((element,triangle)=>{
  const parent=element.parentElement;window.__surfaceProbe={parent,style:parent.getAttribute('style')};parent.style.background='#164bde';
  const r=element.getBoundingClientRect();return triangle?{x:Math.floor(r.left+r.width/2-1),y:Math.floor(r.top+r.height/2-1),width:3,height:3}:{x:Math.floor(r.left+6),y:Math.floor(r.top+6),width:Math.max(1,Math.floor(r.width-12)),height:Math.max(1,Math.floor(r.height-12))};
 },triangle);
 await frames(5);const blue=await pixels(await page.screenshot({path:path.join(output,`${name}-blue.png`),clip:geometry}));
 await page.evaluate(()=>window.__surfaceProbe.parent.style.background='#e54d16');await frames(5);const orange=await pixels(await page.screenshot({path:path.join(output,`${name}-orange.png`),clip:geometry}));
 const actual=difference(blue,orange);
 result.latestTransmission={name,actual,geometry};
 await page.evaluate(()=>{const p=window.__surfaceProbe;p.style===null?p.parent.removeAttribute('style'):p.parent.setAttribute('style',p.style);delete window.__surfaceProbe});
 assert.ok(actual.meanChannelDifference>8,`${name} actually transmits the background through its visible material: ${JSON.stringify(actual)}`);
 return actual;
}
async function textContrast(selector,name){
 const text=page.locator(selector).first();await text.scrollIntoViewIfNeeded();await frames(6);
 const target=await text.evaluate(element=>{
  const r=element.getBoundingClientRect(),parent=element.closest('.sentence'),canvas=document.createElement('canvas'),context=canvas.getContext('2d');canvas.width=canvas.height=1;context.fillStyle=getComputedStyle(element).color;context.fillRect(0,0,1,1);const color=Array.from(context.getImageData(0,0,1,1).data);color[3]/=255;
  const hidden=[element,...(parent?parent.querySelectorAll('.timestamp'):[])];window.__contrastProbe=hidden.map(node=>({node,style:node.getAttribute('style')}));hidden.forEach(node=>node.style.opacity='0');
  const left=Math.max(0,Math.floor(r.left)),top=Math.max(0,Math.floor(r.top));
  return {color,clip:{x:left,y:top,width:Math.min(innerWidth,Math.ceil(r.right))-left,height:Math.min(innerHeight,Math.ceil(r.bottom))-top}};
 });
 await frames(3);const background=await pixels(await page.screenshot({path:path.join(output,`${name}-text-background.png`),clip:target.clip}));
 await page.evaluate(()=>{window.__contrastProbe.forEach(({node,style})=>style===null?node.removeAttribute('style'):node.setAttribute('style',style));delete window.__contrastProbe});
 const light=rgb=>rgb.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0),ratios=[];
 for(let i=0;i<background.data.length;i+=4){const base=background.data.slice(i,i+3),alpha=target.color[3]??1,ink=target.color.slice(0,3).map((n,c)=>n*alpha+base[c]*(1-alpha)),a=light(ink),b=light(base);ratios.push((Math.max(a,b)+.05)/(Math.min(a,b)+.05))}
 ratios.sort((a,b)=>a-b);const contrast={color:target.color,minimum:ratios[0],fifthPercentile:ratios[Math.floor(ratios.length*.05)],median:ratios[Math.floor(ratios.length/2)]};
 result.latestContrast={name,...contrast};
 assert.ok(contrast.fifthPercentile>=4.5,`${name} stays readable against the actual wallpaper/lens pixels: ${JSON.stringify(contrast)}`);return contrast;
}
async function refraction(list,name){
 await frames(40);
 const optical=await page.locator(`${list} > .flow-lens`).evaluate(lens=>{
  const parent=lens.parentElement,r=lens.getBoundingClientRect(),css=getComputedStyle(lens),filter=css.backdropFilter||css.webkitBackdropFilter;
  window.__refractionProbe={lens,parent,lensStyle:lens.getAttribute('style'),parentStyle:parent.getAttribute('style'),filter};parent.style.background='repeating-linear-gradient(90deg,#153de8 0px,#153de8 4px,#fff 4px,#fff 8px,#f84a19 8px,#f84a19 12px,#111 12px,#111 16px)';
  return {filter,without:filter.replace(/url\([^)]*\)\s*/g,'').trim()||'none',clip:{x:Math.floor(r.left),y:Math.floor(r.top),width:Math.ceil(r.width),height:Math.ceil(r.height)}};
 });
 assert.notEqual(optical.filter,optical.without,'the moving row lens contains refraction');await frames(5);const natural=await pixels(await page.screenshot({path:path.join(output,`${name}-natural.png`),clip:optical.clip}));
 const paint=async filter=>{await page.evaluate(filter=>{const l=window.__refractionProbe.lens;l.style.setProperty('backdrop-filter',filter);l.style.setProperty('-webkit-backdrop-filter',filter);l.style.opacity='.999'},filter);await frames(2);await page.evaluate(()=>window.__refractionProbe.lens.style.opacity='1');await frames(5);return pixels(await page.screenshot({clip:optical.clip}))};
 const forced=await paint(optical.filter),plain=await paint(optical.without),actual=difference(forced,plain),same=difference(natural,forced);
 await page.evaluate(()=>{const p=window.__refractionProbe;for(const [node,style] of [[p.lens,p.lensStyle],[p.parent,p.parentStyle]])style===null?node.removeAttribute('style'):node.setAttribute('style',style);delete window.__refractionProbe});
 assert.equal(same.changed,0,'forcing a compositor refresh does not itself alter the naturally rendered lens');assert.ok(actual.ratio>.005&&actual.meanChannelDifference>.25,`${name} bends actual background pixels: ${JSON.stringify(actual)}`);return {...optical,actual,same};
}
async function glyphVisibility(selector,name){
 const glyph=page.locator(selector).first(),box=await glyph.boundingBox(),clip={x:Math.floor(box.x),y:Math.floor(box.y),width:Math.ceil(box.width),height:Math.ceil(box.height)};await frames(5);
 const visible=await pixels(await page.screenshot({path:path.join(output,`${name}-visible.png`),clip}));const style=await glyph.getAttribute('style');await glyph.evaluate(element=>element.style.visibility='hidden');await frames(5);const hidden=await pixels(await page.screenshot({path:path.join(output,`${name}-hidden.png`),clip}));await glyph.evaluate((element,style)=>style===null?element.removeAttribute('style'):element.setAttribute('style',style),style);const actual=difference(visible,hidden);result.latestGlyph={name,actual};assert.ok(actual.changed>10&&actual.ratio>.025&&actual.meanChannelDifference>.5,`${name} paints a recognizable translucent symbol instead of an invisible mask: ${JSON.stringify(actual)}`);return actual;
}
async function makeFixture(){
 const folder=path.join(output,'fixture','wallpaper-original');await mkdir(folder,{recursive:true});
 const original=JSON.parse(await readFile(path.join(webRoot,'demo.json'),'utf8'));
 await copyFile(path.join(webRoot,original.audio),path.join(folder,'paper.wav'));
 const articles=original.articles.map((article,index)=>{const {audio,...chapter}=article;return {...chapter,id:index===0?'one':'two',title:`第${index+1}篇`,transcript:article.transcript.map((row,sentence)=>({...row,en:`${sentence+1}. ${row.en}`,timed:true}))}});
 const paper={...original,id:'wallpaper-original',title:'透镜交互验证',year:2004,audio:'paper.wav',articles};
 await writeFile(path.join(folder,'paper.json'),JSON.stringify(paper));return {folder,paper};
}

try{
 await page.goto(url);await page.locator('.home-playback').waitFor();
 const day=await wallpaper('home-day');
 assert.doesNotMatch(await page.locator('#app').innerText(),/\d+\s*(?:篇|套)(?:\s|$)/,'home omits decorative material counts');
 await click('[data-action="nav"][data-route="library"]');const libraryDay=await wallpaper('library-day');assert.ok(difference(day,libraryDay).meanChannelDifference<.5,'routing keeps the same fixed wallpaper position');
 await expandLibraryCollection(page,'original');
 const fixture=await makeFixture();await page.locator('#folder-input').setInputFiles(fixture.folder);await page.locator('[data-action="select-paper"][data-paper="wallpaper-original"]').waitFor();if(await page.locator('.dialog-shade:not(.is-closing)').count())await click('[data-action="close-dialog"]');
 assert.equal(await page.locator('.selection-indicator,.paper-select svg rect').count(),0,'suite selection has no duplicate checkbox');
 assert.doesNotMatch(await page.locator('#library-list').innerText(),/\d+\s*(?:篇|套)(?:\s|$)/,'library omits decorative article/suite counts');
 const paperList=await page.locator('[data-flow-list="library:original"]').evaluate(element=>{const s=getComputedStyle(element);return {radius:s.borderTopLeftRadius,border:s.borderTopWidth,background:s.backgroundColor}});assert.equal(parseFloat(paperList.radius),0,'paper choices are divided rows, without one large rounded outside box');
 const homeBeforePreview=await saved();await enterLibraryPaper(page,'wallpaper-original');assert.equal((await saved()).selectedPaper,homeBeforePreview.selectedPaper);assert.deepEqual((await saved()).homeFocus,homeBeforePreview.homeFocus,'the preview arrow does not select a suite');await wallpaper('library-preview-day');await collapseLibraryPaper(page,'wallpaper-original');await frames(25);
 await startProbe('[data-flow-list="library:original"]');await click('[data-action="select-paper"][data-paper="wallpaper-original"]');await waitFlow('[data-flow-list="library:original"]');const libraryMotion=verifyTravel(await endProbe(),'suite lens');assert.equal((await saved()).selectedPaper,'wallpaper-original');pass('suite title selects through one moving lens while its arrow only previews',{paperList,libraryMotion});

 await click('[data-action="nav"][data-route="home"]');
 const originalRows=await page.locator('.home-paper-row').evaluateAll(rows=>rows.map(row=>row.dataset.article));
 await click('.home-paper-row [data-action="home-play"][data-article="one"]');await page.waitForFunction(()=>{const a=document.querySelector('#audio'),s=JSON.parse(localStorage.getItem('listenly.state.v1'));return !a.paused&&a.currentTime>.08&&s.homeFocus?.paper==='wallpaper-original'&&s.homeFocus.article==='one'});await click('.focus-play');await waitFlow('[data-flow-list^="home:"]');
 const triangleSelector='.home-paper-row [data-action="home-play"][data-article="two"] .glass-symbol-play',glyph=await glyphVisibility(triangleSelector,'play-triangle'),triangle=await transmission(triangleSelector,'play-triangle',true);
 await startProbe('[data-flow-list^="home:"]');await click('.home-paper-row [data-action="home-play"][data-article="two"]');await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('.focus-play').dataset.article==='two');await waitFlow('[data-flow-list^="home:"]');const homeMotion=verifyTravel(await endProbe(),'home article lens');await click('.focus-play');
 assert.deepEqual(await page.locator('.home-paper-row').evaluateAll(rows=>rows.map(row=>row.dataset.article)),originalRows,'playing an article retains its original list position');const optical=await refraction('[data-flow-list^="home:"]','home-row-refraction');pass('home selection moves and transfers optical type emphasis without removing list rows',{homeMotion,glyph,triangle,optical});

 await click('.focus-open');assert.equal(await page.locator('.practice-header [data-action="nav"][data-route="library"]').count(),0,'reader header keeps the bookmark without the library shortcut');assert.equal(await page.locator('.practice-header [data-action="bookmark"]').count(),1);
 await wallpaper('reader-hidden-day');await click('[data-action="display"][data-display="original"]');await page.waitForFunction(()=>document.querySelector('#audio').readyState>=1);await waitFlow('[data-flow-list^="sentences:"]');
 await startProbe('[data-flow-list^="sentences:"]');const slider=await rect('#seek'),position=Number(await page.locator('#seek').inputValue()),duration=Number(await page.locator('#seek').getAttribute('max')),chapter=fixture.paper.articles[1],target=chapter.start+(chapter.end-chapter.start)*.74;await page.mouse.move(slider.left+9+(slider.width-18)*position/duration,slider.cy);await page.mouse.down();await page.mouse.move(slider.left+9+(slider.width-18)*target/duration,slider.cy,{steps:8});await page.mouse.up();await waitFlow('[data-flow-list^="sentences:"]');const sentenceMotion=verifyTravel(await endProbe(),'sentence lens');
 const selectedSentence=await page.locator('.sentence.active').evaluate(element=>({index:Number(element.dataset.index),start:element.querySelector('.timestamp').textContent}));assert.ok(selectedSentence.index>=3,'the actual range drag advances sentence selection with the audio position');
 await page.setViewportSize({width:320,height:740});await waitFlow('[data-flow-list^="sentences:"]');
 const panel=await page.locator('.main-panel').evaluate(element=>{element.scrollTop=element.scrollHeight;const s=getComputedStyle(element),bar=getComputedStyle(element,'::-webkit-scrollbar');return {scroll:element.scrollTop,range:element.scrollHeight-element.clientHeight,barDisplay:bar.display,barWidth:bar.width,gutter:element.offsetWidth-element.clientWidth-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth)}});assert.ok(panel.range>0&&panel.scroll>0,'removing the visual scrollbar preserves actual article scrolling');assert.ok(panel.barDisplay==='none'||parseFloat(panel.barWidth)===0,'reader does not paint a scrollbar');assert.ok(panel.gutter<1,'the hidden scrollbar reserves no reading width');const dayContrast={selected:await textContrast('.sentence.active .en','selected-day'),ordinary:await textContrast('.sentence:not(.active) .en','ordinary-day')};await page.screenshot({path:path.join(output,'reader-selected-day.png')});pass('timeline scrubbing transfers the viscous sentence lens and optical text emphasis; scrolling stays available',{sentenceMotion,selectedSentence,panel,dayContrast});
 await page.setViewportSize({width:393,height:873});await frames(8);

 await click('[data-action="mode"][data-mode="exam"]');await wallpaper('quiz-day');
 for(const [index,question] of fixture.paper.articles[1].questions.entries()){const toggle=page.locator(`[data-action="toggle-question"][data-index="${index}"]`);if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await click(`.quiz-question[data-question-index="${index}"] [data-action="answer"][data-option="${question.answer}"]`)}
 assert.equal(await page.locator('[data-action="submit-article"]').isDisabled(),false,'the real whole-article submit is enabled');const submit=await transmission('[data-action="submit-article"]','enabled-submit');await page.screenshot({path:path.join(output,'quiz-ready-day.png')});await click('[data-action="submit-article"]');await page.locator('.result-card').waitFor();await wallpaper('result-day');pass('the enabled submit surface remains frosted and visibly transmits its surroundings, including the completed result page',{submit});
 await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="profile"]');await wallpaper('profile-day');assert.equal(await page.locator('.settings-card h2').filter({hasText:/^设置$/}).count(),0);const recordCard=await page.locator('[data-action="export"]').evaluate(button=>{const card=button.closest('.settings-card'),r=card.getBoundingClientRect();return {text:card.innerText,height:r.height}});assert.doesNotMatch(recordCard.text,/设置|播放速度|资料导入/);assert.ok(recordCard.height<=80,'the learning-record row is compact');

 await page.evaluate(()=>{window.__wallpaperFrames=[];window.__wallpaperSampling=true;const sample=()=>{if(!window.__wallpaperSampling)return;const appearance=window.__themeAppearanceRead();window.__wallpaperFrames.push({time:appearance.time,night:appearance.night,rawNight:appearance.rawNight,pseudoOpacity:appearance.pseudoOpacity,renderer:appearance.renderer});requestAnimationFrame(sample)};sample()});await click('[data-action="theme"][data-theme="dark"]');await settled();await frames(4);const fade=await page.evaluate(()=>{window.__wallpaperSampling=false;return window.__wallpaperFrames});
 const fadeSteps=fade.slice(1).map((frame,index)=>({elapsedMs:frame.time-fade[index].time,change:frame.night-fade[index].night}));result.appearanceFade={fade,steps:fadeSteps};
 assert.ok(fade.filter(frame=>frame.night>.01&&frame.night<.99).length>=8,'wallpapers cross-fade through many actual composited opacities');
 // A skipped presentation frame spans more of a valid CSS transition. Check
 // change against its measured elapsed time, not a hardware-specific frame cap.
 assert.ok(fadeSteps.every(step=>step.change>=-.002),'one appearance change never flashes the wallpaper backwards');assert.ok(fadeSteps.every(step=>Math.abs(step.change)<.02+step.elapsedMs*.015),'appearance has no abrupt opacity jump within a presented frame interval');
 const night=await wallpaper('profile-night');assert.ok(difference(day,night).meanChannelDifference>5,'the night wallpaper paints distinctly different actual pixels');
 await click('[data-action="nav"][data-route="home"]');await wallpaper('home-night');await click('[data-action="nav"][data-route="library"]');await wallpaper('library-night');await expandLibraryCollection(page,'original');await enterLibraryPaper(page,'wallpaper-original');await click('[data-action="open"][data-paper="wallpaper-original"][data-article="one"]');await click('[data-action="display"][data-display="original"]');await wallpaper('reader-night');const nightContrast={selected:await textContrast('.sentence.active .en','selected-night'),ordinary:await textContrast('.sentence:not(.active) .en','ordinary-night')};await click('[data-action="mode"][data-mode="exam"]');await wallpaper('quiz-night');pass('all pages share the day/night wallpaper and a gradual cross-fade',{recordCard,fade,nightContrast});

 await page.emulateMedia({reducedMotion:'reduce'});await click('[data-action="nav"][data-route="home"]');await click('[data-action="nav"][data-route="profile"]');await click('[data-action="theme"][data-theme="light"]');assert.equal(await page.locator('#wallpaper-scene .wallpaper-night').evaluate(element=>Number(getComputedStyle(element).opacity)),0,'reduced motion changes the wallpaper without a hidden animation tail');await click('[data-action="import"]');await page.locator('.dialog').waitFor();await page.screenshot({path:path.join(output,'import-day.png')});assert.equal(await page.locator('.dialog .format-details').count(),0);await click('[data-action="close-dialog"]');pass('reduced motion and import retain the shared wallpaper without residual overlays');
 assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.failedImages,[]);result.passed=true;console.log(JSON.stringify({passed:true,checks:result.checks.length,entrySha256:result.entrySha256,output}));
}catch(error){result.failure={message:error.message,stack:error.stack};result.failureFlow=await page.locator('[data-flow-list]').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect(),lens=element.querySelector('.flow-lens'),b=lens?.getBoundingClientRect(),s=lens?getComputedStyle(lens):null;return {key:element.dataset.flowList,top:r.top,height:r.height,lens:b?{top:b.top,height:b.height,width:b.width,opacity:s.opacity,transform:s.transform}:null,selected:[...element.querySelectorAll('[data-flow-item].is-selected,[data-flow-item].active')].map(item=>{const a=item.getBoundingClientRect();return {key:item.dataset.flowKey,top:a.top,height:a.height}})}})).catch(()=>[]);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
