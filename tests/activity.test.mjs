import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateKey,normalizeActivity,recordQuestionSubmission,
  recordListeningSeconds,recordStudySeconds,activitySummary,
  activityLevel,activityCalendar,recordArticleCompletion,migrateArticleCompletions,
  recordListeningCoverage,finishListeningArticle,resetListeningSession
} from '../app/src/main/assets/web/activity.js';

const originalTimeZone=process.env.TZ;
process.env.TZ='Asia/Shanghai';
after(()=>{if(originalTimeZone===undefined)delete process.env.TZ;else process.env.TZ=originalTimeZone});
const questionKey=JSON.stringify(['paper','article','q1']);
const local=(year,month,day,hour=0,minute=0,second=0)=>new Date(year,month-1,day,hour,minute,second);
const makeState=input=>normalizeActivity(input||{},local(2026,10,14));

test('date keys follow device midnight, rather than UTC midnight',()=>{
  assert.equal(localDateKey(new Date('2026-10-13T15:59:59.999Z')),'2026-10-13');
  assert.equal(localDateKey(new Date('2026-10-13T16:00:00.000Z')),'2026-10-14');
  assert.equal(localDateKey(local(2026,1,2)),'2026-01-02');
  assert.throws(()=>localDateKey(new Date(NaN)),RangeError);
});

test('legacy date formats merge into one local day while all historical seconds survive',()=>{
  const state=makeState({days:{'2026-10-14':60,'2026/10/14':120,'10/14/2026':180,'14/10/2026':240,'2026-2-28':3600,'unknown old day':600}});
  assert.equal(state.days['2026-10-14'],600);
  assert.equal(state.days['2026-02-28'],3600);
  assert.equal(state.days['unknown old day'],600);
  const summary=activitySummary(state,local(2026,10,14));
  assert.equal(summary.listeningMinutes,0,'legacy elapsed time cannot prove complete playback');
  assert.equal(summary.totalListeningSeconds,4800);
  assert.equal(summary.studyHours,4800/3600);
  normalizeActivity(state,local(2026,10,14));
  assert.equal(activitySummary(state,local(2026,10,14)).totalListeningSeconds,4800,'normalizing twice must not double a merged day');
});

test('invalid dated legacy counters remain in lifetime totals without being attributed to today',()=>{
  const state=makeState({days:{'2026-02-30':600,'2026-10-14':120,negative:-20,bad:NaN,infinite:Infinity}});
  const summary=activitySummary(state,local(2026,10,14));
  assert.equal(state.days['2026-02-30'],600);
  assert.equal(summary.totalSeconds,720);
  assert.equal(summary.listeningMinutes,0);
});

test('legacy submitted answers migrate by their actual local timestamp only once',()=>{
  const previousAt=local(2026,10,13,23,59,59).getTime(),todayAt=local(2026,10,14,0,0,1).getTime();
  const answers={
    a:{choice:'A',submitted:true,at:previousAt},
    b:{choice:'B',submitted:true,at:todayAt},
    c:{choice:'C',submitted:false,at:todayAt},
    d:{choice:'D',submitted:true},
    e:{submitted:true,at:NaN}
  };
  const state=makeState({answers});
  assert.equal(state.dailyQuestions['2026-10-13'].a,1);
  assert.equal(state.dailyQuestions['2026-10-14'].b,1);
  assert.equal(activitySummary(state,local(2026,10,14)).completedQuestions,1);
  assert.equal(state.answers,answers,'answer objects and their scores must remain intact');
  normalizeActivity(state,local(2026,10,15));
  normalizeActivity(state,local(2026,10,15));
  assert.equal(state.dailyQuestions['2026-10-14'].b,1);
  assert.equal(state.dailyQuestions['2026-10-14'].d,undefined,'unknown submission dates must not become today');
  assert.equal(state.activityVersion,2);
});

test('migration preserves pre-existing repeated question counts and normalizes ledger dates',()=>{
  const state=makeState({
    dailyQuestions:{'2026/10/14':{a:2},'10/14/2026':{a:3,b:1}},
    answers:{a:{submitted:true,at:local(2026,10,14,8).getTime()}}
  });
  assert.equal(state.dailyQuestions['2026-10-14'].a,5);
  assert.equal(activitySummary(state,local(2026,10,14)).completedQuestions,6);
});

