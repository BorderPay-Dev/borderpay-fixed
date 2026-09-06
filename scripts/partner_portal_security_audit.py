from pathlib import Path

root = Path(__file__).resolve().parents[1]
onboarding = (root / "supabase/functions/partner-onboarding/index.ts").read_text()
admin = (root / "supabase/functions/partner-application-admin/index.ts").read_text()
migration = (root / "supabase/migrations/20260904213000_partner_portal_private_access.sql").read_text()
public_request_security = (root / "supabase/functions/_shared/public-request-security.ts").read_text()

public_invite = onboarding.split('if (action === "request_invite")', 1)[1].split("const token =", 1)[0]
checks = {
    "public requests never create Auth users": "inviteUserByEmail" not in public_invite,
    "public requests are queued pending": 'status: "pending"' in public_invite,
    "public intake is IP rate limited": 'eq("requester_ip_hash", ipHash)' in public_invite,
    "public intake trusts gateway IP before forwarded input": (
        "extractPublicClientIp(req)" in public_invite
        and public_request_security.find('req.headers.get("cf-connecting-ip")')
        < public_request_security.find('req.headers.get("x-forwarded-for")')
    ),
    "membership requires an invited email": all(token in onboarding for token in ('.eq("email", email)', '.eq("status", "invited")', '"Partner access has not been approved."')),
    "only admin worker creates Auth invite links": 'type: "invite"' in admin and "Admin access required" in admin,
    "partner invites use logged transactional email": 'template: "partner.access_invite"' in admin and 'sensitive_props: { invite_url:' in admin,
    "existing Auth identities are supported": 'type: "magiclink"' in admin and "isExistingUserError" in admin,
    "invite redirect uses production portal": "https://portal.borderpayafrica.com/auth/callback?setup=password" in admin,
    "operational tables are tenant scoped": onboarding.count('.eq("tenant_id", tenantId)') >= 8,
    "partner keys do not reference customer profiles": "created_by: null" in onboarding,
    "key hashes never appear in workspace responses": 'select("id,key_prefix,key_label,scopes,is_active,revoked_at,last_used_at,created_at")' in onboarding,
    "activity omits IP and metadata": 'select("id,request_id,method,route,status_code,error_code,latency_ms,created_at")' in onboarding,
    "private access schema is constrained": all(token in migration for token in ("partner_access_invite_status_check", "partner_members_one_active_org_per_user_idx")),
    "partner mutations require super admin": "if (!canOperate)" in admin and "Super admin access required" in admin,
    "sandbox activation requires typed confirmation": 'clean(body.confirmation, 40) !== "ACTIVATE SANDBOX"' in admin,
    "sandbox activation cannot enable production": 'default_mode: "sandbox"' in admin and 'production_access: false' in admin,
    "sandbox activation requires approved KYB": 'application.status !== "approved"' in admin,
    "document finalization verifies uploaded object": '.storage.from("partner-due-diligence").list(folder' in onboarding and 'Uploaded document was not found' in onboarding,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"Partner portal security audit failed: {', '.join(failed)}")
print(f"Partner portal security audit passed ({len(checks)}/{len(checks)}).")
