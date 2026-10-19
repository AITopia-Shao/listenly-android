/** Playback stays within the current paper and ignores passages without audio. */
export const playbackModes=Object.freeze([
  Object.freeze({id:'sequential',label:'顺序播放',icon:'queue'}),
  Object.freeze({id:'repeat',label:'整套循环',icon:'repeatone'}),
  Object.freeze({id:'shuffle',label:'随机播放',icon:'shuffle'})
]);

export function normalizePlaybackMode(value){
  return playbackModes.some(mode=>mode.id===value)?value:'sequential';
}

export function playbackModeDetails(value){
  return playbackModes.find(mode=>mode.id===normalizePlaybackMode(value));
}

export function nextPlaybackMode(value){
  const index=playbackModes.findIndex(mode=>mode.id===normalizePlaybackMode(value));
  return playbackModes[(index+1)%playbackModes.length].id;
}

export function nextPlaybackArticle(articles,currentId,mode,random=Math.random){
  const available=(articles||[]).filter(article=>article?.audio?.intensive||article?.audio?.exam);
  if(!available.length)return null;
  const current=available.findIndex(article=>article.id===currentId),normalized=normalizePlaybackMode(mode);
  if(normalized==='repeat'&&current>=0)return available[current];
  if(normalized==='shuffle'){
    const candidates=available.filter(article=>article.id!==currentId);
    if(!candidates.length)return available[0];
    const sample=Number(random()),fraction=Number.isFinite(sample)?Math.max(0,Math.min(1,sample)):0;
    return candidates[Math.min(candidates.length-1,Math.floor(fraction*candidates.length))];
  }
  return available[(current+1)%available.length];
}
