#!/usr/bin/env python3
"""Direct Android SDK build of the original-fixture CI APK; no release keystore."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ANDROID = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID)


def build(args: argparse.Namespace) -> None:
    sdk = args.sdk.resolve()
    java_home = args.java_home.resolve()
    tools = sdk / "build-tools" / args.build_tools
    android_jar = sdk / "platforms" / f"android-{args.compile_api}" / "android.jar"
    staged = args.staged_main.resolve()
    output = args.output.resolve()
    if not staged.is_relative_to((ROOT / ".build" / "ci").resolve()):
        raise ValueError("Only source staged by tools/prepare-ci-assets.py may be packaged")
    fixture = json.loads((staged / "assets" / "web" / "demo.json").read_text(encoding="utf-8"))
    library = json.loads((staged / "assets" / "web" / "bundled-library.json").read_text(encoding="utf-8"))
    if not fixture.get("testFixture") or library.get("papers") != []:
        raise ValueError("CI builds require an original fixture and an empty real-paper library")
    allowed = {f"assets/web/{name}" for name in ("index.html", "app.js", "styles.css", "importer.js", "alignment.js", "demo.json", "bundled-library.json")}
    allowed.add("assets/web/media/ci-playback.wav")
    for filename in ("app.compat.js", "compat-polyfills.js"):
        if (staged / "assets" / "web" / filename).is_file():
            allowed.add(f"assets/web/{filename}")
    actual = {item.relative_to(staged).as_posix() for item in (staged / "assets").rglob("*") if item.is_file()}
    if actual != allowed:
        raise ValueError(f"Unexpected or missing CI assets: {sorted(actual.symmetric_difference(allowed))}")
    suffix = ".exe" if os.name == "nt" else ""
    java = java_home / "bin" / f"java{suffix}"
    javac = java_home / "bin" / f"javac{suffix}"
    keytool = java_home / "bin" / f"keytool{suffix}"
    for required in (android_jar, java, javac, keytool, tools / f"aapt2{suffix}", tools / f"zipalign{suffix}", tools / "lib" / "d8.jar", tools / "lib" / "apksigner.jar"):
        if not required.is_file():
            raise FileNotFoundError(f"Required build tool not found: {required}")
    config = (ROOT / "app" / "build.gradle").read_text(encoding="utf-8")
    version_code = re.search(r"\bversionCode\s+(\d+)", config).group(1)
    version_name = re.search(r"\bversionName\s+'([^']+)'", config).group(1)
    output.parent.mkdir(parents=True, exist_ok=True)
    results = ROOT / ".build" / "ci"
    results.mkdir(parents=True, exist_ok=True)
    work_parent = (args.work_dir or results).resolve()
    work_parent.mkdir(parents=True, exist_ok=True)
    with (results / "build.log").open("w", encoding="utf-8") as log:
        def run(command: list[str | Path]) -> str:
            command = [str(arg) for arg in command]
            rendered = subprocess.list2cmdline(command)
            print(rendered, flush=True)
            log.write(rendered + "\n")
            execution = subprocess.run(command, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            print(execution.stdout, end="", flush=True)
            log.write(execution.stdout)
            log.flush()
            if execution.returncode:
                raise subprocess.CalledProcessError(execution.returncode, command, execution.stdout)
            return execution.stdout

        # Each cleaned directory is a newly created child of this resolved build root.
        # Windows AAPT2 may require --work-dir to point to an ASCII-only path.
        with tempfile.TemporaryDirectory(prefix="listenly-ci-work-", dir=work_parent) as temporary:
            work = Path(temporary)
            main = work / "main"
            shutil.copytree(staged, main)
            for directory in ("compiled", "gen", "classes", "dex"):
                (work / directory).mkdir()
            manifest = ET.parse(main / "AndroidManifest.xml")
            root = manifest.getroot()
            root.set("package", "cn.listenly.app")
            root.set(f"{{{ANDROID}}}versionCode", version_code)
            root.set(f"{{{ANDROID}}}versionName", version_name)
            root.find("application").set(f"{{{ANDROID}}}debuggable", "true")
            uses_sdk = root.find("uses-sdk")
            min_sdk = uses_sdk.attrib[f"{{{ANDROID}}}minSdkVersion"]
            target_sdk = uses_sdk.attrib[f"{{{ANDROID}}}targetSdkVersion"]
            manifest.write(work / "AndroidManifest.xml", encoding="utf-8", xml_declaration=True)
            run([tools / f"aapt2{suffix}", "compile", "--dir", main / "res", "-o", work / "compiled.zip"])
            run([tools / f"aapt2{suffix}", "link", "-I", android_jar, "--manifest", work / "AndroidManifest.xml", "--java", work / "gen", "--auto-add-overlay", "-A", main / "assets", "-o", work / "base.apk", work / "compiled.zip"])
            sources = sorted((main / "java").rglob("*.java")) + sorted((work / "gen").rglob("*.java"))
            run([javac, "--release", "8", "-encoding", "UTF-8", "-classpath", android_jar, "-d", work / "classes", *sources])
            run([java, "-cp", tools / "lib" / "d8.jar", "com.android.tools.r8.D8", "--min-api", min_sdk, "--lib", android_jar, "--output", work / "dex", *sorted((work / "classes").rglob("*.class"))])
            with zipfile.ZipFile(work / "base.apk") as source, zipfile.ZipFile(work / "normalized.apk", "w") as destination:
                for entry in source.infolist():
                    name = entry.filename.replace("\\", "/")
                    compression = zipfile.ZIP_STORED if name == "resources.arsc" or name.endswith(".wav") else zipfile.ZIP_DEFLATED
                    destination.writestr(name, source.read(entry), compress_type=compression)
                for dex in sorted((work / "dex").glob("*.dex")):
                    destination.write(dex, dex.name, compress_type=zipfile.ZIP_DEFLATED)
            run([tools / f"zipalign{suffix}", "-P", "16", "-f", "4", work / "normalized.apk", work / "aligned.apk"])
            # Temporary disposable key. Never reads or uploads the local user's installation key.
            keystore = work / "ci-only.keystore"
            run([keytool, "-genkeypair", "-keystore", keystore, "-storepass", "android", "-keypass", "android", "-alias", "ci-test", "-dname", "CN=Listenly CI Fixture,O=Test,C=CN", "-keyalg", "RSA", "-keysize", "2048", "-validity", "30"])
            signer = [java, "-jar", tools / "lib" / "apksigner.jar"]
            run([*signer, "sign", "--ks", keystore, "--ks-key-alias", "ci-test", "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", work / "signed.apk", work / "aligned.apk"])
            signature = run([*signer, "verify", "--verbose", work / "signed.apk"])
            if "Verified using v2 scheme (APK Signature Scheme v2): true" not in signature:
                raise RuntimeError("Missing valid v2 APK signature")
            run([tools / f"zipalign{suffix}", "-c", "-P", "16", "4", work / "signed.apk"])
            badging = run([tools / f"aapt{suffix}", "dump", "badging", work / "signed.apk"])
            for contract in ("package: name='cn.listenly.app'", f"sdkVersion:'{min_sdk}'", f"targetSdkVersion:'{target_sdk}'", "launchable-activity: name='cn.listenly.app.MainActivity'"):
                if contract not in badging:
                    raise RuntimeError(f"Manifest contract missing: {contract}")
            shutil.copyfile(work / "signed.apk", output)
    metadata = {"apk": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "compileApi": args.compile_api,
                "minSdk": int(min_sdk), "targetSdk": int(target_sdk), "versionCode": int(version_code), "versionName": version_name,
                "testFixture": True, "realPapers": 0, "signing": "disposable CI test key, incompatible with installed local APK"}
    (results / "build.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Built CI fixture APK: {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", os.environ.get("ANDROID_SDK_ROOT", "."))))
    parser.add_argument("--java-home", type=Path, default=Path(os.environ.get("JAVA_HOME", ".")))
    parser.add_argument("--compile-api", type=int, default=36)
    parser.add_argument("--build-tools", default="36.0.0")
    parser.add_argument("--work-dir", type=Path, help="Temporary build parent; an ASCII-only path is recommended on Windows")
    parser.add_argument("--staged-main", type=Path, default=ROOT / ".build" / "ci" / "main")
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "listenly-ci-fixture.apk")
    build(parser.parse_args())
