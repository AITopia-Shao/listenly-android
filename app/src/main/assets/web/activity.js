const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const dictionary=()=>Object.create(null);
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positiveNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:0;
const dateValue=value=>value instanceof Date?new Date(value.getTime()):new Date(value);
const pad=value=>String(value).padStart(2,'0');

// Use the device's calendar day, rather than the UTC day from toISOString().
export function localDateKey(date=new Date()){
  const value=dateValue(date);
  if(!Number.isFinite(value.getTime()))throw new RangeError('Invalid activity date');
  return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
}

function normalizeDateKey(key){
  let match=String(key).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/),year,month,day;
  if(match){year=Number(match[1]);month=Number(match[2]);day=Number(match[3])}
  else{
    // Some older WebViews format en-CA dates as M/D/YYYY.
    match=String(key).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(!match)return null;
    year=Number(match[3]);month=Number(match[1]);day=Number(match[2]);
    if(month>12&&day<=12){const swap=month;month=day;day=swap}
  }
  if(year<1000||year>9999||month<1||month>12||day<1||day>31)return null;
  const date=new Date(year,month-1,day);
  return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?localDateKey(date):null;
}

function normalizedSeconds(input){
  const result=dictionary();
  if(!isRecord(input))return result;
  Object.keys(input).forEach(key=>{
    const seconds=positiveNumber(input[key]);
    if(!seconds)return;
    // Keep unrecognised legacy keys in the total; their original day is unknown.
    const date=normalizeDateKey(key)||key;
    result[date]=(result[date]||0)+seconds;
  });
  return result;
}

function normalizedQuestions(input){
  const result=dictionary();
  if(!isRecord(input))return result;
  Object.keys(input).forEach(key=>{
    if(!isRecord(input[key]))return;
    const date=normalizeDateKey(key)||key;
    if(!own(result,date))result[date]=dictionary();
    Object.keys(input[key]).forEach(question=>{
      const count=Math.floor(positiveNumber(input[key][question]));
      if(count)result[date][question]=(result[date][question]||0)+count;
    });
  });
  return result;
}

// days retains the previous listening counter. studyDays counts only time spent
// answering with audio paused, so the caller can avoid counting the same second twice.
export function normalizeActivity(state,now=new Date()){
  if(!isRecord(state))throw new TypeError('Activity state must be an object');
  localDateKey(now);
  state.days=normalizedSeconds(state.days);
  state.studyDays=normalizedSeconds(state.studyDays);
  state.dailyQuestions=normalizedQuestions(state.dailyQuestions);
  state.dailyArticles=normalizedQuestions(state.dailyArticles);
  state.completedListeningDays=normalizedSeconds(state.completedListeningDays);
  state.articleCompletions=normalizedCompletions(state.articleCompletions);
  state.listeningSessions=normalizedListeningSessions(state.listeningSessions);
  if(!(state.activityVersion>=1)){
    const answers=isRecord(state.answers)?state.answers:{};
    Object.keys(answers).forEach(key=>{
      const answer=answers[key];
      if(!isRecord(answer)||!answer.submitted||typeof answer.at!=='number'||answer.at<=0)return;
      const date=new Date(answer.at);
      if(!Number.isFinite(date.getTime()))return;
      const day=localDateKey(date);
      if(!own(state.dailyQuestions,day))state.dailyQuestions[day]=dictionary();
      // An existing count may already include this legacy answer. Never overwrite it.
      state.dailyQuestions[day][key]=Math.max(1,state.dailyQuestions[day][key]||0);
    });
  }
  state.activityVersion=2;
  return state;
}

function ensureActivity(state){
  if(state.activityVersion!==2)normalizeActivity(state);
  if(!isRecord(state.days))state.days=dictionary();
  if(!isRecord(state.studyDays))state.studyDays=dictionary();
  if(!isRecord(state.dailyQuestions))state.dailyQuestions=dictionary();
  if(!isRecord(state.dailyArticles))state.dailyArticles=dictionary();
  if(!isRecord(state.completedListeningDays))state.completedListeningDays=dictionary();
  if(!isRecord(state.articleCompletions))state.articleCompletions=dictionary();
  if(!isRecord(state.listeningSessions))state.listeningSessions=dictionary();
}

