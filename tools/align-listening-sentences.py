#!/usr/bin/env python3
"""Offline, evidence-backed sentence marks from a whole listening recording.

Private audio/text and raw ASR evidence stay outside Git. No timing interpolation:
every accepted endpoint comes from a real recognized word or acoustic DTW alignment.
See SYSTRAN/faster-whisper (word_timestamps) and CTranslate2 Whisper.align docs.
"""
from __future__ import annotations

import argparse
import copy
import difflib
import hashlib
import json
import re
import statistics
import subprocess
import time
from pathlib import Path


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    temporary.replace(path)


def log(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def tokens(text):
    text = re.sub(r'^\s*(?:M|W|Man|Woman)\s*:\s*', '', text, flags=re.I)
    result = [match.group().lower().replace('\u2019', "'") for match in word_spans(text)]
    # Orthography only: the original displayed manuscript is never rewritten.
    # Numerals/number names and OK/okay are the same spoken word, not mismatches.
    numbers = dict(enumerate('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()))
    canonical = {str(key): value for key, value in numbers.items()}
    canonical.update({'ok': 'okay'})
    def normalize(word):
        compact = re.sub(r'\s+', '', word)
        if re.fullmatch(r"b(?:&|and|n)b(?:'?s)?", compact):
            return 'bnbs' if compact.endswith('s') else 'bnb'
        return canonical.get(word, word.replace('.', ''))
    return [normalize(word) for word in result]


def word_spans(text):
    return list(re.finditer(r"(?:[a-z]\.){2,}|\bb\s*(?:&|\band\b|\bn\b)\s*b(?:['\u2019]?s)?\b|[a-z0-9]+(?:['\u2019][a-z0-9]+)*", text, flags=re.I))


def sentences(text):
    """Retain source punctuation, speaker prefixes, and all words exactly."""
    result, start = [], 0
    for match in re.finditer(r'''[.!?]+['"\u201d\u2019)]*(?=\s|$)''', text):
        prefix = text[start:match.end()]
        last = re.search(r'(\S+)\s*$', prefix)
        if match.group().startswith('.') and last and re.search(
            r'(?i)(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc)\.|(?:[a-z]\.){2,})[\"\u201d]?$'
            , last.group()):
            continue
        part = prefix.strip()
        if part:
            result.append(part)
        start = match.end()
    if text[start:].strip():
        result.append(text[start:].strip())
    assert ' '.join(text.split()) == ' '.join(' '.join(result).split())
    return result or [text]


def paper_at(library, paper_id):
    papers = library if isinstance(library, list) else library['papers']
    return next(p for p in papers if p['id'] == paper_id)


def prepare(args):
    import faster_whisper
    import ctranslate2
    import numpy as np
    from faster_whisper import WhisperModel
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    library = read(args.library)
    paper = paper_at(library, args.paper)
    for name, value in [('paper-before.json', paper), ('library-before.json', library)]:
        if not (out / name).exists():
            write(out / name, value)
    original_audio_sha = digest(args.audio)
    # Decode the existing whole source, without writing or changing any audio.
    # This also avoids PyAV API version differences in newer Windows wheels.
    decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(args.audio),
                              '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1',
                              '-ar', '16000', 'pipe:1'], check=True, capture_output=True)
    wav = np.frombuffer(decoded.stdout, dtype='<f4')
    model = WhisperModel(str(Path(args.model).resolve()), device='cpu', compute_type='int8',
                         cpu_threads=args.threads, num_workers=1, local_files_only=True)
    manifest = {
        'paperId': args.paper, 'audioSha256': original_audio_sha,
        'audioBytes': Path(args.audio).stat().st_size, 'sampleRate': 16000,
        'decodedSamples': len(wav), 'decodedDuration': len(wav) / 16000,
        'modelDirectory': str(Path(args.model).resolve()),
        'modelFiles': [{'file': name, 'sha256': digest(Path(args.model) / name)}
                       for name in ('model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt')],
        'fasterWhisperVersion': faster_whisper.__version__,
        'ctranslate2Version': ctranslate2.__version__, 'computeType': 'int8',
        'cpuThreads': args.threads, 'privateOfflineProcessing': True,
        'timeBasis': 'article-local seconds, sampled from unmodified whole recording',
        'notHumanListeningReview': True,
        'documentation': ['https://github.com/SYSTRAN/faster-whisper',
                          'https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html'],
    }
    write(out / 'environment.json', manifest)
    return paper, wav, model, manifest


def transcribe(args):
    from dataclasses import asdict
    paper, wav, model, manifest = prepare(args)
    for article in paper['articles']:
        if args.articles and article['id'] not in args.articles:
            continue
        path = Path(args.output) / (article['id'] + '.asr.json')
        if path.exists() and not args.force:
            old = read(path)
            assert old['audioSha256'] == manifest['audioSha256']
            assert old['modelFiles'] == manifest['modelFiles']
            log({'article': article['id'], 'cached': True})
            continue
        first, last = round(article['start'] * 16000), round(article['end'] * 16000)
        began = time.monotonic()
        options = {'language': 'en', 'beam_size': 5, 'temperature': 0,
                   'condition_on_previous_text': False, 'word_timestamps': True,
                   'vad_filter': True, 'vad_parameters': {'min_silence_duration_ms': 500}}
        segments, info = model.transcribe(wav[first:last], **options)
        result = [asdict(segment) for segment in segments]
        elapsed = time.monotonic() - began
        write(path, {**manifest, 'articleId': article['id'], 'chapterStart': article['start'],
                     'chapterEnd': article['end'], 'sampleStart': first, 'sampleEnd': last,
                     'options': options, 'elapsedSeconds': elapsed, 'segments': result})
        log({'article': article['id'], 'segments': len(result),
             'words': sum(len(s['words']) for s in result), 'elapsedSeconds': round(elapsed, 2)})


def normalized_asr(raw):
    return normalize_words([word for segment in raw['segments'] for word in segment['words']])


def normalize_words(words):
    result = []
    for word in words:
        for token in tokens(word['word']):
            result.append({'token': token, **word})
    merged, index = [], 0
    while index < len(result):
        current = result[index]
        count = 0
        if current['token'] == 'b' and index + 1 < len(result):
            following = result[index + 1]['token']
            if following in ('b', 'bs', "b's"):
                count = 2
            elif following in ('and', 'n') and index + 2 < len(result) and result[index + 2]['token'] in ('b', 'bs', "b's"):
                count = 3
        if count:
            final = result[index + count - 1]
            merged.append({**current, 'token': 'bnbs' if final['token'].endswith('s') else 'bnb',
                           'word': ''.join(w['word'] for w in result[index:index + count]),
                           'end': final['end'],
                           'probability': min(w['probability'] for w in result[index:index + count])})
            index += count
        else:
            merged.append(current)
            index += 1
    return merged


def reference(article):
    rows, all_tokens = [], []
    for paragraph, row in enumerate(article['transcript']):
        parts = sentences(row['en'])
        for index, part in enumerate(parts):
            ts = tokens(part)
            rows.append({'en': part, 'zh': row.get('zh', '') if index == len(parts) - 1 else '',
                         'paragraph': paragraph, 'paragraphSentence': index,
                         'translationPlacement': 'paragraph-last-sentence',
                         'tokenStart': len(all_tokens), 'tokenEnd': len(all_tokens) + len(ts)})
            all_tokens += ts
    return rows, all_tokens


def reference_span(article, first_token, last_token):
    """Original casing/punctuation improve DTW decoder likelihood at turn boundaries."""
    source = ' '.join(re.sub(r'^\s*(?:M|W|Man|Woman)\s*:\s*', '', row['en'], flags=re.I)
                      for row in article['transcript'])
    spans = word_spans(source)
    finish = spans[last_token].start() if last_token < len(spans) else len(source)
    return ' ' + source[spans[first_token].start():finish].strip()


def token_map(ref, recognized):
    matches = {}
    matcher = difflib.SequenceMatcher(None, ref, [w['token'] for w in recognized], autojunk=False)
    for group in matcher.get_matching_blocks():
        for offset in range(group.size):
            matches[group.a + offset] = group.b + offset
    return matches


def align(args):
    paper = paper_at(read(args.library), args.paper)
    results, problems = [], []
    for article in paper['articles']:
        if args.articles and article['id'] not in args.articles:
            continue
        raw = read(Path(args.output) / (article['id'] + '.asr.json'))
        assert raw['audioSha256'] == digest(args.audio)
        recognized = normalized_asr(raw)
        rows, ref = reference(article)
        matched = token_map(ref, recognized)
        checks = []
        for index, row in enumerate(rows):
            begin, end = row['tokenStart'], row['tokenEnd']
            matched_ids = [matched[i] for i in range(begin, end) if i in matched]
            coverage = len(matched_ids) / max(1, end - begin)
            exact_edges = begin in matched and end - 1 in matched
            check = {'sentence': index, 'paragraph': row['paragraph'],
                     'words': end - begin, 'matchedWords': len(matched_ids),
                     'coverage': coverage, 'exactEndpointWords': exact_edges}
            if exact_edges:
                first, last = recognized[matched[begin]], recognized[matched[end - 1]]
                uncertain_edges = [edge for edge, word in [('start', first), ('end', last)]
                                   if word['end'] - word['start'] <= .02]
                check.update(start=first['start'], end=last['end'],
                             endpointProbabilities=[first['probability'], last['probability']],
                             endpointNeedsAcousticRefinement=uncertain_edges,
                             method='independent-asr-word-endpoints')
                row.update(start=round(first['start'], 3), end=round(last['end'], 3), timed=True)
            if not exact_edges or coverage < args.minimum_coverage or check.get('endpointNeedsAcousticRefinement'):
                problems.append({'article': article['id'], **check})
            checks.append(check)
        coverage = len(matched) / max(1, len(ref))
        body_end = max((r.get('end', 0) for r in rows), default=0)
        question_audio = [word for word in recognized if word['start'] >= body_end - .02]
        question_reference = [word for question in article['questions'] for word in tokens(question.get('prompt', ''))]
        question_matches = token_map(question_reference, question_audio)
        question_evidence = {
            'bodyEnd': body_end, 'referenceQuestionWords': len(question_reference),
            'matchedQuestionWordsAfterBody': len(question_matches),
            'coverage': len(question_matches) / max(1, len(question_reference)),
            'firstMatchedQuestionWordStart': min((question_audio[i]['start'] for i in question_matches.values()), default=None),
            'questionAudioExcludedFromTranscript': True,
        }
        item = {'articleId': article['id'], 'chapterStart': article['start'],
                'chapterEnd': article['end'], 'referenceWords': len(ref),
                'recognizedWords': len(recognized), 'matchedWords': len(matched),
                'coverage': coverage, 'sentences': len(rows), 'checks': checks,
                'questionAudioCheck': question_evidence, 'rows': rows}
        results.append(item)
        log({k: item[k] for k in ('articleId', 'sentences', 'coverage')})
    write(Path(args.output) / 'alignment-draft.json', {
        'paperId': args.paper, 'audioSha256': digest(args.audio),
        'minimumCoverage': args.minimum_coverage, 'articles': results, 'reviewRequired': problems,
        'applied': False, 'translationPolicy': 'Exact original paragraph translation once on its last sentence.'})
    log({'reviewRequired': len(problems), 'applied': False})


def refine(args):
    """Recover missing endpoint words using acoustic DTW, not interpolation."""
    from dataclasses import asdict
    from faster_whisper.audio import pad_or_trim
    from faster_whisper.tokenizer import Tokenizer
    paper, wav, model, manifest = prepare(args)
    path = Path(args.output) / 'alignment-draft.json'
    draft = read(path)
    assert draft['audioSha256'] == manifest['audioSha256']
    tokenizer = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task='transcribe', language='en')
    unresolved, evidence = [], []
    for aligned in draft['articles']:
        article = next(a for a in paper['articles'] if a['id'] == aligned['articleId'])
        _, ref = reference(article)
        raw = read(Path(args.output) / (article['id'] + '.asr.json'))
        recognized = normalized_asr(raw)
        matched = token_map(ref, recognized)
        for index, (row, check) in enumerate(zip(aligned['rows'], aligned['checks'])):
            if check['exactEndpointWords'] and check['coverage'] >= args.minimum_coverage and not check.get('endpointNeedsAcousticRefinement'):
                continue
            before = len(evidence)
            new_edges = {}
            for edge, target in [('start', row['tokenStart']), ('end', row['tokenEnd'] - 1)]:
                if target in matched and edge not in check.get('endpointNeedsAcousticRefinement', []):
                    new_edges[edge] = recognized[matched[target]][edge]
                    continue
                lo = max(0, target - 9)
                hi = min(len(ref), target + 10)
                left_matches = [i for i in range(max(0, lo - 12), target) if i in matched]
                right_matches = [i for i in range(target + 1, min(len(ref), hi + 12)) if i in matched]
                lo = min(lo, left_matches[-1]) if left_matches else lo
                hi = max(hi, right_matches[0] + 1) if right_matches else hi
                anchors = [(i, recognized[matched[i]]) for i in range(lo, hi) if i in matched]
                if len(anchors) < 3:
                    evidence.append({'article': article['id'], 'sentence': index,
                                     'edge': edge, 'accepted': False, 'reason': 'insufficient-independent-ASR-anchors'})
                    continue
                first, last = anchors[0][1], anchors[-1][1]
                window_start = max(0, first['start'] - 1.5)
                window_end = min(article['end'] - article['start'], last['end'] + 1.5)
                if window_end - window_start > 29.5:
                    evidence.append({'article': article['id'], 'sentence': index,
                                     'edge': edge, 'accepted': False, 'reason': 'window-exceeds-model-context'})
                    continue
                first_sample = round((article['start'] + window_start) * 16000)
                last_sample = round((article['start'] + window_end) * 16000)
                samples = wav[first_sample:last_sample]
                features = model.feature_extractor(samples)
                frame_count = features.shape[-1]
                encoded = model.encode(pad_or_trim(features))
                text_tokens = tokenizer.encode(reference_span(article, lo, hi))
                words = model.find_alignment(tokenizer, [text_tokens], encoded, frame_count)[0]
                normalized = normalize_words(words)
                local_map = token_map(ref[lo:hi], normalized)
                target_local = target - lo
                anchor_errors = []
                for reference_index, recognized_word in anchors:
                    if reference_index - lo in local_map:
                        word = normalized[local_map[reference_index - lo]]
                        anchor_errors.append(abs(word['start'] + window_start - recognized_word['start']))
                word = normalized[local_map[target_local]] if target_local in local_map else None
                orthographic_retry = None
                if not word or word['end'] <= word['start'] or word['probability'] < .1:
                    # Capitalization/numeral tokenization can collapse a genuine
                    # spoken word to zero DTW duration. Re-run actual acoustic DTW
                    # with equivalent spoken orthography, retaining both results.
                    retry_tokens = tokenizer.encode(' '.join(ref[lo:hi]))
                    retry = model.find_alignment(tokenizer, [retry_tokens], encoded, frame_count)[0]
                    retry_words = normalize_words(retry)
                    retry_map = token_map(ref[lo:hi], retry_words)
                    retry_word = retry_words[retry_map[target_local]] if target_local in retry_map else None
                    retry_residuals = [abs(retry_words[retry_map[i - lo]]['start'] + window_start - recognized_word['start'])
                                       for i, recognized_word in anchors if i - lo in retry_map]
                    orthographic_retry = {'originalWordAlignment': word,
                                          'retryWordAlignment': retry_word,
                                          'medianAnchorResidualSeconds': statistics.median(retry_residuals) if retry_residuals else None}
                    if retry_word and retry_word['end'] > retry_word['start'] and retry_word['probability'] >= .1 and retry_residuals and statistics.median(retry_residuals) <= .35:
                        word = retry_word
                        anchor_errors = retry_residuals
                accepted = bool(word and word['end'] > word['start'] and word['probability'] >= .1
                                and anchor_errors and statistics.median(anchor_errors) <= .35)
                record = {'article': article['id'], 'sentence': index, 'edge': edge,
                          'method': 'Whisper-cross-attention-DTW', 'windowStart': window_start,
                          'windowEnd': window_end, 'referenceWordIndex': target,
                          'independentAnchorCount': len(anchor_errors),
                          'medianAnchorResidualSeconds': statistics.median(anchor_errors) if anchor_errors else None,
                          'accepted': accepted, 'wordAlignment': word,
                          'orthographicRetry': orthographic_retry}
                evidence.append(record)
                if accepted:
                    new_edges[edge] = float(word[edge] + window_start)
            # Zero-duration attention words and genuinely dropped ASR words get a
            # fresh decoding of a different audio context. This changes evidence,
            # never the source text or the acceptance threshold.
            if len(new_edges) < 2 or new_edges.get('end', 0) <= new_edges.get('start', 0) or check['coverage'] < args.minimum_coverage:
                ids = [matched[i] for i in range(row['tokenStart'], row['tokenEnd']) if i in matched]
                start = max(0, recognized[min(ids)]['start'] - 1.8)
                end = min(article['end'] - article['start'], recognized[max(ids)]['end'] + 1.8)
                samples = wav[round((article['start'] + start) * 16000):round((article['start'] + end) * 16000)]
                fresh, _ = model.transcribe(samples, language='en', beam_size=5, temperature=0,
                                            word_timestamps=True, condition_on_previous_text=False, vad_filter=False)
                fresh_segments = [asdict(segment) for segment in fresh]
                fresh_words = normalized_asr({'segments': fresh_segments})
                reference_words = ref[row['tokenStart']:row['tokenEnd']]
                fresh_matches = token_map(reference_words, fresh_words)
                coverage = len(fresh_matches) / len(reference_words)
                first = fresh_words[fresh_matches[0]] if 0 in fresh_matches else None
                last_index = len(reference_words) - 1
                last = fresh_words[fresh_matches[last_index]] if last_index in fresh_matches else None
                residuals = [abs(fresh_words[local]['start'] + start - recognized[matched[reference_index + row['tokenStart']]]['start'])
                             for reference_index, local in fresh_matches.items()
                             if reference_index + row['tokenStart'] in matched
                             and recognized[matched[reference_index + row['tokenStart']]]['end'] - recognized[matched[reference_index + row['tokenStart']]]['start'] > .02]
                valid = bool(first and last and first['end'] - first['start'] > .02
                             and last['end'] - last['start'] > .02 and coverage >= args.minimum_coverage
                             and residuals and statistics.median(residuals) <= .35)
                evidence.append({'article': article['id'], 'sentence': index,
                                 'method': 'fresh-local-audio-ASR-no-VAD', 'windowStart': start,
                                 'windowEnd': end, 'coverage': coverage, 'accepted': valid,
                                 'medianIndependentWordResidualSeconds': statistics.median(residuals) if residuals else None,
                                 'freshTranscription': fresh_segments})
                if valid:
                    check['initialCoverage'] = check['coverage']
                    check['coverage'] = coverage
                    check['freshAcousticVerification'] = True
                    new_edges.update(start=first['start'] + start, end=last['end'] + start)
            if len(new_edges) == 2 and new_edges['end'] > new_edges['start'] and check['coverage'] >= args.minimum_coverage:
                row.update(start=round(new_edges['start'], 3), end=round(new_edges['end'], 3), timed=True)
                check.update(start=row['start'], end=row['end'], method='independent-ASR-plus-acoustic-DTW',
                             acousticRefinement=True)
            else:
                unresolved.append({'article': article['id'], **check})
            log({'article': article['id'], 'sentence': index, 'refinements': len(evidence) - before,
                 'resolved': bool(row.get('timed')) and len(new_edges) == 2})
    draft['reviewRequired'] = unresolved
    draft['refinementEvidence'] = evidence
    write(path, draft)
    log({'reviewRequired': len(unresolved), 'acousticRefinements': len(evidence)})


