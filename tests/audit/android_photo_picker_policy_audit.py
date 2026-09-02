#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
manifest = (ROOT / "android/app/src/main/AndroidManifest.xml").read_text()

for permission in (
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_EXTERNAL_STORAGE",
):
    if permission in manifest:
        raise SystemExit(f"FAIL: prohibited broad media permission present: {permission}")

print("Android photo-picker policy audit: PASS")
