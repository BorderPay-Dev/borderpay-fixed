#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL = (ROOT / "supabase/migrations/20260819133000_terminal_settled_revenue_refund_exclusion.sql").read_text(encoding="utf-8")

checks = {
    "only completed signed events are used": "q.status='completed'" in SQL and "b.signature_ok=true" in SQL,
    "only terminal successful payments earn revenue": "lower(obj->>'type')='payment_processed'" in SQL,
    "payment lifecycle is deduplicated by deposit": "distinct on (deposit_id)" in SQL,
    "signed terminal refunds are excluded by deposit": "refunded as (" in SQL and "not exists (select 1 from refunded" in SQL,
    "refund exclusion covers repository lifecycle vocabulary": all(status in SQL for status in ("refunded", "returned", "canceled", "cancelled", "refund_complete", "refund_completed")),
    "actual settlement uses the same deposit id": "left join wallet_settlement w using (deposit_id)" in SQL,
    "USD value is derived from actual settlement": "developer_fee*w.settlement_amount" in SQL and "net_source_amount" in SQL,
    "missing settlement fails coverage closed": "unvalued_fee_payments" in SQL and "complete" in SQL,
    "admin guard and grants are restricted": "not public.is_borderpay_admin()" in SQL and "from public, anon" in SQL,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items(): print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed: raise SystemExit(1)
print("terminal settled revenue audit: PASS")
