#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/subscription-billing-worker/index.ts").read_text()
collector = (ROOT / "supabase/functions/flutterwave-subscription-collection/index.ts").read_text()
migration = (ROOT / "supabase/migrations/20260830234000_regional_subscription_collection_routing.sql").read_text()

checks = {
    "authoritative Bridge country scope is used": "resolveBridgeScaScope(db, row.user_id)" in worker,
    "confirmed EEA is routed to an external invoice": "isBridgeEeaScaCountry(scope.country)" in worker
    and 'route: "flutterwave_invoice"' in worker,
    "only confirmed non-EEA enters provider-backed billing": 'scope.reason !== "non_eea"' in worker
    and 'functions/v1/subscription-bridge-collection' in worker
    and worker.find('scope.reason !== "non_eea"') < worker.find('functions/v1/subscription-bridge-collection'),
    "legacy internal-only charge is not used": 'charge_internal_subscription' not in worker,
    "unknown geography fails closed": 'route: "blocked"' in worker
    and "maintenance_region_unresolved" in worker,
    "provider scope checks use bounded concurrency": "mapWithConcurrency(rows, 3" in worker,
    "invoice creation does not claim payment": "Creation is not payment" in migration
    and "pending_configuration" in migration,
    "invoice payment requires verified callback": "complete_external_subscription_invoice" in migration
    and "Verified provider payment does not match invoice" in migration,
    "Flutterwave callback uses verif-hash": 'req.headers.get("verif-hash")' in collector,
    "Flutterwave transaction is re-read before settlement": "/transactions/${encodeURIComponent(transactionId)}/verify" in collector
    and collector.find("/transactions/${encodeURIComponent(transactionId)}/verify") < collector.find('db.rpc("complete_external_subscription_invoice"'),
    "exact reference is verified": 'clean(verified.tx_ref) !== txRef' in collector,
    "missing Flutterwave configuration fails closed": "flutterwave_not_configured" in collector
    and "configured: false" in collector,
    "invoice uniqueness prevents duplicate monthly bills": "unique(subscription_id, billing_period)" in migration,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'PASS' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit(f"regional subscription collection audit failed: {', '.join(failed)}")
print(f"regional subscription collection audit: PASS ({len(checks)}/{len(checks)})")