test('redoing and replacing current answers adds activity without deleting previous days',()=>{
  const state=makeState({answers:{[questionKey]:{choice:'A',submitted:true,at:local(2026,10,13,8).getTime()}}});
  delete state.answers[questionKey];
  assert.equal(recordQuestionSubmission(state,questionKey,local(2026,10,14,8).getTime()),1);
  state.answers[questionKey]={choice:'B',submitted:true,at:local(2026,10,14,8).getTime()};
  delete state.answers[questionKey];
  assert.equal(recordQuestionSubmission(state,questionKey,local(2026,10,14,9).getTime()),2);
  state.answers[questionKey]={choice:'C',submitted:true,at:local(2026,10,14,9).getTime()};
  assert.equal(recordQuestionSubmission(state,questionKey,local(2026,10,15,8).getTime()),1);
  normalizeActivity(state,local(2026,10,15));
  assert.equal(activitySummary(state,local(2026,10,13)).completedQuestions,1);
  assert.equal(activitySummary(state,local(2026,10,14)).completedQuestions,2);
  assert.equal(activitySummary(state,local(2026,10,15)).completedQuestions,1);
});

test('saved activity survives JSON reload without being inferred again from latest answers',()=>{
  const state=makeState({answers:{[questionKey]:{submitted:true,at:local(2026,10,14,8).getTime()}}});
  recordQuestionSubmission(state,questionKey,local(2026,10,14,9).getTime());
  const reloaded=JSON.parse(JSON.stringify(state));
  normalizeActivity(reloaded,local(2026,10,14));
  assert.equal(activitySummary(reloaded,local(2026,10,14)).completedQuestions,2);
  assert.deepEqual(reloaded.answers,state.answers);
});

test('only completed listening affects daily minutes while total study hours retain all actual study time',()=>{
  const state=makeState({days:{'2026-10-13':7200,'2026-10-14':125},studyDays:{'2026-10-13':3475,'2026-10-14':3600}});
  recordQuestionSubmission(state,'a',local(2026,10,13,9).getTime());
  recordQuestionSubmission(state,'b',local(2026,10,14,9).getTime());
  recordQuestionSubmission(state,'c',local(2026,10,14,10).getTime());
  const today=activitySummary(state,local(2026,10,14));
  assert.equal(today.listeningSeconds,0);
  assert.equal(today.listeningMinutes,0);
  assert.equal(today.completedQuestions,2);
  assert.equal(today.totalListeningSeconds,7325);
  assert.equal(today.totalStudySeconds,7075);
  assert.equal(today.totalSeconds,14400);
  assert.equal(today.studyHours,4);
  const tomorrow=activitySummary(state,local(2026,10,15));
  assert.equal(tomorrow.listeningMinutes,0);
  assert.equal(tomorrow.completedQuestions,0);
  assert.equal(tomorrow.studyHours,4);
});

const article={id:'article',questions:[{id:'q1'},{id:'q2'},{id:'q3'}]};
const articleKey=JSON.stringify(['paper','article']);
function submit(state,id,at){
  state.answers??={};
  state.answers[JSON.stringify(['paper','article',id])]={choice:id==='q2'?'B':'A',submitted:true,at};
}

test('an article is counted immediately after every question is submitted, including wrong choices',()=>{
  const state=makeState(),at=local(2026,10,14,8).getTime();
  submit(state,'q1',at);
  assert.equal(recordArticleCompletion(state,'paper',article,at),false);
  submit(state,'q2',at+1000);
  assert.equal(recordArticleCompletion(state,'paper',article,at+1000),false);
  submit(state,'q3',at+2000);
  assert.equal(recordArticleCompletion(state,'paper',article,at+2000),true);
  assert.equal(activitySummary(state,at+2000).completedArticles,1);
  assert.equal(state.articleCompletions[articleKey].last,at+2000);
  assert.equal(recordArticleCompletion(state,'paper',article,at+3000),false,'result-page clicks cannot add another article');
  assert.equal(recordArticleCompletion(state,'paper',{id:'empty',questions:[]},at),false);
});

