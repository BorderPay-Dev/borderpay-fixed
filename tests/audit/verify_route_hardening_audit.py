#!/usr/bin/env python3
"""
Verify-route hardening audit (Option B).

Incident: a user clicked the verification link and stayed unverified
(redirected to login). The verify contract exists in source but is UNPROVEN
end-to-end. This PR hardens the known weak point WITHOUT a deploy:
accept the token from query OR hash, ensure the verify screen wins over the
login router, and keep the expired/invalid → resend UX.

Invariants (fail closed):

  (Q1) App.tsx accepts the verify token from the QUERY string.
  (H1) App.tsx ALSO accepts the verify token from the URL HASH.
  (R1) App.tsx detects the /auth/verify route and sets pendingVerify.
  (G1) The verify screen wins over login routing: the auth-router effect early-
       returns for appState==='verify-email' AND for a truthy pendingVerify.
  (P1) Reset-password detection does NOT fire on the verify route (the verify
       token is not mis-handled as a recovery token).
  (L1) EmailVerificationLanding keeps the expired/invalid UX (expired/not_found
       states) and the resend path.
  (S1) No manual verification / no DB mutation in the frontend:
       EmailVerificationLanding does not call admin/email_confirm/update; it only
       calls verifyEmailToken (server consumes the token).
  (S2) No provider/email-sender change in this PR (no send-email/Resend edits in
       the touched frontend files).

Non-runtime: parses source as text. No deploy, no DB, no provider call.

Run: python3 tests/audit/verify_route_hardening_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT    = Path(__file__).resolve().parents[2]
APP     = ROOT / "App.tsx"
LANDING = ROOT / "components" / "auth" / "EmailVerificationLanding.tsx"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    app     = read(APP)
    landing_raw = read(LANDING)

    # Strip comments so S1's mutation-token scan tests CODE, not prose. (The
    # component's header comment legitimately mentions "email_confirmed_at" when
    # describing what the SERVER does — that is not a client mutation.)
    def strip_comments(src: str) -> str:
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
        src = re.sub(r"(?m)//.*$", "", src)
        return src
    landing = strip_comments(landing_raw)

    # Isolate the mount-detection effect (from the hardening banner to the next
    # effect) so query/hash checks are scoped to verify detection.
    mount = ""
    m = re.search(r"Verify-link hardening.*?\n  \}, \[\]\);", app, re.S)
    if m:
        mount = m.group(0)

    # Isolate the auth-router early-return guard block.
    guard = ""
    g = re.search(r"appState === 'verify-email'.*?if \(pendingResetPassword\) return;", app, re.S)
    if g:
        guard = g.group(0)

    checks: list[tuple[str, bool, str]] = []

    checks.append(("Q1 verify token accepted from query string",
                   "queryParams.get('token')" in mount,
                   "mount effect must read token from window.location.search"))

    checks.append(("H1 verify token accepted from hash",
                   "hashParams.get('token')" in mount,
                   "mount effect must also read token from window.location.hash"))

    checks.append(("R1 /auth/verify route sets pendingVerify",
                   "'/auth/verify'" in mount and "setPendingVerify(" in mount,
                   "must detect /auth/verify and set pendingVerify"))

    checks.append(("G1 verify screen wins over login routing",
                   ("appState === 'verify-email'" in guard)
                   and ("if (pendingVerify)        return;" in app
                        or "if (pendingVerify) return;" in app),
                   "auth-router must early-return for verify-email + pendingVerify"))

    checks.append(("P1 reset-password detection skips the verify route",
                   bool(re.search(r"if \(!isVerifyRoute &&", mount)),
                   "reset detection must be guarded by !isVerifyRoute"))

    checks.append(("L1 landing keeps expired/invalid + resend UX",
                   all(tok in landing for tok in ["'expired'", "'not_found'", "handleResend", "resendVerification"]),
                   "EmailVerificationLanding must keep expired/not_found + resend"))

    # S1 — no manual verify / DB mutation in the landing component
    forbidden = [t for t in ["email_confirm", "admin.updateUser", "updateUserById",
                             ".update(", "from('users')", 'from("users")']
                 if t in landing]
    checks.append(("S1 landing does not manually verify / mutate DB",
                   not forbidden and "verifyEmailToken" in landing,
                   f"forbidden tokens present: {forbidden}"))

    # S2 — no provider/email sender change in touched frontend files
    s2 = ("api.resend.com" not in app) and ("api.resend.com" not in landing) \
         and ("send-email" not in app)
    checks.append(("S2 no provider/email-sender change in this PR", s2,
                   "verify hardening must not touch the email provider/sender"))

    print("verify_route_hardening_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
