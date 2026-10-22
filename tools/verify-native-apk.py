#!/usr/bin/env python3
"""Check the compiled Miuix UI and native-library mmap/16 KiB APK contracts."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile


def elf_load_alignments(stream) -> list[int]:
    header = stream.read(64)
    if len(header) != 64 or header[:4] != b"\x7fELF" or header[5] != 1:
        raise ValueError("Expected a little-endian Android ELF library")
    wide = header[4] == 2
    if header[4] not in (1, 2):
        raise ValueError("Unknown ELF class")
    offset = struct.unpack_from("<Q" if wide else "<I", header, 32 if wide else 28)[0]
    size, count = struct.unpack_from("<HH", header, 54 if wide else 42)
    if size < (56 if wide else 32) or count > 4096:
        raise ValueError("Invalid ELF program headers")
    alignments = []
    for index in range(count):
        stream.seek(offset + index * size)
        program = stream.read(size)
        if len(program) != size:
            raise ValueError("Truncated ELF program header")
        if struct.unpack_from("<I", program)[0] == 1:
            alignments.append(struct.unpack_from("<Q" if wide else "<I", program, 48 if wide else 28)[0])
    if not alignments:
        raise ValueError("ELF library has no loadable segments")
    return alignments


def verify(path: Path) -> dict:
    required_classes = {
        "nativeUiController": b"Lcn/listenly/app/ui/NativeUiController;",
        "nativeListeningApp": b"Lcn/listenly/app/ui/NativeListeningAppKt;",
        "miuixNavigationBar": b"Ltop/yukonga/miuix/kmp/basic/NavigationBarKt;",
        "miuixTabRow": b"Ltop/yukonga/miuix/kmp/basic/TabRowKt;",
        "miuixSlider": b"Ltop/yukonga/miuix/kmp/basic/SliderKt;",
    }
    found = set()
    libraries = []
    with zipfile.ZipFile(path) as apk, path.open("rb") as raw:
        if apk.getinfo("resources.arsc").compress_type != zipfile.ZIP_STORED:
            raise ValueError("resources.arsc must remain uncompressed")
        license_entry = "assets/web/licenses/Apache-2.0.txt"
        if len(apk.read(license_entry)) < 10000:
            raise ValueError("Missing complete upstream Apache license")
        for entry in apk.infolist():
            if re.fullmatch(r"classes(?:\d+)?\.dex", entry.filename):
                dex = apk.read(entry)
                found.update(name for name, descriptor in required_classes.items() if descriptor in dex)
            if not (entry.filename.startswith("lib/") and entry.filename.endswith(".so")):
                continue
            if entry.compress_type != zipfile.ZIP_STORED:
                raise ValueError(f"Native mmap library is compressed: {entry.filename}")
            raw.seek(entry.header_offset)
            local_header = raw.read(30)
            name_size, extra_size = struct.unpack_from("<HH", local_header, 26)
            data_offset = entry.header_offset + 30 + name_size + extra_size
            if data_offset % 16384:
                raise ValueError(f"Native library is not ZIP-aligned to 16 KiB: {entry.filename}")
            with apk.open(entry) as library:
                alignments = elf_load_alignments(library)
            abi = entry.filename.split("/")[1]
            if abi in ("arm64-v8a", "x86_64") and min(alignments) < 16384:
                raise ValueError(f"64-bit ELF segments do not support 16 KiB pages: {entry.filename}")
            libraries.append({"path": entry.filename, "dataOffset": data_offset, "loadAlignments": alignments})
    missing = set(required_classes) - found
    if missing:
        raise ValueError(f"APK lacks the compiled native Miuix UI: {sorted(missing)}")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return {"apk": str(path.resolve()), "sha256": digest.hexdigest(), "compiledNativeMiuix": True, "compiledClasses": sorted(found), "nativeLibraries": libraries}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    report = json.dumps(verify(arguments.apk), ensure_ascii=False, indent=2)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(report + "\n", encoding="utf-8")
    print(report)
