#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL = (ROOT / "supabase/migrations/20260819123000_provider_revenue_native_currency_summary.sql").read_text(encoding="utf-8")

checks = {
    "summary is admin guarded": "not public.is_borderpay_admin()" in SQL,
    "only live immutable ledger rows are used": "from public.provider_revenue_events" in SQL and "environment = 'live'" in SQL,
    "currencies are not combined without FX": "group by upper(fee_currency)" in SQL,
    "earned and reversals are separate": "event_kind = 'earned'" in SQL and "event_kind = 'reversal'" in SQL,
    "net subtracts immutable reversals": "then gross_customer_fee else -gross_customer_fee" in SQL,
    "public and anonymous execution are revoked": "revoke all on function public.admin_provider_revenue_native_summary() from public, anon" in SQL,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("provider native-currency revenue audit: PASS")
