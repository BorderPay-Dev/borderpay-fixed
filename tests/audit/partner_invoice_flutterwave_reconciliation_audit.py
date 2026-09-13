#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
admin = (root / "supabase/functions/partner-application-admin/index.ts").read_text()
webhook = (root / "supabase/functions/flutterwave-subscription-collection/index.ts").read_text()
migration = (root / "supabase/migrations/20260913183000_partner_invoice_flutterwave_reconciliation.sql").read_text()

checks = {
    "live webhook source is version controlled": "FLUTTERWAVE_V4_WEBHOOK_SECRET" in webhook and "bp-maintenance-" in webhook,
    "v3 and v4 signatures remain supported": 'return "v3"' in webhook and 'return "v4"' in webhook,
    "webhook re-verifies the provider transaction": "/verify`" in webhook and "verified.status" in webhook,
    "partner invoice references have an isolated namespace": "bp-partner-invoice-" in admin and "bp-partner-invoice-" in webhook,
    "Flutterwave links are created server-side": 'https://api.flutterwave.com/v3/payments' in admin,
    "partner reference is deterministic": "sha256" in admin and "organizationId" in admin and "invoiceNumber" in admin,
    "invoice is not issued when link creation fails": "No invoice was issued" in admin,
    "webhook calls a dedicated partner completion RPC": "complete_partner_invoice_flutterwave" in webhook,
    "maintenance reconciliation remains separate": "complete_external_subscription_invoice" in webhook,
    "manual reconciliation supports both scopes": 'scope: "all"' in webhook and "reconcilePartnerInvoices" in webhook,
    "completion locks the invoice row": "for update" in migration.lower(),
    "completion requires exact currency": "Payment currency mismatch" in migration,
    "completion requires exact amount": "Payment amount mismatch" in migration,
    "provider transaction IDs are unique": "partner_invoices_flutterwave_transaction_uidx" in migration,
    "paid events are auditable": "partner_invoice_paid_flutterwave" in migration,
    "public callers cannot invoke completion": "revoke all on function public.complete_partner_invoice_flutterwave" in migration,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("Partner invoice Flutterwave audit failed: " + ", ".join(failed))
print(f"Partner invoice Flutterwave audit passed ({len(checks)}/{len(checks)}).")
