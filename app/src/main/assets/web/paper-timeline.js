/** One paper recording; article and sentence coordinates never change its source. */
export function paperAudio(paper){const value=typeof paper?.audio==='string'?paper.audio:paper?.audio?.url;return typeof value==='string'&&value.trim()?value:null}
export function articleStart(article){return Number.isFinite(article?.start)?Math.max(0,article.start):0}
export function articleEnd(article){return Number.isFinite(article?.end)?article.end:articleStart(article)+(article?.duration||0)}
export function paperDuration(paper){return Number.isFinite(paper?.duration)?paper.duration:Math.max(0,...(paper?.articles||[]).map(articleEnd))}
export function sentenceTime(article,sentence){return articleStart(article)+(Number.isFinite(sentence?.start)?sentence.start:0)}
export function migrateLegacyPosition(article,time){
  return Number.isFinite(article?.start)&&article.start>=0&&Number.isFinite(time)&&time>=0?article.start+time:undefined;
}
export function articleAtTime(paper,time){
  const rows=(paper?.articles||[]).filter(article=>Number.isFinite(article.start));
  return rows.find(article=>time>=articleStart(article)&&time<articleEnd(article))||null;
}
export function paperCollection(paper){
  const value=paper?.collection;
  if(value&&typeof value==='object'&&typeof value.id==='string')return {id:value.id,title:String(value.title||value.id)};
  const kind=String(paper?.kind||paper?.id||'').toLowerCase();
  if(kind.startsWith('cet6'))return {id:'cet6',title:'六级合集'};
  if(kind.startsWith('ielts'))return {id:'ielts',title:'雅思合集'};
  if(kind.startsWith('toefl'))return {id:'toefl',title:'托福合集'};
  if(paper?.isDemo)return {id:'original',title:'原创合集'};
  return {id:'imported',title:'导入合集'};
}
// IndexedDB getAll orders UUID keys, not imports. Old undated records retain
// their observed order; dated replacements always replay in creation order.
export function orderedImports(items){
  return (Array.isArray(items)?items:[]).map((item,index)=>({item,index,time:Number.isFinite(item.createdAt)?item.createdAt:Number.isFinite(item.importedAt)?item.importedAt:0})).sort((a,b)=>a.time-b.time||a.index-b.index).map(entry=>entry.item);
}
export function normalizePaperTimeline(paper){
  const copy={...paper,articles:(paper.articles||[]).map(article=>({...article,questions:(article.questions||[]).map(q=>({...q}))}))};
  // A previous single-recording folder already describes a complete paper.
  // Multiple legacy clips are retained for reading until an authored full
  // recording is imported; do not invent offsets or concatenate decoder tails.
  if(!paperAudio(copy)&&copy.articles.length===1){
    const article=copy.articles[0];copy.audio=article.audio?.intensive||article.audio?.exam;
    copy.duration=article.duration;article.start=0;article.end=article.duration;
  }
  copy.collection=paperCollection(copy);
  return copy;
}
export function validatePaperTimeline(paper){
  const problems=[];
  if(!Array.isArray(paper?.articles)||!paper.articles.length)problems.push('缺少篇章进度标记');
  if(paper?.duration!==undefined&&(!Number.isFinite(paper.duration)||paper.duration<=0))problems.push('整套时长无效');
  if(!paperAudio(paper))problems.push('缺少整套音频');
  const duration=paperDuration(paper);
  if(!Number.isFinite(duration)||duration<=0)problems.push('整套时长无效');
  let end=-1;
  for(const article of paper.articles||[]){
    if(!Number.isFinite(article.start)||!Number.isFinite(article.end)||article.start<0||article.end<=article.start||article.start<end||article.end>duration+.05)problems.push(`「${article.title||article.id}」进度标记无效或重叠`);
    end=article.end;
    if(article.transcript?.some(row=>row.timed!==false&&(!Number.isFinite(row.start)||row.start<0||row.start>=article.end-article.start||row.end!==undefined&&(!Number.isFinite(row.end)||row.end<=row.start||row.end>article.end-article.start+.05))))problems.push(`「${article.title||article.id}」分句超出篇章标记`);
  }
  return problems;
}
