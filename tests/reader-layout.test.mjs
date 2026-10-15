import assert from 'node:assert/strict';
import {openLibraryArticle} from './library-navigation.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

// Run against the actual rendered reader, including the Android-injected safe areas.
export async function verifyReaderLayout(page,artifactRoot){
 const results=[];
 const cases=[
  {width:360,height:800,safeTop:0,safeBottom:0},
  {width:393,height:873,safeTop:0,safeBottom:0},
  {width:430,height:932,safeTop:0,safeBottom:0},
  {width:360,height:800,safeTop:36,safeBottom:34},
  {width:393,height:873,safeTop:36,safeBottom:34},
  {width:430,height:932,safeTop:36,safeBottom:34}
 ];
 for(const size of cases){
  await page.setViewportSize({width:size.width,height:size.height});
  await page.evaluate(({safeTop,safeBottom})=>{
   document.documentElement.style.setProperty('--safe-top',`${safeTop}px`);
   document.documentElement.style.setProperty('--safe-bottom',`${safeBottom}px`);
  },size);
  await page.locator('[data-action="mode"][data-mode="intensive"]').click();
  assert.deepEqual(await page.locator('.display-controls [data-action="display"]').evaluateAll(buttons=>buttons.map(button=>button.dataset.display)),['hidden','original','bilingual'],'text display choices follow the reading order: hidden, original, bilingual');
  for(const display of ['original','bilingual']){
   await page.locator(`.display-controls [data-action="display"][data-display="${display}"]`).click();
   await page.locator('.transcript-card').waitFor();
   const measured=await measureReader(page,size,display);
   results.push(measured);
   validateGeometry(measured);
   assert.equal(await page.locator('.sentence .zh').count(),display==='bilingual'?6:0);
   assert.ok(await page.locator('.sentence .en').first().evaluate(element=>parseFloat(getComputedStyle(element).fontSize)>=15),'more text space keeps the English text readable');
   if(display==='bilingual')assert.ok(await page.locator('.sentence .zh').first().evaluate(element=>parseFloat(getComputedStyle(element).fontSize)>=12),'translation text remains readable');
   if(size.width===393){
    const safeLabel=size.safeTop?'-safe':'';
    await page.screenshot({path:path.join(artifactRoot,`reader-${size.width}-${display}${safeLabel}-phone.png`),fullPage:false});
   }
   // The last sentence must remain reachable above the fixed transport controls.
   const last=page.locator('.sentence').last();
   await last.scrollIntoViewIfNeeded();
   const lastBounds=await last.boundingBox();
   const playerBounds=await page.locator('.playback-card').boundingBox();
   assert.ok(lastBounds.y>=size.safeTop-1,'last sentence stays below the top safe area');
   assert.ok(lastBounds.y+lastBounds.height<=playerBounds.y+1,'last sentence is not covered by the player');
   await page.locator('.main-panel,.transcript-card').evaluateAll(elements=>elements.forEach(element=>element.scrollTop=0));
  }
  await page.locator('[data-action="mode"][data-mode="exam"]').click();
  await page.locator('.quiz-card').waitFor();
  assert.equal(await page.locator('.quiz-question').count(),3,'the reader displays every question in the article together');
  assert.equal(await page.locator('.question-dot,[data-action="next-question"],[data-action="submit-answer"]').count(),0,'the article has no per-question pagination');
  const measured=await measureReader(page,size,'exam');
  results.push(measured);
  validateGeometry(measured);
  if(size.width===393){
   const safeLabel=size.safeTop?'-safe':'';
   await page.screenshot({path:path.join(artifactRoot,`reader-${size.width}-exam${safeLabel}-phone.png`),fullPage:false});
  }
 }
 await writeFile(path.join(artifactRoot,'reader-layout-results.json'),JSON.stringify(results,null,2)+'\n');
 await page.setViewportSize({width:430,height:932});
 await page.evaluate(()=>{
  document.documentElement.style.setProperty('--safe-top','0px');
  document.documentElement.style.setProperty('--safe-bottom','0px');
 });
 await page.locator('[data-action="mode"][data-mode="intensive"]').click();
 await page.locator('.display-controls [data-action="display"][data-display="bilingual"]').click();
 return results;
}

