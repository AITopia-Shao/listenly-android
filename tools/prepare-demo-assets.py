#!/usr/bin/env python3
"""Stage the public application with original examples, without a local CET corpus.

Run npm run build:web first. Output is restricted to .build/demo descendants;
app/src/main/assets is read only and examples/demo is the sole material source.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import wave

ROOT = Path(__file__).resolve().parents[1]
WEB_FILES = ("index.html", "app.js", "styles.css", "importer.js", "alignment.js", "activity.js", "playback-modes.js", "glass.js", "theme.js", "overlays.js", "flow-lens.js", "wallpaper.js", "import-media.js", "wallpapers.json", "wallpapers/day.svg", "wallpapers/night.svg", "icons/play-mask.svg", "icons/pause-mask.svg")
OPTIONAL_WEB_FILES = ("app.compat.js", "compat-polyfills.js")
FONT_FILES = ("Inter-Regular.woff2", "Inter-Medium.woff2", "Inter-SemiBold.woff2", "InterVariable.woff2", "OFL.txt", "README.md")


def original_example_files() -> tuple[dict, list[Path]]:
    """Resolve only local WAV recordings referenced by the licensed original demo."""
    examples = (ROOT / "examples" / "demo").resolve()
    demo = json.loads((examples / "demo.json").read_text(encoding="utf-8-sig"))
    if not demo.get("isDemo") or demo.get("source", {}).get("license") != "CC0-1.0":
        raise ValueError("Public demo must be explicitly labelled original CC0 material")
    audio_files = set()
    for article in demo["articles"]:
        audio = article.get("audio", {})
        if set(audio) != {"intensive", "exam"}:
            raise ValueError("Each original article must support both listening modes")
        for reference in audio.values():
            if not isinstance(reference, str) or not re.fullmatch(r"media/[a-zA-Z0-9_-]+\.wav", reference):
                raise ValueError("Demo recordings must use a local media/<name>.wav path")
            source = (examples / PurePosixPath(reference)).resolve()
            if not source.is_relative_to(examples) or not source.is_file():
                raise ValueError(f"Missing or unsafe original recording: {reference}")
            with wave.open(str(source), "rb") as recording:
                if recording.getnframes() == 0:
                    raise ValueError(f"Empty original recording: {reference}")
            audio_files.add(source)
    if not audio_files:
        raise ValueError("Public demo has no original recordings")
    return demo, sorted(audio_files)


def prepare(output: Path) -> None:
    output = output.resolve()
    demo_root = (ROOT / ".build" / "demo").resolve()
    if not demo_root.is_relative_to(ROOT) or not output.is_relative_to(demo_root) or output == demo_root:
        raise ValueError("Demo staging must remain inside this workspace's .build/demo directory")
    # Validate all inputs before replacing a previous generated staging directory.
    demo, audio_files = original_example_files()
    source = ROOT / "app" / "src" / "main"
    source_web = source / "assets" / "web"
    index = (source_web / "index.html").read_text(encoding="utf-8-sig")
    referenced_scripts = set(re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+)', index))
    web_files = list(WEB_FILES)
    for filename in OPTIONAL_WEB_FILES:
        if (source_web / filename).is_file():
            web_files.append(filename)
        elif filename in referenced_scripts:
            raise FileNotFoundError(f"Run npm run build:web before staging: missing {filename}")
    for filename in web_files:
        if not (source_web / filename).is_file():
            raise FileNotFoundError(f"Missing application source: {filename}")
    for filename in FONT_FILES:
        if not (source_web / 'fonts' / filename).is_file():
            raise FileNotFoundError(f"Missing licensed offline font: {filename}")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for directory in ("java", "res"):
        shutil.copytree(source / directory, output / directory)
    shutil.copyfile(source / "AndroidManifest.xml", output / "AndroidManifest.xml")
    web = output / "assets" / "web"
    (web / "media").mkdir(parents=True)
    for filename in web_files:
        (web / filename).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_web / filename, web / filename)
    (web / 'fonts').mkdir()
    for filename in FONT_FILES:
        shutil.copyfile(source_web / 'fonts' / filename, web / 'fonts' / filename)
    (web / "demo.json").write_text(json.dumps(demo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for recording in audio_files:
        shutil.copyfile(recording, web / "media" / recording.name)
    for notice_name in ("THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES"):
        notice = ROOT / notice_name
        if notice.is_file():
            shutil.copyfile(notice, web / "THIRD_PARTY_NOTICES.txt")
            break
    license_file = ROOT / "LICENSE"
    if license_file.is_file():
        shutil.copyfile(license_file, web / "LICENSE.txt")
    (web / "bundled-library.json").write_text(json.dumps({
        "papers": [],
        "summary": {"papers": 0, "articles": 0, "questions": 0, "audioBytes": 0}
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Staged public application with {len(demo['articles'])} original articles, {len(audio_files)} recordings, no CET papers: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".build" / "demo" / "main")
    prepare(parser.parse_args().output)
