"""Validate and stage optional personal wallpapers; public builds use original SVGs."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.build' / 'personal-wallpapers'
EVIDENCE = ROOT / '.build' / 'ten-peaks-performance'
PROFILE = 'personal-ten-peaks'
SOURCE_PAGE = 'https://basicappleguy.com/basicappleblog/macos-ten-peaks'
SOURCES = {
    'day.png': 'https://basicappleguy.com/s/TenPeaksDayiPhone.png',
    'night.png': 'https://basicappleguy.com/s/TenPeaksNightiPhone.png',
}
MAX_BYTES = 32 * 1024 * 1024


def png_info(data):
    """Check the complete PNG, including CRCs and decoded scanline lengths."""
    if not 45 <= len(data) <= MAX_BYTES or data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Wallpaper source did not return a bounded PNG')
    offset, header, compressed, complete = 8, None, bytearray(), False
    while offset + 12 <= len(data):
        length = struct.unpack_from('>I', data, offset)[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError('Truncated PNG chunk')
        content = data[offset + 8:end - 4]
        crc = struct.unpack_from('>I', data, end - 4)[0]
        if zlib.crc32(kind + content) & 0xffffffff != crc:
            raise ValueError('PNG chunk CRC does not match')
        if header is None:
            if kind != b'IHDR' or length != 13:
                raise ValueError('PNG must start with its dimensions')
            header = struct.unpack('>IIBBBBB', content)
        elif kind == b'IHDR':
            raise ValueError('Repeated PNG dimensions')
        if kind == b'IDAT':
            compressed.extend(content)
        if kind == b'IEND':
            complete = length == 0 and end == len(data)
            break
        offset = end
    if not complete or not compressed:
        raise ValueError('PNG is missing complete image data')
    width, height, depth, color, compression, filtering, interlace = header
    depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
    if not (0 < width <= 8192 and width < height <= 8192 and width * height <= 24_000_000):
        raise ValueError('Wallpaper must have bounded portrait dimensions')
    if depth not in depths.get(color, ()) or compression or filtering or interlace not in (0, 1):
        raise ValueError('Unsupported PNG image encoding')
    samples = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    passes = ((0, 0, 1, 1),) if not interlace else ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2))
    expected = 0
    for x, y, dx, dy in passes:
        columns, rows = max(0, (width - x + dx - 1) // dx), max(0, (height - y + dy - 1) // dy)
        if columns and rows:
            expected += rows * (1 + (columns * depth * samples + 7) // 8)
    decoder = zlib.decompressobj()
    raw = decoder.decompress(compressed, expected + 1)
    if not decoder.eof or decoder.unused_data or len(raw) != expected:
        raise ValueError('PNG pixels do not match the declared dimensions')
    return {'bytes': len(data), 'size': [width, height], 'sha256': hashlib.sha256(data).hexdigest()}


@contextmanager
def cache_lock(cache):
    cache.parent.mkdir(parents=True, exist_ok=True)
    lock = cache.with_name(cache.name + '.lock')
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as error:
        raise RuntimeError('Personal wallpaper cache is being updated; wait for that operation to finish') from error
    try:
        os.write(descriptor, str(os.getpid()).encode('ascii'))
        yield
    finally:
        os.close(descriptor)
        lock.unlink()


def fetch(source, destination):
    subprocess.run(['curl', '--fail', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '90', '--max-filesize', str(MAX_BYTES), '--output', str(destination), source], check=True)


def read_cache(cache=CACHE):
    metadata = json.loads((cache / 'sources.json').read_text(encoding='utf-8-sig'))
    if metadata.get('personalOnly') is not True or metadata.get('profile') != PROFILE:
        raise ValueError('Personal cache must contain the reviewed Ten Peaks pair; run --download')
    records = metadata.get('files', [])
    if len(records) != 2 or {item.get('name') for item in records} != set(SOURCES):
        raise ValueError('Personal cache must contain exactly the day and night wallpapers')
    images = {}
    for record in records:
        name = record['name']
        data = (cache / name).read_bytes()
        info = png_info(data)
        if record.get('source') != SOURCES[name] or any(record.get(key) != info[key] for key in info):
            raise ValueError('Personal wallpaper does not match its reviewed source, hash or dimensions')
        images[name] = data
    if records[0]['size'] != records[1]['size']:
        raise ValueError('Day and night wallpaper dimensions must match')
    return metadata, images


def download(cache=CACHE, evidence=EVIDENCE, downloader=fetch):
    cache_parent = cache.parent.resolve()
    if cache.resolve().parent != cache_parent:
        raise ValueError('Personal cache must not resolve through a linked directory')
    with cache_lock(cache):
        evidence.mkdir(parents=True, exist_ok=True)
        backup = None
        if cache.exists():
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup = evidence / ('previous-wallpapers-' + stamp)
            shutil.copytree(cache, backup)
        with tempfile.TemporaryDirectory(prefix='wallpaper-download-', dir=cache.parent) as temporary:
            prepared = Path(temporary) / 'ready'
            prepared.mkdir()
            records = []
            for name, source in SOURCES.items():
                target = prepared / name
                downloader(source, target)
                records.append({'name': name, 'source': source, **png_info(target.read_bytes())})
            metadata = {'personalOnly': True, 'profile': PROFILE, 'sourcePage': SOURCE_PAGE, 'files': records}
            (prepared / 'sources.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
            read_cache(prepared)
            # Swap only a fully verified pair. On Windows a nonempty directory
            # cannot be replaced directly; the lock prevents builds consuming
            # the short gap, and a failed promotion restores the original.
            previous = cache.with_name(cache.name + '-replaced-' + uuid.uuid4().hex)
            if previous.resolve().parent != cache_parent or prepared.resolve().parent != Path(temporary).resolve():
                raise ValueError('Refusing to move wallpaper directories outside their generated locations')
            if cache.exists():
                cache.rename(previous)
            try:
                prepared.rename(cache)
            except BaseException:
                if previous.exists():
                    previous.rename(cache)
                raise
            if previous.exists():
                if previous.resolve().parent != cache_parent or not previous.name.startswith(cache.name + '-replaced-'):
                    raise ValueError('Refusing to remove an unexpected previous cache directory')
                shutil.rmtree(previous)
        summary = {'profile': PROFILE, 'cache': str(cache), 'previousCache': str(backup) if backup else None, 'files': records}
        (evidence / 'wallpaper-download.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
        return summary


def stage(web, cache=CACHE):
    web = web.resolve()
    source = (ROOT / 'app' / 'src' / 'main').resolve()
    if web == source or source in web.parents:
        raise ValueError('Personal wallpapers may only be staged into generated build assets')
    if not (web / 'index.html').is_file() or not (web / 'wallpapers.json').is_file():
        raise ValueError('Stage the generated web assets before adding personal wallpapers')
    with cache_lock(cache):
        metadata, images = read_cache(cache)
        target = web / 'wallpapers'
        target.mkdir(parents=True, exist_ok=True)
        for name, data in images.items():
            (target / name).write_bytes(data)
        manifest = {'profile': PROFILE, 'day': 'wallpapers/day.png', 'night': 'wallpapers/night.png'}
        temporary = web / ('wallpapers-' + uuid.uuid4().hex + '.json')
        temporary.write_text(json.dumps(manifest, separators=(',', ':')) + '\n', encoding='utf-8')
        temporary.replace(web / 'wallpapers.json')
        return {'profile': PROFILE, 'web': str(web), 'files': metadata['files']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--download', action='store_true')
    action.add_argument('--verify-cache', action='store_true')
    action.add_argument('--stage-web', type=Path)
    args = parser.parse_args()
    if args.download:
        result = download()
    elif args.stage_web:
        result = stage(args.stage_web)
    else:
        with cache_lock(CACHE):
            result, _ = read_cache()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
