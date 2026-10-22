#!/usr/bin/env python3
"""Reuse a verified cloud-compiled native shell with local-only listening assets.

The native source must match the explicitly supplied immutable Git commit.
This only prepares an unsigned ZIP; normalize, align and sign it afterwards.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NATIVE_INPUTS = ["app/src/main/java", "app/src/main/kotlin", "app/src/main/res", "app/src/main/AndroidManifest.xml", "app/build.gradle", "build.gradle", "settings.gradle", "gradle.properties", "gradle/wrapper/gradle-wrapper.properties"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while data := stream.read(1024 * 1024):
            digest.update(data)
    return digest.hexdigest()


def repack(shell: Path, staged_web: Path, output: Path, expected_hash: str, source_commit: str) -> dict:
    shell, staged_web, output = shell.resolve(), staged_web.resolve(), output.resolve()
    if not re.fullmatch(r"[0-9a-fA-F]{64}", expected_hash) or sha256(shell) != expected_hash.lower():
        raise ValueError("Compiled shell SHA256 differs from the explicitly verified artifact")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", source_commit):
        raise ValueError("Supply the full immutable source commit SHA")
    subprocess.run(["git", "cat-file", "-e", source_commit + "^{commit}"], cwd=ROOT, check=True, capture_output=True)
    diff = subprocess.run(["git", "diff", "--exit-code", source_commit, "--", *NATIVE_INPUTS], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if diff.returncode:
        raise ValueError("Current native sources/dependencies differ from the cloud shell commit; rebuild the shell")
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "--", *NATIVE_INPUTS], cwd=ROOT, capture_output=True, check=True, text=True, encoding="utf-8")
    if untracked.stdout.strip():
        raise ValueError("Untracked native source files are absent from the cloud shell commit")
    if output == shell or not staged_web.is_dir() or not (staged_web / "bundled-library.json").is_file():
        raise ValueError("Output must differ from the shell and the approved web staging must exist")
    spec = importlib.util.spec_from_file_location("verify_native_apk", ROOT / "tools" / "verify-native-apk.py")
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    checker.verify(shell)
    output.parent.mkdir(parents=True, exist_ok=True)
    replaced = []
    with zipfile.ZipFile(shell) as original, zipfile.ZipFile(output, "w", allowZip64=False) as packaged:
        for entry in original.infolist():
            if entry.filename.startswith("assets/web/") or re.fullmatch(r"META-INF/(?:[^/]+\.(?:SF|RSA|DSA|EC)|MANIFEST\.MF)", entry.filename, re.I):
                continue
            target = zipfile.ZipInfo(entry.filename, entry.date_time)
            target.compress_type = entry.compress_type
            target.external_attr = entry.external_attr
            target.create_system = entry.create_system
            with original.open(entry) as reader, packaged.open(target, "w") as writer:
                shutil.copyfileobj(reader, writer, length=1024 * 1024)
        for file in sorted(staged_web.rglob("*")):
            if not file.is_file():
                continue
            relative = file.relative_to(staged_web).as_posix()
            if file.is_symlink() or not file.resolve().is_relative_to(staged_web):
                raise ValueError("Staged asset escapes the approved source directory")
            compression = zipfile.ZIP_STORED if file.suffix.lower() in (".m4a", ".mp3", ".aac", ".wav", ".ogg", ".opus", ".flac", ".mp4") else zipfile.ZIP_DEFLATED
            packaged.write(file, "assets/web/" + relative, compress_type=compression)
            replaced.append(relative)
    return {"compiledShell": str(shell), "compiledShellSha256": expected_hash.lower(), "nativeSourceCommit": source_commit.lower(), "nativeCompilation": "reused verified cloud-compiled shell; native source unchanged", "assets": replaced, "unsignedOutput": str(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shell", type=Path)
    parser.add_argument("staged_web", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--shell-sha256", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--report", type=Path)
    arguments = parser.parse_args()
    report = repack(arguments.shell, arguments.staged_web, arguments.output, arguments.shell_sha256, arguments.source_commit)
    if arguments.report:
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Reused native shell {report['nativeSourceCommit']}; staged {len(report['assets'])} local web assets")
