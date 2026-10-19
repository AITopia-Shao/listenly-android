import {paperAudio,validatePaperTimeline} from './paper-timeline.js';
import { validateIntensiveTranscript } from './importer.js';

const METADATA_TIMEOUT_MS = 8000;
const short = value => String(value || '未命名文章').slice(0, 80);

/** Read metadata on a detached element; never borrow or change the study player. */
function readDuration(url) {
  return new Promise(resolve => {
    let media;
    let timer;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (media) {
        media.removeEventListener('loadedmetadata', metadata);
        media.removeEventListener('error', failed);
        // Clearing and reloading releases the decoder and cancels outstanding reads.
        media.removeAttribute('src');
        try { media.load(); } catch {}
      }
      resolve(result);
    };
    const metadata = () => {
      const duration = media.duration;
      finish(Number.isFinite(duration) && duration > 0
        ? { duration } : { error: '音频时长无效' });
    };
    const failed = () => finish({ error: '音频无法读取' });
    try {
      media = new Audio();
      media.preload = 'metadata';
      media.addEventListener('loadedmetadata', metadata);
      media.addEventListener('error', failed);
      timer = setTimeout(() => finish({ error: '读取音频超时，请重试' }), METADATA_TIMEOUT_MS);
      media.src = url;
      media.load();
    } catch {
      finish({ error: '音频无法读取' });
    }
  });
}

/** Validate a new intensive import against decoded audio before saving any files. */
export async function validateImportedIntensiveMedia(papers,{requireTranscript=true}={}) {
  const articles = (papers || []).flatMap(paper => paper.articles || []);
  const groups = new Map();
  const warnings = [];
  for (const article of articles) {
    const url = article.audio?.intensive||article.audio?.exam;
    if (typeof url !== 'string' || !url) {
      warnings.push({ code: 'INTENSIVE_AUDIO_REQUIRED', message: `「${short(article.title || article.id)}」缺少精听音频。` });
      continue;
    }
    if (!groups.has(url)) groups.set(url, []);
    groups.get(url).push(article);
  }
  if (warnings.length) return { rejected: true, warnings };
  const queue = [...groups.entries()];
  const verified = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length && !warnings.length) {
      const [url, linked] = queue[cursor++];
      const result = await readDuration(url);
      if (result.error) {
        warnings.push({ code: 'INTENSIVE_AUDIO_UNREADABLE', message: `「${short(linked[0].title || linked[0].id)}」${result.error}，本次未导入。` });
        continue;
      }
      for (const article of linked) {
        if(requireTranscript)warnings.push(...validateIntensiveTranscript(article,Number.isFinite(article.end)?article.end-article.start:result.duration));
        if(Number.isFinite(article.end)&&article.end>result.duration+.05)warnings.push({code:'INVALID_PAPER_TIMELINE',message:'篇章标记超出实际整套音频，本次未导入。'});
      }
      verified.set(url, result.duration);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));
  if (warnings.length) return { rejected: true, warnings };
  // The caller's parsed library is updated only after the entire selection passes.
  for(const paper of papers){
    const decoded=verified.get(paperAudio(paper));if(decoded)paper.duration=decoded;
    for(const article of paper.articles||[]){
      if(paper.articles.length===1&&article.start===0&&!Number.isFinite(article.end))article.end=decoded;
      article.duration=Number.isFinite(article.end)?article.end-article.start:verified.get(article.audio.intensive||article.audio.exam);
    }
  }
  return { rejected: false, warnings: [] };
}
