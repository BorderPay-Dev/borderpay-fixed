from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SECURITY = (ROOT / "utils/security/SecurityManager.ts").read_text()
LOCK = (ROOT / "components/security/AppLockScreen.tsx").read_text()

failures = []
if "verifyAppUnlockPIN" not in SECURITY or "legacy.pinHash" not in SECURITY or "legacy.pinSalt" not in SECURITY:
    failures.append("legacy device PIN is not preserved for app unlock")
if "verifyAppUnlockPINResult" not in SECURITY or "backendAPI.auth.verifyPIN(pin)" not in SECURITY:
    failures.append("server-backed PIN fallback is missing")
if "verifyAppUnlockPIN" not in LOCK:
    failures.append("app lock does not use compatibility verifier")
if "verifyTransactionPIN" in LOCK:
    failures.append("app unlock is incorrectly coupled to transaction authorization")
if "biometric_enrolled" not in LOCK:
    failures.append("app lock does not restore biometric enrollment from server truth")
if "result.code === 'invalid_pin'" not in LOCK:
    failures.append("transport failures can still be counted as incorrect PIN attempts")

if failures:
    print("app_lock_legacy_pin_regression_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("app_lock_legacy_pin_regression_audit: PASS")
