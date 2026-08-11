from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APP = (ROOT / "App.tsx").read_text()
LOCK = (ROOT / "components/security/AppLockScreen.tsx").read_text()
CLIENT = (ROOT / "utils/supabase/client.ts").read_text()


def main() -> None:
    failures: list[str] = []
    unlock_block = """onUnlock={() => {
            clearAppLocked();
            setAppLocked(false);
            setLockChecked(true);
          }}"""

    if unlock_block not in APP:
        failures.append("successful PIN/biometric unlock does not clear persistent and React lock state")
    if "const handleLoginSuccess" not in APP or "clearAppLocked();\n      setAppLocked(false);\n      setLockChecked(true);" not in APP:
        failures.append("successful credential login does not clear stale lock state")
    if "restoreLockedSession" not in LOCK or "supabase.auth.refreshSession({ refresh_token: refreshToken })" not in LOCK:
        failures.append("locked native session cannot be restored before PIN verification")
    if LOCK.count("<InputOTPSlot index=") != 6 or LOCK.count(" mask />") < 6:
        failures.append("unlock PIN must remain six-digit and fully masked")
    if "export function clearAppLocked" not in CLIENT:
        failures.append("persistent lock cleanup helper is missing")

    if failures:
        raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))
    print("PASS: PIN/biometric unlock clears persistent state across Android, iOS, PWA, and web")


if __name__ == "__main__":
    main()
