/** Folder-only material import. Metadata never grants access outside selected files. */
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4)$/i;
const TEXT = /\.(json|txt|srt|vtt|lrc)$/i;
const WRAPPERS = new Set(['精听', '做题', 'intensive', 'exam', 'materials', 'papers']);
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const dir = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const basename = path => path.slice(path.lastIndexOf('/') + 1);
const join = (...parts) => parts.filter(Boolean).join('/');
const short = value => String(value ?? '').slice(0, 120);

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  const path = decoded.replace(/\\/g, '/');
  if (/^[\/]|[:\u0000-\u001f]/.test(path)) return null;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return parts.join('/');
}

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
    && /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u.test(value) ? value : null;
}

function slug(value) {
  return String(value || 'imported').normalize('NFKC').trim()
    .replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'imported';
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0).toString(36);
}

function warning(warnings, code, message, path) {
  warnings.push({ code, message, ...(path ? { path } : {}) });
}

function seconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
    + Number((match[4] || '').padEnd(3, '0')) / 1000;
}

export function parseSubtitle(text, warnings = [], path = '') {
  const blocks = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/);
  const rows = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timeIndex = lines.findIndex(line => line.includes('-->'));
    if (timeIndex < 0) {
      if (lines.length && !/^(WEBVTT|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(lines[0])) {
        warning(warnings, 'INVALID_TIMESTAMP', '字幕原文缺少有效起止时间。', path);
      }
      continue;
    }
    if (lines.filter(line => line.includes('-->')).length !== 1) {
      warning(warnings, 'INVALID_TIMESTAMP', '字幕分句之间需空行分隔。', path);
      continue;
    }
    const times = lines[timeIndex].split('-->');
    const start = seconds(times[0].trim());
    const end = seconds(times[1].trim().split(/\s/)[0]);
    if (start === null || end === null || end <= start) {
      warning(warnings, 'INVALID_TIMESTAMP', '字幕起止时间无效。', path);
      continue;
    }
    const body = lines.slice(timeIndex + 1).map(line => line.replace(/<[^>]*>/g, ''));
    const english = body.filter(line => !/[\u3400-\u9fff]/.test(line));
    const chinese = body.filter(line => /[\u3400-\u9fff]/.test(line));
    rows.push({ start, end, en: english.join('\n'), zh: chinese.join('\n'), timed: true });
  }
  return rows.sort((a, b) => a.start - b.start);
}

export function parseLrc(text, warnings = [], path = '') {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const body = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!body) continue;
    if (!matches.length) {
      warning(warnings, 'INVALID_TIMESTAMP', 'LRC 原文缺少有效时间。', path);
      continue;
    }
    for (const match of matches) {
      if (Number(match[2]) > 59) {
        warning(warnings, 'INVALID_TIMESTAMP', 'LRC 秒数必须小于 60。', path);
        continue;
      }
      const start = Number(match[1]) * 60 + Number(match[2]) + Number((match[3] || '').padEnd(3, '0')) / 1000;
      rows.push({ start, en: /[\u3400-\u9fff]/.test(body) ? '' : body,
        zh: /[\u3400-\u9fff]/.test(body) ? body : '', timed: true });
    }
  }
  rows.sort((a, b) => a.start - b.start);
  return rows.map((row, index) => ({ ...row,
    ...(rows[index + 1]?.start > row.start ? { end: rows[index + 1].start } : {}) }));
}

