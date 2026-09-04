from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "supabase/migrations/20260904230000_subscription_final_warning_delivery_gate.sql").read_text()
WORKER = (ROOT / "supabase/functions/subscription-billing-worker/index.ts").read_text()

checks = {
    "day-3 uses payment-link invoice template": "'notice','reminder'" in MIGRATION and "subscription_external_invoice" in MIGRATION,
    "day-7 queues one deterministic final warning": "subscription:day7_final_warning:" in MIGRATION and "'notice','final_warning'" in MIGRATION,
    "grace control does not restrict directly": "set restricted_at=now()" not in MIGRATION.split("create or replace function public.finalize_subscription_restrictions")[0],
    "restriction requires confirmed email delivery": "j.status='sent'" in MIGRATION and "j.sent_at is not null" in MIGRATION,
    "restriction requires an unpaid live Flutterwave invoice": "sei.status='payment_link_created'" in MIGRATION and "s.payment_status in ('failed','pending')" in MIGRATION,
    "email drain finalizes before provider enforcement": WORKER.index('out.restrictions = await finalizeRestrictionsAfterEmailDelivery()') < WORKER.index('out.access = await reconcileSubscriptionAccess(false);', WORKER.index('out.restrictions = await finalizeRestrictionsAfterEmailDelivery()')),
    "restriction remains idempotent": "and restricted_at is null" in MIGRATION and "on conflict(idempotency_key) do nothing" in MIGRATION,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"{len(failed)} lifecycle checks failed")
print(f"PASS: {len(checks)}/{len(checks)} lifecycle checks")
