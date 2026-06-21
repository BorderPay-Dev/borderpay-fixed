#!/usr/bin/env python3
"""
PIN atomic-RPC hardening audit.

Checks:
  P1  migration defines atomic PIN RPCs (set/verify/change) and lockout columns use pin_failed_attempts.
  P2  setup-pin uses set_user_pin_v2 + PBKDF2 helper, not legacy sha256 helper.
  P3  verify-pin and change-pin call atomic RPCs (verify_user_pin_atomic / change_user_pin_atomic).
  P4  shared helper exports v2 PBKDF2 derivation + legacy compatibility hash.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FNS = ROOT / "supabase" / "functions"
MIG = ROOT / "supabase" / "migrations" / "20260619103000_security_abuse_and_reconciliation_hardening.sql"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    mig = read(MIG)
    setup_pin = read(FNS / "setup-pin" / "index.ts")
    verify_pin = read(FNS / "verify-pin" / "index.ts")
    change_pin = read(FNS / "change-pin" / "index.ts")
    shared_pin = read(FNS / "_shared" / "security" / "pin.ts")

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "P1 migration has atomic PIN RPCs",
        all(x in mig for x in [
            "create or replace function public.set_user_pin_v2(",
            "create or replace function public.verify_user_pin_atomic(",
            "create or replace function public.change_user_pin_atomic(",
            "pin_failed_attempts",
        ]),
        "expected set_user_pin_v2/verify_user_pin_atomic/change_user_pin_atomic with pin_failed_attempts lockout",
    ))

    checks.append((
        "P2 setup-pin writes v2 via RPC",
        ("derivePinHashV2" in setup_pin and "set_user_pin_v2" in setup_pin and "hashPin(" not in setup_pin),
        "setup-pin should derive PBKDF2 v2 hash and call set_user_pin_v2 (no local sha256 hashPin)",
    ))

    checks.append((
        "P3 verify/change use atomic RPC path",
        ("verify_user_pin_atomic" in verify_pin and "change_user_pin_atomic" in change_pin and
         ".update(updateData)" not in verify_pin and ".update(updateData)" not in change_pin),
        "verify-pin/change-pin should route through atomic RPCs, not manual read-then-write counter updates",
    ))

    checks.append((
        "P4 shared PIN helper present",
        all(x in shared_pin for x in [
            "derivePinHashV2(",
            "derivePinHashV2FromStored(",
            "hashLegacyPin(",
            "PBKDF2",
        ]),
        "missing PBKDF2 v2 helper or legacy-compat hash helper in _shared/security/pin.ts",
    ))

    print("pin_atomic_rpc_hardening_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