function normalizeTranscript(value, warnings = [], path = '') {
  const rows = Array.isArray(value) ? value : value?.segments || value?.transcript;
  if (!Array.isArray(rows)) {
    warning(warnings, 'INVALID_TRANSCRIPT', '字幕 JSON 必须包含句子数组。', path);
    return [];
  }
  const result = [];
  rows.forEach((row, index) => {
    if (typeof row === 'string') {
      result.push({ start: 0, en: row, zh: '', timed: false });
      return;
    }
    if (!row || typeof row !== 'object') {
      warning(warnings, 'INVALID_TRANSCRIPT', `第 ${index + 1} 句缺少原文和时间。`, path);
      return;
    }
    const en = String(row.en ?? row.text ?? row.english ?? '').trim();
    const zh = String(row.zh ?? row.translation ?? row.chinese ?? '').trim();
    if (!en && !zh) {
      warning(warnings, 'INVALID_TRANSCRIPT', `第 ${index + 1} 句没有原文。`, path);
      return;
    }
    const start = seconds(row.start ?? row.startTime);
    const end = seconds(row.end ?? row.endTime);
    const timed = row.timed !== false && start !== null;
    if (((row.start ?? row.startTime) !== undefined && start === null)
      || ((row.end ?? row.endTime) !== undefined && end === null)
      || (end !== null && start !== null && end <= start)) {
      warning(warnings, 'INVALID_TIMESTAMP', `第 ${index + 1} 句的时间无效。`, path);
      result.push({ start: 0, en, zh, timed: false });
    } else {
      result.push({ start: start ?? 0, ...(end !== null ? { end } : {}), en, zh, timed });
    }
  });
  if (result.every(row => row.timed)) result.sort((a, b) => a.start - b.start);
  return result;
}

/** Check authored sentence coordinates without inventing alignment for legacy text. */
export function validateIntensiveTranscript(article, duration = article?.duration) {
  const issues = [];
  const rows = article?.transcript;
  const label = short(article?.title || article?.id || '未命名文章');
  const requireTimed = detail => warning(issues, 'TIMED_TRANSCRIPT_REQUIRED',
    `「${label}」${detail}，请提供逐句 SRT／LRC 或带 start 的 JSON 原文。`);
  if (!article?.audio?.intensive) {
    warning(issues, 'INTENSIVE_AUDIO_REQUIRED', `「${label}」缺少可播放的精听音频。`);
  }
  const hasDuration = duration !== undefined && duration !== null;
  const validDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
  if (hasDuration && !validDuration) {
    warning(issues, 'INVALID_AUDIO_DURATION', `「${label}」音频时长必须大于 0。`);
  }
  if (!Array.isArray(rows) || !rows.length) {
    requireTimed('缺少分句原文');
    return issues;
  }
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row.en !== 'string' || !/[A-Za-z]/.test(row.en)) {
      requireTimed(`第 ${index + 1} 句缺少英文`);
      continue;
    }
    if (row.timed === false || typeof row.start !== 'number' || !Number.isFinite(row.start) || row.start < 0) {
      requireTimed(`第 ${index + 1} 句没有有效时间`);
      continue;
    }
    const next = rows[index + 1];
    if (next && typeof next.start === 'number' && next.start <= row.start) {
      requireTimed(`第 ${index + 1}、${index + 2} 句时间必须递增`);
    }
    if (row.end !== undefined && (typeof row.end !== 'number' || !Number.isFinite(row.end) || row.end <= row.start)) {
      requireTimed(`第 ${index + 1} 句结束时间无效`);
    }
    if (validDuration && (row.start >= duration || (row.end !== undefined && row.end > duration + 0.05))) {
      requireTimed(`第 ${index + 1} 句超出音频时长`);
    }
  }
  return issues;
}

function plainRows(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim())
    .filter(Boolean).map(en => ({ start: 0, en, zh: '', timed: false }));
}

function combineTranslation(transcript, translation, warnings, path) {
  if (!translation) return transcript;
  const lines = String(translation).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== transcript.length) {
    warning(warnings, 'TRANSLATION_ALIGNMENT', '译文行数与原文不同；保留完整译文，未猜测逐句对应。', path);
    return transcript;
  }
  return transcript.map((row, index) => ({ ...row, zh: row.zh || lines[index] }));
}

