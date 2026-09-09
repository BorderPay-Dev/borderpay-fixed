#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL = (ROOT / "supabase/migrations/20260819120000_bridge_wallet_webhook_metrics.sql").read_text()
API = (Path("/private/tmp/bp-admin-partner-ui/utils/api.ts")).read_text()

checks = {
    "only completed signed wallet webhooks are included": all(token in SQL for token in (
        "b.signature_ok = true",
        "q.status = 'completed'",
        "b.event_type = 'bridge_wallet.activity.created'",
    )),
    "activities are deduplicated": "select distinct on (activity_id)" in SQL,
    "directions match Bridge wallet dashboard": all(token in SQL for token in (
        "'into_wallets'",
        "'out_of_wallets'",
        "'between_wallets'",
        "('deposit','direct_deposit')",
        "activity_type = 'withdrawal'",
    )),
    "currency volume remains separated": "'volume_by_currency'" in SQL and "jsonb_object_agg(currency, amount" in SQL,
    "current balance uses latest wallet currency observation": all(token in SQL for token in (
        "distinct on (bridge_wallet_id, currency)",
        "order by bridge_wallet_id, currency, occurred_at desc",
        "'balance_by_currency'",
    )),
    "admin money movement consumes wallet metric RPC": "admin_bridge_wallet_webhook_metrics" in API,
    "no configured fee or synthetic rate is used": "developer_fee_percent" not in SQL and "usd_rate" not in SQL,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("bridge wallet webhook metrics audit: PASS")
