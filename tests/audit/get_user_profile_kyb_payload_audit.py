#!/usr/bin/env python3
"""
get-user-profile KYB payload-contract audit.

The deployed get-user-profile returned bridge_kyc_status but OMITTED
bridge_account_status (on user_profiles) and bridge_kyb_status (on
business_profiles), so the frontend deriveKycStatus() never received KYB status —
business KYB display/gating fell through to legacy kyc_status. This audit locks the
corrected payload contract: the function must return all three Bridge status fields,
with bridge_kyb_status sourced from business_profiles for business accounts.

Invariants (fail closed):

  (P1) get-user-profile is under repo source control.
  (P2) the returned payload includes bridge_account_status from user_profiles.
  (P3) the returned payload includes bridge_kyb_status, fetched from
       business_profiles, gated on a business account_type.
  (P4) (regression) the payload still includes bridge_kyc_status.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/get_user_profile_kyb_payload_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FN = ROOT / "supabase" / "functions" / "get-user-profile" / "index.ts"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    src = read(FN)
    checks: list[tuple[str, bool, str]] = []

    checks.append(("P1 get-user-profile under repo source control",
                   bool(src) and "Deno.serve(" in src,
                   "supabase/functions/get-user-profile/index.ts must exist"))

    checks.append(("P2 payload returns bridge_account_status (user_profiles)",
                   "bridge_account_status: profile?.bridge_account_status" in src,
                   "return object must include bridge_account_status from the user_profiles row"))

    p3 = ("bridge_kyb_status:" in src
          and "bridgeKybStatus" in src
          and '.from("business_profiles")' in src
          and '.select("bridge_kyb_status")' in src
          and 'accountType === "business"' in src)
    checks.append(("P3 payload returns bridge_kyb_status from business_profiles (business)",
                   p3,
                   "must fetch business_profiles.bridge_kyb_status for business accounts and return it"))

    checks.append(("P4 payload still returns bridge_kyc_status (regression)",
                   "bridge_kyc_status:   profile?.bridge_kyc_status || null" in src,
                   "existing bridge_kyc_status field must be preserved"))

    print("get_user_profile_kyb_payload_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