function normalizeQuestions(value, warnings, path, resolveAudio, allowDirectUrl = false) {
  const list = Array.isArray(value) ? value : value?.questions || (value?.options ? [value] : null);
  if (!Array.isArray(list)) {
    warning(warnings, 'INVALID_QUESTIONS', '题目 JSON 必须包含 questions 数组。', path);
    return [];
  }
  const seen = new Set();
  const questions = [];
  for (const [index, item] of list.entries()) {
    if (!item || typeof item !== 'object') continue;
    const rawOptions = Array.isArray(item.options) ? item.options
      : item.options && typeof item.options === 'object'
        ? Object.entries(item.options).map(([id, text]) => ({ id, text })) : [];
    const options = rawOptions.map((option, optionIndex) => {
      const text = typeof option === 'string' ? option : String(option?.text ?? option?.label ?? '');
      return { id: String(typeof option === 'object' ? option.id ?? option.key ?? String.fromCharCode(65 + optionIndex)
        : String.fromCharCode(65 + optionIndex)), text };
    }).filter(option => option.text);
    if (options.length < 2 || new Set(options.map(option => option.id)).size !== options.length) {
      warning(warnings, 'INVALID_OPTIONS', `第 ${index + 1} 题选项不足或选项 ID 重复，已跳过。`, path);
      continue;
    }
    const number = Number(item.number ?? item.questionNumber ?? index + 1);
    const prompt = String(item.prompt ?? item.question ?? '请选择正确答案');
    const id = safeId(item.id) || `q${Number.isInteger(number) ? number : index + 1}-${hash(prompt + JSON.stringify(options))}`;
    if (seen.has(id)) {
      warning(warnings, 'QUESTION_ID_COLLISION', `题目 ID ${id} 重复，已保留第一题。`, path);
      continue;
    }
    seen.add(id);
    let answer = item.answer ?? item.correctAnswer;
    if (answer !== undefined && answer !== null && String(answer).trim() !== '') {
      answer = String(answer).trim();
      if (!options.some(option => option.id === answer)) {
        warning(warnings, 'INVALID_ANSWER', `题目 ${id} 的答案不在选项中，按无答案处理。`, path);
        answer = undefined;
      }
    } else answer = undefined;
    const start = seconds(item.start);
    const end = seconds(item.end);
    const audioUrl = (allowDirectUrl ? item.audioUrl : undefined) || (item.audio ? resolveAudio(item.audio) : undefined);
    if (item.audioUrl && !allowDirectUrl) warning(warnings, 'UNSAFE_REFERENCE', '题目音频必须引用所选文件夹内的 audio 文件，已忽略外部地址。', path);
    const audioTimeline = Array.isArray(item.audioTimeline) ? item.audioTimeline.filter(segment =>
      segment && seconds(segment.clipStart) !== null && seconds(segment.clipEnd) !== null
      && seconds(segment.articleStart) !== null && segment.clipEnd > segment.clipStart)
      .map(segment => ({ clipStart: Number(segment.clipStart), clipEnd: Number(segment.clipEnd), articleStart: Number(segment.articleStart) })) : [];
    questions.push({
      id, number: Number.isInteger(number) && number > 0 ? number : index + 1, prompt, options,
      ...(answer !== undefined ? { answer } : {}),
      ...(item.explanation ? { explanation: String(item.explanation) } : {}),
      ...(audioUrl ? { audioUrl } : {}),
      ...(start !== null ? { start } : {}),
      ...(end !== null && (start === null || end > start) ? { end } : {}),
      ...(item.groupId ? { groupId: String(item.groupId) } : {}),
      ...(audioTimeline.length ? { audioTimeline } : {}),
    });
  }
  return questions.sort((a, b) => a.number - b.number);
}

