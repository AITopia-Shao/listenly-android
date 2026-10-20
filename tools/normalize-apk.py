#!/usr/bin/env python3
"""Stream APK ZIP entries with method 0 for resources/audio, or inspect --verify APK.

Call before zipalign and signing. No whole-archive or whole-recording reads are
used; the transfer buffer is 1 MiB. APK signing keys are not handled here.
"""
from __future__ import annotations

import argparse
from pathlib import Path, PurePosixPath
import re
import shutil
import zipfile

COPY_BUFFER = 1024 * 1024
AUDIO_SUFFIXES = frozenset((".m4a", ".aac", ".mp3", ".ogg", ".opus", ".flac", ".mp4", ".wav"))


def normalized_name(name: str) -> str:
    name = name.replace("\\", "/")
    if not name or name.startswith("/") or re.match(r"^[a-zA-Z]:", name) or ".." in PurePosixPath(name).parts:
        raise ValueError(f"Unsafe APK entry path: {name}")
    return name


def must_store(name: str) -> bool:
    # Native libraries must stay uncompressed for extractNativeLibs=false.
    # zipalign -P 16, called after normalization, aligns these mmap entries.
    return name == "resources.arsc" or PurePosixPath(name).suffix.lower() in AUDIO_SUFFIXES or name.startswith("lib/") and name.endswith(".so")


def verify(apk: Path) -> dict[str, int]:
    """Inspect actual ZIP compression methods, not size equality."""
    with zipfile.ZipFile(apk) as archive:
        names = set()
        audio_count = 0
        for entry in archive.infolist():
            name = normalized_name(entry.filename)
            if name != entry.filename:
                raise ValueError(f"APK entry path is not normalized: {entry.filename}")
            if name in names:
                raise ValueError(f"Duplicate APK entry: {name}")
            names.add(name)
            if must_store(name):
                if entry.compress_type != zipfile.ZIP_STORED:
                    raise ValueError(f"APK entry must use ZIP_STORED (method 0): {name}; got method {entry.compress_type}")
                if PurePosixPath(name).suffix.lower() in AUDIO_SUFFIXES:
                    audio_count += 1
        if "resources.arsc" not in names:
            raise ValueError("APK is missing resources.arsc")
        return {"entries": len(names), "storedAudio": audio_count}


def normalize(source: Path, output: Path, dex_dir: Path | None = None) -> dict[str, int]:
    source, output = source.resolve(), output.resolve()
    if source == output:
        raise ValueError("Input and normalized output APK paths must differ")
    dex_files = []
    if dex_dir is not None:
        dex_dir = dex_dir.resolve()
        dex_files = sorted(dex_dir.glob("*.dex"))
        if not dex_dir.is_dir() or not dex_files:
            raise ValueError("Dex directory must contain at least one compiled .dex file")
    output.parent.mkdir(parents=True, exist_ok=True)
    names = set()
    with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(output, "w", allowZip64=False) as outgoing:
        for original in incoming.infolist():
            name = normalized_name(original.filename)
            if name in names:
                raise ValueError(f"Duplicate APK entry after path normalization: {name}")
            names.add(name)
            entry = zipfile.ZipInfo(name, original.date_time)
            entry.compress_type = zipfile.ZIP_STORED if must_store(name) else zipfile.ZIP_DEFLATED
            entry.file_size = original.file_size
            entry.external_attr = original.external_attr
            entry.create_system = original.create_system
            with incoming.open(original) as reader, outgoing.open(entry, "w") as writer:
                shutil.copyfileobj(reader, writer, length=COPY_BUFFER)
        for dex in dex_files:
            if dex.name in names:
                raise ValueError(f"Duplicate compiled dex entry: {dex.name}")
            names.add(dex.name)
            outgoing.write(dex, dex.name, compress_type=zipfile.ZIP_DEFLATED)
    return verify(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", help="AAPT2 base APK before alignment/signing")
    parser.add_argument("output", type=Path, nargs="?", help="Normalized APK before alignment/signing")
    parser.add_argument("--dex-dir", type=Path, help="Directory containing D8's compiled .dex files")
    parser.add_argument("--verify", type=Path, metavar="APK", help="Check existing APK ZIP compression methods without rewriting")
    args = parser.parse_args()
    if args.verify:
        if args.source or args.output or args.dex_dir:
            parser.error("--verify cannot be combined with normalization arguments")
        result = verify(args.verify)
        print(f"Verified APK compression: resources.arsc method 0; {result['storedAudio']} stored recordings; {result['entries']} entries")
    else:
        if args.source is None or args.output is None:
            parser.error("source and output are required unless --verify is used")
        result = normalize(args.source, args.output, args.dex_dir)
        print(f"Normalized APK: resources.arsc method 0; {result['storedAudio']} stored recordings; {result['entries']} entries")
