from pathlib import Path

root = Path(__file__).resolve().parents[2]
admin = (root / "supabase/functions/admin-signup/index.ts").read_text()
partner = (root / "supabase/functions/partner-application-admin/index.ts").read_text()
mailer = (root / "supabase/functions/send-email/index.ts").read_text()
registry = (root / "supabase/functions/_shared/email-templates/index.ts").read_text()

checks = {
    "staff creation requires an authenticated super admin after bootstrap":
        '"ADMIN_SUPER", "SUPER_ADMIN"' in admin and "Sign in as a super admin" in admin,
    "shared secret is restricted to empty-table bootstrap":
        'select("user_id", { count: "exact", head: true })' in admin and 'role = "ADMIN_SUPER"' in admin,
    "support role maps to the canonical support permission":
        'support: "SUPPORT_AGENT"' in admin,
    "partner access supports existing BorderPay Auth users":
        'type: "magiclink"' in partner and "isExistingUserError" in partner,
    "partner invite is not marked sent before email delivery":
        partner.index("await deliverPartnerAccessInvite(email, requestId)") < partner.index('status: "invited"'),
    "one-time invite URL is sent as non-persisted sensitive data":
        'sensitive_props: { invite_url: access.actionLink }' in partner
        and "sensitive_props_redacted" in mailer,
    "partner invite template is registered":
        registry.count('"partner.access_invite"') >= 2,
    "legacy duplicate-user invite API is absent":
        "inviteUserByEmail" not in partner,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("Admin/partner invite audit failed:\n- " + "\n- ".join(failed))
print(f"Admin/partner invite audit passed ({len(checks)}/{len(checks)})")