/** Normalize in-memory/demo material. File references are handled by parseFolder. */
export function normalizePaper(paper, mode = 'intensive') {
  const warnings = [];
  if (!paper || typeof paper !== 'object' || !safeId(paper.id) || !Array.isArray(paper.articles)) {
    return { paper: null, warnings: [{ code: 'INVALID_PAPER', message: '试卷缺少合法 ID 或 articles 数组。' }] };
  }
  const ids = new Set();
  const articles = [];
  for (const article of paper.articles) {
    if (!safeId(article?.id) || ids.has(article.id)) {
      warning(warnings, 'ARTICLE_ID_COLLISION', `文章 ID 无效或重复：${short(article?.id)}`);
      continue;
    }
    ids.add(article.id);
    const audio = { ...(article.audio && typeof article.audio === 'object' ? article.audio : {}) };
    if (article.audioUrl) audio[mode] = article.audioUrl;
    const transcript = normalizeTranscript(article.transcript || [], warnings);
    const questions = normalizeQuestions(article.questions || [], warnings, '', () => undefined, true);
    articles.push({ ...article, id: article.id, title: String(article.title || article.id), audio, transcript, questions });
  }
  return { paper: { ...paper, id: paper.id, title: String(paper.title || paper.id), articles }, warnings };
}