function normalizedCompletions(input){
  const result=dictionary();
  if(!isRecord(input))return result;
  Object.keys(input).forEach(key=>{
    const value=input[key];
    if(!isRecord(value)||typeof value.fingerprint!=='string'||!value.fingerprint)return;
    const last=positiveNumber(value.last);
    if(!last||!Number.isFinite(new Date(last).getTime()))return;
    result[key]={last,count:Math.max(1,Math.floor(positiveNumber(value.count))),fingerprint:value.fingerprint};
  });
  return result;
}

function completedAnswerSet(state,paperId,article){
  if(!article||!Array.isArray(article.questions)||!article.questions.length)return null;
  const entries=[];
  for(const question of article.questions){
    const key=JSON.stringify([paperId,article.id,question.id]);
    const answer=state.answers?.[key],at=positiveNumber(answer?.at);
    if(!answer?.submitted||!at||!Number.isFinite(new Date(at).getTime()))return null;
    entries.push([String(question.id),at]);
  }
  entries.sort((a,b)=>a[0].localeCompare(b[0]));
  return {key:JSON.stringify([paperId,article.id]),fingerprint:JSON.stringify(entries),last:Math.max(...entries.map(entry=>entry[1]))};
}

// A result-page visit is not necessary: the last submitted question completes
// the article. The full answer-set fingerprint also makes reloads idempotent.
export function recordArticleCompletion(state,paperId,article,at=Date.now()){
  ensureActivity(state);
  const completed=completedAnswerSet(state,paperId,article);
  if(!completed)return false;
  const previous=state.articleCompletions[completed.key];
  if(previous?.fingerprint===completed.fingerprint)return false;
  const day=localDateKey(at);
  if(!own(state.dailyArticles,day))state.dailyArticles[day]=dictionary();
  state.dailyArticles[day][completed.key]=Math.floor(positiveNumber(state.dailyArticles[day][completed.key]))+1;
  state.articleCompletions[completed.key]={last:dateValue(at).getTime(),count:Math.floor(positiveNumber(previous?.count))+1,fingerprint:completed.fingerprint};
  return true;
}

// Historical partial listening cannot prove that an article was heard fully.
// Completed quizzes can be recovered after the material definitions are loaded.
export function migrateArticleCompletions(state,papers){
  ensureActivity(state);
  let migrated=0;
  for(const paper of Array.isArray(papers)?papers:[]){
    for(const article of Array.isArray(paper.articles)?paper.articles:[]){
      const completed=completedAnswerSet(state,paper.id,article);
      if(!completed||own(state.articleCompletions,completed.key))continue;
      const day=localDateKey(completed.last);
      if(!own(state.dailyArticles,day))state.dailyArticles[day]=dictionary();
      // A previously exported ledger may already hold this completion.
      state.dailyArticles[day][completed.key]=Math.max(1,Math.floor(positiveNumber(state.dailyArticles[day][completed.key])));
      state.articleCompletions[completed.key]={last:completed.last,count:1,fingerprint:completed.fingerprint};
      migrated++;
    }
  }
  return migrated;
}

function mergeRanges(ranges,duration){
  const valid=[];
  for(const range of Array.isArray(ranges)?ranges:[]){
    if(!Array.isArray(range)||range.length!==2||!Number.isFinite(range[0])||!Number.isFinite(range[1]))continue;
    const from=Math.max(0,Math.min(duration,range[0])),to=Math.max(0,Math.min(duration,range[1]));
    if(to>from)valid.push([from,to]);
  }
  valid.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const range of valid){
    const previous=merged[merged.length-1];
    if(previous&&range[0]<=previous[1]+.001)previous[1]=Math.max(previous[1],range[1]);
    else merged.push(range);
  }
  return merged;
}

