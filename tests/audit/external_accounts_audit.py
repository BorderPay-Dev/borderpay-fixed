#!/usr/bin/env python3
"""
Bridge external-accounts v1 audit (PR D).

This PR ships SOURCE ONLY — feature flag default OFF, edge function not
deployed, migration not applied. The audit asserts the feature is inert
and correctly gated, and that no live activation slipped in.

Invariants:

  (G1) utils/featureFlags.ts exports EXTERNAL_ACCOUNTS_LIVE and its
       default value is `false`.

  (G2) MainApp gates BOTH external-account routes on EXTERNAL_ACCOUNTS_LIVE
       (each case bails when the flag is false).

  (G3) MainApp only passes onOpenPayoutAccounts to AppShell when
       EXTERNAL_ACCOUNTS_LIVE is true (the drawer entry is gated).

  (R1) v1 rail scope is exactly US (USD) + IBAN (EUR). The forbidden
       v1.1 account types (clabe / pix / swift / gb / bre_b /
       co_bank_transfer) must NOT appear in the edge function or the
       Add screen.

  (M1) The migration file exists, creates public.bridge_external_accounts,
       and enables RLS with an owner policy.

  (S1) The edge function enforces the KYC-approved gate
       (bridge_kyc_status === 'approved') and the country gate
       (isBridgeBlocked).

Non-runtime: parses source via regex. No build, no Bridge call, no DB.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FLAGS    = ROOT / "utils" / "featureFlags.ts"
MAINAPP  = ROOT / "components" / "app" / "MainApp.tsx"
EDGE     = ROOT / "supabase" / "functions" / "bridge-external-account" / "index.ts"
ADD_SCR  = ROOT / "components" / "payouts" / "AddExternalAccountScreen.tsx"
MIGR     = ROOT / "supabase" / "migrations" / "20260529_bridge_external_accounts.sql"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def read(p: Path) -> str:
    if not p.is_file():
        fail(f"missing file: {p}")
    return p.read_text(encoding="utf-8")


def main() -> int:
    flags   = read(FLAGS)
    mainapp = read(MAINAPP)
    edge    = read(EDGE)
    add_scr = read(ADD_SCR)
    migr    = read(MIGR)

    # (G1)
    m = re.search(r"export\s+const\s+EXTERNAL_ACCOUNTS_LIVE\s*:\s*boolean\s*=\s*(true|false)", flags)
    if not m:
        fail("G1: EXTERNAL_ACCOUNTS_LIVE not exported with explicit boolean default")
    if m.group(1) != "false":
        fail(f"G1: EXTERNAL_ACCOUNTS_LIVE must default to false (got {m.group(1)})")

    # (G2) both routes gate on the flag
    for route in ("external-accounts", "add-external-account"):
        if f"case '{route}':" not in mainapp:
            fail(f"G2: MainApp missing case '{route}'")
    # Each case must reference EXTERNAL_ACCOUNTS_LIVE near its body.
    # Heuristic: the substring "!EXTERNAL_ACCOUNTS_LIVE" appears at least twice
    # (once per route guard).
    if mainapp.count("!EXTERNAL_ACCOUNTS_LIVE") < 2:
        fail("G2: both external-account routes must early-return when "
             "!EXTERNAL_ACCOUNTS_LIVE (expected >= 2 guards)")

    # (G3) drawer callback gated
    if not re.search(r"onOpenPayoutAccounts=\{EXTERNAL_ACCOUNTS_LIVE\s*\?", mainapp):
        fail("G3: onOpenPayoutAccounts must be passed only when EXTERNAL_ACCOUNTS_LIVE")

    # (R1) rail scope: us + iban only. Forbidden v1.1 account types must not
    # appear as QUOTED account_type literals. We match quoted forms only, so
    # legitimate field names like `bic_swift` and labels like "BIC / SWIFT"
    # (valid for IBAN) do not trip the check.
    forbidden = ["clabe", "pix", "swift", "gb", "bre_b", "co_bank_transfer"]
    for tok in forbidden:
        for q in (f"'{tok}'", f'"{tok}"'):
            if q in edge:
                fail(f"R1: forbidden v1.1 account_type literal {q} present in edge function")
            if q in add_scr:
                fail(f"R1: forbidden v1.1 account_type literal {q} present in Add screen")
    # Must support both us and iban.
    if "'us'" not in edge or "'iban'" not in edge:
        fail("R1: edge function must support both 'us' and 'iban' account types")

    # (M1) migration shape
    if "create table" not in migr.lower() or "public.bridge_external_accounts" not in migr:
        fail("M1: migration must create public.bridge_external_accounts")
    if "enable row level security" not in migr.lower():
        fail("M1: migration must enable RLS")
    if "external_accounts_own" not in migr:
        fail("M1: migration must define the external_accounts_own RLS policy")

    # (S1) edge gates
    if "bridge_kyc_status" not in edge or "approved" not in edge:
        fail("S1: edge function must enforce the KYC-approved gate")
    if "isBridgeBlocked" not in edge:
        fail("S1: edge function must enforce the country gate via isBridgeBlocked")

    print("OK: external-accounts v1 is source-only and correctly gated.")
    print("    G1 flag default false; G2 both routes flag-gated; "
          "G3 drawer gated; R1 rails = us+iban only; "
          "M1 migration + RLS present; S1 KYC+country gates present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