export async function parseFolder(input, { restore = false } = {}) {
  const warnings = [];
  const mode = input?.mode === 'exam' ? 'exam' : 'intensive';
  const strictIntensive = mode === 'intensive' && !restore;
  const files = new Map();
  function finish(papers) {
    const merged = mergePapers([], papers);
    const notices = [...warnings, ...merged.warnings];
    if (strictIntensive) {
      const issues = merged.papers.flatMap(paper => paper.articles.flatMap(article => validateIntensiveTranscript(article)));
      const malformed = notices.some(item => ['INVALID_TRANSCRIPT', 'INVALID_TIMESTAMP', 'INVALID_AUDIO_DURATION',
        'INVALID_JSON', 'INVALID_PAPER', 'INVALID_ARTICLE_ID', 'ARTICLE_ID_COLLISION', 'PAPER_ID_COLLISION',
        'TRANSCRIPT_CONFLICT', 'GROUP_ID_CONFLICT', 'READ_FAILED', 'TEXT_TOO_LARGE'].includes(item.code));
      if (malformed || issues.length) {
        warning(notices, 'TIMED_IMPORT_REJECTED', '本次精听材料未导入。每篇都需有效音频及逐句 SRT／LRC 或带时间戳的 JSON 原文；已有材料保留。');
        return { papers: [], warnings: [...notices, ...issues], rejected: true };
      }
    }
    return { papers: merged.papers, warnings: notices };
  }
  if (!Array.isArray(input?.files)) return { papers: [], warnings: [{ code: 'NO_FILES', message: '未收到文件夹内容。' }] };
  if (input.files.length > 25000) return { papers: [], warnings: [{ code: 'TOO_MANY_FILES', message: '文件超过 25,000 个，请按年份分批导入。' }] };
  for (const file of input.files) {
    const path = safePath(file?.path);
    if (!path) {
      warning(warnings, 'UNSAFE_PATH', '已拒绝绝对路径、上级目录或无效文件路径。', short(file?.path));
      continue;
    }
    if (files.has(path)) {
      warning(warnings, 'DUPLICATE_PATH', '同一路径出现重复文件，已保留第一份。', path);
      continue;
    }
    files.set(path, { ...file, path });
  }
  const cache = new Map();
  async function readText(path) {
    if (cache.has(path)) return cache.get(path);
    const file = files.get(path);
    if (!file) return null;
    if (file.size > MAX_TEXT_BYTES || (typeof file.text === 'string' && file.text.length > MAX_TEXT_BYTES)) {
      warning(warnings, 'TEXT_TOO_LARGE', '文本文件超过 8 MB，已跳过。', path);
      return null;
    }
    try {
      let value = typeof file.text === 'string' ? file.text : null;
      if (value === null && typeof file.text === 'function') value = await file.text();
      if (value === null && file.url) {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        value = await response.text();
      }
      if (typeof value !== 'string' || value.length > MAX_TEXT_BYTES) throw new Error('无可读取文本');
      value = value.replace(/^\uFEFF/, '');
      cache.set(path, value);
      return value;
    } catch {
      warning(warnings, 'READ_FAILED', '无法读取文件，请重新授权并导入。', path);
      cache.set(path, null);
      return null;
    }
  }
  async function readJSON(path) {
    const text = await readText(path);
    if (text === null) return null;
    try { return JSON.parse(text); }
    catch { warning(warnings, 'INVALID_JSON', 'JSON 格式错误，已跳过。', path); return null; }
  }
  function resolve(reference, base, silent = false) {
    const clean = safePath(reference);
    if (!clean) {
      if (!silent) warning(warnings, 'UNSAFE_REFERENCE', '文件引用必须是当前试卷内的相对路径。', short(reference));
      return null;
    }
    const path = join(base, clean);
    if (files.has(path)) return path;
    if (!silent) warning(warnings, 'MISSING_FILE', '元数据引用的文件不存在。', path);
    return null;
  }
  function audioReference(reference, base, silent = false) {
    const path = resolve(reference, base, silent);
    if (!path) return undefined;
    if (!AUDIO.test(path) || !files.get(path).url
      || (typeof files.get(path).size === 'number' && files.get(path).size <= 0)) {
      warning(warnings, 'INVALID_AUDIO', '音频格式不支持或没有可播放地址。', path);
      return undefined;
    }
    return files.get(path).url;
  }
  async function transcriptReference(value, base, fallbackDir) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return normalizeTranscript(value, warnings);
    let path = typeof value === 'string' ? resolve(value, base) : null;
    if (!path && value === undefined) {
      path = ['transcript.json', 'transcript.srt', 'transcript.vtt', 'transcript.lrc', 'transcript.txt', 'text.txt', '原文.txt']
        .map(name => join(fallbackDir, name)).find(candidate => files.has(candidate));
    }
    if (!path) return [];
    if (/\.json$/i.test(path)) return normalizeTranscript(await readJSON(path), warnings, path);
    const text = await readText(path);
    if (text === null) return [];
    return /\.(srt|vtt)$/i.test(path) ? parseSubtitle(text, warnings, path)
      : /\.lrc$/i.test(path) ? parseLrc(text, warnings, path) : plainRows(text);
  }
  async function extraText(value, base, fallbackDir, names) {
    if (typeof value === 'string') {
      if (TEXT.test(value) && !value.includes('\n')) {
        const path = resolve(value, base);
        return path ? (await readText(path) || '') : '';
      }
      return value;
    }
    const path = names.map(name => join(fallbackDir, name)).find(candidate => files.has(candidate));
    return path ? (await readText(path) || '') : '';
  }
  async function questionReference(value, base, fallbackDir) {
    let path;
    let questionData = value;
    if (typeof value === 'string') {
      path = resolve(value, base);
      questionData = path ? await readJSON(path) : [];
    } else if (value === undefined) {
      path = ['questions.json', 'question.json', '题目.json'].map(name => join(fallbackDir, name)).find(candidate => files.has(candidate));
      questionData = path ? await readJSON(path) : [];
    }
    return normalizeQuestions(questionData || [], warnings, path || '', reference => {
      const localBase = path ? dir(path) : base;
      const local = audioReference(reference, localBase, true);
      return local || audioReference(reference, base);
    });
  }
  async function articleFromMetadata(metadata, base, manifestPath) {
    if (!metadata || !safeId(metadata.id)) {
      warning(warnings, 'INVALID_ARTICLE_ID', '文章必须提供唯一且不含路径符号的 id。', manifestPath);
      return null;
    }
    const articleDir = metadata.folder ? resolveDirectory(metadata.folder, base) : join(base, metadata.id);
    const audio = {};
    if (typeof metadata.audio === 'string') audio[mode] = audioReference(metadata.audio, base);
    else if (metadata.audio && typeof metadata.audio === 'object') {
      for (const role of ['intensive', 'exam']) {
        if (typeof metadata.audio[role] === 'string') {
          const value = audioReference(metadata.audio[role], base, role !== mode);
          if (value) audio[role] = value;
        }
      }
    }
    if (!audio[mode] && metadata.audio === undefined) {
      const first = [...files.keys()].filter(path => dir(path) === articleDir && AUDIO.test(path)).sort()[0];
      if (first) audio[mode] = audioReference(basename(first), dir(first));
    }
    Object.keys(audio).forEach(key => { if (!audio[key]) delete audio[key]; });
    let transcript = await transcriptReference(metadata.transcript, base, articleDir);
    const text = await extraText(metadata.text, base, articleDir, []);
    if (!transcript.length && text) transcript = plainRows(text);
    const translation = await extraText(metadata.translation, base, articleDir, ['translation.txt', '译文.txt']);
    transcript = combineTranslation(transcript, translation, warnings, articleDir);
    const questions = await questionReference(metadata.questions, base, articleDir);
    const duration = seconds(metadata.duration);
    if (metadata.duration !== undefined && (duration === null || duration <= 0)) {
      warning(warnings, 'INVALID_AUDIO_DURATION', `「${short(metadata.title || metadata.id)}」音频时长必须大于 0。`, manifestPath);
    }
    return {
      id: metadata.id, title: String(metadata.title || metadata.id),
      ...(metadata.type ? { type: String(metadata.type) } : {}), audio, transcript, questions,
      ...(text ? { text } : {}), ...(translation ? { translation } : {}),
      ...(metadata.source ? { source: metadata.source } : {}),
      ...(duration !== null ? { duration } : {}),
    };
  }
  function resolveDirectory(reference, base) {
    const clean = safePath(reference);
    if (!clean) { warning(warnings, 'UNSAFE_REFERENCE', '文章目录引用无效。', short(reference)); return join(base, 'invalid'); }
    return join(base, clean);
  }
  const papers = [];
  const manifests = [...files.keys()].filter(path => /(^|\/)paper\.json$/i.test(path)).sort();
  for (const manifestPath of manifests) {
    const document = await readJSON(manifestPath);
    if (!document) continue;
    const entries = Array.isArray(document.papers) ? document.papers : [document];
    for (const metadata of entries) {
      if (!metadata || !safeId(metadata.id) || !Array.isArray(metadata.articles)) {
        warning(warnings, 'INVALID_PAPER', 'paper.json 必须包含合法 id 和 articles 数组。', manifestPath);
        continue;
      }
      const articles = [];
      const articleIds = new Set();
      for (const articleMetadata of metadata.articles) {
        if (articleIds.has(articleMetadata?.id)) {
          warning(warnings, 'ARTICLE_ID_COLLISION', `文章 ${short(articleMetadata.id)} 在同一试卷中重复，已保留第一份。`, manifestPath);
          continue;
        }
        const article = await articleFromMetadata(articleMetadata, dir(manifestPath), manifestPath);
        if (article) { articles.push(article); articleIds.add(article.id); }
      }
      if (articles.length) papers.push({
        id: metadata.id, title: String(metadata.title || metadata.id),
        ...(Number.isInteger(metadata.year) ? { year: metadata.year } : {}),
        ...(metadata.session ? { session: String(metadata.session) } : {}),
        ...(metadata.source ? { source: metadata.source } : {}), articles,
      });
    }
  }
  // A malformed explicit manifest is not silently reinterpreted as an unrelated import.
  if (manifests.length) {
    return finish(papers);
  }
  const groups = new Map();
  for (const path of files.keys()) {
    if (!AUDIO.test(path) && !/(^|\/)(article|questions?|transcript)\.json$/i.test(path)
      && !/\.(srt|vtt|lrc|txt)$/i.test(path)) continue;
    const folder = dir(path);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(path);
  }
  for (const [folder, paths] of groups) {
    const audioPaths = paths.filter(path => AUDIO.test(path)).sort();
    if (!audioPaths.length && !paths.some(path => /questions?\.json$/i.test(path))) continue;
    const metadataPath = join(folder, 'article.json');
    const metadata = files.has(metadataPath) ? await readJSON(metadataPath) : {};
    const questionPath = ['questions.json', 'question.json'].map(name => join(folder, name)).find(path => files.has(path));
    const questionData = questionPath ? await readJSON(questionPath) : [];
    const questionList = Array.isArray(questionData) ? questionData : questionData?.questions || [questionData];
    const groupIds = [...new Set(questionList.map(question => question?.groupId).filter(Boolean))];
    if (groupIds.length > 1) {
      warning(warnings, 'GROUP_ID_CONFLICT', '同一子文件夹包含多个 groupId，无法确定文章对应关系，已跳过。', folder);
      continue;
    }
    const parts = folder.split('/').filter(Boolean);
    while (parts.length && WRAPPERS.has(parts[0].toLowerCase())) parts.shift();
    const rootName = WRAPPERS.has(String(input.name).toLowerCase()) ? 'imported-paper' : slug(input.name);
    const paperId = safeId(metadata?.paperId) || slug(parts.length >= 2 ? parts[0] : rootName);
    const articleId = safeId(metadata?.groupId || groupIds[0] || metadata?.id)
      || slug(parts.length >= 2 ? parts[1] : parts[0] || basename(audioPaths[0] || 'article').replace(AUDIO, ''));
    const audio = {};
    const isQuestionFolder = parts.length >= 3 || (!!questionData?.groupId && !!questionData?.options);
    if (audioPaths[0] && !isQuestionFolder) audio[mode] = audioReference(basename(audioPaths[0]), folder);
    let transcript = await transcriptReference(metadata?.transcript, folder, folder);
    const translation = await extraText(metadata?.translation, folder, folder, ['translation.txt', '译文.txt']);
    transcript = combineTranslation(transcript, translation, warnings, folder);
    const questions = normalizeQuestions(questionData || [], warnings, questionPath || '', reference => audioReference(reference, folder));
    if (isQuestionFolder && audioPaths[0]) questions.forEach(question => { if (!question.audioUrl) question.audioUrl = files.get(audioPaths[0]).url; });
    const duration = seconds(metadata?.duration);
    if (metadata?.duration !== undefined && (duration === null || duration <= 0)) {
      warning(warnings, 'INVALID_AUDIO_DURATION', `「${short(metadata?.title || articleId)}」音频时长必须大于 0。`, metadataPath);
    }
    papers.push({ id: paperId, title: String(metadata?.paperTitle || paperId), articles: [{
      id: articleId, title: String(metadata?.title || articleId), audio, transcript, questions,
      ...(duration !== null ? { duration } : {}),
      ...(translation ? { translation } : {}),
    }] });
    if (audioPaths.length > 1) warning(warnings, 'MULTIPLE_AUDIO', '子文件夹有多个音频，默认使用按文件名排序的第一个；建议添加 paper.json。', folder);
  }
  if (papers.length) warning(warnings, 'INFERRED_IDS', '已根据目录名建立对应关系；两个模式请保持相同的试卷名和文章名，或添加 paper.json。');
  else warning(warnings, 'NO_MATERIALS', '未发现可用音频或题目。请检查目录结构和 paper.json。');
  return finish(papers);
}

