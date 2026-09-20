#!/usr/bin/env python3
"""Routine mobile uploads must not overwrite published store listings."""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
android = (root / ".github/workflows/android-play.yml").read_text()
ios = (root / ".github/workflows/ios-testflight.yml").read_text()
for name, source in [("Android", android), ("iOS", ios)]:
    for forbidden in ["fastlane supply", "fastlane deliver", "--metadata_path", "android-play-listing.yml", "Publish Google Play name and icon"]:
        if forbidden in source:
            raise SystemExit(f"{name} release may overwrite published listing: {forbidden}")
if "r0adkll/upload-google-play@" not in android or "xcrun altool --upload-app" not in ios:
    raise SystemExit("Expected binary-only upload paths are missing; review release workflow")
print("Store listing preservation: PASS")
