#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
gradle = (ROOT / "android/app/build.gradle").read_text()
rules = (ROOT / "android/app/proguard-rules.pro").read_text()

required = {
    "R8 minification": "minifyEnabled true" in gradle,
    "resource shrinking": "shrinkResources true" in gradle,
    "optimized default rules": "proguard-android-optimize.txt" in gradle,
    "production stack trace metadata": "-keepattributes SourceFile,LineNumberTable" in rules,
    "source filename redaction": "-renamesourcefileattribute SourceFile" in rules,
}

failed = [label for label, passed in required.items() if not passed]
if failed:
    raise SystemExit("FAIL: " + "; ".join(failed))

print("PASS: Android release enables R8 optimization, resource shrinking, and actionable obfuscated crash traces")
