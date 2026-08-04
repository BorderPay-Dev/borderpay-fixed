#!/usr/bin/env python3
"""Fail-closed structural audit for Bridge operator-account exclusion."""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "supabase/functions/process-pending-events/index.ts"


def main() -> int:
    source = WORKER.read_text(encoding="utf-8") if WORKER.is_file() else ""
    start = source.find("async function ensureStablecoinWalletsProvisioned")
    end = source.find("\nasync function ", start + 1) if start >= 0 else -1
    function_source = source[start : end if end >= 0 else len(source)] if start >= 0 else ""

    lookup_pos = function_source.find('.from("operator_bridge_accounts")')
    active_pos = function_source.find('.eq("active", true)', lookup_pos)
    guard_pos = function_source.find("if (operatorRow?.bridge_customer_id)", active_pos)
    return_pos = function_source.find("return;", guard_pos)
    profile_pos = function_source.find("const profileTable", return_pos)
    provision_pos = function_source.find("for (const { symbol, chain }", return_pos)

    checks = [
        (
            "O1 provisioning function exists",
            bool(function_source),
            "ensureStablecoinWalletsProvisioned is missing",
        ),
        (
            "O2 operator registry lookup is scoped to Bridge customer",
            lookup_pos >= 0
            and '.eq("bridge_customer_id", input.bridgeCustomerId)' in function_source[lookup_pos:],
            "worker must query operator_bridge_accounts by the current bridge_customer_id",
        ),
        (
            "O3 only active operator exclusions apply",
            active_pos >= 0 and ".maybeSingle()" in function_source[active_pos:],
            "worker must require active=true and resolve at most one operator row",
        ),
        (
            "O4 operator guard returns before customer profile/provisioning work",
            guard_pos >= 0
            and return_pos > guard_pos
            and profile_pos > return_pos
            and provision_pos > return_pos,
            "active operator accounts must exit before profile reads and wallet provisioning",
        ),
        (
            "O5 exclusion is registry-driven, not a hardcoded Bridge customer ID",
            "operatorRow?.bridge_customer_id" in function_source
            and "operator_bridge_accounts" in function_source,
            "operator exclusion must be derived from the server-side registry",
        ),
    ]

    failures: list[str] = []
    for name, passed, detail in checks:
        if passed:
            print(f"[OK] {name}")
        else:
            print(f"[FAIL] {name}: {detail}")
            failures.append(name)

    if failures:
        print(f"\noperator_account_exclusion_audit: FAIL ({len(failures)} checks)")
        return 1

    print("\noperator_account_exclusion_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
