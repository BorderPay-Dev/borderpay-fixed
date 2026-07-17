#!/usr/bin/env python3
"""
Capacitor viewport regression audit.

Production contract:
- Native iOS/Android webviews must fill the physical app viewport.
- Root app screens must not rely only on 100dvh, which can underfill inside
  iOS WebView/TestFlight and leave a black strip at the bottom.
"""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "src/main.tsx"
GLOBALS = ROOT / "styles/globals.css"
MAIN_APP = ROOT / "components/app/MainApp.tsx"
LOCK_SCREEN = ROOT / "components/security/AppLockScreen.tsx"


def fail(message: str) -> None:
    print("FAIL: capacitor viewport audit")
    print()
    print(message)
    sys.exit(1)


def require(src: str, marker: str, label: str) -> None:
    if marker not in src:
        fail(f"{label}: missing marker: {marker}")


def main() -> int:
    for path in [MAIN, GLOBALS, MAIN_APP, LOCK_SCREEN]:
        if not path.is_file():
            fail(f"missing file: {path.relative_to(ROOT)}")

    main = MAIN.read_text()
    globals_css = GLOBALS.read_text()
    main_app = MAIN_APP.read_text()
    lock_screen = LOCK_SCREEN.read_text()

    require(main, "function syncAppViewportHeight", "src/main viewport sync")
    require(main, "window.visualViewport?.height", "src/main viewport sync")
    require(main, "window.innerHeight", "src/main viewport sync")
    require(main, "document.documentElement.style.setProperty('--app-height'", "src/main viewport sync")
    require(main, "window.visualViewport?.addEventListener('resize'", "src/main viewport sync")

    require(globals_css, "--app-height: 100vh", "global app height variable")
    require(globals_css, "height: var(--app-height)", "global app height variable")
    require(globals_css, "min-height: var(--app-height)", "global app height variable")

    require(main_app, "height: 'var(--app-height)'", "MainApp native viewport")
    require(main_app, "maxHeight: 'var(--app-height)'", "MainApp native viewport")
    require(lock_screen, "height: 'var(--app-height)'", "PIN lock native viewport")

    print("PASS: capacitor viewport audit")
    print()
    print("  native viewport: measured --app-height drives full-screen app roots")
    return 0


if __name__ == "__main__":
    main()
