#!/usr/bin/env python3
"""Fail closed when an Android release requests broad photo/video storage access."""

from __future__ import annotations

import argparse
import glob
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE_MANIFEST = ROOT / "android/app/src/main/AndroidManifest.xml"
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"
TOOLS_NS = "{http://schemas.android.com/tools}"
FORBIDDEN = {
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
}


def permissions(path: Path) -> dict[str, ET.Element]:
    root = ET.parse(path).getroot()
    return {
        node.attrib.get(f"{ANDROID_NS}name", ""): node
        for node in root.findall("uses-permission")
    }


def verify_source() -> None:
    declared = permissions(SOURCE_MANIFEST)
    missing_removals = sorted(
        name
        for name in FORBIDDEN
        if declared.get(name) is None
        or declared[name].attrib.get(f"{TOOLS_NS}node") != "remove"
    )
    if missing_removals:
        raise SystemExit(
            "Broad-media manifest removal rules missing: " + ", ".join(missing_removals)
        )


def find_merged_manifest() -> Path:
    candidates = []
    for pattern in (
        "android/app/build/intermediates/merged_manifests/release/**/AndroidManifest.xml",
        "android/app/build/intermediates/merged_manifest/release/**/AndroidManifest.xml",
        "android/app/build/intermediates/packaged_manifests/release/**/AndroidManifest.xml",
    ):
        candidates.extend(Path(path) for path in glob.glob(str(ROOT / pattern), recursive=True))
    if not candidates:
        raise SystemExit("Generated release manifest not found; run processReleaseMainManifest first")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def verify_merged() -> None:
    merged = find_merged_manifest()
    present = sorted(FORBIDDEN.intersection(permissions(merged)))
    if present:
        raise SystemExit(
            f"Generated release manifest {merged} still requests: " + ", ".join(present)
        )
    print(f"Android merged-manifest media permission audit: PASS ({merged})")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--merged", action="store_true")
    args = parser.parse_args()
    verify_source()
    print("Android source-manifest media permission audit: PASS")
    if args.merged:
        verify_merged()
    return 0


if __name__ == "__main__":
    sys.exit(main())
