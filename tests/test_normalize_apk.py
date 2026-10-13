"""Regression tests for Android's actual uncompressed resources ZIP requirement."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("normalize_apk", ROOT / "tools" / "normalize-apk.py")
apk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apk)


class NormalizeApkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_root = ROOT / ".build" / "normalize-tests"
        cls.temp_root.mkdir(parents=True, exist_ok=True)

    def test_resources_and_audio_use_actual_method_zero_and_preserve_contents(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temporary:
            root = Path(temporary)
            source, output = root / "base.apk", root / "normalized.apk"
            contents = {"resources.arsc": b"resource-table" * 128,
                        "assets\\web\\media\\spoken.wav": b"RIFF" + b"wav" * 256,
                        "assets/web/media/passage.m4a": b"aac" * 256,
                        "assets/web/index.html": b"<html>offline</html>" * 128}
            with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, data in contents.items():
                    archive.writestr(name, data)
            dex = root / "dex"
            dex.mkdir()
            (dex / "classes.dex").write_bytes(b"dex\n035\x00")
            # Whole-entry reads are prohibited while normalizing large corpus APKs.
            with mock.patch.object(zipfile.ZipFile, "read", side_effect=AssertionError("whole-entry read")):
                result = apk.normalize(source, output, dex)
            self.assertEqual(result["storedAudio"], 2)
            with zipfile.ZipFile(output) as archive:
                for name, data in contents.items():
                    normalized = name.replace("\\", "/")
                    self.assertEqual(archive.read(normalized), data)
                    expected = zipfile.ZIP_STORED if normalized == "resources.arsc" or normalized.endswith((".wav", ".m4a")) else zipfile.ZIP_DEFLATED
                    self.assertEqual(archive.getinfo(normalized).compress_type, expected)
                self.assertEqual(archive.read("classes.dex"), b"dex\n035\x00")

    def test_deflated_resources_are_rejected_even_with_no_compression_level(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temporary:
            invalid = Path(temporary) / "invalid.apk"
            with zipfile.ZipFile(invalid, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=0) as archive:
                archive.writestr("resources.arsc", b"original framework no-compression resource bytes")
            with self.assertRaisesRegex(ValueError, "method 0"):
                apk.verify(invalid)

    def test_normalized_path_collisions_are_rejected(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temporary:
            root = Path(temporary)
            with zipfile.ZipFile(root / "base.apk", "w") as archive:
                archive.writestr("resources.arsc", b"resources")
                # Windows ZipInfo may normalize the slash while writing this
                # intentionally invalid input, which warns about the collision.
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", message="Duplicate name:", category=UserWarning)
                    archive.writestr("assets\\index.html", b"one")
                    archive.writestr("assets/index.html", b"two")
            with self.assertRaisesRegex(ValueError, "Duplicate APK entry"):
                apk.normalize(root / "base.apk", root / "normalized.apk")


if __name__ == "__main__":
    unittest.main()