test('a completed article remains in history while a complete redo counts once again',()=>{
  const state=makeState(),first=local(2026,10,13,8).getTime(),second=local(2026,10,14,8).getTime();
  for(const q of article.questions)submit(state,q.id,first);
  assert.equal(recordArticleCompletion(state,'paper',article,first),true);
  state.answers={};
  submit(state,'q1',second);
  assert.equal(recordArticleCompletion(state,'paper',article,second),false);
  assert.equal(state.articleCompletions[articleKey].last,first,'partial redo must not enter recent practice');
  submit(state,'q2',second+1000);submit(state,'q3',second+2000);
  assert.equal(recordArticleCompletion(state,'paper',article,second+2000),true);
  assert.equal(recordArticleCompletion(state,'paper',article,second+2000),false);
  assert.equal(state.articleCompletions[articleKey].count,2);
  assert.equal(activitySummary(state,first).completedArticles,1);
  assert.equal(activitySummary(state,second).completedArticles,1);
  const reloaded=makeState(JSON.parse(JSON.stringify(state)));
  assert.equal(recordArticleCompletion(reloaded,'paper',article,second+3000),false);
});

test('legacy article migration requires every valid timestamp and uses the final submission day',()=>{
  const state=makeState(),first=local(2026,10,13,23,59,59).getTime(),last=local(2026,10,14,0,0,1).getTime();
  submit(state,'q1',first);submit(state,'q2',first);submit(state,'q3',last);
  state.dailyArticles['2026-10-14']={[articleKey]:4};
  const papers=[{id:'paper',articles:[article,{id:'unfinished',questions:[{id:'q1'}]},{id:'unknown-date',questions:[{id:'q1'}]}]}];
  state.answers[JSON.stringify(['paper','unknown-date','q1'])]={choice:'A',submitted:true};
  assert.equal(migrateArticleCompletions(state,papers),1);
  assert.equal(migrateArticleCompletions(state,papers),0);
  assert.equal(activitySummary(state,last).completedArticles,4,'existing exported counts survive migration');
  assert.equal(activitySummary(state,first).completedArticles,0);
  assert.equal(state.articleCompletions[articleKey].last,last);
  assert.equal(Object.keys(state.articleCompletions).length,1);
});

test('partial listening stays out of daily minutes but remains in lifetime hours',()=>{
  const state=makeState(),at=local(2026,10,14,8).getTime();
  recordListeningSeconds(state,90,at);
  recordListeningCoverage(state,articleKey,{from:0,to:90,duration:120,seconds:90,at});
  assert.equal(finishListeningArticle(state,articleKey,120,at),false);
  const summary=activitySummary(state,at);
  assert.equal(summary.listeningMinutes,0);
  assert.equal(summary.studyHours,90/3600);
});

test('continuous complete playback credits actual wall minutes once and supports full replay',()=>{
  const state=makeState(),at=local(2026,10,14,8).getTime();
  recordListeningCoverage(state,articleKey,{from:0,to:60,duration:120,seconds:40,at});
  recordListeningCoverage(state,articleKey,{from:60,to:120,duration:120,seconds:40,at});
  assert.equal(finishListeningArticle(state,articleKey,120,at),true);
  assert.equal(activitySummary(state,at).listeningSeconds,80,'1.5× playback counts the real time spent listening');
  assert.equal(activitySummary(state,at).listeningMinutes,1);
  assert.equal(finishListeningArticle(state,articleKey,120,at),false);
  assert.equal(recordListeningCoverage(state,articleKey,{from:100,to:120,duration:120,seconds:20,at}),false,'a completed session cannot accrue an extra tail');
  recordListeningCoverage(state,articleKey,{from:0,to:120,duration:120,seconds:120,at});
  assert.equal(finishListeningArticle(state,articleKey,120,at+1000),true);
  assert.equal(activitySummary(state,at).listeningSeconds,200);
});

