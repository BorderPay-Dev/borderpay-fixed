#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sql = (ROOT / "supabase/migrations/20260828113000_restore_admin_wallet_metrics_and_fee_catalog.sql").read_text()
revenue_sql = (ROOT / "supabase/migrations/20260828114000_restore_admin_revenue_metrics_access.sql").read_text()

checks = {
    "admin metrics remains unavailable to anon": "from public, anon" in sql,
    "authenticated admins can execute guarded metrics RPC": "to authenticated, service_role" in sql,
    "external fiat catalogue is percentage based": all(token in sql for token in (
        "product = 'bridge_external_fiat_transfer'",
        "borderpay_markup_fixed = 0",
        "borderpay_markup_percent = 2.0",
    )),
    "legacy fixed transfer row is removed": "product = 'transfer_fee'" in sql,
    "retired Flutterwave rows are removed": "product like 'flutterwave\\_%'" in sql,
    "guarded revenue metrics access is restored": all(token in revenue_sql for token in (
        "admin_terminal_settled_revenue_summary()",
        "from public, anon",
        "to authenticated, service_role",
    )),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'PASS' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit(1)
print("admin_wallet_metrics_permission_and_fee_catalog_audit: PASS")
