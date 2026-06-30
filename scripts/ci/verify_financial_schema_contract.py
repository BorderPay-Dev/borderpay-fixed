#!/usr/bin/env python3
"""
Fail-fast financial schema/read-model contract gate.

Checks:
- required tables/columns exist in linked production schema
- required RPCs exist and return expected types
- nullable-sensitive fields are handled in canonical read-model/UI code
- financial UI files do not duplicate inline ownership-or filters
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

REQUIRED_TABLE_COLUMNS: dict[str, set[str]] = {
    "bridge_balance_ledger": {
        "id", "event_id", "entity_type", "entity_id", "user_id", "business_user_id",
        "currency", "amount_minor", "direction", "metadata", "created_at",
    },
    "bridge_wallets": {
        "id", "user_id", "business_user_id", "bridge_wallet_id", "currency", "chain", "address", "status",
    },
    "bridge_virtual_accounts": {
        "id", "user_id", "business_user_id", "bridge_virtual_account_id", "currency", "status", "account_details",
    },
    "bridge_external_accounts": {
        "id", "user_id", "bridge_external_account_id", "account_type", "currency", "status", "metadata", "created_at",
    },
    "notifications": {
        "id", "user_id", "title", "body", "read", "created_at",
    },
    "user_profiles": {
        "id", "phone", "postal_code", "address", "bridge_address_object",
        "bridge_kyc_status", "bridge_account_status",
    },
}

REQUIRED_RPCS: dict[str, str] = {
    "apply_bridge_va_credit": "TABLE(",
    "upsert_bridge_transaction": "uuid",
}

NO_INLINE_OWNERSHIP_FILES = [
    "utils/api/backendAPI.ts",
    "components/app/Dashboard.tsx",
    "components/wallet/WalletScreen.tsx",
    "components/transactions/TransactionsScreen.tsx",
    "components/profile/ProfileScreen.tsx",
    "components/send/SendMoneyFlow.tsx",
    "components/receive/ReceiveMoneyScreen.tsx",
    "components/notifications/NotificationsScreen.tsx",
    "components/notifications/NotificationBell.tsx",
    "components/payouts/ExternalAccountsScreen.tsx",
    "components/payouts/AddExternalAccountScreen.tsx",
]

NULLABLE_GUARD_PATTERNS = [
    ("utils/api/backendAPI.ts", r"row\?\.\s*metadata\s*\|\|\s*\{\}"),
    ("components/profile/ProfileScreen.tsx", r"address_object\s*\|\|\s*null"),
    ("components/notifications/NotificationsScreen.tsx", r"n\.body\s*\|\|\s*n\.message\s*\|\|"),
]


def run_json(sql: str) -> dict:
    compact_sql = " ".join(sql.split())
    cmd = [
        "/bin/zsh", "-lc",
        f"cd {ROOT} && SUPABASE_DISABLE_TELEMETRY=1 supabase db query --linked -o json {json.dumps(compact_sql)}",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "supabase db query failed")
    out = proc.stdout
    start = out.find("{")
    if start < 0:
        raise RuntimeError("no JSON output from supabase db query")
    return json.loads(out[start:])


def fail(msg: str) -> int:
    print(f"[FAIL] {msg}")
    return 1


def main() -> int:
    failures = 0

    cols = run_json(
        "select table_name, column_name, is_nullable from information_schema.columns "
        "where table_schema='public';"
    ).get("rows", [])
    col_map: dict[str, set[str]] = {}
    nullable_map: dict[tuple[str, str], str] = {}
    for r in cols:
        table = r["table_name"]
        col = r["column_name"]
        col_map.setdefault(table, set()).add(col)
        nullable_map[(table, col)] = str(r.get("is_nullable", "")).upper()

    for table, required_cols in REQUIRED_TABLE_COLUMNS.items():
        if table not in col_map:
            failures += fail(f"missing required table: {table}")
            continue
        missing = sorted(required_cols - col_map[table])
        if missing:
            failures += fail(f"table {table} missing columns: {missing}")
        else:
            print(f"[OK] table {table} contract columns present")

    # nullable contract checks
    nullable_expected = [
        ("user_profiles", "bridge_address_object"),
        ("user_profiles", "phone"),
        ("user_profiles", "postal_code"),
    ]
    for table, col in nullable_expected:
        if nullable_map.get((table, col), "NO") != "YES":
            failures += fail(f"expected nullable column {table}.{col} to remain nullable")
        else:
            print(f"[OK] nullable contract preserved for {table}.{col}")

    rpc_rows = run_json(
        "select p.proname, pg_get_function_result(p.oid) as result_type "
        "from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public';"
    ).get("rows", [])
    rpc_map = {r["proname"]: str(r.get("result_type") or "") for r in rpc_rows}
    for rpc, expected_result in REQUIRED_RPCS.items():
        actual = rpc_map.get(rpc)
        if not actual:
            failures += fail(f"missing required RPC: {rpc}")
            continue
        if expected_result.lower() not in actual.lower():
            failures += fail(f"RPC return type mismatch for {rpc}: expected contains '{expected_result}', got '{actual}'")
        else:
            print(f"[OK] RPC {rpc} return type {actual}")

    inline_owner_re = re.compile(r"user_id\.eq\.\$\{[^}]+\},business_user_id\.eq\.\$\{[^}]+\}")
    for rel in NO_INLINE_OWNERSHIP_FILES:
        p = ROOT / rel
        if not p.exists():
            failures += fail(f"missing file for ownership scan: {rel}")
            continue
        txt = p.read_text(encoding="utf-8")
        if inline_owner_re.search(txt):
            failures += fail(f"inline ownership filter found in {rel}; use resolveFinancialOwner()/ownerOrFilter()")
        else:
            print(f"[OK] no inline ownership duplication in {rel}")

    for rel, pattern in NULLABLE_GUARD_PATTERNS:
        p = ROOT / rel
        txt = p.read_text(encoding="utf-8") if p.exists() else ""
        if not re.search(pattern, txt):
            failures += fail(f"nullable-field guard missing in {rel}: /{pattern}/")
        else:
            print(f"[OK] nullable-field guard present in {rel}")

    # Contract consumption check: key screens must use canonical snapshot
    must_use_snapshot = {
        "components/app/Dashboard.tsx": "backendAPI.financial.getSnapshot",
        "components/wallet/WalletScreen.tsx": "backendAPI.financial.getSnapshot",
        "components/transactions/TransactionsScreen.tsx": "backendAPI.financial.getSnapshot",
        "components/profile/ProfileScreen.tsx": "backendAPI.financial.getSnapshot",
        "components/send/SendMoneyFlow.tsx": "backendAPI.financial.getSnapshot",
        "components/receive/ReceiveMoneyScreen.tsx": "backendAPI.financial.getSnapshot",
        "components/notifications/NotificationsScreen.tsx": "backendAPI.financial.getSnapshot",
        "components/notifications/NotificationBell.tsx": "backendAPI.financial.getSnapshot",
        "components/payouts/ExternalAccountsScreen.tsx": "backendAPI.financial.getSnapshot",
        "components/payouts/AddExternalAccountScreen.tsx": "backendAPI.financial.getSnapshot",
    }
    for rel, needle in must_use_snapshot.items():
        txt = (ROOT / rel).read_text(encoding="utf-8")
        if needle not in txt:
            failures += fail(f"canonical read-model not consumed in {rel}")
        else:
            print(f"[OK] canonical read-model consumed in {rel}")

    forbidden_direct_financial_reads = [
        ("components/notifications/NotificationsScreen.tsx", "backendAPI.notifications.getNotifications"),
        ("components/notifications/NotificationBell.tsx", "backendAPI.notifications.getNotifications"),
        ("components/notifications/NotificationBell.tsx", "backendAPI.notifications.getUnreadCount"),
        ("components/send/SendMoneyFlow.tsx", "backendAPI.bridge.externalAccount.capabilities"),
        ("components/payouts/AddExternalAccountScreen.tsx", "backendAPI.bridge.externalAccount.capabilities"),
        ("components/app/MainApp.tsx", "backendAPI.bridge.externalAccount.capabilities"),
        ("components/app/MainApp.tsx", "backendAPI.notifications.getUnreadCount"),
    ]
    for rel, needle in forbidden_direct_financial_reads:
        txt = (ROOT / rel).read_text(encoding="utf-8")
        if needle in txt:
            failures += fail(f"forbidden direct financial read in {rel}: {needle}")
        else:
            print(f"[OK] no forbidden direct read in {rel}: {needle}")

    if failures:
        print(f"\nfinancial_schema_contract: FAIL ({failures} checks)")
        return 1
    print("\nfinancial_schema_contract: PASS")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"financial_schema_contract: FAIL (error={exc})")
        sys.exit(1)
