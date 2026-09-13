#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = (root / "supabase/functions/partner-application-admin/index.ts").read_text()

checks = {
    "direct invite action exists": 'action === "send_direct_invite"' in source,
    "operator permission is mandatory": 'if (!canOperate)' in source[source.find('action === "send_direct_invite"'):],
    "email is normalized and validated": "normalizeEmail(body?.email)" in source and "validEmail(email)" in source,
    "email matching escapes wildcard characters": "ilikeLiteral(email)" in source,
    "existing partner organizations are rejected": "already belongs to a partner organization" in source,
    "accepted invitations cannot be duplicated": 'existing?.status === "accepted"' in source,
    "active invitations cannot be duplicated": 'existing?.status === "invited"' in source,
    "delivery targets the partner portal": "https://portal.borderpayafrica.com/auth/callback?setup=password" in source,
    "failed delivery stays pending for retry": "request remains pending and can be retried" in source,
    "successful delivery records operator and timestamps": "approved_by: authData.user.id" in source and "invited_at: now" in source,
    "direct invitation does not create an organization": 'from("partner_organizations").insert' not in source[source.find('action === "send_direct_invite"'):source.find('action === "approve_invite"')],
    "direct invitation does not approve KYB": 'status: "approved"' not in source[source.find('action === "send_direct_invite"'):source.find('action === "approve_invite"')],
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"Partner direct invite audit failed: {', '.join(failed)}")
print(f"Partner direct invite audit passed ({len(checks)}/{len(checks)}).")