test('seek-to-end and skipped middle sections cannot be mistaken for a complete listen',()=>{
  const state=makeState(),at=local(2026,10,14,8).getTime();
  recordListeningCoverage(state,articleKey,{from:0,to:10,duration:120,seconds:10,at});
  recordListeningCoverage(state,articleKey,{from:119,to:120,duration:120,seconds:1,at});
  assert.equal(finishListeningArticle(state,articleKey,120,at),false);
  resetListeningSession(state,articleKey,120);
  recordListeningCoverage(state,articleKey,{from:0,to:59,duration:120,seconds:59,at});
  recordListeningCoverage(state,articleKey,{from:61,to:120,duration:120,seconds:59,at});
  assert.equal(finishListeningArticle(state,articleKey,120,at),false);
  assert.equal(activitySummary(state,at).listeningMinutes,0);
  recordListeningCoverage(state,articleKey,{from:59,to:61,duration:120,seconds:2,at});
  assert.equal(finishListeningArticle(state,articleKey,120,at),true,'listening to the missing section completes coverage');
});

test('paused sessions and process reload preserve coverage without charging partial listening',()=>{
  const state=makeState(),at=local(2026,10,14,8).getTime();
  recordListeningCoverage(state,articleKey,{from:0,to:30,duration:60,seconds:30,at});
  const reloaded=makeState(JSON.parse(JSON.stringify(state)));
  assert.equal(activitySummary(reloaded,at).listeningMinutes,0);
  recordListeningCoverage(reloaded,articleKey,{from:30,to:60,duration:60,seconds:30,at});
  assert.equal(finishListeningArticle(reloaded,articleKey,60,at),true);
  assert.equal(activitySummary(reloaded,at).listeningMinutes,1);
  const finishedReload=makeState(JSON.parse(JSON.stringify(reloaded)));
  assert.equal(finishListeningArticle(finishedReload,articleKey,60,at),false);
});

test('rounding tolerance is tiny, repeated intervals do not manufacture coverage, and changed audio resets it',()=>{
  const state=makeState(),at=local(2026,10,14,8).getTime();
  for(let i=0;i<10;i++)recordListeningCoverage(state,articleKey,{from:0,to:30,duration:60,seconds:30,at});
  assert.equal(finishListeningArticle(state,articleKey,60,at),false);
  recordListeningCoverage(state,articleKey,{from:30,to:59.9,duration:60,seconds:29.9,at});
  assert.equal(finishListeningArticle(state,articleKey,60,at),true);
  assert.equal(recordListeningCoverage(state,articleKey,{from:30,to:60,duration:100,seconds:30,at}),true);
  assert.equal(finishListeningArticle(state,articleKey,100,at),false);
  assert.deepEqual(state.listeningSessions[articleKey].ranges,[[30,60]]);
  assert.equal(recordListeningCoverage(state,articleKey,{from:60,to:30,duration:100,seconds:30,at}),false);
});

test('complete playback releases minutes to actual local playback dates after crossing midnight',()=>{
  const state=makeState(),at=local(2026,10,15,0,0,5).getTime();
  recordListeningSeconds(state,120,at);
  recordListeningCoverage(state,articleKey,{from:0,to:120,duration:120,seconds:120,at});
  assert.equal(activitySummary(state,local(2026,10,14)).listeningSeconds,0,'neither day is credited before completion');
  assert.equal(activitySummary(state,at).listeningSeconds,0);
  assert.equal(finishListeningArticle(state,articleKey,120,at),true);
  assert.equal(activitySummary(state,local(2026,10,14)).listeningSeconds,115);
  assert.equal(activitySummary(state,local(2026,10,14)).listeningMinutes,1);
  assert.equal(activitySummary(state,at).listeningSeconds,5);
  assert.equal(activitySummary(state,at).listeningMinutes,0);
  assert.equal(state.days['2026-10-14'],115,'lifetime elapsed counters retain their actual day split');
});

