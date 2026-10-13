/** Map a sliced question recording to the same article, including concatenated context. */
export function mapAudioTime(time, timeline, direction = 'clipToArticle') {
  if (!Number.isFinite(time) || !Array.isArray(timeline) || !timeline.length) return undefined;
  const segments = timeline.filter(s => [s.clipStart,s.clipEnd,s.articleStart].every(Number.isFinite)
    && s.clipStart >= 0 && s.clipEnd > s.clipStart && s.articleStart >= 0);
  if (segments.length !== timeline.length) return undefined;
  const clip = direction === 'clipToArticle';
  let closest;
  for (const segment of segments) {
    const start = clip ? segment.clipStart : segment.articleStart;
    const end = start + segment.clipEnd - segment.clipStart;
    const target = clip ? segment.articleStart : segment.clipStart;
    if (time >= start && (time < end || (time === end && segment === segments[segments.length - 1]))) return target + time - start;
    const boundary = time < start ? start : end;
    const distance = Math.abs(time - boundary);
    if (!closest || distance < closest.distance) closest = {distance, time: target + boundary - start};
  }
  return closest?.time;
}
