#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
main_app = (ROOT / "components/app/MainApp.tsx").read_text()
app = (ROOT / "App.tsx").read_text()

checks = [
    (
        "last screen is isolated per authenticated user",
        "borderpay_last_screen_v1:${String(userId || '').trim()}" in main_app,
    ),
    (
        "stored screen is validated through canonical routing",
        "return stored ? canonicalizeScreen(stored) : 'dashboard';" in main_app,
    ),
    (
        "callback routes take precedence over restored screen",
        "if (params.get('screen') === 'kyc') return 'kyc';" in main_app
        and "return readLastScreen(userId);" in main_app,
    ),
    (
        "screen changes are persisted before an automatic lock unmount",
        "writeLastScreen(userId, currentScreen);" in main_app
        and "}, [currentScreen, userId]);" in main_app,
    ),
    (
        "locked app renders only the lock surface",
        "if (showAppLock)" in app
        and "<AppLockScreen" in app
        and "aria-hidden={showAppLock ? true : undefined}" not in app,
    ),
    (
        "unlock remounts MainApp without forcing dashboard navigation",
        "clearAppLocked();" in app
        and "setAppLocked(false);" in app
        and "setAppState('dashboard')" not in app[app.find("if (showAppLock)"):app.find("{/* Android PWA Install Banner */")],
    ),
]

failed = False
for label, ok in checks:
    print(f"[{'OK' if ok else 'FAIL'}] {label}")
    failed = failed or not ok

if failed:
    raise SystemExit("app_lock_screen_restore_audit: FAIL")

print("app_lock_screen_restore_audit: PASS")
