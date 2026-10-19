"""Public packaging contracts: complete original playback assets and no exam corpus."""
import importlib.util
import copy
import json
from pathlib import Path
import tempfile
import unittest
import wave
from argparse import Namespace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_demo_assets", ROOT / "tools" / "prepare-demo-assets.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)
ci_spec = importlib.util.spec_from_file_location("prepare_ci_assets", ROOT / "tools" / "prepare-ci-assets.py")
ci_assets = importlib.util.module_from_spec(ci_spec)
ci_spec.loader.exec_module(ci_assets)
builder_spec = importlib.util.spec_from_file_location("build_apk_ci", ROOT / "tools" / "build-apk-ci.py")
ci_builder = importlib.util.module_from_spec(builder_spec)
builder_spec.loader.exec_module(ci_builder)


class PublicDemoAssetTests(unittest.TestCase):
    def test_both_builders_accept_approved_modules_and_reject_unexpected_assets(self):
        # Run the actual builder's complete asset gate, stopping at the absent
        # SDK. This catches drift between staging and the packaging allowlist.
        for public in (True, False):
            stage_root = ROOT / '.build' / ('demo' if public else 'ci')
            stage_root.mkdir(parents=True, exist_ok=True)
            with self.subTest(public=public), tempfile.TemporaryDirectory(prefix='builder-contract-', dir=stage_root) as temporary:
                output = Path(temporary) / 'main'
                (assets if public else ci_assets).prepare(output)
                args = Namespace(sdk=Path(temporary) / 'absent-sdk', java_home=Path(temporary) / 'absent-jdk', build_tools='36.0.0', compile_api=36, demo=public, staged_main=output, output=Path(temporary) / 'test.apk')
                with self.assertRaisesRegex(FileNotFoundError, 'Required build tool not found'):
                    ci_builder.build(args)
                (output / 'assets' / 'web' / 'unapproved-private-audio.mp3').write_bytes(b'not real media')
                with self.assertRaisesRegex(ValueError, 'Unexpected or missing CI assets'):
                    ci_builder.build(args)

    def test_original_audio_and_sentence_timestamps_are_complete(self):
        demo, recordings = assets.original_example_files()
        self.assertEqual(len(demo["articles"]), 2)
        self.assertEqual(len(recordings), 1)
        self.assertEqual(sum(len(article["questions"]) for article in demo["articles"]), 5)
        for article in demo["articles"]:
            with wave.open(str(ROOT / "examples" / "demo" / article["audio"]["intensive"]), "rb") as audio:
                duration = audio.getnframes() / audio.getframerate()
            self.assertAlmostEqual(article["end"]-article["start"], article["duration"], delta=.001)
            self.assertLessEqual(article["end"],duration+.01)
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
            expected = set(assets.WEB_FILES) | {"app.compat.js", "demo.json", "bundled-library.json", "media/original-suite.wav"}
            for filename in assets.FONT_FILES:
                expected.add(f'fonts/{filename}')
                self.assertEqual((web / 'fonts' / filename).read_bytes(), (ROOT / 'app' / 'src' / 'main' / 'assets' / 'web' / 'fonts' / filename).read_bytes())
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


class CiFixtureAssetTests(unittest.TestCase):
    def test_two_distinct_original_suites_share_the_single_original_recording(self):
        ci_root = ROOT / ".build" / "ci"
        ci_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="suite-contract-", dir=ci_root) as temporary:
            output = Path(temporary) / "main"
            ci_assets.prepare(output)
            web = output / "assets" / "web"
            primary = json.loads((web / "demo.json").read_text(encoding="utf-8"))
            library = json.loads((web / "bundled-library.json").read_text(encoding="utf-8"))
            ci_builder.validate_ci_suites(primary, library)
            papers = [primary, *library["papers"]]
            self.assertEqual([paper["id"] for paper in papers], ["listenly-original-ci", "listenly-original-ci-selection"])
            self.assertEqual([paper["articles"][0]["id"] for paper in papers], ["ci-playback", "ci-selection"])
            self.assertEqual([paper["articles"][0]["questions"][0]["id"] for paper in papers], ["ci-q1", "ci-selection-q1"])
            self.assertEqual(sum(len(paper["articles"]) for paper in papers), 2)
            self.assertEqual(sum(len(article["questions"]) for paper in papers for article in paper["articles"]), 2)
            for paper in papers:
                self.assertTrue(paper["testFixture"] and paper["isDemo"])
                self.assertEqual(paper["source"]["license"], "CC0-1.0")
                self.assertEqual(paper["articles"][0]["audio"], {"intensive": "media/ci-playback.wav", "exam": "media/ci-playback.wav"})
            self.assertEqual([path.name for path in (web / "media").iterdir()], ["ci-playback.wav"])
            with wave.open(str(web / "media" / "ci-playback.wav"), "rb") as audio:
                self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 16000))
                self.assertEqual(audio.getnframes() / audio.getframerate(), 24)
            self.assertEqual(library["summary"], {"papers": 1, "articles": 1, "questions": 1, "audioBytes": (web / "media" / "ci-playback.wav").stat().st_size})
            for mutation in ("unknown-suite", "unlicensed", "unexpected-audio", "unlabelled", "third-suite"):
                changed = copy.deepcopy(library)
                if mutation == "unknown-suite": changed["papers"][0]["id"] = "unknown-source"
                elif mutation == "unlicensed": changed["papers"][0]["source"]["license"] = "unknown"
                elif mutation == "unexpected-audio": changed["papers"][0]["articles"][0]["audio"]["exam"] = "media/third-party.mp3"
                elif mutation == "unlabelled": changed["testFixture"] = False
                else: changed["papers"].append(copy.deepcopy(primary))
                with self.subTest(rejected=mutation), self.assertRaises(ValueError):
                    ci_builder.validate_ci_suites(primary, changed)


if __name__ == "__main__":
    unittest.main()