test('a paused cross-midnight session preserves pending dated seconds through JSON reload',()=>{
  const state=makeState(),first=local(2026,10,14,23,59,50).getTime(),finish=local(2026,10,15,0,1).getTime();
  recordListeningCoverage(state,articleKey,{from:0,to:60,duration:120,seconds:60,at:first});
  const reloaded=makeState(JSON.parse(JSON.stringify(state)));
  recordListeningCoverage(reloaded,articleKey,{from:60,to:120,duration:120,seconds:60,at:finish});
  assert.equal(activitySummary(reloaded,first).listeningSeconds,0);
  assert.equal(activitySummary(reloaded,finish).listeningSeconds,0);
  assert.equal(finishListeningArticle(reloaded,articleKey,120,finish),true);
  assert.equal(activitySummary(reloaded,first).listeningMinutes,1);
  assert.equal(activitySummary(reloaded,finish).listeningMinutes,1);
  assert.equal(finishListeningArticle(makeState(JSON.parse(JSON.stringify(reloaded))),articleKey,120,finish),false);
});

test('pending dated playback splitting respects daylight-saving local midnight',()=>{
  process.env.TZ='America/New_York';
  try{
    const state=makeState(),start=local(2026,3,8),end=local(2026,3,9),seconds=(end-start)/1000;
    recordListeningCoverage(state,articleKey,{from:0,to:seconds,duration:seconds,seconds,at:end.getTime()});
    assert.equal(state.listeningSessions[articleKey].days['2026-03-08'],23*3600);
    assert.equal(state.listeningSessions[articleKey].days['2026-03-09'],undefined);
    assert.equal(finishListeningArticle(state,articleKey,seconds,end.getTime()),true);
    assert.equal(activitySummary(state,start).listeningMinutes,23*60);
    assert.equal(activitySummary(state,end).listeningMinutes,0);
  }finally{process.env.TZ='Asia/Shanghai'}
});

test('an undated pre-release pending session credits only its unknown remainder on finish date',()=>{
  const at=local(2026,10,15,8).getTime();
  const state=makeState({listeningSessions:{[articleKey]:{duration:120,ranges:[[0,60]],seconds:60,completed:false}}});
  recordListeningCoverage(state,articleKey,{from:60,to:120,duration:120,seconds:60,at});
  assert.equal(finishListeningArticle(state,articleKey,120,at),true);
  assert.equal(activitySummary(state,at).listeningSeconds,120);
  assert.equal(activitySummary(state,local(2026,10,14)).listeningSeconds,0);
});

test('listening intervals crossing midnight split their actual seconds between the two days',()=>{
  const state=makeState();
  recordListeningSeconds(state,20,local(2026,10,15,0,0,5).getTime());
  assert.equal(state.days['2026-10-14'],15);
  assert.equal(state.days['2026-10-15'],5);
  assert.equal(activitySummary(state,local(2026,10,15)).totalListeningSeconds,20);
  recordListeningSeconds(state,.75,local(2026,10,15,0,0,6).getTime());
  assert.equal(state.days['2026-10-15'],5.75);
});

test('an interval ending exactly at midnight belongs to the day that just ended',()=>{
  const state=makeState();
  recordStudySeconds(state,60,local(2026,10,15).getTime());
  assert.equal(state.studyDays['2026-10-14'],60);
  assert.equal(state.studyDays['2026-10-15'],undefined);
});

test('study intervals preserve listening history and can span multiple midnight boundaries',()=>{
  const state=makeState({days:{'2026-10-13':120}});
  recordStudySeconds(state,86430,local(2026,10,15,0,0,10).getTime());
  assert.equal(state.studyDays['2026-10-13'],20);
  assert.equal(state.studyDays['2026-10-14'],86400);
  assert.equal(state.studyDays['2026-10-15'],10);
  assert.equal(state.days['2026-10-13'],120);
  assert.equal(activitySummary(state,local(2026,10,15)).totalSeconds,86550);
  assert.equal(recordStudySeconds(state,-10,Date.now()),0);
  assert.equal(recordListeningSeconds(state,Infinity,Date.now()),0);
  assert.throws(()=>recordListeningSeconds(state,1,NaN),RangeError);
});

test('local interval splitting respects a daylight-saving day rather than forcing 24 hours',()=>{
  process.env.TZ='America/New_York';
  try{
    const state=makeState(),start=local(2026,3,8),end=local(2026,3,9);
    assert.equal((end-start)/1000,23*3600);
    recordStudySeconds(state,(end-start)/1000,end.getTime());
    assert.equal(state.studyDays['2026-03-08'],23*3600);
    assert.equal(state.studyDays['2026-03-09'],undefined);
    assert.equal(localDateKey(new Date('2026-03-09T03:59:59Z')),'2026-03-08');
  }finally{process.env.TZ='Asia/Shanghai'}
});