async function measureReader(page,size,display){
 const geometry=await page.evaluate(()=>{
  const rect=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
  const main=document.querySelector('.main-panel');
  const card=document.querySelector('.transcript-card,.quiz-card');
  const player=document.querySelector('.playback-card');
  const controls=[...player.querySelectorAll('.player-buttons button')].map(button=>({label:button.getAttribute('aria-label'),rect:rect(button)}));
  return {viewportHeight:innerHeight,viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,main:rect(main),card:rect(card),player:rect(player),playerCount:document.querySelectorAll('.playback-card').length,bottomNavCount:document.querySelectorAll('.bottom-nav').length,controls};
 });
 const visible=Math.min(geometry.main.bottom,geometry.card.bottom,geometry.player.top)-Math.max(geometry.main.top,geometry.card.top,size.safeTop);
 return {...size,display,...geometry,visibleBodyHeight:visible,bodyFraction:visible/(size.height-size.safeTop-size.safeBottom)};
}

function validateGeometry(result){
 const context=`${result.width}×${result.height}, ${result.display}, safe ${result.safeTop}/${result.safeBottom}`;
 assert.equal(result.playerCount,1,`one player: ${context}`);
 assert.equal(result.bottomNavCount,0,`reader replaces the navigation with audio controls: ${context}`);
 assert.ok(result.documentWidth<=result.viewportWidth,`no horizontal overflow: ${context}`);
 assert.ok(result.bodyFraction>=.6,`text/questions occupy at least 60% of usable screen (${Math.round(result.bodyFraction*100)}%): ${context}`);
 assert.ok(result.main.bottom<=result.player.top+1,`reader is not hidden behind the player: ${context}`);
 assert.ok(result.main.top>=result.safeTop,`reader stays below the top safe area: ${context}`);
 assert.ok(result.player.height<=96+result.safeBottom,`compact player is at most 96 px plus bottom safe area: ${context}`);
 assert.ok(Math.abs(result.player.bottom-result.height)<=1,`player reaches the bottom of the viewport: ${context}`);
 assert.ok(result.controls.length>=5,`all transport controls are present: ${context}`);
 for(const control of result.controls){
  assert.ok(control.rect.width>=40&&control.rect.height>=40,`audio control stays easy to tap (${control.label}): ${context}`);
  assert.ok(control.rect.bottom<=result.height-result.safeBottom+1,`audio control stays above the bottom safe area (${control.label}): ${context}`);
 }
}

export async function verifyCompactPlayerControls(page){
 const seek=page.locator('#seek');
 await seek.evaluate(input=>{input.value='12';input.dispatchEvent(new Event('input',{bubbles:true}))});
 assert.ok(Math.abs(await page.locator('#audio').evaluate(audio=>audio.currentTime)-12)<.2,'seekbar controls playback');
 await page.locator('[data-action="seek-relative"][data-seconds="-5"]').click();
 assert.ok(Math.abs(await page.locator('#audio').evaluate(audio=>audio.currentTime)-7)<.2,'rewind button moves five seconds');
 await page.locator('[data-action="seek-relative"][data-seconds="5"]').click();
 assert.ok(Math.abs(await page.locator('#audio').evaluate(audio=>audio.currentTime)-12)<.2,'forward button moves five seconds');
 const rate=await page.locator('#audio').evaluate(audio=>audio.playbackRate);
 await page.locator('[data-action="speed"]').click();
 assert.equal(await page.locator('#audio').evaluate(audio=>audio.playbackRate),rate,'opening the speed menu keeps the actual audio rate');
 const choices=page.locator('.speed-popover [data-action="set-speed"]');
 assert.deepEqual(await choices.evaluateAll(buttons=>buttons.map(button=>Number(button.dataset.speed))),[.75,1,1.25,1.5],'the menu offers the four explicit playback rates');
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.speed-popover').count(),0,'Escape cancels speed adjustment');
 for(const speed of [.75,1,1.25,1.5,rate]){
  await page.locator('[data-action="speed"]').click();
  await page.locator(`.speed-popover [data-action="set-speed"][data-speed="${speed}"]`).click();
  assert.equal(await page.locator('#audio').evaluate(audio=>audio.playbackRate),speed,'explicit speed selection updates the decoded recording');
  assert.equal(await page.locator('[data-action="speed"]').getAttribute('aria-expanded'),'false','selecting a speed dismisses its menu');
  assert.match(await page.locator('[data-action="speed"]').innerText(),new RegExp(`^${String(speed).replace('.','\\.')}\\s*×$`),'the speed control displays the applied value');
 }
 await page.locator('.sentence').first().click();
 assert.equal(await page.locator('#audio').evaluate(audio=>audio.paused),false,'a sentence still starts audio');
 await page.locator('[data-action="play"]').click();
 const loop=page.locator('[data-action="loop"]');
 await loop.click();
 assert.equal(await loop.getAttribute('aria-pressed'),'true','loop button enables sentence repetition');
 await page.locator('#audio').evaluate(audio=>{audio.currentTime=5.3;audio.dispatchEvent(new Event('timeupdate'))});
 assert.ok(await page.locator('#audio').evaluate(audio=>audio.currentTime)<.4,'sentence loop returns to the start at its boundary');
 await loop.click();
 assert.equal(await loop.getAttribute('aria-pressed'),'false','loop can be disabled');
}

