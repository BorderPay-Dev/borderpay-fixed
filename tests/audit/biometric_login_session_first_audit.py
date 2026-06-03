#!/usr/bin/env python3
"""
Biometric sign-in — session-first / WebAuthn-gated ordering audit.

Locks the fix for "biometric enabled but cannot sign in": the login screen used
to call the authenticated WebAuthn endpoints (webauthn-auth-options /
webauthn-auth-verify, both verify_jwt=true) BEFORE restoring the Supabase
session, so they 401'd (no valid user JWT) and the refresh never happened.

The corrected contract in components/auth/LoginScreen.tsx handleBiometricLogin:

  1. Restore the Supabase session from borderpay_refresh_token FIRST.
  2. Publish the fresh access token to borderpay_token (apiCall reads it) so the
     WebAuthn calls are authorized — BEFORE calling WebAuthn.
  3. Do NOT navigate (onLoginSuccess / setShow2FA) before WebAuthn succeeds.
  4. WebAuthn assertion (BiometricManager.verify) is the access gate.
  5. On WebAuthn failure: tear the restored session down (signOut + clear local
     auth tokens) and stay on login.

This is NOT Supabase native passkeys/MFA and NOT passwordless passkey login —
the refresh token restores the session and biometric gates access.

Invariants (fail closed):

  (B1) handleBiometricLogin exists.
  (B2) refreshSession() happens before BiometricManager.verify().
  (B3) borderpay_token is set (from the refreshed session) before WebAuthn.
  (B4) WebAuthn (BiometricManager.verify) happens before any navigation
       (onLoginSuccess / setShow2FA).
  (B5) navigation appears only AFTER the WebAuthn success check.
  (B6) the WebAuthn-failure branch tears down the session (clearRestoredSession).
  (B7) clearRestoredSession signs out and clears borderpay_token +
       borderpay_refresh_token + borderpay_user.
  (B8) no Supabase native passkey / MFA API is used (no regression to native).
  (B9) deployed-only webauthn-auth-options is now under repo source control
       (verbatim: 401-without-user guard + challenge generation).

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/biometric_login_session_first_audit.py  (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT  = Path(__file__).resolve().parents[2]
LOGIN = ROOT / "components" / "auth" / "LoginScreen.tsx"
FN    = ROOT / "supabase" / "functions" / "webauthn-auth-options" / "index.ts"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def strip_comments(s: str) -> str:
    """Remove /* */ and // line comments. The handler has no URLs/`//` inside
    string literals, so a simple strip is safe for ordering checks."""
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"//[^\n]*", "", s)
    return s


def slice_fn(src: str, anchor: str) -> str:
    start = src.find(anchor)
    if start < 0:
        return ""
    end = src.find("\n  };", start)
    return src[start:end] if end > start else src[start:]


def main() -> int:
    raw = read(LOGIN)
    body = slice_fn(raw, "const handleBiometricLogin = async () =>")
    code = strip_comments(body)
    fn = read(FN)

    checks: list[tuple[str, bool, str]] = []

    # B1
    checks.append(("B1 handleBiometricLogin exists", bool(body),
                   "handleBiometricLogin handler not found in LoginScreen.tsx"))

    i_refresh = code.find("refreshSession(")
    i_token   = code.find("setItem('borderpay_token'")
    i_verify  = code.find("BiometricManager.verify(")
    i_check   = code.find("if (!result.success)")
    i_login   = code.find("onLoginSuccess(")
    i_2fa     = code.find("setShow2FA(")

    def before(a: int, b: int) -> bool:
        return a >= 0 and b >= 0 and a < b

    # B2
    checks.append(("B2 refreshSession before WebAuthn verify",
                   before(i_refresh, i_verify),
                   f"refreshSession({i_refresh}) must precede BiometricManager.verify({i_verify})"))

    # B3
    checks.append(("B3 borderpay_token set before WebAuthn",
                   before(i_token, i_verify),
                   f"borderpay_token setItem({i_token}) must precede verify({i_verify})"))

    # B4
    checks.append(("B4 WebAuthn before navigation",
                   before(i_verify, i_login) and before(i_verify, i_2fa),
                   f"verify({i_verify}) must precede onLoginSuccess({i_login}) and setShow2FA({i_2fa})"))

    # B5
    checks.append(("B5 navigation only after success check",
                   before(i_check, i_login) and before(i_check, i_2fa),
                   f"'if (!result.success)'({i_check}) must precede onLoginSuccess({i_login})/setShow2FA({i_2fa})"))

    # B6 — failure branch tears down the session
    fail_ok = False
    if i_check >= 0:
        i_ret = code.find("return", i_check)
        if i_ret > i_check:
            fail_ok = "clearRestoredSession" in code[i_check:i_ret]
    checks.append(("B6 WebAuthn-failure branch tears down session",
                   fail_ok,
                   "the !result.success branch must call clearRestoredSession() before returning"))

    # B7 — teardown helper clears everything
    helper = slice_fn(raw, "const clearRestoredSession = async () =>")
    checks.append(("B7 clearRestoredSession signs out + clears tokens",
                   ("signOut(" in helper
                    and "removeItem('borderpay_token')" in helper
                    and "removeItem('borderpay_refresh_token')" in helper
                    and "removeItem('borderpay_user')" in helper),
                   "clearRestoredSession must signOut and remove borderpay_token/refresh_token/user"))

    # B8 — no Supabase native passkey/MFA regression
    native = re.search(r"auth\.mfa|signInWithPasskey|enrollPasskey|auth\.signInWith\w*Passkey", raw)
    checks.append(("B8 no Supabase native passkeys/MFA",
                   native is None,
                   f"native passkey/MFA API found: {native.group(0) if native else ''}"))

    # B9 — deployed-only function now in repo, verbatim behavior preserved
    checks.append(("B9 webauthn-auth-options under source control (verbatim)",
                   (bool(fn)
                    and "generateAuthenticationOptions" in fn
                    and "error: 'Unauthorized' }, 401" in fn
                    and "supa.auth.getUser(token)" in fn),
                   "supabase/functions/webauthn-auth-options/index.ts missing or not verbatim"))

    print("biometric_login_session_first_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
