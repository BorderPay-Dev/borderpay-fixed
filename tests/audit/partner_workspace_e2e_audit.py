#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
migration = (root / "supabase/migrations/20260905110000_partner_workspace_projects_resources.sql").read_text()
portal = (root / "supabase/functions/partner-onboarding/index.ts").read_text()
admin = (root / "supabase/functions/partner-application-admin/index.ts").read_text()
gateway = (root / "supabase/functions/public-api-gateway/index.ts").read_text()
worker = (root / "supabase/functions/process-pending-events/index.ts").read_text()

checks = {
    "resources are tenant owned": "tenant_id uuid not null references public.api_tenants" in migration,
    "resource type constrained": "resource_type in ('customer','wallet','virtual_account','transfer','payout')" in migration,
    "resource table blocks direct authenticated access": "revoke all on table public.api_tenant_resources from anon, authenticated" in migration,
    "projects are organization owned": "organization_id uuid not null references public.partner_organizations" in migration,
    "new projects are sandbox only": 'default_mode: "sandbox", is_active: true' in portal and "production_access: false" in portal,
    "project selection is ownership bounded": 'project.id === requestedProjectId' in portal,
    "workspace resource read is tenant bounded": '.eq("tenant_id", tenantId)' in portal,
    "gateway records customers": 'resource_type: "customer"' in gateway,
    "gateway records wallets": 'resource_type: "wallet"' in gateway,
    "gateway records virtual accounts": 'resource_type: "virtual_account"' in gateway,
    "gateway records payments": 'routeKey === "POST /v1/payouts" ? "payout" : "transfer"' in gateway,
    "gateway stores only masked bank identifiers": "result.account_number?.slice(-4)" in gateway and "result.iban?.slice(-4)" in gateway,
    "verified webhooks update existing partner resources": "updatePartnerResourceState" in worker and '.eq("provider_resource_id", providerResourceId)' in worker,
    "webhooks cannot create or move partner resources": '.from("api_tenant_resources")\n    .update(' in worker and '.insert(' not in worker[worker.index('async function updatePartnerResourceState'):worker.index('// ── Top-level router')],
    "Bridge match is exact and confirmed": 'VERIFY BRIDGE KYB' in admin and "identity_checks" in admin,
    "Bridge link is unique": "partner_organizations_bridge_customer_unique" in migration,
    "manual KYB remains default": "kyb_source text not null default 'manual'" in migration,
    "compliance documents remain mandatory": all(x in portal for x in ["AML/CFT policy", "Sanctions policy", "Information-security policy", "Incident-response policy"]),
    "support is organization scoped": '.eq("organization_id", org.id)' in portal,
    "settings reject arbitrary HTML surface": "email_sender_name" in migration and "custom_html" not in migration,
    "organization 2FA protects mutations": "mfaProtectedActions" in portal and 'tokenAal(token) !== "aal2"' in portal,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("partner workspace audit failed: " + ", ".join(failed))
print(f"Partner workspace audit passed ({len(checks)}/{len(checks)}).")
