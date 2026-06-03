#!/usr/bin/env python3
"""
Profile email-confirmed first-paint audit.

The Profile screen must not show a false "Unconfirmed" badge while waiting for
get-user-profile when the local Supabase session already proves the email is
confirmed. KYC status is already cached/derived at first paint; this keeps email
confirmation equally truthful.

Invariants:
  (P1) SAFE_FIELDS caches email_confirmed + email_confirmed_at.
  (P2) ProfileScreen has a defensive local Supabase session reader for
       email_confirmed_at / confirmed_at.
  (P3) ProfileScreen maps cached and fresh backend profile data through
       deriveEmailConfirmed(), not raw `u.email_confirmed || false`.

Run: python3 tests/audit/profile_email_confirmed_audit.py
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLIENT = ROOT / "utils" / "supabase" / "client.ts"
PROFILE = ROOT / "components" / "profile" / "ProfileScreen.tsx"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    client = read(CLIENT)
    profile = read(PROFILE)
    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "P1 SAFE_FIELDS caches email confirmation fields",
        "'email_confirmed'" in client and "'email_confirmed_at'" in client,
        "SAFE_FIELDS must include email_confirmed and email_confirmed_at",
    ))

    checks.append((
        "P2 ProfileScreen reads local Supabase session confirmation",
        "function readLocalEmailConfirmed()" in profile
        and "sb-.+-auth-token" in profile
        and "email_confirmed_at" in profile
        and "confirmed_at" in profile,
        "ProfileScreen must derive first-paint confirmation from local Supabase session when available",
    ))

    checks.append((
        "P3 cached + fresh mappings use deriveEmailConfirmed",
        profile.count("email_confirmed: deriveEmailConfirmed(u)") >= 2
        and "email_confirmed: u.email_confirmed || false" not in profile,
        "cached and fresh profile mappings must use deriveEmailConfirmed(u), not raw false fallback",
    ))

    print("profile_email_confirmed_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