test('heatmap levels increase at stable question-count thresholds',()=>{
  for(const [count,level] of [[0,0],[1,1],[3,1],[4,2],[9,2],[10,3],[19,3],[20,4],[100,4],[-1,0],[NaN,0]]){
    assert.equal(activityLevel(count),level,`count ${count}`);
  }
});

test('annual heatmap has 365 local days, complete Sunday-based columns, and disabled padding',()=>{
  const state=makeState();
  recordQuestionSubmission(state,questionKey,local(2026,10,14,8).getTime());
  const calendar=activityCalendar(state,local(2026,10,14,23,59,59)),days=calendar.weeks.flat();
  assert.equal(calendar.start,'2025-10-15');
  assert.equal(calendar.end,'2026-10-14');
  assert.equal(calendar.dayCount,365);
  assert.equal(calendar.weekCount,53);
  assert.equal(calendar.weeks.every(week=>week.length===7),true);
  assert.equal(days.filter(day=>day.inRange).length,365);
  assert.equal(days.filter(day=>day.isToday).length,1);
  assert.equal(days.find(day=>day.isToday).count,1);
  assert.equal(days.find(day=>day.isToday).level,1);
  assert.equal(days.every(day=>day.disabled===!day.inRange),true);
  assert.equal(days.filter(day=>day.date>'2026-10-14').every(day=>day.disabled&&day.count===0),true);
  for(const week of calendar.weeks){
    const [year,month,day]=week[0].date.split('-').map(Number);
    assert.equal(local(year,month,day).getDay(),0);
  }
});

test('leap-year heatmap keeps all 366 days even when week alignment requires 54 columns',()=>{
  const calendar=activityCalendar(makeState(),local(2024,3,3));
  assert.equal(calendar.start,'2023-03-04');
  assert.equal(calendar.end,'2024-03-03');
  assert.equal(calendar.dayCount,366);
  assert.equal(calendar.weekCount,54);
  assert.equal(calendar.weeks.flat().some(day=>day.date==='2024-02-29'&&day.inRange),true);
  assert.equal(calendar.weeks.flat().filter(day=>day.inRange).length,366);
});

test('February anniversary clamps safely without losing leap day',()=>{
  const feb29=activityCalendar(makeState(),local(2024,2,29));
  assert.equal(feb29.start,'2023-03-01');
  assert.equal(feb29.dayCount,366);
  const feb28=activityCalendar(makeState(),local(2025,2,28));
  assert.equal(feb28.start,'2024-02-29');
  assert.equal(feb28.dayCount,366);
  assert.equal(feb28.weeks.flat().find(day=>day.date==='2024-02-29').inRange,true);
});

test('month labels use one-based week columns that contain the corresponding local date',()=>{
  const calendar=activityCalendar(makeState(),local(2026,10,14));
  assert.equal(calendar.months.length,13);
  assert.equal(calendar.months[0].label,'10月');
  assert.equal(calendar.months[0].column,1);
  for(const month of calendar.months){
    assert.ok(month.column>=1&&month.column<=calendar.weekCount);
    assert.equal(calendar.weeks[month.column-1].some(day=>day.date===month.date),true);
    assert.equal(month.label,`${Number(month.date.slice(5,7))}月`);
  }
});

test('unknown and prototype-shaped imported keys cannot alter records or their totals',()=>{
  const input=JSON.parse('{"days":{"__proto__":60,"2026-10-14":120},"dailyQuestions":{"2026-10-14":{"__proto__":3,"constructor":2}}}');
  const state=makeState(input),summary=activitySummary(state,local(2026,10,14));
  assert.equal(summary.totalListeningSeconds,180);
  assert.equal(summary.completedQuestions,5);
  recordQuestionSubmission(state,'__proto__',local(2026,10,14).getTime());
  assert.equal(activitySummary(state,local(2026,10,14)).completedQuestions,6);
  assert.equal(Object.getPrototypeOf(state.dailyQuestions),null);
  assert.equal({}.polluted,undefined);
});
