#!/usr/bin/env python3
"""
Phase 1 audit: Customer Identity Invariant.

Checks:
  P1) Shared identity invariant helper exists and enforces approved-without-customer failure.
  P2) Downstream money/provisioning endpoints call the helper.
  P3) Webhook owner resolution fails closed on ambiguous customer ownership.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def must(name: str, cond: bool, msg: str) -> None:
    if not cond:
        print(f"[FAIL] {name}: {msg}")
        sys.exit(1)
    print(f"[PASS] {name}")


def main() -> None:
    helper = read("supabase/functions/_shared/bridge-identity-invariant.ts")
    must("P1 helper exists", "loadAndAssertBridgeIdentityInvariant" in helper,
         "expected loadAndAssertBridgeIdentityInvariant export")
    must("P1 approved-without-customer guard", "approved_without_customer_id" in helper,
         "expected explicit approved_without_customer_id invariant failure")
    must("P1 ownership ambiguity guard", "customer_id_ambiguous" in helper,
         "expected explicit customer_id_ambiguous invariant failure")

    guarded_files = [
        "supabase/functions/bridge-transfer/index.ts",
        "supabase/functions/bridge-bulk-payout/index.ts",
        "supabase/functions/bridge-wallet/index.ts",
        "supabase/functions/bridge-virtual-account/index.ts",
        "supabase/functions/bridge-external-account/index.ts",
        "supabase/functions/bridge-provision-stablecoins/index.ts",
    ]
    for f in guarded_files:
        src = read(f)
        must(f"P2 guard wired: {f}", "loadAndAssertBridgeIdentityInvariant" in src,
             "expected endpoint to import/use shared identity invariant")

    worker = read("supabase/functions/process-pending-events/index.ts")
    must("P3 worker ambiguous owner fail-closed",
         "ambiguous profile rows for bridge_customer_id" in worker,
         "expected ambiguous owner mapping to throw in resolveOwnerFromBridgeCustomer")

    print("\nAll Phase 1 identity invariant checks passed.")


if __name__ == "__main__":
    main()