export async function verifyReaderScrollAndArticleMenu(page){
 // The compact title menu retains the same-paper article navigation.
 await page.locator('[data-action="article-list"]').click();
 assert.equal(await page.locator('.dialog .article-button').count(),2);
 await page.locator('.dialog [data-action="open"][data-article="library"]').click();
 assert.match(await page.locator('.practice-title').innerText(),/little library/);
 await page.locator('[data-action="article-list"]').click();
 await page.locator('.dialog [data-action="open"][data-article="morning"]').click();
 assert.match(await page.locator('.practice-title').innerText(),/A small change/);

 // Use original, deliberately long content so both text layouts can scroll.
 const transcript=Array.from({length:18},(_,index)=>({start:index,timed:true,en:`Sentence ${index+1}. Reading a long passage should keep the same sentence in view when the translation is shown or hidden. The extra room belongs to the words we are learning.`,zh:`第 ${index+1} 句。切换原文和双语时，长文章应停留在同一句，屏幕空间留给正在阅读的内容。`}));
 const questions=[{id:'long-question',number:1,prompt:'Which answer describes the reading exercise?',options:['A','B','C','D'].map(id=>({id,text:`Option ${id}. ${'This original option is intentionally long to exercise scrolling on a phone. '.repeat(7)}`})),answer:'D'}, {id:'short-question',number:2,prompt:'Choose the next answer.',options:['A','B','C','D'].map(id=>({id,text:`Answer ${id}`})),answer:'A'}];
 await page.evaluate(({transcript,questions})=>window.dispatchEvent(new CustomEvent('listenly-import',{detail:{mode:'intensive',name:'原创滚动测试',files:[
  {path:'paper-layout-scroll/paper.json',text:JSON.stringify({id:'paper-layout-scroll',title:'Original reader test',articles:[{id:'long',title:'Reader scroll verification',audio:{intensive:'long/audio.wav',exam:'long/audio.wav'},transcript:'long/transcript.json',questions:'long/questions.json'}]})},
  {path:'paper-layout-scroll/long/audio.wav',url:'media/morning.wav'},
  {path:'paper-layout-scroll/long/transcript.json',text:JSON.stringify(transcript)},
  {path:'paper-layout-scroll/long/questions.json',text:JSON.stringify(questions)}
 ]}})),{transcript,questions});
 await page.locator('[data-action="nav"][data-route="library"]').click();
 await openLibraryArticle(page,'paper-layout-scroll','long');
 await page.locator('[data-action="mode"][data-mode="intensive"]').click();
 await page.locator('.display-controls [data-action="display"][data-display="bilingual"]').click();
 await page.locator('.main-panel').evaluate(panel=>{
  const sentence=panel.querySelector('.sentence[data-index="5"]');
  panel.scrollTop+=sentence.getBoundingClientRect().top-panel.getBoundingClientRect().top+24;
 });
 const before=await visibleSentence(page);
 assert.ok(Number(before.index)>0,'long passage really scrolls before changing text mode');
 await page.locator('.display-controls [data-action="display"][data-display="original"]').click();
 const original=await visibleSentence(page);
 assert.equal(original.index,before.index,'showing original text retains the visible sentence');
 assert.ok(Math.abs(original.offset-before.offset)<2,'showing original text retains the reading offset');
 for(const display of ['bilingual','original','bilingual','original']){
  await page.locator(`.display-controls [data-action="display"][data-display="${display}"]`).click();
  const current=await visibleSentence(page);
  assert.equal(current.index,before.index,'rapid display reversals preserve the reading sentence');
  assert.ok(Math.abs(current.offset-before.offset)<2,'rapid display reversals preserve the reading offset');
  assert.equal(await page.locator('.display-controls').getAttribute('data-current'),display,'the text indicator follows the latest display choice');
 }
 await page.locator('.display-controls [data-action="display"][data-display="hidden"]').click();
 await page.locator('.display-controls [data-action="display"][data-display="bilingual"]').click();
 const restored=await visibleSentence(page);
 assert.equal(restored.index,before.index,'temporarily hiding the transcript preserves the reading sentence');
 assert.ok(Math.abs(restored.offset-before.offset)<2,'temporarily hiding the transcript preserves its offset');
 // When only the translation remains visible, removing it must not lose the sentence.
 await page.locator('.main-panel').evaluate(panel=>{
  const translation=panel.querySelector('.sentence[data-index="5"] .zh');
  panel.scrollTop+=translation.getBoundingClientRect().top-panel.getBoundingClientRect().top+10;
 });
 const translationOnly=await visibleSentence(page);
 assert.equal(translationOnly.index,'5','translation-only edge case starts on the intended sentence');
 await page.locator('.display-controls [data-action="display"][data-display="original"]').click();
 assert.equal((await visibleSentence(page)).index,translationOnly.index,'removing a partly visible translation keeps its English sentence reachable');
 await page.locator('[data-action="mode"][data-mode="exam"]').click();
 assert.equal(await page.locator('.quiz-question').count(),2,'long and short questions share the article page');
 assert.doesNotMatch(await page.locator('.quiz-card').innerText(),/Which answer describes the reading exercise\?|Choose the next answer\./,'written question prompts are not shown in listening practice');
 const first=page.locator('.quiz-question[data-question-index="0"]');
 const firstToggle=first.locator('[data-action="toggle-question"]');
 if(await firstToggle.getAttribute('aria-expanded')!=='true')await firstToggle.click();
 const option=first.locator('[data-action="answer"][data-option="D"]');
 await option.scrollIntoViewIfNeeded();
 const answerTop=await page.locator('.main-panel').evaluate(panel=>panel.scrollTop);
 assert.ok(answerTop>100,'long options really require scrolling');
 await option.click();
 assert.equal(await firstToggle.getAttribute('aria-expanded'),'false','choosing an answer collapses its option list');
 await page.waitForFunction(()=>document.querySelector('.quiz-question[data-question-index="0"] .question-options-wrap').getBoundingClientRect().height<1);
 assert.match(await first.locator('.question-selection').innerText(),/Option D/,'the collapsed row retains the complete selected answer');
 assert.equal(await page.locator('.quiz-question').count(),2,'choosing an answer retains all article questions');
 const firstBounds=await firstToggle.boundingBox();
 const panelBounds=await page.locator('.main-panel').boundingBox();
 assert.ok(firstBounds.y>=panelBounds.y-1&&firstBounds.y+firstBounds.height<=panelBounds.y+panelBounds.height+1,'the selected question stays reachable after long options collapse');
 const submit=page.locator('[data-action="submit-article"]');
 assert.equal(await submit.isDisabled(),true,'the article cannot be submitted while another question is unanswered');
 const second=page.locator('.quiz-question[data-question-index="1"]');
 await second.locator('[data-action="toggle-question"]').click();
 assert.equal(await firstToggle.getAttribute('aria-expanded'),'false','opening another question keeps the previous one collapsed');
 await second.locator('[data-action="answer"][data-option="A"]').click();
 assert.equal(await second.locator('[data-action="toggle-question"]').getAttribute('aria-expanded'),'false','each selection closes its own dropdown');
 assert.equal(await submit.isDisabled(),false,'all selected answers enable whole-article submission');
 await submit.scrollIntoViewIfNeeded();
 const submitTop=await page.locator('.main-panel').evaluate(panel=>panel.scrollTop);
 await submit.click();
 assert.ok(Math.abs(await page.locator('.main-panel').evaluate(panel=>panel.scrollTop)-submitTop)<2,'submitting the article retains the article page position');
 assert.equal(await page.locator('.quiz-question').count(),2,'submitting keeps the complete article answer sheet on screen');
 await page.locator('[data-action="view-result"]').click();
 assert.match(await page.locator('.result-card').innerText(),/本篇完成\s+2\s*\/\s*2/,'results include every question submitted together');
 await page.locator('[data-action="nav"][data-route="library"]').click();
 await openLibraryArticle(page,'listenly-original','morning');
 await page.locator('[data-action="mode"][data-mode="intensive"]').click();
 await page.locator('.display-controls [data-action="display"][data-display="bilingual"]').click();
}

async function visibleSentence(page){
 return page.locator('.main-panel').evaluate(panel=>{
  const top=panel.getBoundingClientRect().top;
  const sentence=[...panel.querySelectorAll('.sentence')].find(element=>element.getBoundingClientRect().bottom>top);
  return {index:sentence.dataset.index,offset:sentence.getBoundingClientRect().top-top};
 });
}
