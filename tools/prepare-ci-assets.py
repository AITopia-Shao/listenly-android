#!/usr/bin/env python3
"""Stage only application source plus a labelled original audio test fixture."""
from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
import re
import shutil
import struct
import wave

ROOT = Path(__file__).resolve().parents[1]
WEB_MODULES = ("index.html", "app.js", "styles.css", "importer.js", "alignment.js", "paper-timeline.js", "activity.js", "playback-modes.js", "glass.js", "theme.js", "overlays.js", "flow-lens.js", "wallpaper.js", "import-media.js", "native-engine.js", "wallpapers.json", "wallpapers/day.svg", "wallpapers/night.svg", "icons/play-mask.svg", "icons/pause-mask.svg")
COMPAT_MODULES = ("app.compat.js", "compat-polyfills.js")
FONT_FILES = ("Inter-Regular.woff2", "Inter-Medium.woff2", "Inter-SemiBold.woff2", "InterVariable.woff2", "OFL.txt", "README.md")


def prepare(output: Path) -> None:
    output = output.resolve()
    ci_root = (ROOT / ".build" / "ci").resolve()
    if not output.is_relative_to(ci_root) or output == ci_root:
        raise ValueError("Fixture staging must remain inside this workspace's .build/ci directory")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    source = ROOT / "app" / "src" / "main"
    for directory in ("java", "kotlin", "res"):
        if (source / directory).is_dir():
            shutil.copytree(source / directory, output / directory)
    shutil.copyfile(source / "AndroidManifest.xml", output / "AndroidManifest.xml")
    web = output / "assets" / "web"
    web.mkdir(parents=True)
    for filename in WEB_MODULES:
        (web / filename).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / "assets" / "web" / filename, web / filename)
    (web / 'fonts').mkdir()
    for filename in FONT_FILES:
        shutil.copyfile(source / 'assets' / 'web' / 'fonts' / filename, web / 'fonts' / filename)
    index = (web / "index.html").read_text(encoding="utf-8")
    referenced_scripts = set(re.findall(r'<script\b[^>]*\bsrc=[\"\']([^\"\']+)', index))
    for filename in COMPAT_MODULES:
        module = source / "assets" / "web" / filename
        if module.exists():
            shutil.copyfile(module, web / filename)
        elif filename in referenced_scripts:
            raise FileNotFoundError(f"Run npm run build:web before staging: missing {filename}")
    # Preserve the complete licenses for Miuix and adapted upstream components.
    licenses = ROOT / "LICENSES"
    if licenses.is_dir():
        shutil.copytree(licenses, web / "licenses")
    media = web / "media"
    for filename, destination in (("LICENSE", "LICENSE.txt"), ("THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.txt")):
        notice = ROOT / filename
        if notice.is_file():
            shutil.copyfile(notice, web / destination)
    media.mkdir()
    # Quiet PCM markers test decoding, seek and playback. They are not English speech.
    rate, duration = 16000, 24
    samples = bytearray()
    for index in range(rate * duration):
        seconds = index / rate
        envelope = min(1.0, seconds / .03, (duration - seconds) / .03)
        frequency = 220 if int(seconds / 4) % 2 == 0 else 330
        samples.extend(struct.pack("<h", round(1200 * envelope * math.sin(2 * math.pi * frequency * seconds))))
    with wave.open(str(media / "ci-playback.wav"), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(samples)
    fixture = {
        "id": "listenly-original-ci", "title": "拾听原创 CI 播放测试 · 非六级真题",
        "isDemo": True, "testFixture": True,
        "source": {"title": "程序生成的原创测试音；非英语朗读，非六级真题", "license": "CC0-1.0"},
        "articles": [{
            "id": "ci-playback", "title": "Original playback test fixture", "type": "播放测试音",
            "duration": duration,
            "warnings": ["仅供兼容性测试：音频是合成测试音，下面的文字是说明，不是听力原文。"],
            "audio": {"intensive": "media/ci-playback.wav", "exam": "media/ci-playback.wav"},
            "transcript": [{"start": 0, "en": "This fixture contains a synthetic test tone, not spoken English.",
                            "zh": "此夹具包含合成测试音，并非英语朗读。", "timed": False}],
            "questions": [{"id": "ci-q1", "number": 1,
                "prompt": "What does this original fixture verify?",
                "options": [{"id": "A", "text": "Audio playback and switching practice modes."},
                            {"id": "B", "text": "An official CET-6 listening examination."},
                            {"id": "C", "text": "A translation of recorded speech."},
                            {"id": "D", "text": "Downloading copyrighted recordings."}],
                "answer": "A", "explanation": "原创测试音用于验证播放、进度和模式切换，不属于六级真题。"}]
        }]
    }
    # A distinct suite is necessary to exercise actual cross-paper preview,
    # playback promotion and selection transitions rather than reselecting the
    # only, already selected paper. Both suites reuse the same original tone.
    selection_fixture = copy.deepcopy(fixture)
    selection_fixture["id"] = "listenly-original-ci-selection"
    selection_fixture["title"] = "拾听原创 CI 套卷选择测试 · 非六级真题"
    selection_fixture["articles"][0]["id"] = "ci-selection"
    selection_fixture["articles"][0]["title"] = "Original suite selection test fixture"
    selection_fixture["articles"][0]["questions"][0]["id"] = "ci-selection-q1"
    (web / "demo.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    (web / "bundled-library.json").write_text(json.dumps({
        "papers": [selection_fixture], "testFixture": True,
        "summary": {"papers": 1, "articles": 1, "questions": 1, "audioBytes": (media / "ci-playback.wav").stat().st_size}
    }), encoding="utf-8")
    print(f"Staged application source and two original suites sharing one 24-second PCM test recording: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".build" / "ci" / "main")
    prepare(parser.parse_args().output)
