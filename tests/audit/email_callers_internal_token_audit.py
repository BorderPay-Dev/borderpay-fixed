#!/usr/bin/env python3
"""
Email callers internal-token audit.

After send-email's HTTP gate moved from the service-role key to the dedicated
SEND_EMAIL_INTERNAL_TOKEN, the two callers MUST send that token (not the
service-role key, not a missing header) when invoking send-email — otherwise
every signup/resend email 401s.

Per-caller invariants (auth-signup, auth-resend-verification):

  (C1) reads SEND_EMAIL_INTERNAL_TOKEN from env.
  (C2) still POSTs to /functions/v1/send-email (logged path).
  (C3) the send-email call's Authorization uses the internal token
       (Bearer ${SEND_EMAIL_TOKEN}).
  (C4) the send-email call does NOT use the service-role key as the bearer
       (no `Bearer ${SUPABASE_SERVICE_ROLE}` anywhere in the file).
  (C5) the service-role key is STILL used for the admin DB client
       (createClient(..., SUPABASE_SERVICE_ROLE, ...)).
  (C6) does NOT fall back to the unlogged send-confirmation-email.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/email_callers_internal_token_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CALLERS = {
    "auth-signup": ROOT / "supabase" / "functions" / "auth-signup" / "index.ts",
    "auth-resend-verification": ROOT / "supabase" / "functions" / "auth-resend-verification" / "index.ts",
}


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    checks: list[tuple[str, bool, str]] = []

    for name, path in CALLERS.items():
        src = read(path)

        checks.append((f"[{name}] C1 reads SEND_EMAIL_INTERNAL_TOKEN",
                       'Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN")' in src,
                       "must read the internal token from env"))

        checks.append((f"[{name}] C2 posts to /functions/v1/send-email",
                       "/functions/v1/send-email" in src,
                       "must call the logged send-email path"))

        checks.append((f"[{name}] C3 send-email bearer = internal token",
                       "Bearer ${SEND_EMAIL_TOKEN}" in src,
                       "Authorization to send-email must use SEND_EMAIL_TOKEN"))

        checks.append((f"[{name}] C4 service-role NOT used as bearer",
                       "Bearer ${SUPABASE_SERVICE_ROLE}" not in src,
                       "service-role must not be sent as the HTTP bearer"))

        checks.append((f"[{name}] C5 service-role still used for admin client",
                       "createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE" in src,
                       "admin DB client must still use the service-role key"))

        checks.append((f"[{name}] C6 no send-confirmation-email fallback",
                       "/functions/v1/send-confirmation-email" not in src,
                       "must not call the unlogged send-confirmation-email"))

    print("email_callers_internal_token_audit:")
    ok = True
    for cname, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {cname}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
