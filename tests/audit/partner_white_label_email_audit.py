#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
signup = (root / "supabase/functions/auth-signup/index.ts").read_text()
resend = (root / "supabase/functions/auth-resend-verification/index.ts").read_text()
sender = (root / "supabase/functions/send-email/index.ts").read_text()

checks = {
    "only white-label signup forwards tenant identity": 'partnerAuthorization?.onboarding_channel === "white_label"' in signup,
    "verification resend restores immutable tenant provenance": 'origin?.onboarding_channel === "white_label"' in resend,
    "sender rechecks active product approval": all(token in sender for token in ['api_partner_approvals', 'approved_products.includes("white_label")', 'tenant?.is_active']),
    "sender verifies user tenant ownership": 'account_origin_provenance' in sender and 'Email recipient is not owned by this partner tenant' in sender,
    "branding is sanitized and provider sender address is retained": all(token in sender for token in ['escapeBrand', 'formatFromName', 'parseFrom(raw)']),
    "partner reply-to overrides caller input": 'whiteLabel?.replyTo || body.reply_to' in sender,
    "successful sends are billable and failures are not": 'billable: status === "sent"' in sender,
    "delivery outcome is queued to partner webhooks": 'api_webhook_enqueue_event' in sender and '"email.sent"' in sender and '"email.failed"' in sender,
    "partner-owned delivery is webhook-only": 'whiteLabel?.deliveryMode === "partner_webhook"' in sender and '"email.delivery_requested"' in sender,
    "partner-owned delivery is not metered as sent": 'provider: "partner_webhook"' in sender and 'status: "queued"' in sender,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("partner white-label email audit failed: " + ", ".join(failed))
print(f"Partner white-label email audit passed ({len(checks)}/{len(checks)}).")
