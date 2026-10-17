import {parseFolder, mergePapers} from './importer.js';
import {mapAudioTime} from './alignment.js';
import {mountGlass,syncGlass,isRangeInteracting} from './glass.js';
import {transitionTheme} from './theme.js';
import {animateOverlay,dismissOverlay} from './overlays.js';
import {normalizePlaybackMode,playbackModeDetails,nextPlaybackMode,nextPlaybackArticle} from './playback-modes.js';
import {localDateKey,normalizeActivity,recordQuestionSubmission,recordListeningSeconds,recordStudySeconds,activitySummary,activityCalendar,recordArticleCompletion,migrateArticleCompletions,recordListeningCoverage,finishListeningArticle} from './activity.js';

const icons={headphones:'<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',plus:'<path d="M12 5v14M5 12h14"/>',book:'<path d="M12 5c-3-2-7-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1zM12 5v15"/>',home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',chevron:'<path d="m9 5 7 7-7 7"/>',back:'<path d="m14 5-7 7 7 7"/>',play:'<path d="M8.1 4.8C7.2 4.2 6 4.9 6 6v12c0 1.1 1.2 1.8 2.1 1.2l10-6c1-.6 1-1.8 0-2.4l-10-6Z" fill="currentColor" stroke="none"/>',pause:'<rect x="5.8" y="4.5" width="4.7" height="15" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.5" y="4.5" width="4.7" height="15" rx="1.4" fill="currentColor" stroke="none"/>',folder:'<path d="M3 7V5h6l3 3h9v12H3z"/>',check:'<path d="m5 12 4 4 10-10"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',eyeoff:'<path d="m3 3 18 18M10 5a11 11 0 0 1 12 7 16 16 0 0 1-4 4M6 6a17 17 0 0 0-4 6c4 7 10 9 16 4M10 10a3 3 0 0 0 4 4"/>',translate:'<path d="M3 5h12M9 3v2M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-8 10M13 21l4-11 4 11M15 17h4"/>',quiz:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="m8 9 1 1 2-3M13 9h3M8 15h2M13 15h3"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',fire:'<path d="M13 3c2 5 5 6 5 11a6 6 0 0 1-12 0c0-3 2-5 4-8 0 4 2 4 3-3z"/>',bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',rewind:'<path d="M5 8a8 8 0 1 1-1 8M5 3v5H1"/>',forward:'<path d="M19 8a8 8 0 1 0 1 8M19 3v5h4"/>',repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',leaf:'<path d="M4 20c1-5 6-9 13-13M4 17C0 9 9 3 21 3c0 11-7 18-17 14z"/>'};
const icon=(name,extra='')=>`<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${icons[name]||icons.book}</svg>`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const audio=document.querySelector('#audio');
const app=document.querySelector('#app');
const storageKey='listenly.state.v1';
const playbackSpeeds=[.75,1,1.25,1.5];
let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
const state={route:'home',mode:'intensive',display:'hidden',theme:saved.theme==='dark'?'dark':'light',speed:playbackSpeeds.includes(Number(saved.speed))?Number(saved.speed):1,active:saved.active||null,homeFocus:Object.prototype.hasOwnProperty.call(saved,'homeFocus')?saved.homeFocus:saved.active||null,selectedPaper:saved.selectedPaper||null,positions:saved.positions||{},answers:saved.answers||{},questionIndices:saved.questionIndices||{},bookmarks:saved.bookmarks||[],days:saved.days||{},studyDays:saved.studyDays||{},dailyQuestions:saved.dailyQuestions||{},dailyArticles:saved.dailyArticles||{},articleCompletions:saved.articleCompletions||{},completedListeningDays:saved.completedListeningDays||{},listeningSessions:saved.listeningSessions||{},activityVersion:saved.activityVersion,activity:saved.activity||{},lastImport:saved.lastImport||null};
normalizeActivity(state);
state.playbackMode=normalizePlaybackMode(saved.playbackMode);
icons.queue='<path d="M4 6h13M4 11h9M4 16h7M16 12l5 4-5 4z"/>';
icons.repeatone='<path d="m17 3 4 4-4 4M3 10V9a2 2 0 0 1 2-2h16M7 21l-4-4 4-4M21 14v1a2 2 0 0 1-2 2H3M11 10l2-1v6"/>';
icons.shuffle='<path d="m18 3 3 3-3 3M3 6h2c5 0 9 12 14 12h2M18 15l3 3-3 3M3 18h2c2.5 0 4.8-3 7-6s4.5-6 7-6h2"/>';
let papers=[],currentAudioKey='',currentSentence=-1,importMode='intensive',quizResult=false,lastPlaybackTick=0,toastTimer,busy=false;
let speedMenu=null;
let libraryPaperId=null,listeningAnchor=null;
const openQuestions=new Set();
function resetQuestionDisclosure(){openQuestions.clear();if(questions()[qIndex()])openQuestions.add(qIndex())}
const libraryFilters={search:'',year:'',kind:'all'};
const transientUrls=new Set();
const paperId=()=>state.active?.paper;
const getPaper=()=>papers.find(p=>p.id===paperId());
const getArticle=()=>getPaper()?.articles.find(a=>a.id===state.active?.article);
const keyFor=(p,a)=>JSON.stringify([p,a]);
const materialKey=()=>keyFor(state.active?.paper,state.active?.article);
const selectedPaper=()=>papers.find(p=>p.id===state.selectedPaper)||papers.find(p=>p.id===state.active?.paper)||papers[0];
const materialTitle=title=>String(title||'').replace(/\s*(?:[·•|｜:：,，–—-]\s*)?(?:[（(]\s*)?(?:第\s*)?\d+(?:\s*[-–—~～至]\s*\d+)?\s*题\s*[)）]?\s*$/,'').trim();
const qIndex=()=>state.questionIndices[materialKey()]||0;
const questions=()=>getArticle()?.questions||[];
const getQuestion=()=>questions()[qIndex()];
const answerKey=q=>JSON.stringify([state.active?.paper,state.active?.article,q?.id]);
const getAnswer=q=>state.answers[answerKey(q)];
const today=()=>localDateKey();
const formatTime=n=>{n=Number.isFinite(n)?Math.max(0,n):0;return `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`};
function fullListeningKey(){return getArticle()&&sourceAudio()===audio.getAttribute('src')&&!(state.mode==='exam'&&getQuestion()?.audioUrl)?materialKey():null}
function resetListeningAnchor(){const key=fullListeningKey();listeningAnchor=key&&!audio.paused&&!audio.seeking?{key,src:audio.getAttribute('src'),time:audio.currentTime,at:performance.now(),rate:audio.playbackRate}:null}
function settleListeningCoverage(flush=false){
  const previous=listeningAnchor,now=performance.now(),time=audio.currentTime,key=fullListeningKey();
  if(previous&&previous.key===key&&previous.src===audio.getAttribute('src')&&!audio.seeking&&(!audio.paused||flush||audio.ended)){
    const elapsed=Math.max(0,(now-previous.at)/1000),advance=time-previous.time;
    if(elapsed>0&&advance>0&&advance<=elapsed*previous.rate+.5)recordListeningCoverage(state,key,{from:previous.time,to:time,duration:audio.duration,seconds:Math.min(elapsed,advance/previous.rate),at:Date.now()});
  }
  resetListeningAnchor();if(flush)listeningAnchor=null;
}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(state))}catch{toast('存储空间不足，请导出学习记录。')}}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500)}
function nav(route){settleListeningCoverage(true);settleStudyClock();savePosition();if(route!=='practice')audio.pause();state.route=route;if(route==='library')libraryPaperId=null;quizResult=false;render();settleStudyClock();window.scrollTo(0,0)}
function selectMaterial(p,a){settleListeningCoverage(true);settleStudyClock();savePosition();if(state.route!=='practice'){if(state.mode==='exam'&&state.active?.paper===p&&state.active?.article===a)switchMode('intensive');else state.mode='intensive';state.display='hidden'}state.active={paper:p,article:a};state.route='practice';quizResult=false;resetQuestionDisclosure();currentSentence=-1;persist();render();setAudio();settleStudyClock();window.scrollTo(0,0)}
function prepareHomePlayback(p,a){settleListeningCoverage(true);settleStudyClock();savePosition();const same=state.active?.paper===p&&state.active?.article===a;if(same&&state.mode==='exam')switchMode('intensive',false);else if(!same){audio.pause();state.active={paper:p,article:a};state.mode='intensive'}state.display='hidden';currentSentence=-1;setAudio();persist()}
async function playAtHome(p,a){prepareHomePlayback(p,a);await togglePlay();settleStudyClock()}
function previewPaper(p){if(!papers.some(paper=>paper.id===p))return;libraryPaperId=p;render();window.scrollTo(0,0)}
const selectionTimers=new WeakMap();
function choosePaper(p){
  if(!papers.some(paper=>paper.id===p))return;state.selectedPaper=p;persist();
  document.querySelectorAll('.paper-group-row').forEach(row=>{
    const selected=row.dataset.paper===p,wasSelected=row.classList.contains('is-selected'),button=row.querySelector('[data-action="select-paper"]'),paper=papers.find(item=>item.id===row.dataset.paper);
    row.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-label',`${selected?'已选择':'选择'}套卷：${paper.title}`);
    if(wasSelected!==selected){clearTimeout(selectionTimers.get(row));row.classList.remove('selection-changing');if(selected&&!matchMedia('(prefers-reduced-motion: reduce)').matches){row.classList.add('selection-changing');selectionTimers.set(row,setTimeout(()=>{row.classList.remove('selection-changing');selectionTimers.delete(row)},260))}}
  });syncGlass(app);
}
function promotePlayingMaterial(){const active=getArticle();if(!active||audio.paused||audio.error||audio.readyState<2||audio.getAttribute('src')!==sourceAudio())return;const changed=state.selectedPaper!==paperId()||state.homeFocus?.paper!==paperId()||state.homeFocus?.article!==active.id;state.selectedPaper=paperId();state.homeFocus={...state.active};if(changed){persist();if(state.route==='home'){const card=document.querySelector('.focus-card');if(card?.dataset.paper!==paperId()||card?.dataset.article!==active.id){const template=document.createElement('template');template.innerHTML=homeCard(getPaper(),active);card?.replaceWith(template.content.firstElementChild)}updateHomeSelection();syncGlass(app);updatePlayer()}}}

