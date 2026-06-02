#!/usr/bin/env python3
"""
Email P0 — logged-send-path audit.

Problem: email delivery was UNPROVEN. The deployed senders (auth-signup,
auth-resend-verification) called `send-confirmation-email`, which does NOT write
public.email_log. Result: email_log had 0 rows for 78 users — no way to prove or
debug whether verification/resend emails were delivered.

This PR re-points the two editable callers through the unified `send-email`
function, which writes email_log BEFORE calling Resend (via the
log_email_attempt RPC) and records status / Resend message id / error / attempts
/ idempotency key.

Invariants (fail closed):

  (E1) send-email writes email_log BEFORE the provider (Resend) call:
       log_email_attempt (the pre-write RPC) appears before api.resend.com in
       supabase/functions/send-email/index.ts.

  (E2) send-email records the required fields on success/failure:
       status, resend_id, last_error, attempts (column writes present).

  (S1) auth-signup sends via the LOGGED path: it POSTs to /functions/v1/send-email
       and no longer to /functions/v1/send-confirmation-email.

  (S2) auth-resend-verification sends via the LOGGED path: POSTs to
       /functions/v1/send-email and not to send-confirmation-email.

  (B1) Behaviour preserved — signup does NOT block on email failure:
       on a failed send auth-signup returns success:true with
       email_sent:false + email_error (account already created).

  (B2) Resend stays rate-limited: auth-resend-verification still calls
       issue_email_token (server-side cooldown/cap) before sending.

  (B3) Forgot-password remains account-enumeration safe: auth-resend-verification
       returns a soft success for unknown emails (no leak) — guarded BEFORE the
       send. (auth-reset-password/-confirm are deployed-only, NOT in this repo;
       re-pointing them is a flagged follow-up, asserted out-of-scope here.)

  (C1) send-email is pinned verify_jwt=false in config.toml (public route,
       service-role gated in-code).

  (G1) Idempotency key is passed on both callers' send-email calls.

Non-runtime: parses source as text. No deploy, no DB, no provider call.

Run: python3 tests/audit/email_p0_logged_path_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT   = Path(__file__).resolve().parents[2]
SEND   = ROOT / "supabase" / "functions" / "send-email" / "index.ts"
SIGNUP = ROOT / "supabase" / "functions" / "auth-signup" / "index.ts"
RESEND = ROOT / "supabase" / "functions" / "auth-resend-verification" / "index.ts"
CONF   = ROOT / "supabase" / "config.toml"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    send   = read(SEND)
    signup = read(SIGNUP)
    resend = read(RESEND)
    conf   = read(CONF)

    checks: list[tuple[str, bool, str]] = []

    # E1 — pre-write before provider call
    i_log = send.find("log_email_attempt")
    i_res = send.find("api.resend.com")
    checks.append(("E1 send-email writes email_log before Resend call",
                   i_log != -1 and i_res != -1 and i_log < i_res,
                   "log_email_attempt must precede api.resend.com"))

    # E2 — records required fields
    e2 = all(tok in send for tok in ['status:', 'resend_id', 'last_error', 'attempts'])
    checks.append(("E2 send-email records status/resend_id/last_error/attempts", e2,
                   "missing one of the email_log status fields"))

    # S1 — auth-signup uses logged path, not the unlogged one
    checks.append(("S1 auth-signup POSTs to /functions/v1/send-email",
                   "/functions/v1/send-email" in signup
                   and "/functions/v1/send-confirmation-email" not in signup,
                   "auth-signup must call send-email and not send-confirmation-email"))

    # S2 — resend uses logged path
    checks.append(("S2 auth-resend-verification POSTs to /functions/v1/send-email",
                   "/functions/v1/send-email" in resend
                   and "/functions/v1/send-confirmation-email" not in resend,
                   "resend must call send-email and not send-confirmation-email"))

    # B1 — signup does not block on email failure
    # On failed send, returns success:true + email_sent:false + email_error.
    b1 = ("email_sent:" in signup) and ("email_error:" in signup) \
         and bool(re.search(r"success:\s*true", signup))
    checks.append(("B1 signup returns success + email_sent:false on send failure", b1,
                   "signup must not roll back the account on email failure"))

    # B2 — resend still rate-limited
    checks.append(("B2 resend still calls issue_email_token (rate limit)",
                   "issue_email_token" in resend,
                   "resend must keep the server-side rate limiter"))

    # B3 — enumeration safe: soft success for unknown email, before send
    i_noop   = resend.find('reason: "no_op"')
    i_send   = resend.find("/functions/v1/send-email")
    checks.append(("B3 resend is enumeration-safe (soft success before send)",
                   i_noop != -1 and i_send != -1 and i_noop < i_send,
                   "unknown-email soft success must occur before the send"))

    # C1 — config pin
    c1 = bool(re.search(r"\[functions\.send-email\][^\[]*verify_jwt\s*=\s*false", conf, re.S))
    checks.append(("C1 send-email pinned verify_jwt=false in config.toml", c1,
                   "missing [functions.send-email] verify_jwt=false"))

    # G1 — idempotency keys passed
    checks.append(("G1 idempotency_key passed by both callers",
                   "idempotency_key" in signup and "idempotency_key" in resend,
                   "both callers must pass idempotency_key to send-email"))

    print("email_p0_logged_path_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
