#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def check(name: str, condition: bool, message: str) -> bool:
    if condition:
        print(f"[OK] {name}")
        return True
    print(f"[FAIL] {name}: {message}")
    return False


def main() -> int:
    worker = read("supabase/functions/process-pending-events/index.ts")
    migration = read("supabase/migrations/20260624202000_operator_bridge_account_exclusions.sql")

    provision_start = worker.find("async function ensureStablecoinWalletsProvisioned")
    provision_end = worker.find("\nasync function ", provision_start + 1) if provision_start >= 0 else -1
    provision = worker[
        provision_start : provision_end if provision_end >= 0 else len(worker)
    ] if provision_start >= 0 else ""

    capture_pos = provision.find("const { data: operatorRow, error: operatorLookupError }")
    lookup_pos = provision.find('.from("operator_bridge_accounts")', capture_pos)
    active_filter_pos = provision.find('.eq("active", true)', lookup_pos)
    maybe_single_pos = provision.find(".maybeSingle()", active_filter_pos)
    error_guard_pos = provision.find("if (operatorLookupError)", maybe_single_pos)
    error_throw_pos = provision.find(
        "operator_bridge_accounts lookup failed", error_guard_pos
    )
    operator_guard_pos = provision.find(
        "if (operatorRow?.bridge_customer_id)", error_throw_pos
    )
    operator_return_pos = provision.find("return;", operator_guard_pos)
    profile_pos = provision.find("const profileTable", operator_return_pos)
    lock_pos = provision.find("tryAcquireProvisioningLock(", profile_pos)
    wallet_create_pos = provision.find("bridgeProvider.createWallet(", lock_pos)

    checks = [
        check(
            "operator registry migration exists",
            "create table if not exists public.operator_bridge_accounts" in migration,
            "operator_bridge_accounts table is missing",
        ),
        check(
            "authoritative operator account is configured",
            "89a7491e-8592-4d23-bb4f-3870f2ddd73b" in migration
            and "operator_partner_admin" in migration,
            "operator lifecycle-exclusion configuration is missing",
        ),
        check(
            "operator lookup is active-only",
            "is_operator_bridge_customer" in migration and "o.active = true" in migration,
            "active-only helper contract is missing",
        ),
        check(
            "operator registry lookup captures data and error",
            capture_pos >= 0
            and lookup_pos > capture_pos
            and active_filter_pos > lookup_pos
            and maybe_single_pos > active_filter_pos,
            "operator lookup must capture operatorRow and operatorLookupError",
        ),
        check(
            "operator lookup errors fail closed before provisioning",
            error_guard_pos > maybe_single_pos
            and error_throw_pos > error_guard_pos
            and operator_guard_pos > error_throw_pos
            and profile_pos > operator_guard_pos
            and lock_pos > profile_pos
            and wallet_create_pos > lock_pos,
            "lookup errors must throw before row checks, profile reads, locks, or wallet creation",
        ),
        check(
            "active operator accounts skip provisioning",
            operator_guard_pos >= 0
            and operator_return_pos > operator_guard_pos
            and profile_pos > operator_return_pos,
            "active operator guard must return before customer provisioning",
        ),
        check(
            "successful non-operator lookup continues normally",
            profile_pos > operator_return_pos
            and lock_pos > profile_pos
            and wallet_create_pos > lock_pos,
            "non-operator path must retain eligibility, lock, and wallet creation flow",
        ),
    ]

    if not all(checks):
        print("\noperator_account_exclusion_audit: FAIL")
        return 1
    print("\noperator_account_exclusion_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
