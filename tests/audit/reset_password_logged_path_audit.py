#!/usr/bin/env python3
"""
Email P0-b — reset-password logged-path + enumeration-safety audit.

Goal: forgot/reset password is under source control and routes its email through
the LOGGED send-email (token-gated), with NO account-enumeration leakage and NO
recovery-token material in the idempotency key. GoTrue recovery tokens are kept
as-is (no redesign).

auth-reset-password (request) invariants:
  (R1) reads SEND_EMAIL_INTERNAL_TOKEN.
  (R2) POSTs to /functions/v1/send-email (logged path).
  (R3) send-email Authorization uses the internal token (Bearer ${SEND_EMAIL_TOKEN}).
  (R4) NO inline Resend call (api.resend.com absent — send goes via send-email).
  (R5) uses the individual.password_reset template.
  (R6) does NOT send the service-role key as the send-email bearer.
  (R7) service-role key still used for the admin client (generateLink).
  (R8) idempotency key is NON-SENSITIVE: uses crypto.randomUUID(), prefixed
       `pwreset:`, and contains NO recovery-token fragment (no hashed_token / ${token}).
  (R9) enumeration-safe: a single uniform GENERIC_OK response is returned on the
       no-token branch AND the success branch; no existence-revealing copy.

auth-reset-password-confirm invariants:
  (C1) updates password via admin updateUserById.
  (C2) enforces min password length (>= 8).
  (C3) preserves 2FA/PIN: never writes user_security.

Frontend ForgotPassword.tsx invariants:
  (F1) no enumeration copy ("No account found" / "User not found" removed).
  (F2) still shows the success state (setSuccess(true)).

config.toml invariants:
  (T1) [functions.auth-reset-password] verify_jwt = false.
  (T2) [functions.auth-reset-password-confirm] verify_jwt = false.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/reset_password_logged_path_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT    = Path(__file__).resolve().parents[2]
REQ     = ROOT / "supabase" / "functions" / "auth-reset-password" / "index.ts"
CONFIRM = ROOT / "supabase" / "functions" / "auth-reset-password-confirm" / "index.ts"
FORGOT  = ROOT / "components" / "auth" / "ForgotPassword.tsx"
RPS     = ROOT / "components" / "auth" / "ResetPasswordScreen.tsx"
CFG     = ROOT / "supabase" / "config.toml"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    req     = read(REQ)
    confirm = read(CONFIRM)
    forgot  = read(FORGOT)
    rps     = read(RPS)
    cfg     = read(CFG)

    # Isolate the idempotency_key expression for the no-token-leak check.
    idem = ""
    m = re.search(r"idempotency_key:[^\n]*", req)
    if m:
        idem = m.group(0)

    checks: list[tuple[str, bool, str]] = []

    checks.append(("R1 reads SEND_EMAIL_INTERNAL_TOKEN",
                   'Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN")' in req, ""))
    checks.append(("R2 posts to /functions/v1/send-email",
                   "/functions/v1/send-email" in req, ""))
    checks.append(("R3 send-email bearer = internal token",
                   "Bearer ${SEND_EMAIL_TOKEN}" in req, ""))
    checks.append(("R4 no inline Resend call",
                   "api.resend.com" not in req, "must send via send-email, not inline Resend"))
    checks.append(("R5 uses individual.password_reset template",
                   '"individual.password_reset"' in req, ""))
    checks.append(("R6 service-role NOT used as send-email bearer",
                   "Bearer ${SUPABASE_SERVICE_ROLE}" not in req, ""))
    checks.append(("R7 service-role still used for admin client",
                   "createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE" in req, ""))
    checks.append(("R8 idempotency key non-sensitive (no token fragment)",
                   ("crypto.randomUUID()" in idem and "pwreset:" in idem
                    and "hashed_token" not in idem and "${token}" not in idem),
                   f"idem line: {idem!r}"))
    leaky = ["No account found", "not found", "does not exist", "doesn't exist", "no account with"]
    checks.append(("R9 enumeration-safe uniform response",
                   ("GENERIC_OK" in req and req.count("json(GENERIC_OK)") >= 2
                    and not any(s.lower() in req.lower() for s in leaky)),
                   "must return one uniform body on both branches; no existence copy"))

    checks.append(("C1 confirm updates via admin updateUserById",
                   "updateUserById" in confirm, ""))
    checks.append(("C2 confirm enforces min password length",
                   "new_password.length < 8" in confirm, ""))
    checks.append(("C3 confirm preserves 2FA/PIN (no user_security write)",
                   ("user_security" in confirm
                    and ".from('user_security')" not in confirm
                    and '.from("user_security")' not in confirm),
                   "must not write user_security"))

    checks.append(("F1 frontend has no enumeration copy",
                   ("No account found" not in forgot and "User not found" not in forgot),
                   "remove account-existence copy"))
    checks.append(("F2 frontend still shows success state",
                   "setSuccess(true)" in forgot, ""))

    t1 = bool(re.search(r"\[functions\.auth-reset-password\][^\[]*verify_jwt\s*=\s*false", cfg, re.S))
    t2 = bool(re.search(r"\[functions\.auth-reset-password-confirm\][^\[]*verify_jwt\s*=\s*false", cfg, re.S))
    checks.append(("T1 config pins auth-reset-password verify_jwt=false", t1, ""))
    checks.append(("T2 config pins auth-reset-password-confirm verify_jwt=false", t2, ""))

    # Reset-link contract (the broken-link fix)
    checks.append(("L1 auth-reset-password emails GoTrue action_link",
                   "properties?.action_link" in req or "properties.action_link" in req,
                   "must email data.properties.action_link"))
    checks.append(("L2 no hand-built #access_token=${...} fragment in code",
                   "#access_token=${" not in req,
                   "must not hand-build the recovery fragment (interpolated)"))
    checks.append(("RPS1 reset screen does NOT pre-validate on mount with { token }",
                   "JSON.stringify({ token })" not in rps,
                   "mount-time confirm POST of { token } must be removed"))
    checks.append(("RPS2 submit sends { access_token, new_password }",
                   ("access_token: resetToken" in rps and "new_password: newPassword" in rps),
                   "submit must send the access_token + new_password shape"))
    checks.append(("RPS3 reset screen reads token from URL hash",
                   "window.location.hash" in rps,
                   "must capture the recovery token from the hash"))

    print("reset_password_logged_path_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
