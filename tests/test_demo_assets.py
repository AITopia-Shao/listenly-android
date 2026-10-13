"""Public packaging contracts: complete original playback assets and no exam corpus."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import wave

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_demo_assets", ROOT / "tools" / "prepare-demo-assets.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class PublicDemoAssetTests(unittest.TestCase):
    def test_original_audio_and_sentence_timestamps_are_complete(self):
        demo, recordings = assets.original_example_files()
        self.assertEqual(len(demo["articles"]), 2)
        self.assertEqual(len(recordings), 2)
        self.assertEqual(sum(len(article["questions"]) for article in demo["articles"]), 5)
        for article in demo["articles"]:
            with wave.open(str(ROOT / "examples" / "demo" / article["audio"]["intensive"]), "rb") as audio:
                duration = audio.getnframes() / audio.getframerate()
            self.assertAlmostEqual(article["duration"], duration, delta=0.7)
            starts = [row["start"] for row in article["transcript"]]
            self.assertEqual(starts, sorted(starts))
            self.assertLess(starts[-1], duration)
            self.assertTrue(all(row.get("en") and row.get("zh") for row in article["transcript"]))
            self.assertEqual(article["audio"]["intensive"], article["audio"]["exam"])

    def test_staged_assets_include_only_public_example_recordings(self):
        demo_root = ROOT / ".build" / "demo"
        demo_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="public-contract-", dir=demo_root) as temporary:
            output = Path(temporary) / "main"
            assets.prepare(output)
            web = output / "assets" / "web"
            actual = {path.relative_to(web).as_posix() for path in web.rglob("*") if path.is_file()}
            expected = set(assets.WEB_FILES) | {"app.compat.js", "demo.json", "bundled-library.json", "media/morning.wav", "media/library.wav"}
            if (ROOT / "app" / "src" / "main" / "assets" / "web" / "compat-polyfills.js").is_file():
                expected.add("compat-polyfills.js")
            if any((ROOT / filename).is_file() for filename in ("THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES")):
                expected.add("THIRD_PARTY_NOTICES.txt")
            if (ROOT / "LICENSE").is_file():
                expected.add("LICENSE.txt")
            self.assertEqual(actual, expected)
            self.assertEqual(json.loads((web / "bundled-library.json").read_text(encoding="utf-8"))["papers"], [])
            self.assertEqual(json.loads((web / "demo.json").read_text(encoding="utf-8")), json.loads((ROOT / "examples" / "demo" / "demo.json").read_text(encoding="utf-8-sig")))

    def test_output_outside_the_generated_demo_directory_is_rejected(self):
        with self.assertRaises(ValueError):
            assets.prepare(ROOT / "examples" / "demo")
        with self.assertRaises(ValueError):
            assets.prepare(ROOT / ".build" / "demo")


if __name__ == "__main__":
    unittest.main()
