#!/usr/bin/env python3
"""
send-email internal-token auth-gate audit (Step 2 of the send-email auth fix).

Incident: send-email gated its HTTP caller by comparing the bearer to
SUPABASE_SERVICE_ROLE_KEY. That (a) made the all-powerful DB admin key double as
the email sender's HTTP password, and (b) broke in practice when the runtime's
service-role value didn't byte-match the caller's key. Fix: gate on a dedicated
SEND_EMAIL_INTERNAL_TOKEN; keep the service-role key ONLY for the admin DB client.

Invariants (fail closed):

  (A1) send-email reads SEND_EMAIL_INTERNAL_TOKEN from env.
  (A2) The HTTP auth gate compares the bearer to the INTERNAL token.
  (A3) The HTTP auth gate does NOT compare the bearer to the service-role key
       (service-role is no longer the HTTP password).
  (A4) The service-role key IS still used to build the admin DB client.
  (A5) Missing internal token fails closed (!INTERNAL_TOKEN -> 401).
  (A6) A constant-time comparison helper is used for the token.
  (A7) The token is never logged (no console.* referencing the token/secret).
  (A8) email_log path preserved (log_email_attempt RPC still called).
  (A9) Resend send path preserved (api.resend.com still called).
  (A10) config.toml still pins [functions.send-email] verify_jwt = false.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/send_email_internal_token_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FN   = ROOT / "supabase" / "functions" / "send-email" / "index.ts"
CFG  = ROOT / "supabase" / "config.toml"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)//.*$", "", src)
    return src


def main() -> int:
    raw = read(FN)
    code = strip_comments(raw)
    cfg = read(CFG)

    # Isolate the auth gate region (from the Authorization read to the 401 return)
    # so service-role checks are scoped to the gate, tested against CODE not prose.
    gate = ""
    m = re.search(r'req\.headers\.get\("Authorization"\).*?\}\s*', code, re.S)
    if m:
        gate = m.group(0)

    checks: list[tuple[str, bool, str]] = []

    checks.append(("A1 reads SEND_EMAIL_INTERNAL_TOKEN",
                   'Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN")' in code,
                   "must read the dedicated internal token from env"))

    checks.append(("A2 gate compares bearer to INTERNAL token",
                   "INTERNAL_TOKEN" in gate and "timingSafeEqualStr(token, INTERNAL_TOKEN)" in gate,
                   "the auth gate must compare the bearer to INTERNAL_TOKEN"))

    checks.append(("A3 gate does NOT use service-role as HTTP password",
                   "SUPABASE_SERVICE_ROLE" not in gate,
                   "service-role must not appear in the auth gate"))

    checks.append(("A4 service-role still used for admin DB client",
                   "createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE" in code,
                   "admin DB client must still be built with the service-role key"))

    checks.append(("A5 missing internal token fails closed",
                   "!INTERNAL_TOKEN" in gate,
                   "an unset internal token must reject all requests"))

    checks.append(("A6 constant-time compare helper present",
                   "function timingSafeEqualStr" in code
                   and "diff |=" in code
                   and bool(re.search(r"for \(let i = 0; i < .*length; i\+\+\) diff \|=", code)),
                   "must use a non-early-exit constant-time comparison"))

    # A7 — token must never be logged.
    logged_token = bool(re.search(r"console\.\w+\([^)]*\b(INTERNAL_TOKEN|token)\b", code))
    checks.append(("A7 token is never logged",
                   not logged_token,
                   "no console.* call may reference the token/secret"))

    checks.append(("A8 email_log path preserved",
                   'rpc("log_email_attempt"' in code,
                   "log_email_attempt RPC must still be called"))

    # NB: check against RAW source — the comment-stripper would treat the "//"
    # in the https:// URL as a line comment and mangle this literal.
    checks.append(("A9 Resend send path preserved",
                   "https://api.resend.com/emails" in raw,
                   "Resend send call must be preserved"))

    pin = bool(re.search(r"\[functions\.send-email\][^\[]*verify_jwt\s*=\s*false", cfg, re.S))
    checks.append(("A10 config pins send-email verify_jwt=false", pin,
                   "config.toml must keep verify_jwt = false for send-email"))

    print("send_email_internal_token_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