function updateHomeSelection(){document.querySelectorAll('.home-paper-row').forEach(row=>row.classList.toggle('is-selected',row.dataset.paper===state.homeFocus?.paper&&row.dataset.article===state.homeFocus?.article))}
function libraryBack(){libraryPaperId=null;render();window.scrollTo(0,0)}
function articlePosition(time){if(state.mode!=='exam')return time;const q=getQuestion(),whole=getArticle()?.audio?.intensive||getArticle()?.audio?.exam;if(!q?.audioUrl)return sourceAudio()===whole?time:null;if(q.audioTimeline)return mapAudioTime(time,q.audioTimeline);if(Number.isFinite(q.start))return q.start+time;return q.audioUrl===whole?time:null}
function savePosition(){const pending=Number(audio.dataset.pendingTime),position=audio.dataset.pendingTime!==undefined&&Number.isFinite(pending)?pending:audio.currentTime;if(currentAudioKey&&Number.isFinite(position)){state.positions[currentAudioKey]=position;if(currentAudioKey===audioKey()&&audio.getAttribute('src')===sourceAudio()){const whole=articlePosition(position);if(Number.isFinite(whole))state.positions[JSON.stringify([paperId(),getArticle()?.id,'intensive','passage'])]=whole}persist()}}
function sourceAudio(){const article=getArticle();if(!article)return null;const q=getQuestion();return state.mode==='exam'?(q?.audioUrl||article.audio?.exam||article.audio?.intensive):(article.audio?.intensive||article.audio?.exam)}
function audioKey(){return JSON.stringify([state.active?.paper,state.active?.article,state.mode,state.mode==='exam'&&getQuestion()?.audioUrl?getQuestion().id:'passage'])}
function playablePosition(time,duration){time=Number.isFinite(time)?Math.max(0,time):0;return Number.isFinite(duration)&&duration>0&&time>=duration-.05?0:time}
function reloadAudio(url,key,time){settleListeningCoverage(true);audio.pause();listeningAnchor=null;currentAudioKey=key;delete audio.dataset.pendingSeek;audio.dataset.pendingTime=String(Number.isFinite(time)?Math.max(0,time):0);audio.src=url;audio.load();audio.playbackRate=state.speed;updatePlayer()}
function setAudio(mappedTime){const url=sourceAudio();const key=audioKey();if(!url){audio.pause();audio.removeAttribute('src');audio.load();currentAudioKey='';updatePlayer();return}
  if(audio.getAttribute('src')!==url||audio.error||audio.networkState===3||audio.ended){reloadAudio(url,key,mappedTime??state.positions[key]??0)}
  else if(key!==currentAudioKey){currentAudioKey=key;delete audio.dataset.pendingSeek;const target=mappedTime??state.positions[key]??0;if(Number.isFinite(audio.duration)){const time=playablePosition(target,audio.duration);if(Math.abs(audio.currentTime-time)>.05)audio.currentTime=time}else audio.dataset.pendingTime=String(target)}
  audio.playbackRate=state.speed;resetListeningAnchor();updatePlayer();
}
function reveal(element){if(!element||window.matchMedia('(prefers-reduced-motion: reduce)').matches||typeof element.animate!=='function')return;try{element.animate([{opacity:.82},{opacity:1}],{duration:140,easing:'cubic-bezier(.2,.8,.2,1)'})}catch{}}
function switchMode(mode,updateView=true){if(state.mode===mode)return;settleListeningCoverage(true);settleStudyClock();const oldArticle=getArticle(),oldQ=getQuestion(),previous=state.mode,oldTime=audio.currentTime;const oldUrl=sourceAudio();savePosition();state.mode=mode;quizResult=false;resetQuestionDisclosure();currentSentence=-1;persist();if(updateView){render();reveal(document.querySelector('.main-panel>div'))}if(state.active&&getArticle()){
  let mapped;if(oldUrl&&oldUrl===sourceAudio())mapped=oldTime;
  else if(previous==='exam'&&oldQ?.audioUrl&&oldQ.audioTimeline)mapped=mapAudioTime(oldTime,oldQ.audioTimeline);
  else if(mode==='exam'&&getQuestion()?.audioUrl&&getQuestion().audioTimeline)mapped=mapAudioTime(oldTime,getQuestion().audioTimeline,'articleToClip');
  else if(previous==='exam'&&oldQ?.audioUrl&&Number.isFinite(oldQ.start)&&oldArticle?.audio?.intensive)mapped=oldQ.start+oldTime;
  else if(mode==='exam'&&getQuestion()?.audioUrl&&Number.isFinite(getQuestion().start))mapped=Math.max(0,oldTime-getQuestion().start);
  else if(!(previous==='exam'&&oldQ?.audioUrl)&&!(mode==='exam'&&getQuestion()?.audioUrl))mapped=oldTime;
  setAudio(mapped);
}settleStudyClock()}
function applyTheme(){transitionTheme(state.theme,()=>{document.querySelector('meta[name="theme-color"]').content=state.theme==='dark'?'#000000':'#fafafa';if(window.Android?.setTheme)window.Android.setTheme(state.theme)});document.querySelectorAll('.theme-control').forEach(control=>{control.dataset.current=state.theme;control.querySelectorAll('[data-theme]').forEach(button=>{const active=button.dataset.theme===state.theme;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))})});syncGlass()}
function speedControl(){return `<button class="speed-btn transport-pill" data-action="speed" aria-label="播放速度，${state.speed}倍" aria-haspopup="menu" aria-expanded="false"><span class="speed-value">${state.speed}×</span>${icon('chevron')}</button>`}
function closeSpeedMenu(restoreFocus=true){if(!speedMenu)return;const {shade,trigger}=speedMenu;speedMenu=null;dismissOverlay(shade,shade.querySelector('.speed-popover'));trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');if(restoreFocus&&trigger.isConnected){try{trigger.focus({preventScroll:true})}catch{trigger.focus()}}}
function setPlaybackSpeed(value){const speed=Number(value);if(!playbackSpeeds.includes(speed))return;settleListeningCoverage();state.speed=speed;audio.playbackRate=speed;persist();document.querySelectorAll('[data-action="speed"]').forEach(button=>{button.querySelector('.speed-value').textContent=`${speed}×`;button.setAttribute('aria-label',`播放速度，${speed}倍`)})}
function showChoiceMenu(trigger,options,label,type='speed',onSelect=setPlaybackSpeed){
  if(speedMenu?.trigger===trigger){closeSpeedMenu();return}closeSpeedMenu(false);
  const shade=document.createElement('div');shade.className=`speed-shade${type==='speed'?'':' filter-shade'}`;
  const id=type==='speed'?'speed-menu':`filter-menu-${type}`;
  shade.innerHTML=`<div id="${id}" class="speed-popover${type==='speed'?'':' filter-popover'}" role="menu" aria-label="${esc(label)}" style="visibility:hidden;animation:none">${options.map(option=>`<button class="speed-option${type==='speed'?'':' filter-option'}" data-action="${type==='speed'?'set-speed':'set-filter'}" ${type==='speed'?`data-speed="${esc(option.value)}"`:`data-filter="${type}"`} data-value="${esc(option.value)}" role="menuitemradio" aria-checked="${option.selected}" tabindex="-1"><span>${esc(option.label)}</span>${icon('check')}</button>`).join('')}</div>`;
  document.body.append(shade);const menu=shade.querySelector('.speed-popover'),bounds=trigger.getBoundingClientRect(),margin=12;
  menu.style.width=`${Math.min(176,innerWidth-margin*2)}px`;menu.style.maxHeight=`${Math.max(44,innerHeight-margin*2)}px`;
  const height=menu.getBoundingClientRect().height,width=menu.getBoundingClientRect().width;
  const below=innerHeight-bounds.bottom-8>=height||bounds.top-8<height;
  menu.style.left=`${Math.max(margin,Math.min(bounds.left,innerWidth-width-margin))}px`;
  menu.style.top=`${Math.max(margin,Math.min(below?bounds.bottom+6:bounds.top-height-6,innerHeight-height-margin))}px`;
  menu.style.setProperty('--menu-origin',below?'top left':'bottom left');menu.style.visibility='visible';menu.style.animation='';
  speedMenu={shade,trigger};trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',id);
  shade.addEventListener('click',event=>{const option=event.target.closest('[role="menuitemradio"]');if(option&&shade.contains(option)){onSelect(option.dataset.value);closeSpeedMenu()}else if(event.target===shade)closeSpeedMenu()});
  syncGlass(shade);animateOverlay(menu);(menu.querySelector('[aria-checked="true"]')||menu.querySelector('button')).focus();
}
function showSpeedMenu(trigger){showChoiceMenu(trigger,playbackSpeeds.map(speed=>({value:speed,label:`${speed}×`,selected:state.speed===speed})),'播放速度')}
const materialKinds=[['all','全部材料'],['saved','收藏'],['real','六级真题']];
function yearOptions(){return [['','全部年份'],...[...new Set(papers.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a).map(year=>[String(year),String(year)])]}
function showFilterMenu(trigger){const type=trigger.dataset.filter,values=type==='year'?yearOptions():materialKinds;showChoiceMenu(trigger,values.map(([value,label])=>({value,label,selected:libraryFilters[type]===value})),type==='year'?'筛选年份':'筛选材料',type,value=>{libraryFilters[type]=value;trigger.querySelector('.filter-value').textContent=values.find(item=>item[0]===value)?.[1]||value;filterLibrary()})}
function themeControl(){return `<div class="theme-control" data-current="${state.theme}" role="group" aria-label="外观"><button data-action="theme" data-theme="light" class="${state.theme==='light'?'active':''}" aria-pressed="${state.theme==='light'}">日间</button><button data-action="theme" data-theme="dark" class="${state.theme==='dark'?'active':''}" aria-pressed="${state.theme==='dark'}">夜间</button></div>`}
function topbar(){return `<header class="topbar">${themeControl()}<button class="icon-btn" data-action="import" aria-label="导入材料">${icon('plus')}</button></header>`}
let navigationBar=null,navigationLens=null;
function bottomNav(){return `<nav class="bottom-nav" aria-label="主导航"><svg class="nav-optics" aria-hidden="true" width="0" height="0"><defs><filter id="nav-lens-refraction" x="0" y="0" width="200" height="44" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feImage class="nav-displacement-map" x="0" y="0" width="200" height="44" preserveAspectRatio="none" result="lens-map"/><feDisplacementMap in="SourceGraphic" in2="lens-map" scale="24" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg><div class="nav-lens" aria-hidden="true"></div>${[['home','headphones','听力'],['library','book','资料库'],['profile','user','我的']].map(([route,i,label])=>`<button class="nav-item ${state.route===route?'active':''}" data-action="nav" data-route="${route}" ${state.route===route?'aria-current="page"':''}><span class="nav-content">${icon(i)}<span>${label}</span></span></button>`).join('')}</nav>`}
function createNavigationLens(bar){
  const lens=bar.querySelector('.nav-lens'),buttons=[...bar.querySelectorAll('.nav-item')],reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let x=0,velocity=0,target=0,width=0,barWidth=0,top=0,frame=0,lastTime=0,route='',attached=false;
  const centers=[];
  function opticalMap(){
    // The flat centre stays undistorted; the curved rim samples further inside.
    // R/G encode the surface normal, rather than a uniform diagonal gradient.
    const canvas=document.createElement('canvas'),w=Math.max(1,Math.round(width*2)),h=88;
    canvas.width=w;canvas.height=h;const context=canvas.getContext('2d');if(!context)return;
    const pixels=context.createImageData(w,h),radius=22,halfWidth=width/2;
    function distance(px,py){const qx=Math.abs(px-halfWidth)-(halfWidth-radius),qy=Math.abs(py-22);return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-radius}
    for(let y=0;y<h;y++)for(let column=0;column<w;column++){
      const px=(column+.5)/2,py=(y+.5)/2,d=distance(px,py),inside=Math.max(0,-d),edge=Math.max(0,1-inside/10),bend=d<=0?6*edge*edge:0;
      let nx=distance(px+.25,py)-distance(px-.25,py),ny=distance(px,py+.25)-distance(px,py-.25);const length=Math.hypot(nx,ny)||1;nx/=length;ny/=length;
      const offset=(y*w+column)*4;pixels.data[offset]=Math.round(128-nx*bend/24*255);pixels.data[offset+1]=Math.round(128-ny*bend/24*255);pixels.data[offset+2]=128;pixels.data[offset+3]=255;
    }
    context.putImageData(pixels,0,0);const map=bar.querySelector('.nav-displacement-map'),filter=bar.querySelector('#nav-lens-refraction');
    map.setAttribute('width',String(width));filter.setAttribute('width',String(width));
    const url=canvas.toDataURL();map.setAttribute('href',url);map.setAttributeNS('http://www.w3.org/1999/xlink','href',url);
  }
  function measure(){
    const bounds=bar.getBoundingClientRect(),css=getComputedStyle(bar),borderLeft=parseFloat(css.borderLeftWidth)||0,borderTop=parseFloat(css.borderTopWidth)||0,first=buttons[0].getBoundingClientRect(),nextWidth=buttons[0].offsetWidth-8;
    barWidth=bounds.width-borderLeft-(parseFloat(css.borderRightWidth)||0);
    buttons.forEach((button,index)=>{const r=button.getBoundingClientRect();centers[index]=r.left-bounds.left-borderLeft+r.width/2});
    top=first.top-bounds.top-borderTop+(first.height-44)/2;
    if(Math.abs(nextWidth-width)>.5){width=nextWidth;lens.style.width=`${width}px`;opticalMap()}
    lens.style.top=`${top}px`;
  }
  function paint(){
    const energy=Math.min(1,Math.abs(velocity)/1600),stretch=1+energy*.22,squash=1-energy*.13,lean=Math.max(-2.4,Math.min(2.4,velocity/650));
    const extent=(width*stretch+44*Math.abs(Math.tan(lean*Math.PI/180)))/2,center=Math.max(extent+3,Math.min(barWidth-extent-3,x));
    lens.style.transform=`translate3d(${center-width/2}px,0,0) scale(${stretch},${squash}) skewX(${lean}deg)`;
    buttons.forEach((button,index)=>{const proximity=Math.exp(-Math.pow((centers[index]-center)/(width*.58),2));button.querySelector('.nav-content').style.transform=`translateY(${-proximity*.6}px) scale(${1+proximity*.045})`});
  }
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;lastTime=0}
  function tick(time){
    frame=0;if(!bar.isConnected){stop();attached=false;return}
    const elapsed=Math.min(.064,Math.max(.001,(time-(lastTime||time-16.667))/1000));lastTime=time;
    const steps=Math.ceil(elapsed/(1/120)),dt=elapsed/steps;
    for(let step=0;step<steps;step++){velocity+=((target-x)*460-velocity*31)*dt;x+=velocity*dt}
    if(Math.abs(target-x)<.08&&Math.abs(velocity)<1){x=target;velocity=0;lastTime=0;paint();return}
    paint();frame=requestAnimationFrame(tick);
  }
  function select(nextRoute,instant=false){
    const index=buttons.findIndex(button=>button.dataset.route===nextRoute);if(index<0)return;
    buttons.forEach((button,i)=>{button.classList.toggle('active',i===index);if(i===index)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
    const reattached=!attached;attached=true;measure();target=centers[index];
    if(instant||reattached||reduced.matches){stop();x=target;velocity=0;paint()}
    else if(route!==nextRoute&&!frame){lastTime=0;frame=requestAnimationFrame(tick)}
    route=nextRoute;
  }
  function suspend(){stop();attached=false}
  function realign(){if(bar.isConnected)select(route,true)}
  window.addEventListener('resize',realign);
  if(reduced.addEventListener)reduced.addEventListener('change',realign);else if(reduced.addListener)reduced.addListener(realign);
  return {select,suspend};
}
function modeControl(){return `<div class="mode-control" data-current="${state.mode}" role="group" aria-label="训练模式"><button data-action="mode" data-mode="intensive" class="${state.mode==='intensive'?'active':''}" aria-pressed="${state.mode==='intensive'}">精听</button><button data-action="mode" data-mode="exam" class="${state.mode==='exam'?'active':''}" aria-pressed="${state.mode==='exam'}">做题</button></div>`}
function allArticles(){return papers.flatMap(p=>p.articles.map(a=>({p,a})))}
function materialRow(p,a,index=0){
  const detail=a.duration?formatTime(a.duration):'';
  const copy=`<span class="paper-copy"><h3>${esc(materialTitle(a.title))}</h3>${detail?`<p><span class="row-detail">${detail}</span></p>`:''}</span>`;
  if(state.route==='home')return `<div class="paper-row home-paper-row ${state.homeFocus?.paper===p.id&&state.homeFocus?.article===a.id?'is-selected':''}" data-paper="${esc(p.id)}" data-article="${esc(a.id)}"><button class="paper-open" data-action="open" data-paper="${esc(p.id)}" data-article="${esc(a.id)}">${copy}</button><button class="row-play" data-action="home-play" data-paper="${esc(p.id)}" data-article="${esc(a.id)}" aria-label="播放音频：${esc(materialTitle(a.title))}" aria-pressed="false">${icon('play')}</button></div>`;
  return `<div class="paper-row library-paper-row"><button class="paper-open" data-action="open" data-paper="${esc(p.id)}" data-article="${esc(a.id)}">${copy}</button><button class="row-play" data-action="material-play" data-paper="${esc(p.id)}" data-article="${esc(a.id)}" aria-label="播放音频：${esc(materialTitle(a.title))}" aria-pressed="false">${icon('play')}</button></div>`;
}
function getStoredAnswer(p,a,q){return state.answers[JSON.stringify([p.id,a.id,q.id])]}
function homeMaterial(){const paper=selectedPaper(),article=paper?.articles.find(a=>state.homeFocus?.paper===paper.id&&state.homeFocus?.article===a.id)||paper?.articles[0];return {paper,article}}
function homeCard(paper,article){return `<section class="focus-card" data-paper="${esc(paper.id)}" data-article="${esc(article.id)}"><button class="focus-open" data-action="open" data-paper="${esc(paper.id)}" data-article="${esc(article.id)}"><span class="focus-copy"><p class="card-kicker">${esc(paper.isDemo?'原创示例':paper.title)}</p><h2>${esc(materialTitle(article.title))}</h2></span></button>${playback({paper,article})}</section>`}
function home(){
  const {paper,article:focus}=homeMaterial(),articles=paper?.articles||[];
  if(!focus)return `<div class="empty"><p>暂无材料</p><button class="text-btn" data-action="nav" data-route="profile">前往我的</button></div>`;
  return `${homeCard(paper,focus)}<div class="section-header"><span>${articles.length} 篇</span></div><div class="paper-list">${articles.map((a,i)=>materialRow(paper,a,i)).join('')}</div>`;
}
function transcript(){
  const article=getArticle(),rows=article.transcript||[];
  if(state.display==='hidden')return `<div class="transcript-card hidden-transcript">${icon('eyeoff')}<button class="text-btn" data-action="display" data-display="original">显示原文</button></div>`;
  const content=rows.length?rows.map((s,i)=>`<button class="sentence" data-action="sentence" data-index="${i}" ${s.timed===false?'disabled aria-label="无时间戳的原文句子"':''}>${s.timed===false?'':`<span class="timestamp">${formatTime(s.start)}</span>`}<span class="en">${esc(s.en)}</span>${state.display==='bilingual'&&s.zh?`<span class="zh">${esc(s.zh)}</span>`:''}</button>`).join(''):article.text?`<div class="text-content">${esc(article.text)}</div>${state.display==='bilingual'&&article.translation?`<div class="translation-content">${esc(article.translation)}</div>`:''}`:`<div class="empty"><p>暂无原文</p><button class="text-btn" data-action="import">导入精听材料 ${icon('plus')}</button></div>`;
  return `<div class="transcript-card">${content}${state.display==='bilingual'&&(rows.length||article.text)&&!(rows.some(s=>s.zh)||article.translation)?'<p class="source-note">暂无译文</p>':''}</div>`;
}
function playback(homeTarget=null){
  const article=homeTarget?.article||getArticle(),source=homeTarget?(article.audio?.intensive||article.audio?.exam):sourceAudio(),target=homeTarget?` data-paper="${esc(homeTarget.paper.id)}" data-article="${esc(article.id)}"`:'',mode=playbackModeDetails(state.playbackMode);
  return `<footer class="playback-card${homeTarget?' home-playback':''}"${target} aria-label="音频播放"><div class="player-progress"><span id="current-time">00:00</span><div class="seek-shell"><span class="seek-track" aria-hidden="true"><i class="seek-fill"></i></span><span class="seek-handle" aria-hidden="true"></span><input class="seekbar" id="seek" type="range" min="0" max="${article?.duration||100}" value="0" step=".1" aria-label="播放进度" ${source?'':'disabled'}></div><span id="duration-time">${formatTime(article?.duration)}</span></div><div class="player-buttons">${speedControl()}<button class="skip-btn" data-action="seek-relative" data-seconds="-5" aria-label="后退5秒">${icon('rewind')}<span>5</span></button><button class="big-play${homeTarget?' focus-play':''}" data-action="${homeTarget?'home-play':'play'}"${target} aria-label="播放" ${homeTarget?'aria-pressed="false"':''} ${source?'':'disabled'}>${icon('play')}</button><button class="skip-btn" data-action="seek-relative" data-seconds="5" aria-label="前进5秒">${icon('forward')}<span>5</span></button><button class="playback-mode-btn transport-pill" data-action="playback-mode" data-playback-mode="${mode.id}" aria-label="${mode.label}" title="${mode.label}">${icon(mode.icon)}</button></div><p id="audio-error" class="playback-error" ${source?'hidden':''}>缺少音频</p></footer>`;
}
const hasChoice=q=>q.options.some(option=>option.id===getAnswer(q)?.choice);
function quiz(){
  const qs=questions();
  if(!qs.length)return `<div class="quiz-card"><div class="empty"><p>暂无题目</p><button class="text-btn" data-action="nav" data-route="profile">前往我的</button></div></div>`;
  const chosen=qs.filter(hasChoice).length,done=qs.filter(q=>getAnswer(q)?.submitted).length,complete=done===qs.length;
  return `<div class="quiz-card"><div class="quiz-summary" aria-live="polite"><span>${complete?'已完成':'已选'} ${complete?done:chosen} / ${qs.length}</span></div><div class="quiz-questions">${qs.map((q,i)=>{
    const answer=getAnswer(q),option=q.options.find(o=>o.id===answer?.choice),open=openQuestions.has(i),graded=answer?.submitted&&q.answer,status=graded?(answer.choice===q.answer?'correct':'wrong'):'';
    const feedback=answer?.submitted?(q.answer?(status==='correct'?'答对了':`答案 ${q.answer}`):'已记录 · 无标准答案'):'';
    return `<section class="quiz-question ${open?'is-open':''}" data-question-id="${esc(q.id)}" data-question-index="${i}"><button class="question-toggle" data-action="toggle-question" data-index="${i}" aria-expanded="${open}" aria-controls="question-options-${i}"><span class="question-number">第 ${esc(q.number??i+1)} 题</span><span class="question-selection ${option?'':'is-placeholder'}">${option?`${esc(option.id)}. ${esc(option.text)}`:'选择答案'}</span><span class="question-state ${status?'is-'+status:''}" aria-label="${esc(feedback)}">${answer?.submitted?icon(status==='wrong'?'close':'check'):''}</span><span class="question-chevron">${icon('chevron')}</span></button><div id="question-options-${i}" class="question-options-wrap" aria-hidden="${!open}"><div class="question-options">${q.options.map(o=>{
      let cls=answer?.choice===o.id?'selected':'';
      if(graded){if(o.id===q.answer)cls='correct';else if(o.id===answer.choice)cls='wrong'}
      return `<button class="option ${cls}" data-action="answer" data-index="${i}" data-option="${esc(o.id)}" ${answer?.submitted||!open?'disabled':''} aria-pressed="${answer?.choice===o.id}"><span class="letter">${esc(o.id)}</span><span>${esc(o.text)}</span>${graded&&q.answer===o.id?icon('check'):''}</button>`;
    }).join('')}${feedback?`<div class="question-feedback ${status}">${esc(feedback)}</div>${q.explanation?`<div class="question-explanation">${esc(q.explanation)}</div>`:''}`:''}</div></div></section>`;
  }).join('')}</div><div class="quiz-actions">${complete?`<button class="text-btn" data-action="restart-quiz">重新练习</button><button class="text-btn" data-action="mode" data-mode="intensive">精听复盘</button><button class="primary-btn" data-action="view-result">查看结果 ${icon('chevron')}</button>`:`<button class="primary-btn" data-action="submit-article" ${chosen===qs.length?'':'disabled'}>提交本篇 ${icon('check')}</button>`}</div></div>`;
}
// Keep accordion nodes in place so expansion follows the tap and playback is uninterrupted.
function refreshQuiz(focusIndex){
  const current=document.querySelector('.quiz-card');if(!current)return;
  const holder=document.createElement('div');holder.innerHTML=quiz();const next=holder.firstElementChild;
  current.querySelector('.quiz-summary').innerHTML=next.querySelector('.quiz-summary').innerHTML;
  current.querySelectorAll('.quiz-question').forEach((row,i)=>{
    const replacement=next.querySelectorAll('.quiz-question')[i],toggle=row.querySelector('.question-toggle'),wrap=row.querySelector('.question-options-wrap');
    const replacementToggle=replacement.querySelector('.question-toggle');
    for(const selector of ['.question-selection','.question-state']){const child=toggle.querySelector(selector),nextChild=replacementToggle.querySelector(selector);child.className=nextChild.className;child.innerHTML=nextChild.innerHTML;if(nextChild.hasAttribute('aria-label'))child.setAttribute('aria-label',nextChild.getAttribute('aria-label'))}
    toggle.setAttribute('aria-expanded',String(openQuestions.has(i)));
    wrap.setAttribute('aria-hidden',String(!openQuestions.has(i)));
    wrap.firstElementChild.innerHTML=replacement.querySelector('.question-options').innerHTML;
    row.classList.toggle('is-open',openQuestions.has(i));
  });
  current.querySelector('.quiz-actions').innerHTML=next.querySelector('.quiz-actions').innerHTML;
  if(Number.isInteger(focusIndex))current.querySelectorAll('.question-toggle')[focusIndex]?.focus({preventScroll:true});
}
function result(){
  const qs=questions(),submitted=qs.filter(q=>getAnswer(q)?.submitted),known=submitted.filter(q=>q.answer),correct=known.filter(q=>getAnswer(q).choice===q.answer).length;
  const p=getPaper(),all=p.articles.flatMap(a=>(a.questions||[]).map(q=>({a,q}))),done=all.filter(({a,q})=>getStoredAnswer(p,a,q)?.submitted).length;
  const next=p.articles.slice(p.articles.indexOf(getArticle())+1).find(a=>a.questions?.length);
  return `<div class="result-card"><h2 class="result-score">${known.length?Math.round(correct/known.length*100)+'%':'—'}<span>正确率</span></h2><p>${known.length?`${correct} / ${known.length} 题答对`:'暂无可评分题目'}<br>本篇完成 ${submitted.length} / ${qs.length} 题<br>本套材料已完成 ${done} / ${all.length} 题${submitted.length-known.length?`<br>${submitted.length-known.length} 题无标准答案`:''}</p><div class="result-buttons"><button class="primary-btn" data-action="mode" data-mode="intensive">精听复盘</button>${next?`<button class="primary-btn light" data-action="open" data-paper="${esc(p.id)}" data-article="${esc(next.id)}">下一篇 ${icon('chevron')}</button>`:`<button class="primary-btn light" data-action="restart-quiz">${icon('repeat')}重新练习</button>`}</div></div>`;
}
function practice(){
  const article=getArticle();if(!article){state.route='home';return home()}
  const readerKey=JSON.stringify([state.active.paper,state.active.article,state.mode,quizResult]);
  return `<header class="practice-header"><button class="icon-btn" data-action="nav" data-route="home" aria-label="返回听力">${icon('back')}</button><div class="practice-title"><h1>${esc(materialTitle(article.title))}</h1></div><button class="icon-btn" data-action="nav" data-route="library" aria-label="资料库">${icon('book')}</button><button class="icon-btn bookmark ${state.bookmarks.includes(materialKey())?'active':''}" data-action="bookmark" aria-pressed="${state.bookmarks.includes(materialKey())}" aria-label="${state.bookmarks.includes(materialKey())?'取消收藏':'收藏文章'}">${icon('bookmark')}</button></header><div class="practice-top">${modeControl()}${state.mode==='intensive'?`<div class="display-controls" data-current="${state.display}" role="group" aria-label="原文显示方式">${[['hidden','隐藏'],['original','原文'],['bilingual','双语']].map(([m,t])=>`<button class="${state.display===m?'active':''}" data-action="display" data-display="${m}" aria-pressed="${state.display===m}">${t}</button>`).join('')}</div>`:''}</div><div class="workspace-grid"><div class="main-panel" data-reader-key="${esc(readerKey)}" data-reader-display="${state.mode==='intensive'?state.display:'exam'}" tabindex="0" aria-label="${state.mode==='intensive'?'文章正文':'题目'}">${state.mode==='intensive'?transcript():quizResult?result():quiz()}</div></div>${playback()}`;
}
function filteredArticles(paper){return paper.articles.filter(article=>(!libraryFilters.search||`${paper.title} ${materialTitle(article.title)} ${paper.year||''}`.toLowerCase().includes(libraryFilters.search.toLowerCase()))&&(libraryFilters.kind!=='saved'||state.bookmarks.includes(keyFor(paper.id,article.id))))}
function filteredPapers(){return papers.filter(paper=>(!libraryFilters.year||String(paper.year)===libraryFilters.year)&&(libraryFilters.kind!=='real'||paper.kind==='cet6'||/^cet6[-_]/i.test(paper.id))&&filteredArticles(paper).length)}
function paperRow(paper){const selected=selectedPaper()?.id===paper.id;return `<div class="paper-group-row ${selected?'is-selected':''}" data-paper="${esc(paper.id)}"><button class="paper-group-open" data-action="open-paper" data-paper="${esc(paper.id)}" aria-label="查看套卷文章：${esc(paper.title)}"><span class="paper-group-copy"><h3>${esc(paper.title)}</h3><p>${paper.articles.length} 篇</p></span>${icon('chevron')}</button><button class="paper-select icon-btn" data-action="select-paper" data-paper="${esc(paper.id)}" aria-label="${selected?'已选择':'选择'}套卷：${esc(paper.title)}" aria-pressed="${selected}"><span class="selection-indicator"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5.5"/><path d="m7.5 12 3 3 6-6"/></svg></span></button></div>`}
function libraryFiltersView(){return `<div class="library-filters"><input class="library-search" id="search" type="search" value="${esc(libraryFilters.search)}" placeholder="搜索材料" aria-label="搜索材料"><button class="library-filter" data-action="filter-menu" data-filter="year" aria-label="筛选年份" aria-haspopup="menu" aria-expanded="false"><span class="filter-value">${esc(libraryFilters.year||'全部年份')}</span>${icon('chevron')}</button><button class="library-filter" data-action="filter-menu" data-filter="kind" aria-label="筛选材料" aria-haspopup="menu" aria-expanded="false"><span class="filter-value">${esc(materialKinds.find(item=>item[0]===libraryFilters.kind)?.[1]||'全部材料')}</span>${icon('chevron')}</button></div>`}
function library(){
  const paper=papers.find(p=>p.id===libraryPaperId);
  if(paper)return `<header class="topbar"><button class="icon-btn library-back" data-action="library-back" aria-label="返回套卷目录">${icon('back')}</button><h1 class="library-heading">${esc(paper.title)}</h1></header><div id="library-list" class="paper-list">${filteredArticles(paper).map((article,index)=>materialRow(paper,article,index)).join('')||'<div class="empty">暂无匹配材料</div>'}</div>`;
  const visible=filteredPapers();
  return `${libraryFiltersView()}<p class="library-stats">${visible.length} 套</p><div id="library-list" class="paper-list">${visible.map(paperRow).join('')||'<div class="empty">暂无匹配材料</div>'}</div>`;
}
function activityView(){
  const calendar=activityCalendar(state);
  const days=calendar.weeks.flat().map(day=>`<span class="calendar-day" role="img" data-date="${day.date}" data-level="${day.level}" data-count="${day.count}" ${day.inRange?'':'data-outside="true" aria-hidden="true"'} ${day.isToday?'aria-current="date"':''} title="${day.date} · ${day.count} 题" aria-label="${day.date}，完成 ${day.count} 题"></span>`).join('');
  return `<section class="activity-card" aria-label="做题活跃度"><div class="calendar-layout"><div class="calendar-weekdays" aria-hidden="true"><span></span><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span></div><div class="activity-calendar" style="--calendar-weeks:${calendar.weekCount}" tabindex="0" aria-label="按日期查看完成题目数量"><div class="calendar-months" aria-hidden="true">${calendar.months.map(month=>`<span style="grid-column:${month.column}">${esc(month.label)}</span>`).join('')}</div><div class="calendar-grid">${days}</div></div></div><div class="activity-legend" aria-label="方块颜色越深，当天完成题目越多">${[0,1,2,3,4].map(level=>`<span class="calendar-day" data-level="${level}" aria-hidden="true"></span>`).join('')}</div></section>`;
}
function profile(){
  const stats=activitySummary(state);
  const recent=Object.entries(state.articleCompletions).sort((a,b)=>b[1].last-a[1].last).map(([key])=>{let p,a;try{[p,a]=JSON.parse(key)}catch{return ''}const article=papers.find(paper=>paper.id===p)?.articles.find(art=>art.id===a);return article?`<button class="history-row" data-action="open" data-paper="${esc(p)}" data-article="${esc(a)}"><span class="history-title">${esc(materialTitle(article.title))}</span></button>`:''}).filter(Boolean).slice(0,4).join('');
  return `${topbar()}<div class="statistics"><div class="stat"><strong data-stat="today-listening-minutes">${stats.listeningMinutes}</strong><span>今日听力 · 分钟</span></div><div class="stat"><strong data-stat="today-articles">${stats.completedArticles}</strong><span>今日完成 · 篇</span></div><div class="stat"><strong data-stat="total-study-hours">${stats.studyHours.toFixed(1)}</strong><span>总学习时长 · 小时</span></div></div>${activityView()}<div class="settings-grid"><section class="settings-card"><h2>设置</h2><div class="setting-row"><span>学习记录</span><button class="text-btn" data-action="export">导出 ${icon('download')}</button></div></section><section class="settings-card"><h2>最近练习</h2>${recent||'<p>暂无记录</p>'}</section></div>`;
}
let studyTickAt=performance.now(),questionStudyActive=false,profileDay=today();
function settleStudyClock(){const now=performance.now();if(questionStudyActive)recordStudySeconds(state,Math.max(0,Math.min(2,(now-studyTickAt)/1000)));studyTickAt=now;questionStudyActive=!document.hidden&&state.route==='practice'&&state.mode==='exam'&&!quizResult&&audio.paused}
function refreshProfileStats(){const stats=activitySummary(state);for(const [key,value] of [['today-listening-minutes',stats.listeningMinutes],['today-articles',stats.completedArticles],['total-study-hours',stats.studyHours.toFixed(1)]]){const el=document.querySelector(`[data-stat="${key}"]`);if(el)el.textContent=value}}
const readerPositions=new Map();
function render(){
  closeSpeedMenu(false);
  app.querySelectorAll('.dialog-shade').forEach(overlay=>overlay.remove());
  const previous=document.querySelector('.main-panel');
  if(previous&&previous.dataset.readerDisplay!=='hidden'){
    const bounds=previous.getBoundingClientRect();
    const sentence=[...previous.querySelectorAll('.sentence')].find(el=>el.getBoundingClientRect().bottom>bounds.top);
    readerPositions.set(previous.dataset.readerKey,{top:previous.scrollTop,index:sentence?.dataset.index,offset:sentence?sentence.getBoundingClientRect().top-bounds.top:null});
  }
  const content=state.route==='home'?home():state.route==='practice'?practice():state.route==='library'?library():profile();
  const practicing=state.route==='practice';
  document.body.classList.toggle('is-practicing',practicing);
  // Keep the lens, buttons and their physical motion alive across route changes.
  const shell=document.createElement('div');shell.className=`app-shell ${practicing?'practice-shell':''}`;shell.innerHTML=content;
  const oldShell=app.querySelector('.app-shell');if(oldShell)app.replaceChild(shell,oldShell);else app.appendChild(shell);
  if(practicing){navigationLens?.suspend();navigationBar?.remove()}
  else{
    if(!navigationBar){const holder=document.createElement('div');holder.innerHTML=bottomNav();navigationBar=holder.firstElementChild}
    if(!navigationBar.isConnected)app.appendChild(navigationBar);if(!navigationLens)navigationLens=createNavigationLens(navigationBar);navigationLens.select(state.route);
  }
  const panel=document.querySelector('.main-panel');
  const position=panel&&previous?.dataset.readerKey===panel.dataset.readerKey?readerPositions.get(panel.dataset.readerKey):null;
  if(position&&panel.dataset.readerDisplay!=='hidden'){
    panel.scrollTop=position.top;
    const sentence=position.index!==undefined?panel.querySelector(`.sentence[data-index="${position.index}"]`):null;
    if(sentence&&position.offset!==null){
      // Keep part of the same sentence visible when hiding its translation.
      const bounds=sentence.getBoundingClientRect();
      const offset=Math.max(position.offset,Math.min(0,24-bounds.height));
      panel.scrollTop+=bounds.top-panel.getBoundingClientRect().top-offset;
    }
  }
  syncGlass(app);updatePlayer();if(practicing)highlightSentence();
  if(state.route==='profile'){const calendar=document.querySelector('.activity-calendar');if(calendar)calendar.scrollLeft=calendar.scrollWidth;profileDay=today()}
}

function updatePlayer(){
  const playbackMode=playbackModeDetails(state.playbackMode);document.querySelectorAll('[data-action="playback-mode"]').forEach(button=>{if(button.dataset.playbackMode!==playbackMode.id)button.innerHTML=icon(playbackMode.icon);button.dataset.playbackMode=playbackMode.id;button.setAttribute('aria-label',playbackMode.label);button.title=playbackMode.label});
  const homePlayer=document.querySelector('.home-playback'),homeArticle=homePlayer?papers.find(p=>p.id===homePlayer.dataset.paper)?.articles.find(a=>a.id===homePlayer.dataset.article):null;
  const sameArticle=homePlayer&&state.active?.paper===homePlayer.dataset.paper&&state.active?.article===homePlayer.dataset.article,wholeSource=homeArticle?.audio?.intensive||homeArticle?.audio?.exam;
  const live=!homePlayer||(sameArticle&&audio.getAttribute('src')===wholeSource),pending=Number(audio.dataset.pendingTime),current=audio.dataset.pendingTime!==undefined&&Number.isFinite(pending)?pending:audio.currentTime||0;
  let position=live?current:state.positions[JSON.stringify([homePlayer.dataset.paper,homePlayer.dataset.article,'intensive','passage'])]||0;
  if(homePlayer&&sameArticle&&!live){const mapped=articlePosition(current);if(Number.isFinite(mapped))position=mapped}
  const length=live&&Number.isFinite(audio.duration)?audio.duration:(homeArticle||getArticle())?.duration||0;
  const seek=document.querySelector('#seek');if(seek){seek.max=length||100;seek.value=position;seek.setAttribute('aria-valuetext',formatTime(position));seek.closest('.seek-shell')?.style.setProperty('--seek-ratio',String(Math.max(0,Math.min(1,position/(length||100)))))}
  const time=document.querySelector('#current-time'),duration=document.querySelector('#duration-time'),button=document.querySelector('.big-play');if(time)time.textContent=formatTime(position);if(duration)duration.textContent=formatTime(length);
  if(button&&!homePlayer){const label=audio.paused?'播放':'暂停';if(button.getAttribute('aria-label')!==label)button.innerHTML=icon(audio.paused?'play':'pause');button.setAttribute('aria-label',label)}
  if(homePlayer){const error=document.querySelector('#audio-error');if(error){error.hidden=!!wholeSource&&!(live&&audio.error);if(live&&audio.error)error.textContent='播放失败，点播放重试'}}
  document.querySelectorAll('[data-action="home-play"],[data-action="material-play"]').forEach(button=>{const playing=state.active?.paper===button.dataset.paper&&state.active?.article===button.dataset.article&&!audio.paused&&!audio.error;const article=papers.find(p=>p.id===button.dataset.paper)?.articles.find(a=>a.id===button.dataset.article);if(button.getAttribute('aria-pressed')!==String(playing))button.innerHTML=icon(playing?'pause':'play');button.setAttribute('aria-pressed',String(playing));button.setAttribute('aria-label',`${playing?'暂停':'播放'}音频：${materialTitle(article?.title)}`)})
}
function seekPlayback(value){
  const duration=Number.isFinite(audio.duration)?audio.duration:getArticle()?.duration||100,time=Math.max(0,Math.min(duration,Number(value)||0));settleListeningCoverage(true);
  if(Number.isFinite(audio.duration)){audio.currentTime=time;delete audio.dataset.pendingTime;delete audio.dataset.pendingSeek}else{audio.dataset.pendingTime=String(time);audio.dataset.pendingSeek='true'}
  if(currentAudioKey){state.positions[currentAudioKey]=time;persist()}updatePlayer();
}
function findSentence(){const rows=getArticle()?.transcript||[];let index=-1;rows.forEach((s,i)=>{if(s.timed!==false&&s.start<=audio.currentTime)index=i});return index}
function highlightSentence(){if(state.mode!=='intensive')return;const i=findSentence();document.querySelectorAll('.sentence').forEach((el,n)=>el.classList.toggle('active',n===i));currentSentence=i}
async function togglePlay(){const url=sourceAudio(),key=audioKey();if(!url){toast('请先导入音频');return}if(!audio.paused&&!audio.error){audio.pause();return}
  const pending=audio.dataset.pendingTime;
  const target=audio.ended?0:pending!==undefined?Number(pending):audio.currentTime>0?audio.currentTime:state.positions[key]??0;
  if(audio.error||audio.networkState===3||audio.ended)reloadAudio(url,key,target);
  try{await audio.play()}catch(error){
    if(error?.name==='AbortError'||audioKey()!==key||sourceAudio()!==url)return;
    // A failed decoder needs a new load; repeating play() leaves MediaError latched.
    if(audio.error||audio.networkState===3){
      reloadAudio(url,key,target);
      try{await audio.play();return}catch(retryError){if(retryError?.name==='AbortError'||audioKey()!==key||sourceAudio()!==url)return}
    }
    toast('播放失败，点播放重试');
  }
}
function setQuestion(i){if(!Number.isInteger(i)||!questions()[i])return;settleListeningCoverage(true);const previous=getQuestion(),changed=i!==qIndex();savePosition();state.questionIndices[materialKey()]=i;quizResult=false;openQuestions.add(i);persist();if(document.querySelector('.quiz-card'))refreshQuiz(i);else render();if(changed&&(previous?.audioUrl||getQuestion()?.audioUrl))setAudio();else{resetListeningAnchor();updatePlayer()}}
function downloadRecord(){const text=JSON.stringify({version:1,exportedAt:new Date().toISOString(),state},null,2);if(window.Android?.exportText){window.Android.exportText('listenly-progress.json',text);return}const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='listenly-progress.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
let dialogTrigger=null;
function closeDialog(){const shade=document.querySelector('.dialog-shade:not(.is-closing)');if(!shade)return;dismissOverlay(shade,shade.querySelector('.dialog'));if(dialogTrigger?.isConnected)dialogTrigger.focus();dialogTrigger=null}
function dialog(html){document.querySelectorAll('.dialog-shade').forEach(shade=>shade.remove());dialogTrigger=document.activeElement;const el=document.createElement('div');el.className='dialog-shade';el.innerHTML=`<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">${html}</section>`;app.append(el);syncGlass(el);animateOverlay(el.querySelector('.dialog'));el.querySelector('button')?.focus()}
function importDialog(){dialog(`<div class="dialog-top"><h2 id="dialog-title">导入材料</h2><button class="icon-btn" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><button class="import-choice" data-action="choose-folder" data-mode="intensive">${icon('headphones')}<div><strong>精听文件夹</strong><span>音频 · 原文 · 翻译</span></div>${icon('chevron')}</button><button class="import-choice" data-action="choose-folder" data-mode="exam">${icon('quiz')}<div><strong>做题文件夹</strong><span>套卷 · 分题音频 · 题目选项</span></div>${icon('chevron')}</button>`)}
function setBusy(value,message='正在整理听力材料…'){busy=value;document.querySelector('.busy')?.remove();if(value){const el=document.createElement('div');el.className='busy';el.innerHTML=`<div class="spinner"></div><span>${esc(message)}</span>`;document.body.append(el)}}
async function chooseFolder(mode){if(busy)return;importMode=mode;closeDialog();if(window.Android?.importFolder){window.Android.importFolder(mode);return}const input=document.querySelector('#folder-input');input.value='';input.click()}
async function processImport(input,silent=false){if(!silent)setBusy(true);try{const parsed=await parseFolder(input);const merged=mergePapers(papers,parsed.papers);papers=merged.papers;migrateArticleCompletions(state,papers);const warnings=[...parsed.warnings,...merged.warnings];state.lastImport={name:input.name,count:parsed.papers.length,date:new Date().toISOString()};persist();if(!silent){render();toast(`已导入 ${parsed.papers.length} 套材料，两种模式自动关联`);if(warnings.length)dialog(`<div class="dialog-top"><h2 id="dialog-title">材料已整理</h2><button class="icon-btn" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><p>已导入 ${parsed.papers.length} 套材料。以下内容需要补充或检查：</p><ul class="warning-list">${warnings.slice(0,30).map(w=>`<li>${esc(typeof w==='string'?w:w.message||JSON.stringify(w))}</li>`).join('')}</ul><button class="primary-btn footer-button" data-action="close-dialog">开始练习</button>`)}return parsed}catch(error){if(!silent)toast(`导入失败：${error.message}`);console.warn('Import',error);return null}finally{if(!silent)setBusy(false)}}
function db(){return new Promise((resolve,reject)=>{const request=indexedDB.open('listenly.files',1);request.onupgradeneeded=()=>request.result.createObjectStore('imports',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function storeFiles(item){const database=await db();await new Promise((resolve,reject)=>{const tx=database.transaction('imports','readwrite');tx.objectStore('imports').put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});database.close()}
async function readImports(){const database=await db();const items=await new Promise((resolve,reject)=>{const request=database.transaction('imports').objectStore('imports').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});database.close();return items}
function readFileText(file){if(typeof file.text==='function')return file.text();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(file)})}
function newImportId(){if(window.crypto?.randomUUID)return crypto.randomUUID();const values=new Uint8Array(16);crypto.getRandomValues(values);values[6]=(values[6]&15)|64;values[8]=(values[8]&63)|128;return [...values].map((v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('')}
async function mapBrowserImport(item){const files=await Promise.all(item.files.map(async record=>{const file=record.file||record;const url=URL.createObjectURL(file);transientUrls.add(url);return {path:record.path||file.webkitRelativePath?.split('/').slice(1).join('/')||file.name,url,size:file.size,text:/\.(json|txt|srt|vtt|lrc|md)$/i.test(file.name)?await readFileText(file):undefined}}));return {mode:item.mode,name:item.name,files}}
document.querySelector('#folder-input').addEventListener('change',async event=>{const files=[...event.target.files];if(!files.length)return;setBusy(true);const item={id:newImportId(),name:files[0].webkitRelativePath.split('/')[0],mode:importMode,files:files.map(file=>({file,path:file.webkitRelativePath.split('/').slice(1).join('/')}))};try{await storeFiles(item);const mapped=await mapBrowserImport(item);setBusy(false);await processImport(mapped)}catch(error){setBusy(false);toast(`材料保存失败：${error.message}`)}});
window.addEventListener('listenly-import',event=>processImport(event.detail));
window.addEventListener('listenly-import-error',event=>{setBusy(false);toast(event.detail?.message||'导入失败，请重试')});
window.addEventListener('listenly-export-error',event=>toast(event.detail?.message||'记录导出失败，请重试'));
window.addEventListener('listenly-import-progress',event=>{setBusy(true,event.detail?.message||'正在复制材料到本机…')});
app.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button||button.disabled)return;settleStudyClock();const action=button.dataset.action;switch(action){
  case 'nav':nav(button.dataset.route);break;
  case 'open':selectMaterial(button.dataset.paper,button.dataset.article);break;
  case 'home-play':case 'material-play':await playAtHome(button.dataset.paper,button.dataset.article);break;
  case 'select-paper':choosePaper(button.dataset.paper);break;
  case 'open-paper':previewPaper(button.dataset.paper);break;
  case 'library-back':libraryBack();break;
  case 'filter-menu':showFilterMenu(button);break;
  case 'theme':state.theme=button.dataset.theme==='dark'?'dark':'light';applyTheme();persist();break;
  case 'mode':switchMode(button.dataset.mode);break;
  case 'display':if(state.display!==button.dataset.display){state.display=button.dataset.display;persist();render();reveal(document.querySelector('.transcript-card'))}break;
  case 'play':await togglePlay();break;
  case 'speed':showSpeedMenu(button);break;
  case 'seek-relative':{const homePlayer=button.closest('.home-playback');if(homePlayer)prepareHomePlayback(homePlayer.dataset.paper,homePlayer.dataset.article);if(sourceAudio())seekPlayback(Number(audio.dataset.pendingTime??audio.currentTime)+Number(button.dataset.seconds));break}
  case 'sentence':{const row=getArticle()?.transcript[Number(button.dataset.index)];if(row?.timed!==false){settleListeningCoverage(true);audio.currentTime=row.start;currentSentence=Number(button.dataset.index);await togglePlayIfPaused()}break}
  case 'playback-mode':state.playbackMode=nextPlaybackMode(state.playbackMode);persist();updatePlayer();toast(playbackModeDetails(state.playbackMode).label);break;
  case 'bookmark':{const key=materialKey();state.bookmarks=state.bookmarks.includes(key)?state.bookmarks.filter(k=>k!==key):[...state.bookmarks,key];persist();button.classList.toggle('active',state.bookmarks.includes(key));button.setAttribute('aria-pressed',String(state.bookmarks.includes(key)));button.setAttribute('aria-label',state.bookmarks.includes(key)?'取消收藏':'收藏文章');break}
  case 'toggle-question':{const index=Number(button.dataset.index);if(openQuestions.has(index)){openQuestions.delete(index);refreshQuiz(index)}else setQuestion(index);break}
  case 'answer':{const index=Number(button.dataset.index),q=questions()[index];if(q&&!getAnswer(q)?.submitted&&q.options.some(o=>o.id===button.dataset.option)){state.answers[answerKey(q)]={choice:button.dataset.option,submitted:false};openQuestions.delete(index);persist();refreshQuiz(index)}break}
  case 'submit-article':{const qs=questions();if(qs.length&&qs.every(hasChoice)&&qs.some(q=>!getAnswer(q)?.submitted)){const at=Date.now();for(const q of qs){const answer=getAnswer(q);if(!answer.submitted){answer.submitted=true;answer.at=at;recordQuestionSubmission(state,answerKey(q),at)}}recordArticleCompletion(state,paperId(),getArticle(),at);openQuestions.clear();persist();refreshQuiz();document.querySelector('[data-action="view-result"]')?.focus({preventScroll:true})}break}
  case 'view-result':if(questions().length&&questions().every(q=>getAnswer(q)?.submitted)){quizResult=true;settleListeningCoverage(true);audio.pause();savePosition();render()}break;
  case 'restart-quiz':for(const q of questions())delete state.answers[answerKey(q)];openQuestions.clear();setQuestion(0);break;
  case 'import':importDialog();break;
  case 'close-dialog':closeDialog();break;
  case 'choose-folder':await chooseFolder(button.dataset.mode);break;
  case 'export':downloadRecord();break;
}settleStudyClock()});
async function togglePlayIfPaused(){if(audio.paused)await togglePlay()}
app.addEventListener('input',event=>{if(event.target.id==='seek'){const value=Number(event.target.value),homePlayer=event.target.closest('.home-playback');if(homePlayer)prepareHomePlayback(homePlayer.dataset.paper,homePlayer.dataset.article);if(sourceAudio())seekPlayback(value)}if(event.target.id==='search'){libraryFilters.search=event.target.value;filterLibrary()}});
app.addEventListener('change',event=>{if(['year-filter','kind-filter'].includes(event.target.id))filterLibrary()});
app.addEventListener('keydown',event=>{if(event.key==='Escape'){const overlay=document.querySelector('.dialog-shade:not(.is-closing)');if(overlay){event.preventDefault();closeDialog();return}if(openQuestions.size&&state.mode==='exam'&&!quizResult){const row=event.target.closest('.quiz-question'),focused=Number(row?.dataset.questionIndex),index=row&&openQuestions.has(focused)?focused:[...openQuestions].pop();openQuestions.delete(index);refreshQuiz(index)}}});
document.addEventListener('keydown',event=>{
  const dialog=document.querySelector('.dialog-shade:not(.is-closing) .dialog');if(dialog&&event.key==='Tab'){const buttons=[...dialog.querySelectorAll('button:not(:disabled),[tabindex="0"]')],first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
  if(!speedMenu)return;
  if(event.key==='Escape'){event.preventDefault();closeSpeedMenu();return}
  if(event.key==='Tab'){closeSpeedMenu();return}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const options=[...speedMenu.shade.querySelectorAll('.speed-option')],current=options.indexOf(document.activeElement);
  const index=event.key==='Home'?0:event.key==='End'?options.length-1:(current+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
  options[index].focus();
});
window.addEventListener('resize',()=>closeSpeedMenu(false));
window.addEventListener('scroll',event=>{if(speedMenu&&(!(event.target instanceof Node)||!speedMenu.shade.contains(event.target)))closeSpeedMenu(false)},true);
function filterLibrary(){if(state.route!=='library')return;const paper=papers.find(p=>p.id===libraryPaperId),visible=paper?filteredArticles(paper):filteredPapers();document.querySelector('#library-list').innerHTML=(paper?visible.map((article,index)=>materialRow(paper,article,index)):visible.map(paperRow)).join('')||'<div class="empty">暂无匹配材料</div>';const count=document.querySelector('.library-stats');if(count)count.textContent=`${visible.length} 套`}

audio.addEventListener('loadedmetadata',()=>{if(audio.dataset.pendingTime!==undefined){const requested=Number(audio.dataset.pendingTime),target=audio.dataset.pendingSeek==='true'?Math.max(0,Math.min(audio.duration,Number.isFinite(requested)?requested:0)):playablePosition(requested,audio.duration);if(Math.abs(audio.currentTime-target)>.05)audio.currentTime=target;delete audio.dataset.pendingTime;delete audio.dataset.pendingSeek}const error=document.querySelector('#audio-error');if(error)error.hidden=true;updatePlayer()});
audio.addEventListener('play',()=>{settleStudyClock();lastPlaybackTick=performance.now();resetListeningAnchor();updatePlayer()});
audio.addEventListener('playing',()=>{lastPlaybackTick=performance.now();resetListeningAnchor();promotePlayingMaterial()});
audio.addEventListener('pause',()=>{settleListeningCoverage(true);settleStudyClock();savePosition();lastPlaybackTick=0;updatePlayer()});
audio.addEventListener('seeking',()=>{listeningAnchor=null;lastPlaybackTick=0});
audio.addEventListener('seeked',()=>{resetListeningAnchor();if(!audio.paused)lastPlaybackTick=performance.now()});
audio.addEventListener('ratechange',()=>{settleListeningCoverage();resetListeningAnchor()});
audio.addEventListener('timeupdate',()=>{settleListeningCoverage();const now=performance.now();if(!audio.paused&&!audio.seeking){if(lastPlaybackTick){const seconds=Math.min(2,(now-lastPlaybackTick)/1000);recordListeningSeconds(state,seconds);const key=materialKey();state.activity[key]??={seconds:0,last:0};state.activity[key].seconds+=seconds;state.activity[key].last=Date.now()}lastPlaybackTick=now}
  highlightSentence();updatePlayer();if(currentAudioKey)state.positions[currentAudioKey]=audio.currentTime;
});
let deferredPlaybackKey=null;
window.addEventListener('listenly-seek-release',()=>{const key=deferredPlaybackKey;deferredPlaybackKey=null;if(key&&key===fullListeningKey()&&audio.ended)advancePlayback().catch(()=>toast('播放失败，点播放重试'))});
async function advancePlayback(){
  // Question clips stop at their end so playback never changes an unanswered quiz.
  if(state.mode!=='intensive'||!fullListeningKey())return;
  if(isRangeInteracting()){deferredPlaybackKey=fullListeningKey();return}
  const paper=getPaper(),current=getArticle(),next=nextPlaybackArticle(paper?.articles,current?.id,state.playbackMode);
  if(!paper||!next)return;
  settleStudyClock();state.active={paper:paper.id,article:next.id};quizResult=false;resetQuestionDisclosure();currentSentence=-1;
  state.positions[audioKey()]=0;persist();if(state.route==='practice')render();setAudio(0);
  await togglePlay();settleStudyClock();
}
audio.addEventListener('ended',()=>{settleListeningCoverage(true);const key=fullListeningKey();if(key)finishListeningArticle(state,key,audio.duration);savePosition();updatePlayer();advancePlayback().catch(()=>toast('播放失败，点播放重试'))});
audio.addEventListener('error',()=>{const el=document.querySelector('#audio-error');if(el){el.hidden=false;el.textContent='播放失败，点播放重试'}updatePlayer()});
window.addEventListener('pagehide',()=>{settleListeningCoverage(true);settleStudyClock();savePosition()});document.addEventListener('visibilitychange',()=>{settleStudyClock();if(document.hidden){settleListeningCoverage();savePosition()}});setInterval(()=>{settleStudyClock();if(state.route==='profile'){if(profileDay!==today())render();else refreshProfileStats()}},1000);setInterval(()=>{if(!audio.paused||questionStudyActive)persist()},5000);
window.listenlyBack=()=>{if(speedMenu){closeSpeedMenu();return true}if(document.querySelector('.dialog-shade:not(.is-closing)')){closeDialog();return true}if(state.route==='library'&&libraryPaperId){libraryBack();return true}if(state.route!=='home'){nav('home');return true}return false};

async function init(){try{const response=await fetch('demo.json');if(!response.ok)throw new Error('demo missing');const demo=await response.json();papers=[demo];const bundled=await fetch('bundled-library.json').catch(()=>null);if(bundled?.ok){const data=await bundled.json();papers=mergePapers(data.papers||[],papers).papers}
  if(window.Android?.getImports){let manifests=[];try{manifests=JSON.parse(window.Android.getImports())}catch{}for(const manifest of manifests)await processImport(manifest,true)}else{try{for(const item of await readImports())await processImport(await mapBrowserImport(item),true)}catch(error){console.warn('Local files unavailable',error)}}
  if(state.active&&!getArticle())state.active=null;state.selectedPaper=selectedPaper()?.id||null;migrateArticleCompletions(state,papers);render();if(state.active)setAudio();persist();
}catch(error){console.error(error);app.innerHTML='<div class="app-shell"><div class="empty">材料加载失败，请重新打开应用。</div></div>'}}
mountGlass();applyTheme();init();
