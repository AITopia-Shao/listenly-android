"""Personal wallpaper replacement and staging contracts; no network or private assets."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('personal_wallpapers', ROOT / 'tools' / 'fetch-personal-wallpapers.py')
wallpapers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wallpapers)


def png(width=2, height=4, rgb=b'\x28\x50\x78'):
    def chunk(kind, content):
        return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\x00' + rgb * width) * height)) + chunk(b'IEND', b'')


class PersonalWallpaperTests(unittest.TestCase):
    def setUp(self):
        generated = ROOT / '.build' / 'ten-peaks-performance' / 'contract-tests'
        generated.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='wallpaper-', dir=generated)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.cache = self.root / 'personal-wallpapers'
        self.evidence = self.root / 'evidence'
        self.day, self.night = png(), png(rgb=b'\x08\x10\x18')

    def fetch(self, source, destination):
        destination.write_bytes(self.day if source == wallpapers.SOURCES['day.png'] else self.night)

    def old_cache(self):
        self.cache.mkdir()
        original = {'day.png': b'previous day image', 'night.png': b'previous night image', 'sources.json': b'{"personalOnly":true,"files":[]}'}
        for name, data in original.items():
            (self.cache / name).write_bytes(data)
        return original

    def web(self):
        web = self.root / 'personal-web'
        (web / 'wallpapers').mkdir(parents=True)
        (web / 'index.html').write_text('<!doctype html>', encoding='utf8')
        (web / 'wallpapers.json').write_text('{"profile":"original-gradients","day":"wallpapers/day.svg","night":"wallpapers/night.svg"}', encoding='utf8')
        for name in ('day.svg', 'night.svg'):
            (web / 'wallpapers' / name).write_text('<svg/>', encoding='utf8')
        return web

    def test_png_requires_complete_crc_valid_pixels_with_portrait_dimensions(self):
        self.assertEqual(wallpapers.png_info(self.day)['size'], [2, 4])
        corrupt = bytearray(self.day)
        corrupt[-5] ^= 1
        for broken in (self.day[:-10], bytes(corrupt), png(width=4, height=2), b'<html>download failed</html>'):
            with self.subTest(bytes=len(broken)), self.assertRaises(ValueError):
                wallpapers.png_info(broken)

    def test_failed_second_download_keeps_old_pair_and_complete_backup(self):
        original = self.old_cache()
        def broken_fetch(source, destination):
            destination.write_bytes(self.day if source == wallpapers.SOURCES['day.png'] else b'not a PNG')
        with self.assertRaises(ValueError):
            wallpapers.download(self.cache, self.evidence, broken_fetch)
        self.assertEqual({name: (self.cache / name).read_bytes() for name in original}, original)
        backup, = self.evidence.glob('previous-wallpapers-*')
        self.assertEqual({name: (backup / name).read_bytes() for name in original}, original)
        self.assertFalse(self.cache.with_name('personal-wallpapers.lock').exists())

    def test_success_replaces_pair_with_reviewed_metadata_and_keeps_original_backup(self):
        original = self.old_cache()
        result = wallpapers.download(self.cache, self.evidence, self.fetch)
        metadata, images = wallpapers.read_cache(self.cache)
        self.assertEqual(images, {'day.png': self.day, 'night.png': self.night})
        self.assertTrue(metadata['personalOnly'])
        self.assertEqual(metadata['profile'], 'personal-ten-peaks')
        self.assertEqual({item['source'] for item in metadata['files']}, set(wallpapers.SOURCES.values()))
        self.assertEqual({name: (Path(result['previousCache']) / name).read_bytes() for name in original}, original)

    def test_failed_directory_promotion_restores_the_previous_complete_cache(self):
        original = self.old_cache()
        rename = wallpapers.os.rename
        def fail_promotion(source, destination):
            if Path(source).name == 'ready':
                raise OSError('simulated replacement failure')
            return rename(source, destination)
        with patch.object(wallpapers.os, 'rename', side_effect=fail_promotion), self.assertRaisesRegex(OSError, 'replacement failure'):
            wallpapers.download(self.cache, self.evidence, self.fetch)
        self.assertEqual({name: (self.cache / name).read_bytes() for name in original}, original)

    def test_personal_staging_keeps_original_vector_fallbacks_and_checks_all_hashes_first(self):
        wallpapers.download(self.cache, self.evidence, self.fetch)
        web = self.web()
        before = (web / 'wallpapers.json').read_bytes()
        (self.cache / 'night.png').write_bytes(self.day)
        with self.assertRaisesRegex(ValueError, 'reviewed source, hash or dimensions'):
            wallpapers.stage(web, self.cache)
        self.assertEqual((web / 'wallpapers.json').read_bytes(), before)
        self.assertFalse((web / 'wallpapers' / 'day.png').exists())
        (self.cache / 'night.png').write_bytes(self.night)
        wallpapers.stage(web, self.cache)
        self.assertEqual(json.loads((web / 'wallpapers.json').read_text('utf8')), {'profile': 'personal-ten-peaks', 'day': 'wallpapers/day.png', 'night': 'wallpapers/night.png'})
        self.assertEqual((web / 'wallpapers' / 'day.png').read_bytes(), self.day)
        self.assertEqual((web / 'wallpapers' / 'night.png').read_bytes(), self.night)
        self.assertEqual((web / 'wallpapers' / 'day.svg').read_text('utf8'), '<svg/>')
        self.assertEqual((web / 'wallpapers' / 'night.svg').read_text('utf8'), '<svg/>')

    def test_staging_rejects_source_assets_and_an_in_progress_cache_update(self):
        with self.assertRaisesRegex(ValueError, 'generated build assets'):
            wallpapers.stage(ROOT / 'app' / 'src' / 'main' / 'assets' / 'web', self.cache)
        web = self.web()
        with wallpapers.cache_lock(self.cache), self.assertRaisesRegex(RuntimeError, 'being updated'):
            wallpapers.stage(web, self.cache)


if __name__ == '__main__':
    unittest.main()