function normalizedListeningSessions(input){
  const result=dictionary();
  if(!isRecord(input))return result;
  Object.keys(input).forEach(key=>{
    const value=input[key],duration=positiveNumber(value?.duration);
    if(!isRecord(value)||!duration)return;
    const days=normalizedSeconds(value.days);
    // Pending sessions only contain known local playback dates. Unknown older
    // keys remain undated and are handled at completion, rather than guessed.
    Object.keys(days).forEach(day=>{if(!normalizeDateKey(day))delete days[day]});
    result[key]={duration,ranges:mergeRanges(value.ranges,duration),seconds:positiveNumber(value.seconds),days,completed:value.completed===true};
  });
  return result;
}

export function resetListeningSession(state,key,duration){
  ensureActivity(state);
  duration=positiveNumber(duration);
  if(!duration)return false;
  state.listeningSessions[String(key)]={duration,ranges:[],seconds:0,days:dictionary(),completed:false};
  return true;
}

// The caller supplies continuous playback only. It must break the media anchor
// on seeking/source changes and must not turn a seek jump into a heard interval.
export function recordListeningCoverage(state,key,{from,to,duration,seconds,at=Date.now()}={}){
  ensureActivity(state);
  duration=positiveNumber(duration);seconds=positiveNumber(seconds);
  if(!duration||!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||from>=duration)return false;
  key=String(key);
  let session=state.listeningSessions[key];
  if(!session||Math.abs(session.duration-duration)>.05||(session.completed&&from<=.05)){
    resetListeningSession(state,key,duration);session=state.listeningSessions[key];
  }
  if(session.completed)return false;
  if(!isRecord(session.days))session.days=dictionary();
  addDatedSeconds(session.days,seconds,at);
  session.ranges=mergeRanges([...session.ranges,[from,to]],duration);
  session.seconds+=seconds;
  return true;
}

export function finishListeningArticle(state,key,duration,at=Date.now()){
  ensureActivity(state);
  duration=positiveNumber(duration);key=String(key);
  const session=state.listeningSessions[key];
  if(!duration||!session||session.completed||Math.abs(session.duration-duration)>.05||!session.seconds)return false;
  const covered=session.ranges.reduce((sum,[from,to])=>sum+to-from,0);
  // Only tiny media-clock rounding errors are tolerated, not a skipped section.
  const tolerance=Math.min(.15,duration*.005);
  if(covered<duration-tolerance)return false;
  const day=localDateKey(at);
  let remaining=session.seconds;
  for(const playedDay of Object.keys(session.days||{})){
    const seconds=Math.min(remaining,positiveNumber(session.days[playedDay]));
    if(!seconds)continue;
    state.completedListeningDays[playedDay]=positiveNumber(state.completedListeningDays[playedDay])+seconds;
    remaining-=seconds;
  }
  // Pre-release sessions had only an aggregate counter. Keep that amount,
  // without inventing historical playback dates we cannot reconstruct.
  if(remaining>0)state.completedListeningDays[day]=positiveNumber(state.completedListeningDays[day])+remaining;
  session.completed=true;
  return true;
}

// Call once for the transition from an unsubmitted answer to a submitted answer.
// Redoing that question is another submission, independent of its current answer.
export function recordQuestionSubmission(state,questionKey,at=Date.now()){
  ensureActivity(state);
  const day=localDateKey(at),key=String(questionKey);
  if(!own(state.dailyQuestions,day))state.dailyQuestions[day]=dictionary();
  const count=Math.floor(positiveNumber(state.dailyQuestions[day][key]))+1;
  state.dailyQuestions[day][key]=count;
  return count;
}

function recordSeconds(state,field,seconds,at){
  ensureActivity(state);
  return addDatedSeconds(state[field],seconds,at);
}

