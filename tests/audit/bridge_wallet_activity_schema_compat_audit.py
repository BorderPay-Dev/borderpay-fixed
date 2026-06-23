#!/usr/bin/env python3
"""
Audit wallet-activity ingestion compatibility for Bridge payloads where
customer_id may be absent (for example direct_deposit history events).

Run: python3 tests/audit/bridge_wallet_activity_schema_compat_audit.py
Exit 0 = pass, 1 = fail.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "supabase" / "functions" / "process-pending-events" / "index.ts"


def main() -> int:
    if not SRC.exists():
        print(f"bridge_wallet_activity_schema_compat_audit: missing source {SRC}")
        return 1

    code = SRC.read_text(encoding="utf-8")

    checks = [
        (
            "C1 wallet handler no longer hard-requires customer_id",
            "if (!walletId || !customer) throw new Error(\"bridge wallet event missing ids\")" not in code,
            "legacy wallet+customer hard requirement still present",
        ),
        (
            "C2 payload customer path still supported",
            "const payloadCustomer = d?.customer_id ?? d?.customer?.id ?? d?.bridge_customer_id ?? d?.bridge_wallet?.customer_id;" in code,
            "customer extraction from payload missing",
        ),
        (
            "C3 customer-present path still resolves via bridge_customer_id mapping",
            "const owner = await resolveOwnerFromBridgeCustomer(customer);" in code,
            "resolveOwnerFromBridgeCustomer(customer) path missing",
        ),
        (
            "C4 missing-customer fallback queries canonical wallet mapping",
            '.from("bridge_wallets")' in code
            and '.select("bridge_customer_id,user_id,business_user_id")' in code
            and '.eq("bridge_wallet_id", String(walletId))' in code,
            "bridge_wallets fallback lookup missing",
        ),
        (
            "C5 unknown wallet mapping completes with reconciliation_required (no retry loop)",
            'reconciliation_required: "wallet_activity_missing_customer_mapping"' in code
            and 'await supabase.rpc("complete_pending_event"' in code,
            "reconciliation-safe completion for unknown wallet_id missing",
        ),
        (
            "C6 duplicate replay remains idempotent on wallet projection",
            '{ onConflict: "bridge_wallet_id" }' in code,
            "wallet projection upsert conflict key missing",
        ),
    ]

    print("bridge_wallet_activity_schema_compat_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f" -> {detail}"))
        ok = ok and passed

    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
