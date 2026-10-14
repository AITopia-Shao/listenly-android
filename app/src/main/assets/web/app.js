import {parseFolder, mergePapers} from './importer.js';
import {mapAudioTime} from './alignment.js';
import {localDateKey,normalizeActivity,recordQuestionSubmission,recordListeningSeconds,recordStudySeconds,activitySummary,activityCalendar} from './activity.js';

const icons={headphones:'<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',plus:'<path d="M12 5v14M5 12h14"/>',book:'<path d="M12 5c-3-2-7-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1zM12 5v15"/>',home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',chevron:'<path d="m9 5 7 7-7 7"/>',back:'<path d="m14 5-7 7 7 7"/>',play:'<path d="m9 5 10 7-10 7z" fill="currentColor" stroke="none"/>',pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',folder:'<path d="M3 7V5h6l3 3h9v12H3z"/>',check:'<path d="m5 12 4 4 10-10"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',eyeoff:'<path d="m3 3 18 18M10 5a11 11 0 0 1 12 7 16 16 0 0 1-4 4M6 6a17 17 0 0 0-4 6c4 7 10 9 16 4M10 10a3 3 0 0 0 4 4"/>',translate:'<path d="M3 5h12M9 3v2M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-8 10M13 21l4-11 4 11M15 17h4"/>',quiz:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="m8 9 1 1 2-3M13 9h3M8 15h2M13 15h3"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',fire:'<path d="M13 3c2 5 5 6 5 11a6 6 0 0 1-12 0c0-3 2-5 4-8 0 4 2 4 3-3z"/>',bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',rewind:'<path d="M5 8a8 8 0 1 1-1 8M5 3v5H1"/>',forward:'<path d="M19 8a8 8 0 1 0 1 8M19 3v5h4"/>',repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',leaf:'<path d="M4 20c1-5 6-9 13-13M4 17C0 9 9 3 21 3c0 11-7 18-17 14z"/>'};
const icon=(name,extra='')=>`<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${icons[name]||icons.book}</svg>`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const audio=document.querySelector('#audio');
const app=document.querySelector('#app');
const storageKey='listenly.state.v1';
const playbackSpeeds=[.75,1,1.25,1.5];
let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
const state={route:'home',mode:'intensive',display:'hidden',theme:saved.theme==='dark'?'dark':'light',speed:playbackSpeeds.includes(Number(saved.speed))?Number(saved.speed):1,active:saved.active||null,positions:saved.positions||{},answers:saved.answers||{},questionIndices:saved.questionIndices||{},bookmarks:saved.bookmarks||[],days:saved.days||{},studyDays:saved.studyDays||{},dailyQuestions:saved.dailyQuestions||{},activityVersion:saved.activityVersion,activity:saved.activity||{},lastImport:saved.lastImport||null};
normalizeActivity(state);
let papers=[],currentAudioKey='',loop=false,currentSentence=-1,importMode='intensive',quizResult=false,lastPlaybackTick=0,toastTimer,busy=false;
let speedMenu=null;
const transientUrls=new Set();
const paperId=()=>state.active?.paper;
const getPaper=()=>papers.find(p=>p.id===paperId());
const getArticle=()=>getPaper()?.articles.find(a=>a.id===state.active?.article);
const keyFor=(p,a)=>JSON.stringify([p,a]);
const materialKey=()=>keyFor(state.active?.paper,state.active?.article);
const qIndex=()=>state.questionIndices[materialKey()]||0;
const questions=()=>getArticle()?.questions||[];
const getQuestion=()=>questions()[qIndex()];
const answerKey=q=>JSON.stringify([state.active?.paper,state.active?.article,q?.id]);
const getAnswer=q=>state.answers[answerKey(q)];
const today=()=>localDateKey();
const formatTime=n=>{n=Number.isFinite(n)?Math.max(0,n):0;return `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`};
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(state))}catch{toast('存储空间不足，请导出学习记录。')}}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500)}
function nav(route){settleStudyClock();savePosition();if(route!=='practice')audio.pause();state.route=route;quizResult=false;render();settleStudyClock();window.scrollTo(0,0)}
function selectMaterial(p,a){settleStudyClock();savePosition();if(state.route!=='practice'){if(state.mode==='exam'&&state.active?.paper===p&&state.active?.article===a)switchMode('intensive');else state.mode='intensive';state.display='hidden'}state.active={paper:p,article:a};state.route='practice';quizResult=false;loop=false;currentSentence=-1;persist();render();setAudio();settleStudyClock();window.scrollTo(0,0)}
async function playAtHome(p,a){settleStudyClock();savePosition();const same=state.active?.paper===p&&state.active?.article===a;if(same&&state.mode==='exam')switchMode('intensive',false);else if(!same){audio.pause();state.active={paper:p,article:a};state.mode='intensive'}state.display='hidden';loop=false;currentSentence=-1;setAudio();persist();await togglePlay();settleStudyClock()}
function savePosition(){if(currentAudioKey&&Number.isFinite(audio.currentTime)){state.positions[currentAudioKey]=audio.currentTime;persist()}}
function sourceAudio(){const article=getArticle();if(!article)return null;const q=getQuestion();return state.mode==='exam'?(q?.audioUrl||article.audio?.exam||article.audio?.intensive):(article.audio?.intensive||article.audio?.exam)}
function audioKey(){return JSON.stringify([state.active?.paper,state.active?.article,state.mode,state.mode==='exam'&&getQuestion()?.audioUrl?getQuestion().id:'passage'])}
function playablePosition(time,duration){time=Number.isFinite(time)?Math.max(0,time):0;return Number.isFinite(duration)&&duration>0&&time>=duration-.05?0:time}
function reloadAudio(url,key,time){audio.pause();currentAudioKey=key;audio.dataset.pendingTime=String(Number.isFinite(time)?Math.max(0,time):0);audio.src=url;audio.load();audio.playbackRate=state.speed;updatePlayer()}
function setAudio(mappedTime){const url=sourceAudio();const key=audioKey();if(!url){audio.pause();audio.removeAttribute('src');audio.load();currentAudioKey='';updatePlayer();return}
  if(audio.getAttribute('src')!==url||audio.error||audio.networkState===3||audio.ended){reloadAudio(url,key,mappedTime??state.positions[key]??0)}
  else if(key!==currentAudioKey){currentAudioKey=key;const target=mappedTime??state.positions[key]??audio.currentTime;if(Number.isFinite(audio.duration))audio.currentTime=playablePosition(target,audio.duration);else audio.dataset.pendingTime=String(target)}
  audio.playbackRate=state.speed;updatePlayer();
}
function reveal(element){if(!element||window.matchMedia('(prefers-reduced-motion: reduce)').matches||typeof element.animate!=='function')return;try{element.animate([{opacity:.82},{opacity:1}],{duration:140,easing:'cubic-bezier(.2,.8,.2,1)'})}catch{}}
function restoreIndicator(selector,transform){const control=document.querySelector(selector);if(control&&transform&&transform!=='none'){control.style.setProperty('--segment-from-transform',transform);control.classList.add('is-moving')}}
function switchMode(mode,updateView=true){if(state.mode===mode)return;settleStudyClock();const previousControl=document.querySelector('.mode-control'),previousTransform=previousControl?getComputedStyle(previousControl,'::before').transform:null;const oldArticle=getArticle(),oldQ=getQuestion(),previous=state.mode,oldTime=audio.currentTime;const oldUrl=sourceAudio();savePosition();state.mode=mode;quizResult=false;loop=false;currentSentence=-1;persist();if(updateView){render();const control=document.querySelector('.mode-control');if(control&&previousTransform&&previousTransform!=='none'){control.style.setProperty('--segment-from-transform',previousTransform);control.classList.add('is-moving')}reveal(document.querySelector('.main-panel>div'))}if(state.active&&getArticle()){
  let mapped;if(oldUrl&&oldUrl===sourceAudio())mapped=oldTime;
  else if(previous==='exam'&&oldQ?.audioUrl&&oldQ.audioTimeline)mapped=mapAudioTime(oldTime,oldQ.audioTimeline);
  else if(mode==='exam'&&getQuestion()?.audioUrl&&getQuestion().audioTimeline)mapped=mapAudioTime(oldTime,getQuestion().audioTimeline,'articleToClip');
  else if(previous==='exam'&&oldQ?.audioUrl&&Number.isFinite(oldQ.start)&&oldArticle?.audio?.intensive)mapped=oldQ.start+oldTime;
  else if(mode==='exam'&&getQuestion()?.audioUrl&&Number.isFinite(getQuestion().start))mapped=Math.max(0,oldTime-getQuestion().start);
  else if(!(previous==='exam'&&oldQ?.audioUrl)&&!(mode==='exam'&&getQuestion()?.audioUrl))mapped=oldTime;
  setAudio(mapped);
}settleStudyClock()}
function applyTheme(){document.documentElement.dataset.theme=state.theme;document.querySelector('meta[name="theme-color"]').content=state.theme==='dark'?'#000000':'#fafafa';document.querySelectorAll('.theme-control').forEach(control=>{control.dataset.current=state.theme;control.querySelectorAll('[data-theme]').forEach(button=>{const active=button.dataset.theme===state.theme;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))})});if(window.Android?.setTheme)window.Android.setTheme(state.theme)}
function speedControl(profile=false){return `<button ${profile?'id="pref-speed"':''} class="${profile?'pref-speed':'speed-btn'}" data-action="speed" aria-label="${profile?'默认播放速度':'播放速度'}，${state.speed}倍" aria-haspopup="menu" aria-expanded="false"><span class="speed-value">${state.speed}×</span>${icon('chevron')}</button>`}
function closeSpeedMenu(restoreFocus=true){if(!speedMenu)return;const {shade,trigger}=speedMenu;speedMenu=null;shade.remove();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');if(restoreFocus&&trigger.isConnected){try{trigger.focus({preventScroll:true})}catch{trigger.focus()}}}
function setPlaybackSpeed(value){const speed=Number(value);if(!playbackSpeeds.includes(speed))return;state.speed=speed;audio.playbackRate=speed;persist();document.querySelectorAll('[data-action="speed"]').forEach(button=>{button.querySelector('.speed-value').textContent=`${speed}×`;button.setAttribute('aria-label',`${button.id==='pref-speed'?'默认播放速度':'播放速度'}，${speed}倍`)})}
function showSpeedMenu(trigger){
  if(speedMenu?.trigger===trigger){closeSpeedMenu();return}closeSpeedMenu(false);
  const shade=document.createElement('div');shade.className='speed-shade';
  shade.innerHTML=`<div id="speed-menu" class="speed-popover" role="menu" aria-label="播放速度" style="visibility:hidden;animation:none">${playbackSpeeds.map(speed=>`<button class="speed-option" data-action="set-speed" data-speed="${speed}" role="menuitemradio" aria-checked="${state.speed===speed}" tabindex="-1"><span>${speed}×</span>${icon('check')}</button>`).join('')}</div>`;
  document.body.append(shade);const menu=shade.querySelector('.speed-popover'),bounds=trigger.getBoundingClientRect(),margin=12;
  menu.style.width=`${Math.min(176,innerWidth-margin*2)}px`;menu.style.maxHeight=`${Math.max(44,innerHeight-margin*2)}px`;
  const height=menu.getBoundingClientRect().height,width=menu.getBoundingClientRect().width;
  const below=innerHeight-bounds.bottom-8>=height||bounds.top-8<height;
  menu.style.left=`${Math.max(margin,Math.min(bounds.left,innerWidth-width-margin))}px`;
  menu.style.top=`${Math.max(margin,Math.min(below?bounds.bottom+6:bounds.top-height-6,innerHeight-height-margin))}px`;
  menu.style.setProperty('--menu-origin',below?'top left':'bottom left');menu.style.visibility='visible';menu.style.animation='';
  speedMenu={shade,trigger};trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls','speed-menu');
  shade.addEventListener('click',event=>{const option=event.target.closest('[data-action="set-speed"]');if(option&&shade.contains(option)){setPlaybackSpeed(option.dataset.speed);closeSpeedMenu()}else if(event.target===shade)closeSpeedMenu()});
  (menu.querySelector('[aria-checked="true"]')||menu.querySelector('button')).focus();
}
function themeControl(){return `<div class="theme-control" data-current="${state.theme}" role="group" aria-label="外观"><button data-action="theme" data-theme="light" class="${state.theme==='light'?'active':''}" aria-pressed="${state.theme==='light'}">日间</button><button data-action="theme" data-theme="dark" class="${state.theme==='dark'?'active':''}" aria-pressed="${state.theme==='dark'}">夜间</button></div>`}
function topbar(){return `<header class="topbar">${themeControl()}<button class="icon-btn" data-action="import" aria-label="导入材料">${icon('plus')}</button></header>`}
function bottomNav(){return `<nav class="bottom-nav" aria-label="主导航">${[['home','headphones','听力'],['library','book','资料库'],['profile','user','我的']].map(([route,i,label])=>`<button class="nav-item ${state.route===route?'active':''}" data-action="nav" data-route="${route}" ${state.route===route?'aria-current="page"':''}>${icon(i)}<span>${label}</span></button>`).join('')}</nav>`}
function modeControl(){return `<div class="mode-control" data-current="${state.mode}" role="group" aria-label="训练模式"><button data-action="mode" data-mode="intensive" class="${state.mode==='intensive'?'active':''}" aria-pressed="${state.mode==='intensive'}">精听</button><button data-action="mode" data-mode="exam" class="${state.mode==='exam'?'active':''}" aria-pressed="${state.mode==='exam'}">做题</button></div>`}
function allArticles(){return papers.flatMap(p=>p.articles.map(a=>({p,a})))}
function materialRow(p,a,index=0){
  const done=(a.questions||[]).filter(q=>getStoredAnswer(p,a,q)?.submitted).length;
  const detail=state.mode==='exam'?`${done} / ${a.questions?.length||0} 题`:a.duration?formatTime(a.duration):'';
  const copy=`<span class="paper-copy"><h3>${esc(a.title)}</h3><p><span>${esc(p.isDemo?'原创示例':p.title)}</span>${detail?`<span class="row-detail">${detail}</span>`:''}</p></span>`;
  if(state.route==='home')return `<div class="paper-row home-paper-row"><button class="paper-open" data-action="open" data-paper="${esc(p.id)}" data-article="${esc(a.id)}">${copy}</button><button class="row-play" data-action="home-play" data-paper="${esc(p.id)}" data-article="${esc(a.id)}" aria-label="播放音频：${esc(a.title)}" aria-pressed="false">${icon('play')}</button></div>`;
  return `<button class="paper-row" data-action="open" data-paper="${esc(p.id)}" data-article="${esc(a.id)}">${copy}<span class="row-play">${icon('play')}</span></button>`;
}
function getStoredAnswer(p,a,q){return state.answers[JSON.stringify([p.id,a.id,q.id])]}
function home(){
  const articles=allArticles();
  const recent=articles.find(({p,a})=>p.id===state.active?.paper&&a.id===state.active?.article)||articles[0];
  const focus=recent?.a;
  const hasRecord=recent&&(Object.entries(state.positions).some(([key,value])=>{try{const [p,a]=JSON.parse(key);return p===recent.p.id&&a===focus.id&&value>0}catch{return false}})||Object.entries(state.answers).some(([key])=>{try{const [p,a]=JSON.parse(key);return p===recent.p.id&&a===focus.id}catch{return false}}));
  const remaining=articles.filter(({p,a})=>p.id!==recent?.p.id||a.id!==focus?.id).slice(0,6);
  return `${topbar()}<section class="focus-card"><button class="focus-open" data-action="${recent?'open':'import'}" data-paper="${esc(recent?.p.id)}" data-article="${esc(focus?.id)}"><span class="focus-copy"><p class="card-kicker">${hasRecord?'继续练习':esc(recent?.p.isDemo?'原创示例':recent?.p.title||'导入材料')}</p><h2>${esc(focus?.title||'暂无材料')}</h2><p class="subtitle">${[focus?.duration?formatTime(focus.duration):'',focus?.questions?.length?`${focus.questions.length} 题`:''].filter(Boolean).join(' · ')}</p></span></button><button class="focus-play" data-action="${recent?'home-play':'import'}" data-paper="${esc(recent?.p.id)}" data-article="${esc(focus?.id)}" aria-label="${recent?'播放音频：'+esc(focus.title):'导入材料'}" aria-pressed="false">${icon(recent?'play':'plus')}</button></section><div class="section-header"><span>${articles.length} 篇</span></div><div class="paper-list">${remaining.map(({p,a},i)=>materialRow(p,a,i)).join('')}</div>`;
}
function articlePanel(){
  const paper=getPaper();
  const warnings=paper.articles.flatMap(a=>(a.warnings||[]).map(w=>`${a.title}：${typeof w==='string'?w:w.message||JSON.stringify(w)}`));
  return `<div class="dialog-top"><h2 id="dialog-title">${esc(paper.title)}</h2><button class="icon-btn" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><div class="article-list">${paper.articles.map((a,i)=>`<button class="article-button ${a.id===state.active.article?'active':''}" data-action="open" data-paper="${esc(paper.id)}" data-article="${esc(a.id)}"><span>${String(i+1).padStart(2,'0')}</span><span class="article-copy"><strong>${esc(a.title)}</strong><span class="article-meta">${[a.duration?formatTime(a.duration):'',a.questions?.length?`${a.questions.length} 题`:''].filter(Boolean).join(' · ')}</span></span></button>`).join('')}</div>${warnings.length?`<details class="format-details"><summary>材料提示 · ${warnings.length}</summary><ul class="warning-list">${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}${paper.isDemo||paper.source?.title?`<p class="source-note">${esc(paper.isDemo?'原创示例':paper.source.title)}</p>`:''}`;
}
function transcript(){
  const article=getArticle(),rows=article.transcript||[];
  if(state.display==='hidden')return `<div class="transcript-card hidden-transcript">${icon('eyeoff')}<button class="text-btn" data-action="display" data-display="original">显示原文</button></div>`;
  const content=rows.length?rows.map((s,i)=>`<button class="sentence" data-action="sentence" data-index="${i}" ${s.timed===false?'disabled aria-label="无时间戳的原文句子"':''}>${s.timed===false?'':`<span class="timestamp">${formatTime(s.start)}</span>`}<span class="en">${esc(s.en)}</span>${state.display==='bilingual'&&s.zh?`<span class="zh">${esc(s.zh)}</span>`:''}</button>`).join(''):article.text?`<div class="text-content">${esc(article.text)}</div>${state.display==='bilingual'&&article.translation?`<div class="translation-content">${esc(article.translation)}</div>`:''}`:`<div class="empty"><p>暂无原文</p><button class="text-btn" data-action="import">导入精听材料 ${icon('plus')}</button></div>`;
  return `<div class="transcript-card">${content}${state.display==='bilingual'&&(rows.length||article.text)&&!(rows.some(s=>s.zh)||article.translation)?'<p class="source-note">暂无译文</p>':''}</div>`;
}
function playback(){
  const article=getArticle(),timed=article?.transcript?.some(r=>r.timed!==false&&r.start>0);
  return `<footer class="playback-card" aria-label="音频播放"><div class="player-progress"><span id="current-time">00:00</span><input class="seekbar" id="seek" type="range" min="0" max="${article?.duration||100}" value="0" step=".1" aria-label="播放进度" ${sourceAudio()?'':'disabled'}><span id="duration-time">${formatTime(article?.duration)}</span></div><div class="player-buttons">${speedControl()}<button class="skip-btn" data-action="seek-relative" data-seconds="-5" aria-label="后退5秒">${icon('rewind')}<span>5</span></button><button class="big-play" data-action="play" aria-label="${audio.paused?'播放':'暂停'}" ${sourceAudio()?'':'disabled'}>${icon(audio.paused?'play':'pause')}</button><button class="skip-btn" data-action="seek-relative" data-seconds="5" aria-label="前进5秒">${icon('forward')}<span>5</span></button><button class="loop-btn ${loop?'active':''}" data-action="loop" aria-label="单句循环" aria-pressed="${loop}" ${state.mode==='exam'||!timed?'disabled':''}>${icon('repeat')}</button></div><p id="audio-error" class="playback-error" ${sourceAudio()?'hidden':''}>缺少音频</p></footer>`;
}
function quiz(){
  const qs=questions(),q=getQuestion();
  if(!q)return `<div class="quiz-card"><div class="empty"><p>暂无题目</p><button class="text-btn" data-action="import">导入做题材料 ${icon('plus')}</button></div></div>`;
  const answer=getAnswer(q);
  return `<div class="quiz-card"><div class="quiz-top"><span>第 ${esc(q.number??qIndex()+1)} 题</span><span>${qIndex()+1} / ${qs.length}</span></div><h3>${esc(q.prompt||'Listen and choose the best answer.')}</h3><div class="options">${q.options.map(o=>{let cls=answer?.choice===o.id?'selected':'';if(answer?.submitted&&q.answer){if(o.id===q.answer)cls='correct';else if(o.id===answer.choice)cls='wrong'}return `<button class="option ${cls}" data-action="answer" data-option="${esc(o.id)}" ${answer?.submitted?'disabled':''} aria-pressed="${answer?.choice===o.id}"><span class="letter">${esc(o.id)}</span><span>${esc(o.text)}</span>${answer?.submitted&&q.answer===o.id?icon('check'):''}</button>`}).join('')}</div>${answer?.submitted?`<div class="feedback ${q.answer&&answer.choice!==q.answer?'wrong':''}"><strong>${q.answer?(answer.choice===q.answer?'答对了':`答案是 ${esc(q.answer)}`):'已记录 · 无标准答案'}</strong>${q.explanation?`<p>${esc(q.explanation)}</p>`:''}<button class="text-btn" data-action="mode" data-mode="intensive">${icon('headphones')}精听复盘</button></div>`:''}<div class="quiz-actions"><div class="question-dots">${qs.map((item,i)=>`<button class="question-dot ${i===qIndex()?'current':''} ${getAnswer(item)?.submitted?'answered':''}" data-action="question" data-index="${i}" aria-label="第${i+1}题">${i+1}</button>`).join('')}</div><button class="primary-btn" data-action="${answer?.submitted?'next-question':'submit-answer'}" ${!answer?.choice?'disabled':''}>${answer?.submitted?(qIndex()===qs.length-1?'查看结果':'下一题'):'提交答案'} ${icon(answer?.submitted?'chevron':'check')}</button></div></div>`;
}
function result(){
  const qs=questions(),submitted=qs.filter(q=>getAnswer(q)?.submitted),known=submitted.filter(q=>q.answer),correct=known.filter(q=>getAnswer(q).choice===q.answer).length;
  const p=getPaper(),all=p.articles.flatMap(a=>(a.questions||[]).map(q=>({a,q}))),done=all.filter(({a,q})=>getStoredAnswer(p,a,q)?.submitted).length;
  const next=p.articles.slice(p.articles.indexOf(getArticle())+1).find(a=>a.questions?.length);
  return `<div class="result-card"><h2 class="result-score">${known.length?Math.round(correct/known.length*100)+'%':'—'}<span>正确率</span></h2><p>${known.length?`${correct} / ${known.length} 题答对`:'暂无可评分题目'}<br>本篇完成 ${submitted.length} / ${qs.length} 题<br>本套材料已完成 ${done} / ${all.length} 题${submitted.length-known.length?`<br>${submitted.length-known.length} 题无标准答案`:''}</p><div class="result-buttons"><button class="primary-btn" data-action="mode" data-mode="intensive">精听复盘</button>${next?`<button class="primary-btn light" data-action="open" data-paper="${esc(p.id)}" data-article="${esc(next.id)}">下一篇 ${icon('chevron')}</button>`:`<button class="primary-btn light" data-action="restart-quiz">${icon('repeat')}重新练习</button>`}</div></div>`;
}
function practice(){
  const article=getArticle();if(!article){state.route='home';return home()}
  const readerKey=JSON.stringify([state.active.paper,state.active.article,state.mode,state.mode==='exam'?qIndex():null,quizResult]);
  return `<header class="practice-header"><button class="icon-btn" data-action="nav" data-route="home" aria-label="返回听力">${icon('back')}</button><button class="practice-title" data-action="article-list" aria-label="选择文章"><h1>${esc(article.title)}</h1>${icon('chevron')}</button><button class="icon-btn" data-action="nav" data-route="library" aria-label="资料库">${icon('book')}</button><button class="icon-btn bookmark ${state.bookmarks.includes(materialKey())?'active':''}" data-action="bookmark" aria-pressed="${state.bookmarks.includes(materialKey())}" aria-label="${state.bookmarks.includes(materialKey())?'取消收藏':'收藏文章'}">${icon('bookmark')}</button></header><div class="practice-top">${modeControl()}${state.mode==='intensive'?`<div class="display-controls" data-current="${state.display}" role="group" aria-label="原文显示方式">${[['hidden','隐藏'],['original','原文'],['bilingual','双语']].map(([m,t])=>`<button class="${state.display===m?'active':''}" data-action="display" data-display="${m}" aria-pressed="${state.display===m}">${t}</button>`).join('')}</div>`:''}</div><div class="workspace-grid"><div class="main-panel" data-reader-key="${esc(readerKey)}" data-reader-display="${state.mode==='intensive'?state.display:'exam'}" tabindex="0" aria-label="${state.mode==='intensive'?'文章正文':'题目'}">${state.mode==='intensive'?transcript():quizResult?result():quiz()}</div></div>${playback()}`;
}
function library(){
  const years=[...new Set(papers.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
  return `${topbar()}<div class="filter-row"><input id="search" type="search" placeholder="搜索材料" aria-label="搜索材料"><select id="year-filter" aria-label="筛选年份"><option value="">全部年份</option>${years.map(y=>`<option>${y}</option>`).join('')}</select><select id="kind-filter" aria-label="筛选材料"><option value="all">全部材料</option><option value="saved">收藏</option><option value="real">六级真题</option></select></div><p class="library-stats"><span>${papers.filter(p=>!p.isDemo).length} 套</span><span>·</span><span>${allArticles().length} 篇</span><span>·</span><span>${state.bookmarks.length} 收藏</span></p><div id="library-list" class="paper-list">${allArticles().map(({p,a},i)=>materialRow(p,a,i)).join('')||'<div class="empty">暂无材料</div>'}</div>`;
}
function activityView(){
  const calendar=activityCalendar(state);
  const days=calendar.weeks.flat().map(day=>`<span class="calendar-day" role="img" data-date="${day.date}" data-level="${day.level}" data-count="${day.count}" ${day.inRange?'':'data-outside="true" aria-hidden="true"'} ${day.isToday?'aria-current="date"':''} title="${day.date} · ${day.count} 题" aria-label="${day.date}，完成 ${day.count} 题"></span>`).join('');
  return `<section class="activity-card" aria-label="做题活跃度"><div class="calendar-layout"><div class="calendar-weekdays" aria-hidden="true"><span></span><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span></div><div class="activity-calendar" style="--calendar-weeks:${calendar.weekCount}" tabindex="0" aria-label="按日期查看完成题目数量"><div class="calendar-months" aria-hidden="true">${calendar.months.map(month=>`<span style="grid-column:${month.column}">${esc(month.label)}</span>`).join('')}</div><div class="calendar-grid">${days}</div></div></div><div class="activity-legend" aria-label="方块颜色越深，当天完成题目越多">${[0,1,2,3,4].map(level=>`<span class="calendar-day" data-level="${level}" aria-hidden="true"></span>`).join('')}</div></section>`;
}
function profile(){
  const stats=activitySummary(state);
  return `${topbar()}<div class="statistics"><div class="stat"><strong data-stat="today-listening-minutes">${stats.listeningMinutes}</strong><span>今日听力 · 分钟</span></div><div class="stat"><strong data-stat="today-questions">${stats.completedQuestions}</strong><span>今日完成 · 题</span></div><div class="stat"><strong data-stat="total-study-hours">${stats.studyHours.toFixed(1)}</strong><span>总学习时长 · 小时</span></div></div>${activityView()}<div class="settings-grid"><section class="settings-card"><h2>设置</h2><div class="setting-row"><span>播放速度</span>${speedControl(true)}</div><div class="setting-row"><span>学习记录</span><button class="text-btn" data-action="export">导出 ${icon('download')}</button></div><div class="setting-row"><span>资料导入</span><button class="text-btn" data-action="import">文件夹 ${icon('plus')}</button></div></section><section class="settings-card"><h2>最近练习</h2>${Object.entries(state.activity).sort((a,b)=>b[1].last-b[1].last).slice(0,4).map(([key,value])=>{let p,a;try{[p,a]=JSON.parse(key)}catch{return ''}const article=papers.find(paper=>paper.id===p)?.articles.find(art=>art.id===a);return article?`<button class="history-row" data-action="open" data-paper="${esc(p)}" data-article="${esc(a)}"><span class="history-title">${esc(article.title)}</span><small>${Math.max(1,Math.floor(value.seconds/60))} 分钟</small></button>`:''}).join('')||'<p>暂无记录</p>'}</section></div>`;
}
let studyTickAt=performance.now(),questionStudyActive=false,profileDay=today();
function settleStudyClock(){const now=performance.now();if(questionStudyActive)recordStudySeconds(state,Math.max(0,Math.min(2,(now-studyTickAt)/1000)));studyTickAt=now;questionStudyActive=!document.hidden&&state.route==='practice'&&state.mode==='exam'&&!quizResult&&audio.paused}
function refreshProfileStats(){const stats=activitySummary(state);for(const [key,value] of [['today-listening-minutes',stats.listeningMinutes],['today-questions',stats.completedQuestions],['total-study-hours',stats.studyHours.toFixed(1)]]){const el=document.querySelector(`[data-stat="${key}"]`);if(el)el.textContent=value}}
const readerPositions=new Map();
function render(){
  closeSpeedMenu(false);
  const previous=document.querySelector('.main-panel');
  if(previous&&previous.dataset.readerDisplay!=='hidden'){
    const bounds=previous.getBoundingClientRect();
    const sentence=[...previous.querySelectorAll('.sentence')].find(el=>el.getBoundingClientRect().bottom>bounds.top);
    readerPositions.set(previous.dataset.readerKey,{top:previous.scrollTop,index:sentence?.dataset.index,offset:sentence?sentence.getBoundingClientRect().top-bounds.top:null});
  }
  const content=state.route==='home'?home():state.route==='practice'?practice():state.route==='library'?library():profile();
  const practicing=state.route==='practice';
  document.body.classList.toggle('is-practicing',practicing);
  app.innerHTML=`<div class="app-shell ${practicing?'practice-shell':''}">${content}</div>${practicing?'':bottomNav()}`;
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
  updatePlayer();if(practicing)highlightSentence();
  if(state.route==='profile'){const calendar=document.querySelector('.activity-calendar');if(calendar)calendar.scrollLeft=calendar.scrollWidth;profileDay=today()}
}

function updatePlayer(){const seek=document.querySelector('#seek');if(seek){seek.max=Number.isFinite(audio.duration)?audio.duration:getArticle()?.duration||100;seek.value=audio.currentTime||0;seek.setAttribute('aria-valuetext',formatTime(audio.currentTime))}const time=document.querySelector('#current-time'),duration=document.querySelector('#duration-time'),button=document.querySelector('.big-play');if(time)time.textContent=formatTime(audio.currentTime);if(duration)duration.textContent=formatTime(Number.isFinite(audio.duration)?audio.duration:getArticle()?.duration);if(button){const label=audio.paused?'播放':'暂停';if(button.getAttribute('aria-label')!==label)button.innerHTML=icon(audio.paused?'play':'pause');button.setAttribute('aria-label',label)}document.querySelectorAll('[data-action="home-play"]').forEach(button=>{const playing=state.active?.paper===button.dataset.paper&&state.active?.article===button.dataset.article&&!audio.paused&&!audio.error;const article=papers.find(p=>p.id===button.dataset.paper)?.articles.find(a=>a.id===button.dataset.article);if(button.getAttribute('aria-pressed')!==String(playing))button.innerHTML=icon(playing?'pause':'play');button.setAttribute('aria-pressed',String(playing));button.setAttribute('aria-label',`${playing?'暂停':'播放'}音频：${article?.title||''}`)})}
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
function setQuestion(i){const previous=getQuestion();savePosition();state.questionIndices[materialKey()]=Math.min(Math.max(i,0),Math.max(0,questions().length-1));quizResult=false;persist();render();if(previous?.audioUrl||getQuestion()?.audioUrl)setAudio();else updatePlayer()}
function downloadRecord(){const text=JSON.stringify({version:1,exportedAt:new Date().toISOString(),state},null,2);if(window.Android?.exportText){window.Android.exportText('listenly-progress.json',text);return}const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='listenly-progress.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function dialog(html){document.querySelector('.dialog-shade')?.remove();const el=document.createElement('div');el.className='dialog-shade';el.innerHTML=`<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">${html}</section>`;app.append(el);el.querySelector('button')?.focus()}
function importDialog(){dialog(`<div class="dialog-top"><h2 id="dialog-title">导入材料</h2><button class="icon-btn" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><button class="import-choice" data-action="choose-folder" data-mode="intensive">${icon('headphones')}<div><strong>精听文件夹</strong><span>音频 · 原文 · 翻译</span></div>${icon('chevron')}</button><button class="import-choice" data-action="choose-folder" data-mode="exam">${icon('quiz')}<div><strong>做题文件夹</strong><span>套卷 · 分题音频 · 题目选项</span></div>${icon('chevron')}</button><details class="format-details"><summary>文件格式与编号</summary><p class="format-note">音频：MP3 / M4A / WAV / OGG<br>文本：JSON / TXT / SRT / LRC<br>通过 paper.json 中相同的套卷与文章编号合并两种模式。</p></details>`)}
function setBusy(value,message='正在整理听力材料…'){busy=value;document.querySelector('.busy')?.remove();if(value){const el=document.createElement('div');el.className='busy';el.innerHTML=`<div class="spinner"></div><span>${esc(message)}</span>`;document.body.append(el)}}
async function chooseFolder(mode){if(busy)return;importMode=mode;document.querySelector('.dialog-shade')?.remove();if(window.Android?.importFolder){window.Android.importFolder(mode);return}const input=document.querySelector('#folder-input');input.value='';input.click()}
async function processImport(input,silent=false){if(!silent)setBusy(true);try{const parsed=await parseFolder(input);const merged=mergePapers(papers,parsed.papers);papers=merged.papers;const warnings=[...parsed.warnings,...merged.warnings];state.lastImport={name:input.name,count:parsed.papers.length,date:new Date().toISOString()};persist();if(!silent){render();toast(`已导入 ${parsed.papers.length} 套材料，两种模式自动关联`);if(warnings.length)dialog(`<div class="dialog-top"><h2 id="dialog-title">材料已整理</h2><button class="icon-btn" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><p>已导入 ${parsed.papers.length} 套材料。以下内容需要补充或检查：</p><ul class="warning-list">${warnings.slice(0,30).map(w=>`<li>${esc(typeof w==='string'?w:w.message||JSON.stringify(w))}</li>`).join('')}</ul><button class="primary-btn footer-button" data-action="close-dialog">开始练习</button>`)}return parsed}catch(error){if(!silent)toast(`导入失败：${error.message}`);console.warn('Import',error);return null}finally{if(!silent)setBusy(false)}}
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
  case 'home-play':await playAtHome(button.dataset.paper,button.dataset.article);break;
  case 'theme':state.theme=button.dataset.theme==='dark'?'dark':'light';applyTheme();persist();break;
  case 'article-list':if(getPaper())dialog(articlePanel());break;
  case 'mode':switchMode(button.dataset.mode);break;
  case 'display':if(state.display!==button.dataset.display){const control=document.querySelector('.display-controls'),transform=control?getComputedStyle(control,'::before').transform:null;state.display=button.dataset.display;persist();render();restoreIndicator('.display-controls',transform);reveal(document.querySelector('.transcript-card'))}break;
  case 'play':await togglePlay();break;
  case 'speed':showSpeedMenu(button);break;
  case 'seek-relative':if(Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(audio.duration,audio.currentTime+Number(button.dataset.seconds)));break;
  case 'sentence':{const row=getArticle()?.transcript[Number(button.dataset.index)];if(row?.timed!==false){audio.currentTime=row.start;currentSentence=Number(button.dataset.index);await togglePlayIfPaused()}break}
  case 'loop':loop=!loop;button.classList.toggle('active',loop);button.setAttribute('aria-pressed',String(loop));toast(loop?'单句循环已开启':'单句循环已关闭');break;
  case 'bookmark':{const key=materialKey();state.bookmarks=state.bookmarks.includes(key)?state.bookmarks.filter(k=>k!==key):[...state.bookmarks,key];persist();button.classList.toggle('active',state.bookmarks.includes(key));button.setAttribute('aria-pressed',String(state.bookmarks.includes(key)));button.setAttribute('aria-label',state.bookmarks.includes(key)?'取消收藏':'收藏文章');break}
  case 'answer':state.answers[answerKey(getQuestion())]={choice:button.dataset.option,submitted:false};persist();render();break;
  case 'submit-answer':{const answer=getAnswer(getQuestion());if(answer?.choice&&!answer.submitted){answer.submitted=true;answer.at=Date.now();recordQuestionSubmission(state,answerKey(getQuestion()),answer.at);persist();render();reveal(document.querySelector('.feedback'))}break}
  case 'next-question':if(qIndex()<questions().length-1)setQuestion(qIndex()+1);else{quizResult=true;audio.pause();savePosition();render()}break;
  case 'question':setQuestion(Number(button.dataset.index));break;
  case 'restart-quiz':for(const q of questions())delete state.answers[answerKey(q)];setQuestion(0);break;
  case 'import':importDialog();break;
  case 'close-dialog':document.querySelector('.dialog-shade')?.remove();break;
  case 'choose-folder':await chooseFolder(button.dataset.mode);break;
  case 'export':downloadRecord();break;
}settleStudyClock()});
async function togglePlayIfPaused(){if(audio.paused)await togglePlay()}
app.addEventListener('input',event=>{if(event.target.id==='seek'&&Number.isFinite(audio.duration)){audio.currentTime=Number(event.target.value);savePosition();updatePlayer()}if(['search','year-filter','kind-filter'].includes(event.target.id))filterLibrary()});
app.addEventListener('change',event=>{if(['year-filter','kind-filter'].includes(event.target.id))filterLibrary()});
app.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelector('.dialog-shade')?.remove()});
document.addEventListener('keydown',event=>{
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
function filterLibrary(){const search=document.querySelector('#search')?.value.toLowerCase()||'',year=document.querySelector('#year-filter')?.value,kind=document.querySelector('#kind-filter')?.value;const results=allArticles().filter(({p,a})=>(!search||`${p.title} ${a.title} ${p.year||''}`.toLowerCase().includes(search))&&(!year||String(p.year)===year)&&(kind!=='saved'||state.bookmarks.includes(keyFor(p.id,a.id)))&&(kind!=='real'||p.kind==='cet6'||/^cet6[-_]/i.test(p.id)));document.querySelector('#library-list').innerHTML=results.map(({p,a},i)=>materialRow(p,a,i)).join('')||'<div class="empty">暂无匹配材料</div>'}
audio.addEventListener('loadedmetadata',()=>{if(audio.dataset.pendingTime!==undefined){const target=playablePosition(Number(audio.dataset.pendingTime),audio.duration);if(Math.abs(audio.currentTime-target)>.05)audio.currentTime=target;delete audio.dataset.pendingTime}const error=document.querySelector('#audio-error');if(error)error.hidden=true;updatePlayer()});
audio.addEventListener('play',()=>{settleStudyClock();lastPlaybackTick=performance.now();updatePlayer()});
audio.addEventListener('pause',()=>{settleStudyClock();savePosition();lastPlaybackTick=0;updatePlayer()});
audio.addEventListener('timeupdate',()=>{const now=performance.now();if(!audio.paused&&!audio.seeking){if(lastPlaybackTick){const seconds=Math.min(2,(now-lastPlaybackTick)/1000);recordListeningSeconds(state,seconds);const key=materialKey();state.activity[key]??={seconds:0,last:0};state.activity[key].seconds+=seconds;state.activity[key].last=Date.now()}lastPlaybackTick=now}
  const rows=getArticle()?.transcript||[];if(loop&&state.mode==='intensive'&&currentSentence>=0){const current=rows[currentSentence],end=current?.end??rows[currentSentence+1]?.start??audio.duration;if(audio.currentTime>=end-.08){audio.currentTime=current.start;updatePlayer();return}}
  highlightSentence();updatePlayer();if(currentAudioKey)state.positions[currentAudioKey]=audio.currentTime;
});
audio.addEventListener('ended',()=>{if(loop&&currentSentence>=0){audio.currentTime=getArticle().transcript[currentSentence].start;audio.play().catch(()=>{});}else{savePosition();updatePlayer()}});
audio.addEventListener('error',()=>{const el=document.querySelector('#audio-error');if(el){el.hidden=false;el.textContent='播放失败，点播放重试'}updatePlayer()});
window.addEventListener('pagehide',()=>{settleStudyClock();savePosition()});document.addEventListener('visibilitychange',()=>{settleStudyClock();if(document.hidden)savePosition()});setInterval(()=>{settleStudyClock();if(state.route==='profile'){if(profileDay!==today())render();else refreshProfileStats()}},1000);setInterval(()=>{if(!audio.paused||questionStudyActive)persist()},5000);
window.listenlyBack=()=>{if(speedMenu){closeSpeedMenu();return true}if(document.querySelector('.dialog-shade')){document.querySelector('.dialog-shade').remove();return true}if(state.route!=='home'){nav('home');return true}return false};

async function init(){try{const response=await fetch('demo.json');if(!response.ok)throw new Error('demo missing');const demo=await response.json();papers=[demo];const bundled=await fetch('bundled-library.json').catch(()=>null);if(bundled?.ok){const data=await bundled.json();papers=mergePapers(data.papers||[],papers).papers}
  if(window.Android?.getImports){let manifests=[];try{manifests=JSON.parse(window.Android.getImports())}catch{}for(const manifest of manifests)await processImport(manifest,true)}else{try{for(const item of await readImports())await processImport(await mapBrowserImport(item),true)}catch(error){console.warn('Local files unavailable',error)}}
  if(state.active&&!getArticle())state.active=null;render();if(state.active)setAudio();persist();
}catch(error){console.error(error);app.innerHTML='<div class="app-shell"><div class="empty">材料加载失败，请重新打开应用。</div></div>'}}
applyTheme();init();
