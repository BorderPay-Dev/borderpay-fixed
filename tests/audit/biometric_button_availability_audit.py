#!/usr/bin/env python3
"""
Biometric sign-in button availability audit.

Smoke of #54 found a contract bug: the "Biometric Sign-In" button was shown using
only enrollment state (storedUserId && BiometricManager.isEnrolled), but the
handler needs the full cached session context (borderpay_user +
borderpay_refresh_token) to restore a session before WebAuthn. After a
logout/cancel/failure that cleared borderpay_user / borderpay_refresh_token but
left the enrollment flag, the button still rendered and then errored with
"No biometric session found".

Fix: the button renders ONLY when biometric sign-in can actually run —
BiometricManager.isLoginAvailable() requires ALL of:
  - borderpay_biometric_user_id
  - enrolled credential (borderpay_biometric_enrolled)
  - borderpay_user
  - borderpay_refresh_token
Otherwise biometric is hidden and password login is shown. Explicit password
login re-primes all of that state.

Security stance (unchanged): refresh tokens are NOT silently preserved after
explicit logout — logout/teardown paths still clear borderpay_refresh_token.

Invariants (fail closed):

  (A1) BiometricManager.isLoginAvailable() exists and requires all four keys.
  (A2) LoginScreen computes biometricAvailable from isLoginAvailable().
  (A3) the button cannot be forced visible from enrollment alone — no
       setBiometricAvailable(true) literal remains.
  (A4) the rendered button is gated on biometricAvailable.
  (A5) explicit password login re-primes all four state items.
  (A6) logout / teardown paths clear borderpay_refresh_token (no silent
       preservation after explicit logout).

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/biometric_button_availability_audit.py  (exit 0 = pass)
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT  = Path(__file__).resolve().parents[2]
LOGIN = ROOT / "components" / "auth" / "LoginScreen.tsx"
SEC   = ROOT / "utils" / "security" / "SecurityManager.ts"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def slice_between(s: str, start: str, end: str) -> str:
    i = s.find(start)
    if i < 0:
        return ""
    j = s.find(end, i + len(start))
    return s[i:j] if j > i else s[i:]


def main() -> int:
    login = read(LOGIN)
    sec   = read(SEC)

    checks: list[tuple[str, bool, str]] = []

    # A1 — isLoginAvailable requires all four keys
    fn = slice_between(sec, "isLoginAvailable()", "\n  },")
    a1 = (bool(fn)
          and "borderpay_biometric_user_id" in fn
          and "isEnrolled(" in fn
          and "borderpay_user" in fn
          and "borderpay_refresh_token" in fn)
    checks.append(("A1 isLoginAvailable requires all four state items", a1,
                   "BiometricManager.isLoginAvailable must check biometric_user_id + isEnrolled + borderpay_user + borderpay_refresh_token"))

    # A2 — LoginScreen derives biometricAvailable from isLoginAvailable
    checks.append(("A2 button availability uses isLoginAvailable",
                   "setBiometricAvailable(BiometricManager.isLoginAvailable())" in login,
                   "LoginScreen must set biometricAvailable from BiometricManager.isLoginAvailable()"))

    # A3 — cannot be forced visible from enrollment alone
    checks.append(("A3 no hardcoded setBiometricAvailable(true)",
                   "setBiometricAvailable(true)" not in login,
                   "biometricAvailable must be derived, never forced true (would allow enrollment-only render)"))

    # A4 — render gated on biometricAvailable
    checks.append(("A4 button render gated on biometricAvailable",
                   "{biometricAvailable && (" in login,
                   "the Biometric Sign-In button must be gated on biometricAvailable"))

    # A5 — password login re-primes all four
    login_fn = slice_between(login, "const handleLogin = async (e: React.FormEvent) =>", "\n  };")
    a5 = ("storeUserProfile(" in login_fn
          and "setItem('borderpay_refresh_token'" in login_fn
          and "setItem('borderpay_biometric_user_id'" in login_fn
          and "setItem('borderpay_token'" in login_fn)
    checks.append(("A5 password login re-primes all biometric state", a5,
                   "handleLogin must set borderpay_token + borderpay_user + borderpay_refresh_token + borderpay_biometric_user_id"))

    # A6 — logout/teardown clears refresh token (no silent preservation)
    a6 = ("removeItem('borderpay_refresh_token')" in login)
    checks.append(("A6 teardown/logout clears refresh token", a6,
                   "logout/teardown must remove borderpay_refresh_token (no silent post-logout preservation)"))

    print("biometric_button_availability_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
