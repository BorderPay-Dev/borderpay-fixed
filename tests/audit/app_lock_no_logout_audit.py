#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
app = (ROOT / "App.tsx").read_text()

match = re.search(r"const handleLock = async \(\) => \{(?P<body>.*?)\n  \};", app, re.S)
body = match.group("body") if match else ""

checks = [
    (
        "handleLock exists",
        bool(match),
    ),
    (
        "manual app lock does not call authAPI.lockApp",
        "authAPI.lockApp" not in body,
    ),
    (
        "manual app lock does not route through login",
        "setAppState('login')" not in body and 'setAppState("login")' not in body,
    ),
    (
        "manual app lock shows dashboard lock surface",
        "setAppLocked(true)" in body and "setAppState('dashboard')" in body,
    ),
    (
        "stale app locked flag can render lock screen when session user exists",
        "if (user?.id)" in app and "setAppLocked(true)" in app and "isAppLocked()" in app,
    ),
]

failed = False
for label, ok in checks:
    print(f"[{'OK' if ok else 'FAIL'}] {label}")
    failed = failed or not ok

if failed:
    raise SystemExit("app_lock_no_logout_audit: FAIL")

print("app_lock_no_logout_audit: PASS")
