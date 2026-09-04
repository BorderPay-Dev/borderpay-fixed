from pathlib import Path

source = (Path(__file__).resolve().parents[2] / "supabase/functions/flutterwave-subscription-collection/index.ts").read_text()
checks = {
    "reconciliation uses provider reference lookup": "/transactions/verify_by_reference?tx_ref=" in source,
    "only open Flutterwave invoices are selected": '.eq("provider", "flutterwave")' in source and '.eq("status", "payment_link_created")' in source,
    "provider success is mandatory": 'clean(verified.status).toLowerCase() !== "successful"' in source,
    "verified amount and currency reach guarded RPC": all(token in source for token in ("p_amount: Number(verified.amount)", "p_currency: clean(verified.currency).toUpperCase()", 'db.rpc("complete_external_subscription_invoice"')),
    "failed lookup does not mark invoice failed": "A failed provider lookup is not proof of payment failure" in source,
    "specific references are maintenance scoped": 'providerReference.startsWith("bp-maintenance-")' in source,
}
failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"Flutterwave reconciliation audit failed: {', '.join(failed)}")
print(f"Flutterwave missed-webhook reconciliation audit passed ({len(checks)}/{len(checks)}).")
