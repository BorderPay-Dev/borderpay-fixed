#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = (root / "supabase/functions/partner-onboarding/index.ts").read_text()
migration = (root / "supabase/migrations/20260905124500_partner_team_invitations.sql").read_text()

checks = {
    "team invitation table is service-role only": all(x in migration for x in [
        "create table if not exists public.partner_team_invitations",
        "enable row level security",
        "revoke all on table public.partner_team_invitations from anon, authenticated",
    ]),
    "team mutations require MFA": all(x in source for x in [
        '"invite_team_member", "update_team_member", "remove_team_member"',
        "tokenAal(token)",
    ]),
    "team mutations are organization scoped": source.count('.eq("organization_id", org.id)') >= 10,
    "owner cannot be demoted or removed": source.count('target.role === "owner"') >= 2,
    "member cannot remove self": 'targetUserId === user.id' in source,
    "team invite accepts only approved organization": '.eq("status", "approved")' in source,
    "team invite email uses portal callback": 'portal.borderpayafrica.com/auth/callback?setup=password' in source,
    "team actions write audit events": all(x in source for x in [
        'event_type: "team_member_invited"',
        'event_type: "team_member_role_updated"',
        'event_type: "team_member_removed"',
    ]),
}

for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if not all(checks.values()):
    raise SystemExit(1)
print(f"partner workspace operations audit passed ({len(checks)}/{len(checks)}).")
