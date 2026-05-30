#!/usr/bin/env python3
"""
webauthn_disable_audit — ensure "Disable Biometric" deletes the SERVER
credential, not just the local hint.

Background
----------
Disabling biometric used to clear only localStorage. The webauthn_credentials
row survived, and webauthn-register-options excludes existing credentials, so
re-enrolling on the same device threw InvalidStateError. The fix adds a
server-backed delete and gates the local clear / UI "disabled" state on its
success.

Invariants (fail closed):
  S1 webauthn-delete edge function exists and deletes webauthn_credentials
     scoped to the caller (user_id = auth.uid()).
  S2 backendAPI.webauthn exposes disable() → POST webauthn-delete.
  S3 BiometricManager.disable is async and calls backendAPI.webauthn.disable;
     it clears the local hint only after a successful server delete.
  S4 enroll() maps InvalidStateError to the friendly "already set up" message.
  S5 both disable callers (PreferencesScreen, BiometricSetup) gate the
     "disabled" UI state on success (no unconditional success).

Run: python3 tests/audit/webauthn_disable_audit.py
Exit 0 = pass, 1 = fail.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEL  = os.path.join(ROOT, "supabase", "functions", "webauthn-delete", "index.ts")
API  = os.path.join(ROOT, "utils", "api", "backendAPI.ts")
MGR  = os.path.join(ROOT, "utils", "security", "SecurityManager.ts")
PREF = os.path.join(ROOT, "components", "app", "PreferencesScreen.tsx")
SET  = os.path.join(ROOT, "components", "security", "BiometricSetup.tsx")


def read(p):
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def main() -> int:
    dele, api, mgr, pref, setup = read(DEL), read(API), read(MGR), read(PREF), read(SET)

    # Isolate BiometricManager.disable body.
    m = re.search(r"async disable\([^)]*\)\s*:\s*Promise<[^>]*>\s*\{(.*?)\n  \},", mgr, re.S)
    disable_body = m.group(1) if m else ""

    checks = [
        ("S1a webauthn-delete edge function exists", bool(dele), f"missing {DEL}"),
        ("S1b deletes webauthn_credentials scoped to user_id=auth.uid()",
         bool(re.search(r"from\(['\"]webauthn_credentials['\"]\)\s*\.delete\(\)", dele))
         and "eq('user_id', user.id)" in dele,
         "delete must be scoped to the caller's user_id"),

        ("S2 backendAPI.webauthn.disable() posts webauthn-delete",
         bool(re.search(r"disable:\s*async", api)) and "'webauthn-delete'" in api,
         "expected disable() → apiCall('webauthn-delete', ...)"),

        ("S3a BiometricManager.disable is async + calls backend disable",
         "async disable(" in mgr and "backendAPI.webauthn.disable" in disable_body,
         "disable must call backendAPI.webauthn.disable"),
        ("S3b local hint cleared only after server success",
         bool(re.search(r"if\s*\(!r\?\.success\)\s*\{[^}]*return", disable_body))
         and disable_body.index("backendAPI.webauthn.disable") < disable_body.index("removeItem"),
         "must return on !success before removeItem"),

        ("S4 enroll maps InvalidStateError to friendly message",
         "InvalidStateError" in mgr and "already set up on this device" in mgr,
         "expected InvalidStateError → 'already set up on this device' message"),

        ("S5a PreferencesScreen gates disabled state on success",
         bool(re.search(r"if\s*\(r\.success\)\s*setBiometricEnabled\(false\)", pref)),
         "PreferencesScreen must setBiometricEnabled(false) only on success"),
        ("S5b BiometricSetup gates disabled state on success",
         "const handleDisable = async" in setup
         and bool(re.search(r"if\s*\(r\.success\)\s*\{", setup)),
         "BiometricSetup handleDisable must be async and gate on success"),
    ]

    print("webauthn_disable_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