def verify_windows(args):
    """Fresh audio-context ASR checks of first/middle/last sentences in each chapter.

    This is an automated audio verification, explicitly not a human listening claim.
    Evidence records all endpoint residuals and recognition failures without repair.
    """
    from dataclasses import asdict
    paper, wav, model, manifest = prepare(args)
    path = Path(args.output) / 'alignment-draft.json'
    draft = read(path)
    assert not draft['reviewRequired'], 'Resolve uncertain sentences before verification.'
    checks = []
    for aligned in draft['articles']:
        article = next(a for a in paper['articles'] if a['id'] == aligned['articleId'])
        rows = aligned['rows']
        for index in sorted({0, len(rows) // 2, len(rows) - 1}):
            row = rows[index]
            start = max(0, row['start'] - 1.5)
            end = min(article['end'] - article['start'], row['end'] + 1.5)
            samples = wav[round((article['start'] + start) * 16000):round((article['start'] + end) * 16000)]
            parts, _ = model.transcribe(samples, language='en', beam_size=5, temperature=0,
                                        word_timestamps=True, condition_on_previous_text=False,
                                        vad_filter=False)
            segments = [asdict(segment) for segment in parts]
            recognized = normalized_asr({'segments': segments})
            ref = tokens(row['en'])
            matched = token_map(ref, recognized)
            endpoints = 0 in matched and len(ref) - 1 in matched
            residuals = None
            if endpoints:
                residuals = [recognized[matched[0]]['start'] + start - row['start'],
                             recognized[matched[len(ref) - 1]]['end'] + start - row['end']]
            accepted = bool(endpoints and len(matched) / len(ref) >= args.minimum_coverage
                            and max(abs(value) for value in residuals) <= .5)
            record = {'article': article['id'], 'sentence': index,
                      'position': 'first' if index == 0 else 'last' if index == len(rows) - 1 else 'middle',
                      'chapterStart': article['start'], 'windowStart': start, 'windowEnd': end,
                      'coverage': len(matched) / len(ref), 'exactEndpointWords': endpoints,
                      'endpointResidualSeconds': residuals, 'accepted': accepted,
                      'freshTranscription': segments}
            checks.append(record)
            write(Path(args.output) / 'audio-window-checks.json', {
                'audioSha256': manifest['audioSha256'], 'automatedAudioReview': True,
                'humanListeningReview': False, 'checks': checks,
                'passed': all(c['accepted'] for c in checks), 'complete': len(checks) == len(draft['articles']) * 3})
            log({k: record[k] for k in ('article', 'sentence', 'position', 'coverage', 'endpointResidualSeconds', 'accepted')})


def review_windows(args):
    """Resolve flagged spot checks by acoustic DTW with the actual adjacent words.

    Never erase failed ASR observations. Any corrected endpoint must itself be a
    nonzero-duration DTW word with a likelihood and independently stable anchors.
    """
    from faster_whisper.audio import pad_or_trim
    from faster_whisper.tokenizer import Tokenizer
    paper, wav, model, manifest = prepare(args)
    out = Path(args.output)
    draft = read(out / 'alignment-draft.json')
    windows = read(out / 'audio-window-checks.json')
    assert windows['complete']
    if not (out / 'audio-window-checks-initial.json').exists():
        write(out / 'audio-window-checks-initial.json', windows)
        write(out / 'alignment-before-window-review.json', draft)
    tokenizer = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task='transcribe', language='en')
    for check in windows['checks']:
        if check['accepted']:
            continue
        aligned = next(a for a in draft['articles'] if a['articleId'] == check['article'])
        article = next(a for a in paper['articles'] if a['id'] == check['article'])
        row = aligned['rows'][check['sentence']]
        recognized = normalized_asr({'segments': check['freshTranscription']})
        ref = tokens(row['en'])
        matched = token_map(ref, recognized)
        if not matched:
            continue
        _, whole_reference = reference(article)
        whole_recognized = normalized_asr(read(out / (article['id'] + '.asr.json')))
        whole_matched = token_map(whole_reference, whole_recognized)
        lo, hi = max(0, row['tokenStart'] - 12), min(len(whole_reference), row['tokenEnd'] + 8)
        context = reference_span(article, lo, hi)
        context_ref = tokens(context)
        prefix_size = row['tokenStart'] - lo
        anchors = [whole_recognized[whole_matched[i]] for i in range(lo, hi) if i in whole_matched]
        start = max(0, anchors[0]['start'] - .6)
        end = min(article['end'] - article['start'], anchors[-1]['end'] + .6)
        assert end - start <= 29.5
        samples = wav[round((article['start'] + start) * 16000):round((article['start'] + end) * 16000)]
        features = model.feature_extractor(samples)
        encoded = model.encode(pad_or_trim(features))
        words = model.find_alignment(tokenizer, [tokenizer.encode(context)], encoded, features.shape[-1])[0]
        normalized = normalize_words(words)
        mapped = token_map(context_ref, normalized)
        target_first, target_last = prefix_size, prefix_size + len(ref) - 1
        first = normalized[mapped[target_first]] if target_first in mapped else None
        last = normalized[mapped[target_last]] if target_last in mapped else None
        fresh_map = token_map(ref, recognized)
        anchor_residuals = [abs(normalized[mapped[prefix_size + i]]['start'] + start - recognized[j]['start'] - check['windowStart'])
                            for i, j in fresh_map.items()
                            if prefix_size + i in mapped and i not in (0, len(ref) - 1)]
        edges_valid = bool(first and last and first['end'] - first['start'] > .02
                           and last['end'] - last['start'] > .02
                           and min(first['probability'], last['probability']) >= .1)
        new_start = float(first['start'] + start) if first else None
        new_end = float(last['end'] + start) if last else None
        neighbors_valid = bool(edges_valid and (check['sentence'] == 0 or new_start >= aligned['rows'][check['sentence'] - 1]['end'] - .02)
                               and (check['sentence'] == len(aligned['rows']) - 1 or new_end <= aligned['rows'][check['sentence'] + 1]['start'] + .02))
        accepted = bool(edges_valid and neighbors_valid and anchor_residuals and statistics.median(anchor_residuals) <= .35
                        and abs(new_start - row['start']) <= 1 and abs(new_end - row['end']) <= 1)
        review = {'method': 'spot-check-acoustic-DTW-with-fresh-context', 'accepted': accepted,
                  'firstWord': first, 'lastWord': last,
                  'medianIndependentInnerWordResidualSeconds': statistics.median(anchor_residuals) if anchor_residuals else None,
                  'beforeStart': row['start'], 'beforeEnd': row['end'],
                  'dtwStart': new_start, 'dtwEnd': new_end,
                  'independentMatchedWords': len(matched), 'referenceWords': len(ref)}
        check.setdefault('acousticReviewHistory', []).append(review)
        check['acousticReview'] = review
        if accepted:
            row.update(start=round(new_start, 3), end=round(new_end, 3))
            aligned['checks'][check['sentence']]['spotCheckAcousticRefinement'] = review
            check['accepted'] = True
        log({'article': article['id'], 'sentence': check['sentence'], **review})
    windows['passed'] = all(check['accepted'] for check in windows['checks'])
    write(out / 'alignment-draft.json', draft)
    write(out / 'audio-window-checks.json', windows)
    log({'passed': windows['passed'], 'reviewed': sum('acousticReview' in c for c in windows['checks'])})


def content_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def apply(args):
    path = Path(args.output) / 'alignment-draft.json'
    draft = read(path)
    windows = read(Path(args.output) / 'audio-window-checks.json')
    assert not draft['reviewRequired']
    assert windows['passed'] and windows['complete']
    assert windows['audioSha256'] == draft['audioSha256'] == digest(args.audio)
    library = read(args.library)
    paper = paper_at(library, args.paper)
    before = copy.deepcopy(paper)
    original = read(Path(args.output) / 'paper-before.json')
    assert [a['id'] for a in original['articles']] == [a['id'] for a in paper['articles']]
    assert content_hash([a['questions'] for a in original['articles']]) == content_hash([a['questions'] for a in paper['articles']])
    assert len(draft['articles']) == len(paper['articles'])
    preservation = []
    for article in paper['articles']:
        old = next(a for a in original['articles'] if a['id'] == article['id'])
        aligned = next(a for a in draft['articles'] if a['articleId'] == article['id'])
        rows = [{key: row[key] for key in ('start', 'end', 'en', 'zh', 'timed')}
                for row in aligned['rows']]
        en_old = ' '.join(' '.join(r['en'] for r in old['transcript']).split())
        en_new = ' '.join(' '.join(r['en'] for r in rows).split())
        zh_old, zh_new = ''.join(r.get('zh', '') for r in old['transcript']), ''.join(r['zh'] for r in rows)
        assert en_old == en_new and zh_old == zh_new
        assert all(0 <= r['start'] < r['end'] <= article['end'] - article['start'] for r in rows)
        assert all(rows[i]['end'] <= rows[i + 1]['start'] + .02 for i in range(len(rows) - 1))
        assert all(r['timed'] is True for r in rows)
        article['transcript'] = rows
        preservation.append({'articleId': article['id'], 'sentences': len(rows),
                             'enSha256': hashlib.sha256(en_new.encode()).hexdigest(),
                             'zhSha256': hashlib.sha256(zh_new.encode()).hexdigest(),
                             'originalEnglishPreserved': True, 'originalTranslationPreserved': True,
                             'questionSha256': content_hash(article['questions']),
                             'chapterCoordinatesUnchanged': article['start'] == old['start'] and article['end'] == old['end']})
    # Compare entire paper after restoring only the allowed transcript field.
    restored = copy.deepcopy(paper)
    for article, old in zip(restored['articles'], before['articles']):
        article['transcript'] = old['transcript']
    assert restored == before
    export_path = Path(args.export)
    exported = read(export_path)
    export_before = copy.deepcopy(exported)
    for article in exported['articles']:
        current = next(a for a in paper['articles'] if a['id'] == article['id'])
        assert article['questions'] == current['questions']
        article['transcript'] = copy.deepcopy(current['transcript'])
    write(Path(args.output) / 'library-immediately-before-apply.json', read(args.library))
    write(Path(args.output) / 'export-immediately-before-apply.json', export_before)
    write(args.library, library)
    write(export_path, exported)
    assert digest(args.audio) == draft['audioSha256']
    write(Path(args.output) / 'applied-audit.json', {
        'paperId': args.paper, 'audioSha256': draft['audioSha256'], 'recordingUnchanged': True,
        'onlyTranscriptFieldsModified': True, 'questionIdsOptionsAnswersPreserved': True,
        'articles': preservation, 'sentences': sum(p['sentences'] for p in preservation),
        'automatedAudioWindowsVerified': len(windows['checks']), 'humanListeningReview': False,
        'englishPreserved': True, 'translationPreservedOnce': True,
        'librarySha256': digest(args.library), 'exportSha256': digest(export_path)})
    log({'applied': True, 'articles': len(preservation), 'sentences': sum(p['sentences'] for p in preservation)})


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=('transcribe', 'align', 'refine', 'verify-windows', 'review-windows', 'apply'))
    p.add_argument('--library', default='app/src/main/assets/web/bundled-library.json')
    p.add_argument('--paper', required=True)
    p.add_argument('--audio', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--export', help='Private folder paper.json destination (only used by apply)')
    p.add_argument('--model', default='.build/sentence-alignment/models/small.en')
    p.add_argument('--threads', type=int, default=6)
    p.add_argument('--articles', nargs='*')
    p.add_argument('--minimum-coverage', type=float, default=.85)
    p.add_argument('--force', action='store_true')
    return p


if __name__ == '__main__':
    parsed = parser().parse_args()
    {'transcribe': transcribe, 'align': align, 'refine': refine,
     'verify-windows': verify_windows, 'review-windows': review_windows,
     'apply': apply}[parsed.command](parsed)
