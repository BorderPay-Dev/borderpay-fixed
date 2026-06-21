#!/usr/bin/env python3
"""
Signup abuse protection audit.

Checks:
  S1 migration includes signup_abuse_events + enforce_signup_abuse_protection RPC.
  S2 auth-signup calls abuse RPC before user creation and maps denial to 429.
  S3 CAPTCHA hook exists (env-gated secret + token validation path).
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / "supabase" / "migrations" / "20260619103000_security_abuse_and_reconciliation_hardening.sql"
AUTH_SIGNUP = ROOT / "supabase" / "functions" / "auth-signup" / "index.ts"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    mig = read(MIG)
    signup = read(AUTH_SIGNUP)

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "S1 migration has abuse table + RPC",
        ("create table if not exists public.signup_abuse_events" in mig and
         "create or replace function public.enforce_signup_abuse_protection(" in mig),
        "expected signup_abuse_events + enforce_signup_abuse_protection in migration",
    ))

    checks.append((
        "S2 auth-signup enforces rate limit",
        ("enforce_signup_abuse_protection" in signup and
         "status: 429" in signup and
         "Retry-After" in signup and
         signup.find("enforce_signup_abuse_protection") < signup.find("createUser({")),
        "auth-signup should call abuse RPC before createUser and return 429 with Retry-After on deny",
    ))

    checks.append((
        "S3 CAPTCHA hook exists",
        ("SIGNUP_CAPTCHA_SECRET" in signup and
         "verifySignupCaptcha(" in signup and
         "captcha_token" in signup and
         "captcha_required" in signup),
        "missing env-gated CAPTCHA verification hook in auth-signup",
    ))

    print("signup_abuse_protection_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

