#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
migration = (root / "supabase/migrations/20260913140000_partner_commercial_billing_and_attribution.sql").read_text()
portal = (root / "supabase/functions/partner-onboarding/index.ts").read_text()
admin = (root / "supabase/functions/partner-application-admin/index.ts").read_text()
templates = (root / "supabase/functions/_shared/email-templates/index.ts").read_text()

checks = {
    "application allows exactly one partner model": "enforce_single_partner_product" in migration and "cardinality" in migration,
    "approval allows exactly one partner model": "enforce_single_approved_partner_product" in migration,
    "API credentials are API-only": "API keys are available only to API partners" in portal,
    "webhooks are API-only": "Webhooks are available only to API partners" in portal,
    "IP allowlists are API-only": "IP allowlists are available only to API partners" in portal,
    "white-label email is BorderPay-managed": "BorderPay manages white-label delivery" in portal,
    "signed NDA and Treasury Agreement are required": "Both NDA and Treasury Agreement references are required" in migration,
    "provider costs require explicit allocation": "partner_provider_cost_allocations" in migration and "allocation_basis" in migration,
    "transactions use immutable tenant/provider ownership": "projectByTenant" in admin and "api_tenant_provider_resources" in admin,
    "partner invoices have itemized lines": "partner_invoice_line_items" in migration and "admin_create_partner_invoice" in migration,
    "invoice notification uses registered transactional email": 'template: "business.partner_invoice"' in admin and '"business.partner_invoice"' in templates,
    "developer-fee ledger cannot move funds": "this table never initiates a payout" in migration and "fetch(\"https://api.bridge.xyz" not in admin,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("partner commercial billing audit failed: " + ", ".join(failed))
print(f"Partner commercial billing audit passed ({len(checks)}/{len(checks)}).")
