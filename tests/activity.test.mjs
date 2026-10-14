import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateKey,normalizeActivity,recordQuestionSubmission,
  recordListeningSeconds,recordStudySeconds,activitySummary,
  activityLevel,activityCalendar
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
  assert.equal(summary.listeningMinutes,10);
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
  assert.equal(summary.listeningMinutes,2);
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
  assert.equal(state.activityVersion,1);
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

test('daily minutes and question totals reset by date while total study hours retain every day',()=>{
  const state=makeState({days:{'2026-10-13':7200,'2026-10-14':125},studyDays:{'2026-10-13':3475,'2026-10-14':3600}});
  recordQuestionSubmission(state,'a',local(2026,10,13,9).getTime());
  recordQuestionSubmission(state,'b',local(2026,10,14,9).getTime());
  recordQuestionSubmission(state,'c',local(2026,10,14,10).getTime());
  const today=activitySummary(state,local(2026,10,14));
  assert.equal(today.listeningSeconds,125);
  assert.equal(today.listeningMinutes,2);
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
