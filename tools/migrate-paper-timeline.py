"""Move an indexed local library onto original complete recordings, without slicing.

Only reviewed source manifests supply chapter coordinates. No guessed offsets,
audio concatenation, transcript alignment, or change of paper/article IDs occurs.
The caller explicitly supplies the private library and authored manifests.
"""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def duration(file):
    value = float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(file)], text=True))
    if not math.isfinite(value) or value <= 0:
        raise ValueError('Full recording has no valid duration: ' + str(file))
    return value


def numbers(article):
    questions = article.get('questions', [])
    if questions:
        return tuple(sorted(int(question['number']) for question in questions))
    label = article.get('sourceTiming', {}).get('label', article.get('title', ''))
    match = re.search(r'(\d+)\s*[–—\-~至]\s*(\d+)\s*题', label)
    return tuple(range(int(match[1]), int(match[2]) + 1)) if match else ()


def match_marker(article, source):
    wanted = numbers(article)
    exact = [mark for mark in source['articles'] if mark['id'] == article['id']]
    if exact and (not numbers(exact[0]) or numbers(exact[0]) == wanted):
        return exact[0], 'preserved-id'
    matches = [mark for mark in source['articles'] if wanted and numbers(mark) == wanted]
    if len(matches) > 1:
        raise ValueError('Ambiguous reviewed question-number chapter: ' + article['id'])
    return (matches[0], 'reviewed-question-numbers') if matches else (None, None)


def copy_recording(original, target):
    if original.resolve() == target.resolve():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if sha256(original) != sha256(target):
            raise ValueError('Refusing to replace a different existing recording: ' + str(target))
        return
    temporary = target.with_name('.' + target.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        shutil.copyfile(original, temporary)
        if sha256(original) != sha256(temporary):
            raise ValueError('Copied recording does not match its source')
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_json(target, value):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.' + target.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()


def migrate(library, manifests, media, allow_unlocated=False):
    media = media.resolve()
    authored = {}
    for manifest in manifests:
        manifest_hash = sha256(manifest)
        for paper in json.loads(manifest.read_text(encoding='utf-8-sig'))['papers']:
            authority = {'manifest': str(manifest.resolve()), 'manifestSha256': manifest_hash,
                         'source': paper.get('source'), 'hls': paper.get('hls')}
            if paper.get('sourceHtml'):
                html = Path(paper['sourceHtml'])
                actual = sha256(html)
                if paper.get('htmlSha256') and actual != paper['htmlSha256']:
                    raise ValueError('Reviewed publisher HTML hash changed: ' + str(html))
                authority.update(sourceHtml=str(html.resolve()), htmlSha256=actual)
            authored[paper['id']] = (paper, authority)
    data = json.loads(library.read_text(encoding='utf-8-sig'))
    evidence = []
    for paper in data['papers']:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', paper['id']):
            raise ValueError('Unsafe paper identifier')
        articles = paper['articles']
        if not articles:
            raise ValueError('Paper has no preserved articles: ' + paper['id'])
        marker_evidence = []
        if len(articles) > 1:
            reviewed = authored.get(paper['id'])
            if not reviewed:
                raise ValueError('Missing reviewed full-source manifest: ' + paper['id'])
            source, authority = reviewed
            sources = {Path(mark['sourceAudio']).resolve() for mark in source['articles']}
            if len(sources) != 1:
                raise ValueError('Articles do not share one original recording: ' + paper['id'])
            original = sources.pop()
            if not original.is_file():
                raise ValueError('Missing full recording: ' + str(original))
            original_duration = duration(original)
            target = media / 'cet6' / paper['id'] / ('paper' + original.suffix.lower())
            if target.resolve().parent != (media / 'cet6' / paper['id']).resolve():
                raise ValueError('Unsafe generated recording path')
            used = set()
            for article in articles:
                mark, matching = match_marker(article, source)
                if mark is None:
                    if not allow_unlocated:
                        raise ValueError('Missing authoritative chapter: ' + paper['id'] + '/' + article['id'])
                    article.update(start=None, end=None, timelineStatus='unlocated')
                    marker_evidence.append({'article': article['id'], 'start': None, 'end': None,
                        'status': 'unlocated', 'questionNumbers': list(numbers(article)),
                        'reason': 'The reviewed publisher manifest and archived HTML omit this chapter; no boundary was inferred from adjacent chapters.'})
                    continue
                if mark['id'] in used:
                    raise ValueError('One reviewed marker was assigned twice')
                used.add(mark['id'])
                article['start'], article['end'] = mark['start'], mark['end']
                timing = mark.get('sourceTiming', mark.get('source', {}).get('originalRange', {}))
                if any(timing.get(key, mark[key]) != mark[key] for key in ('start', 'end')):
                    raise ValueError('Reviewed marker disagrees with its authored source')
                marker_evidence.append({'article': article['id'], 'sourceArticle': mark['id'],
                    'match': matching, 'questionNumbers': list(numbers(article)),
                    'start': mark['start'], 'end': mark['end'], 'status': 'reviewed',
                    'authoritativeMarker': copy.deepcopy(mark.get('sourceTiming', mark.get('source')))})
            if isinstance(source.get('source'), dict) and source['source'].get('timing') == 'authored-lrc':
                lrc = original.with_suffix('.lrc')
                if lrc.is_file():
                    authority.update(sourceLrc=str(lrc), lrcSha256=sha256(lrc))
        else:
            target = (media.parent / articles[0]['audio']['intensive']).resolve()
            if media not in target.parents or not target.is_file():
                raise ValueError('Full recording is outside the private media directory or missing')
            original = target
            original_duration = duration(target)
            articles[0]['start'] = 0
            articles[0]['end'] = original_duration
            authority = {'source': paper.get('source'), 'basis': 'existing complete recording, one preserved article; no audio concatenation'}
            marker_evidence.append({'article': articles[0]['id'], 'start': 0,
                                    'end': original_duration, 'status': 'complete-recording'})
        reference = target.relative_to(media.parent).as_posix()
        previous = 0
        for article in articles:
            start, end = article['start'], article['end']
            if start is not None and end is not None:
                if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in (start, end)) or start < previous or end <= start or end > original_duration + .05:
                    raise ValueError('Invalid authored chapter: ' + paper['id'] + '/' + article['id'])
                article['duration'] = end - start
                previous = end
            article['audio'] = {'intensive': reference, 'exam': reference}
            for question in article.get('questions', []):
                for key in ('audioUrl', 'audioTimeline'):
                    question.pop(key, None)
        copy_recording(original, target)
        paper.update(schemaVersion=2, audio=reference, duration=original_duration,
                     collection={'id': 'cet6', 'title': '六级合集'})
        evidence.append({'paper': paper['id'], 'recording': reference,
                         'originalRecording': str(original.resolve()),
                         'duration': original_duration, 'bytes': target.stat().st_size,
                         'markers': len(articles), 'chapters': marker_evidence,
                         'authority': authority, 'sha256': sha256(target)})
    data['schemaVersion'] = 2
    data.setdefault('summary', {}).update(recordings=len(evidence),
        audioBytes=sum(item['bytes'] for item in evidence),
        unlocatedArticles=sum(mark['status'] == 'unlocated' for item in evidence for mark in item['chapters']))
    return data, evidence