function addDatedSeconds(days,seconds,at){
  seconds=positiveNumber(seconds);
  if(!seconds)return 0;
  const end=dateValue(at).getTime();
  if(!Number.isFinite(end))throw new RangeError('Invalid activity date');
  let cursor=end-seconds*1000;
  if(!Number.isFinite(cursor)||!Number.isFinite(new Date(cursor).getTime()))throw new RangeError('Invalid activity interval');
  while(cursor<end){
    const date=new Date(cursor),key=localDateKey(date);
    // Construct local midnight, so a daylight-saving day can be 23 or 25 hours.
    const nextMidnight=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime();
    const boundary=Math.min(nextMidnight,end),part=(boundary-cursor)/1000;
    days[key]=positiveNumber(days[key])+part;
    cursor=boundary;
  }
  return seconds;
}

export function recordListeningSeconds(state,seconds,at=Date.now()){
  return recordSeconds(state,'days',seconds,at);
}

export function recordStudySeconds(state,seconds,at=Date.now()){
  return recordSeconds(state,'studyDays',seconds,at);
}

function sumValues(input){
  return isRecord(input)?Object.keys(input).reduce((sum,key)=>sum+positiveNumber(input[key]),0):0;
}

export function activitySummary(state,now=new Date()){
  ensureActivity(state);
  const date=localDateKey(now),listeningSeconds=positiveNumber(state.completedListeningDays[date]);
  const totalListeningSeconds=sumValues(state.days),totalStudySeconds=sumValues(state.studyDays);
  return {
    date,listeningSeconds,listeningMinutes:Math.floor(listeningSeconds/60),
    completedQuestions:sumValues(state.dailyQuestions[date]),
    completedArticles:sumValues(state.dailyArticles[date]),
    totalListeningSeconds,totalStudySeconds,totalSeconds:totalListeningSeconds+totalStudySeconds,
    studyHours:(totalListeningSeconds+totalStudySeconds)/3600
  };
}

export function activityLevel(count){
  count=positiveNumber(count);
  return count>=20?4:count>=10?3:count>=4?2:count>=1?1:0;
}

export function activityCalendar(state,now=new Date()){
  ensureActivity(state);
  const today=dateValue(now);
  if(!Number.isFinite(today.getTime()))throw new RangeError('Invalid activity date');
  today.setHours(0,0,0,0);
  const first=new Date(today.getFullYear()-1,today.getMonth(),1);
  // Clamp Feb 29 to the last day of February in the previous year.
  const previousMonthEnd=new Date(today.getFullYear()-1,today.getMonth()+1,0).getDate();
  first.setDate(Math.min(today.getDate(),previousMonthEnd)+1);
  const gridFirst=new Date(first.getTime());gridFirst.setDate(gridFirst.getDate()-gridFirst.getDay());
  const gridLast=new Date(today.getTime());gridLast.setDate(gridLast.getDate()+6-gridLast.getDay());
  const start=localDateKey(first),end=localDateKey(today),weeks=[],months=[];
  let dayCount=0,lastMonth=null;
  for(let cursor=new Date(gridFirst.getTime());cursor<=gridLast;cursor.setDate(cursor.getDate()+1)){
    const date=localDateKey(cursor),inRange=date>=start&&date<=end;
    if(!weeks.length||weeks[weeks.length-1].length===7)weeks.push([]);
    const count=inRange?sumValues(state.dailyQuestions[date]):0;
    weeks[weeks.length-1].push({date,count,level:activityLevel(count),inRange,disabled:!inRange,isToday:date===end});
    if(inRange){
      dayCount++;
      const month=`${cursor.getFullYear()}-${cursor.getMonth()}`;
      if(month!==lastMonth){months.push({label:`${cursor.getMonth()+1}月`,column:weeks.length,date});lastMonth=month}
    }
  }
  return {start,end,startDate:localDateKey(gridFirst),endDate:localDateKey(gridLast),weekCount:weeks.length,dayCount,weeks,months};
}