function contentMismatch(left, right) {
  return left?.source?.checksum && right?.source?.checksum && left.source.checksum !== right.source.checksum;
}

function questionConflict(left, right) {
  return left.prompt !== right.prompt || JSON.stringify(left.options) !== JSON.stringify(right.options)
    || (left.answer && right.answer && left.answer !== right.answer);
}

/** Merge by explicit paper/article ID, preserve each mode's audio and unknown answers. */
export function mergePapers(existing = [], incoming = []) {
  const warnings = [];
  const papers = existing.map(paper => ({ ...paper, articles: paper.articles.map(article => ({
    ...article, audio: { ...article.audio }, transcript: [...(article.transcript || [])],
    questions: (article.questions || []).map(question => ({ ...question, options: question.options.map(option => ({ ...option })) })),
  })) }));
  const paperMap = new Map(papers.map(paper => [paper.id, paper]));
  for (const candidate of incoming) {
    if (!safeId(candidate?.id) || !Array.isArray(candidate.articles)) {
      warning(warnings, 'INVALID_PAPER', '跳过无效试卷。');
      continue;
    }
    let paper = paperMap.get(candidate.id);
    if (!paper) {
      paper = { ...candidate, articles: [] };
      papers.push(paper);
      paperMap.set(paper.id, paper);
    } else if ((paper.year && candidate.year && paper.year !== candidate.year)
      || (paper.session && candidate.session && paper.session !== candidate.session) || contentMismatch(paper, candidate)) {
      warning(warnings, 'PAPER_ID_COLLISION', `试卷 ${candidate.id} 的年份、场次或校验标识冲突，未合并。`);
      continue;
    } else {
      for (const key of ['year', 'session', 'source']) if (!paper[key] && candidate[key]) paper[key] = candidate[key];
    }
    const articleMap = new Map(paper.articles.map(article => [article.id, article]));
    for (const newArticle of candidate.articles) {
      if (!safeId(newArticle?.id)) { warning(warnings, 'INVALID_ARTICLE_ID', '跳过无效文章 ID。'); continue; }
      let article = articleMap.get(newArticle.id);
      if (!article) {
        article = { ...newArticle, audio: { ...(newArticle.audio || {}) },
          transcript: [...(newArticle.transcript || [])], questions: [...(newArticle.questions || [])] };
        paper.articles.push(article);
        articleMap.set(article.id, article);
        continue;
      }
      if (contentMismatch(article, newArticle)) {
        warning(warnings, 'ARTICLE_ID_COLLISION', `文章 ${candidate.id}/${newArticle.id} 的校验标识冲突，未合并。`);
        continue;
      }
      if (newArticle.transcript?.length && article.transcript.length
        && article.transcript.some(row => row.en) && newArticle.transcript.some(row => row.en)
        && article.transcript.map(row => row.en).join('\n') !== newArticle.transcript.map(row => row.en).join('\n')) {
        warning(warnings, 'TRANSCRIPT_CONFLICT', `文章 ${newArticle.id} 的原文内容冲突，未合并此次文章及音频；请核对文章 ID。`);
        continue;
      } else if (newArticle.transcript?.length) {
        if (!article.transcript.length) article.transcript = [...newArticle.transcript];
        else if (validateIntensiveTranscript(newArticle).length === 0
          && validateIntensiveTranscript(article).length > 0) {
          article.transcript = newArticle.transcript.map((row, index) => ({ ...row, zh: row.zh || article.transcript[index]?.zh || '' }));
        }
        else article.transcript = article.transcript.map((row, index) => ({ ...row, zh: row.zh || newArticle.transcript[index]?.zh || '' }));
      }
      article.audio = { ...article.audio, ...Object.fromEntries(Object.entries(newArticle.audio || {}).filter(([, value]) => value)) };
      for (const key of ['text', 'translation', 'source', 'type', 'duration']) if (!article[key] && newArticle[key]) article[key] = newArticle[key];
      const questionMap = new Map(article.questions.map(question => [question.id, question]));
      for (const question of newArticle.questions || []) {
        const old = questionMap.get(question.id);
        if (!old) { article.questions.push({ ...question }); questionMap.set(question.id, question); }
        else if (questionConflict(old, question)) {
          warning(warnings, 'QUESTION_ID_COLLISION', `题目 ${newArticle.id}/${question.id} 内容或答案冲突，已保留已有题目。`);
        } else {
          for (const key of ['answer', 'explanation', 'audioUrl', 'start', 'end', 'audioTimeline']) if ((old[key] === undefined || old[key] === '') && question[key] !== undefined) old[key] = question[key];
        }
      }
      article.questions.sort((a, b) => a.number - b.number);
    }
  }
  return { papers, warnings };
}