def stage_materials(data, evidence, media, destination):
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    staged = []
    for paper, item in zip(data['papers'], evidence):
        folder = destination / paper['id']
        if folder.resolve().parent != destination:
            raise ValueError('Unsafe generated paper folder')
        folder.mkdir(parents=True, exist_ok=True)
        original = (media.parent / paper['audio']).resolve()
        name = 'paper' + original.suffix.lower()
        copy_recording(original, folder / name)
        metadata = copy.deepcopy(paper)
        metadata['audio'] = name
        for article in metadata['articles']:
            article['audio'] = {'intensive': name, 'exam': name}
        write_json(folder / 'paper.json', metadata)
        staged.append({'paper': paper['id'], 'folder': str(folder), 'recording': name,
                       'sha256': item['sha256'], 'bytes': item['bytes']})
    return staged


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, action='append', default=[])
    parser.add_argument('--media', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--materials-root', type=Path)
    parser.add_argument('--allow-unlocated', action='store_true', help='Retain a chapter without an authoritative marker as null, without guessing a boundary')
    args = parser.parse_args()
    data, evidence = migrate(args.library, args.manifest, args.media, args.allow_unlocated)
    if args.materials_root:
        staged = stage_materials(data, evidence, args.media.resolve(), args.materials_root)
        write_json(args.evidence.with_name(args.evidence.stem + '-folders.json'), staged)
    write_json(args.output, data)
    write_json(args.evidence, evidence)
    print(f'Prepared {len(evidence)} complete recordings; {data["summary"]["unlocatedArticles"]} chapter(s) remain explicitly unlocated. IDs, questions and texts preserved.')
