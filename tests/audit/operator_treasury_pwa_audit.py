#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = (ROOT / "App.tsx").read_text()
UI = (ROOT / "components/business/OperatorBridgeReadOnlyApp.tsx").read_text()
INDEX = (ROOT / "index.html").read_text()
MANIFEST = json.loads((ROOT / "public/manifest.json").read_text())

checks = {
    "treasury stays isolated to the master identity": (
        "founder@borderpayafrica.com" in APP
        and "<OperatorBridgeReadOnlyApp" in APP
        and "bp-treasury-shell" in UI
    ),
    "application is installable in standalone mode": (
        MANIFEST.get("display") == "standalone"
        and MANIFEST.get("start_url") == "/"
        and '<link rel="manifest" href="/manifest.json"' in INDEX
    ),
    "viewport supports notches and standalone safe areas": (
        "viewport-fit=cover" in INDEX
        and "safe-area-inset-top" in UI
        and "safe-area-inset-right" in UI
        and "safe-area-inset-bottom" in UI
        and "safe-area-inset-left" in UI
    ),
    "dynamic mobile viewport is used without locking document width": (
        "100svh" in UI and "100dvh" in UI and "overflow-x-hidden" in UI
    ),
    "standalone display receives treasury-only layout rules": (
        "@media (display-mode:standalone)" in UI
        and ".bp-treasury-shell" in UI
        and ".bp-treasury-main" in UI
    ),
    "small phones receive compact brand cards and tab labels": all(token in UI for token in (
        "@media (max-width:359px)",
        "bp-treasury-brand-copy",
        "bp-treasury-card",
        "bp-treasury-nav-label",
    )),
    "short landscape screens retain usable navigation": (
        "orientation:landscape" in UI and "max-height:540px" in UI
    ),
    "mobile navigation remains accessible and touch sized": (
        'aria-label={label}' in UI and "min-h-14" in UI and "grid-cols-5" in UI
    ),
    "chart keeps its aspect ratio instead of stretching": (
        'preserveAspectRatio="xMidYMid meet"' in UI
        and 'preserveAspectRatio="none"' not in UI
    ),
    "motion preference is respected": "prefers-reduced-motion:reduce" in UI,
    "customer application component is not imported into treasury UI": (
        "MainApp" not in UI and "BusinessDashboard" not in UI
    ),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit("operator treasury PWA audit failed: " + ", ".join(failed))
print(f"PASS: {len(checks)}/{len(checks)} operator treasury PWA invariants")
