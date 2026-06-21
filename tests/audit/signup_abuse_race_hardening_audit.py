#!/usr/bin/env python3
"""
Signup abuse race hardening audit.

Checks:
  R1 hardening migration redefines enforce_signup_abuse_protection.
  R2 function applies advisory locks for email and IP lock keys.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / "supabase" / "migrations" / "20260619123000_queue_orchestration_and_signup_lock_hardening.sql"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    mig = read(MIG)

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "R1 enforce_signup_abuse_protection redefined",
        "create or replace function public.enforce_signup_abuse_protection(" in mig,
        "expected enforce_signup_abuse_protection override in hardening migration",
    ))

    checks.append((
        "R2 advisory locks applied",
        ("pg_advisory_xact_lock" in mig and
         "signup_email:" in mig and
         "signup_ip:" in mig),
        "expected transaction advisory locks to serialize concurrent abuse checks",
    ))

    print("signup_abuse_race_hardening_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
