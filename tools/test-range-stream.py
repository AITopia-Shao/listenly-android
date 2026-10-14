#!/usr/bin/env python3
"""Compile the production range streams as Java 8 and run their byte contract checks."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java-home", type=Path, default=os.environ.get("JAVA_HOME"))
    args = parser.parse_args()
    suffix = ".exe" if os.name == "nt" else ""
    java = args.java_home / "bin" / f"java{suffix}" if args.java_home else shutil.which("java")
    javac = args.java_home / "bin" / f"javac{suffix}" if args.java_home else shutil.which("javac")
    if not java or not javac:
        parser.error("Set JAVA_HOME or pass --java-home for a JDK with javac.")
    output = ROOT / ".build" / "range-stream-tests"
    classes = output / "classes"
    classes.mkdir(parents=True, exist_ok=True)
    source = ROOT / "app" / "src" / "main" / "java" / "cn" / "listenly" / "app"
    test = ROOT / "tests" / "java" / "cn" / "listenly" / "app" / "WebViewRangeInputStreamTest.java"
    commands = [
        [str(javac), "--release", "8", "-encoding", "UTF-8", "-d", str(classes),
         str(source / "LimitedStream.java"), str(source / "WebViewRangeInputStream.java"), str(test)],
        [str(java), "-cp", str(classes), "cn.listenly.app.WebViewRangeInputStreamTest"],
    ]
    logs = []
    for command in commands:
        result = subprocess.run(command, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        logs.append(result.stdout)
        print(result.stdout, end="", flush=True)
        if result.returncode:
            (output / "result.json").write_text(json.dumps({"passed": False, "javaRelease": 8, "output": "\n".join(logs)}, indent=2), encoding="utf-8")
            raise subprocess.CalledProcessError(result.returncode, command)
    (output / "result.json").write_text(json.dumps({"passed": True, "javaRelease": 8, "output": "\n".join(logs)}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
