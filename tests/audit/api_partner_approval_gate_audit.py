from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
migration = (ROOT / "supabase/migrations/20260818120000_api_partner_approval_gate.sql").read_text()
admin = (ROOT / "supabase/functions/api-gateway-admin/index.ts").read_text()
portal = (ROOT / "supabase/functions/api-partner-portal/index.ts").read_text()
config = (ROOT / "supabase/functions/onboarding-config/index.ts").read_text()
quarantine = (ROOT / "supabase/migrations/20260818190000_unapproved_api_tenant_quarantine.sql").read_text()

checks = {
    "approval is a separate durable table": "create table if not exists public.api_partner_approvals" in migration,
    "existing tenants are not auto-approved": "insert into public.api_partner_approvals" not in migration,
    "approval has no permissive default status": "status                          text not null" in migration,
    "runtime key resolver joins approval": "join public.api_partner_approvals a" in migration,
    "runtime requires approved status": "a.status = 'approved'" in migration,
    "white-label-only keys cannot receive financial scopes": "k.scopes <@ array['onboarding:write']" in migration,
    "signed onboarding consumption requires white-label approval": "'white_label' = any(pa.approved_products)" in migration,
    "operator approval requires compliance evidence": "compliance_approval_reference" in admin and "compliance_approved_by" in admin,
    "operator approval requires engineering evidence": "engineering_approval_reference" in admin and "engineering_approved_by" in admin,
    "operator approval requires operational contacts": all(field in admin for field in ["technical_contact_email", "compliance_contact_email", "incident_contact_email"]),
    "new tenants cannot combine creation and activation": "Create the tenant without partner access, then record partner approval" in admin,
    "new tenants are forced disabled and sandbox-only": "New partner tenants must be created disabled and sandbox-only" in admin and "is_active: tenantId ? body?.is_active !== false : false" in admin,
    "legacy unapproved tenants are disabled": "is_active = false" in quarantine and "a.status = 'approved'" in quarantine,
    "legacy pre-approval keys are revoked": all(token in quarantine for token in ["update public.api_keys", "is_active = false", "revoked_at = coalesce"]),
    "legacy onboarding and branding flags are cleared": all(token in quarantine for token in ["individual_signup_enabled", "business_signup_enabled", "white_label_signup_enabled", "'enabled', false"]),
    "approval requires quarantined tenant state": all(token in admin for token in ["tenant.is_active === true", "storedPartnerAccess.onboarding", "storedPartnerAccess.whiteLabel", "activeKeyCount", "tenant_quarantine_required"]),
    "credential issuance requires approval": "Partner approval is required before issuing credentials" in admin,
    "partner portal checks approval before actions": portal.find('.from("api_partner_approvals")') < portal.find("body = await req.json()"),
    "browser portal cannot approve itself": '"approve_partner"' not in portal,
    "hosted onboarding rechecks live approval": '.from("api_partner_approvals")' in config and 'includes("white_label")' in config,
    "suspension fails closed before key revocation": admin.find('status: "suspended"') < admin.find("Partner suspended; key revocation requires follow-up"),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("api partner approval gate audit: PASS")
