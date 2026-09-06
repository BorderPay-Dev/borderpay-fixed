from pathlib import Path

root = Path(__file__).resolve().parents[2]
admin = (root / "supabase/functions/partner-application-admin/index.ts").read_text()
sender = (root / "supabase/functions/send-email/index.ts").read_text()
registry = (root / "supabase/functions/_shared/email-templates/index.ts").read_text()
template = (root / "supabase/functions/_shared/email-templates/partner/access-invite.ts").read_text()

checks = {
    "approval creates a GoTrue invite link without default SMTP": 'type: "invite"' in admin and "inviteUserByEmail" not in admin,
    "existing Auth users receive a magic link": 'type: "magiclink"' in admin and "isExistingUserError" in admin,
    "delivery uses internal-token protected send-email": '/functions/v1/send-email' in admin and 'Bearer ${SEND_EMAIL_TOKEN}' in admin,
    "delivery must be confirmed before request is marked invited": admin.find('sendResult?.data?.status !== "sent"') < admin.find('status: "invited"'),
    "one-time link is passed as sensitive data": 'sensitive_props: { invite_url: access.actionLink }' in admin,
    "one-time link is excluded from email log payload": "sensitive_props_redacted: true" in sender and "props: body.props ?? {}" in sender,
    "sensitive props are still available only for rendering": "...(body.sensitive_props ?? {})" in sender,
    "partner template is registered": '"partner.access_invite"' in registry and "partnerAccessInvite" in registry,
    "partner template enforces a secure URL": 'throw new Error("invite_url required")' in template,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit("Partner access invite delivery audit failed: " + ", ".join(failed))
print(f"Partner access invite delivery audit passed ({len(checks)}/{len(checks)}).")
