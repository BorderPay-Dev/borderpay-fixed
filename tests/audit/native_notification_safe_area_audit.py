#!/usr/bin/env python3
from pathlib import Path

source = (Path(__file__).resolve().parents[2] / "App.tsx").read_text()

checks = {
    "global toaster has mobile offset": "mobileOffset={{" in source,
    "top notification clears safe area": "top: 'calc(env(safe-area-inset-top, 0px) + 16px)'" in source,
    "bottom notification clears safe area": "bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)'" in source,
    "legacy fixed offset removed": "offset={16}" not in source,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    for name in failed:
        print(f"[FAIL] {name}")
    raise SystemExit(1)

print("Native notification safe-area audit: PASS")
