#!/usr/bin/env python3
"""
Legacy send-confirmation-email security audit.

Checks:
  E1 endpoint requires internal bearer token (SEND_EMAIL_INTERNAL_TOKEN) with timing-safe compare.
  E2 endpoint enforces POST-only.
  E3 confirmation_url origin is constrained to BORDERPAY_APP_URL origin.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FN = ROOT / "supabase" / "functions" / "send-confirmation-email" / "index.ts"
CFG = ROOT / "supabase" / "config.toml"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    fn = read(FN)
    cfg = read(CFG)

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "E1 internal token gate",
        ("SEND_EMAIL_INTERNAL_TOKEN" in fn and
         "timingSafeEqualStr" in fn and
         "internal token required" in fn.lower()),
        "missing dedicated internal-token auth gate on legacy endpoint",
    ))

    checks.append((
        "E2 POST-only",
        ("if (req.method !== 'POST')" in fn and "POST only" in fn),
        "legacy endpoint should reject non-POST methods",
    ))

    checks.append((
        "E3 confirmation URL origin allowlist",
        ("BORDERPAY_APP_URL" in fn and "confirmation_url origin not allowed" in fn and ".origin" in fn),
        "confirmation_url should be constrained to BORDERPAY_APP_URL origin",
    ))

    checks.append((
        "E4 config pinned",
        "[functions.send-confirmation-email]" in cfg,
        "supabase/config.toml should pin send-confirmation-email deploy auth settings",
    ))

    print("legacy_email_endpoint_security_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

