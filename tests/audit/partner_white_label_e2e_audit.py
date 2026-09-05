#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
portal = (root / "supabase/functions/partner-onboarding/index.ts").read_text()

checks = {
    "white-label publish requires product approval": 'approved_products.includes("white_label")' in portal,
    "settings publish to tenant metadata": 'white_label: {' in portal and 'white_label_signup_enabled: true' in portal,
    "brand and email identity are published": all(key in portal for key in ["brand_name: data.brand_name", "primary_color: data.primary_color", "email_sender_name: data.email_sender_name", "email_reply_to: data.email_reply_to"]),
    "logo upload is type and size bounded": "decodeWhiteLabelLogo" in portal and "1_048_576" in portal and "image/svg" not in portal,
    "logo URL is published to tenant metadata": "logo_url: publicLogo.publicUrl" in portal,
    "sandbox projects inherit approved products": "approvalCloneError" in portal and "sourceApproval" in portal,
    "white-label keys support onboarding only": '"onboarding:write"' in portal and "scopes.every" in portal,
    "partner CAPTCHA uses Google credential and fails closed": all(token in portal for token in ["FIREBASE_SERVICE_ACCOUNT_JSON", "googleAccessToken", "PARTNER_INVITE_CAPTCHA_REQUIRED", "return !required"]),
    "email delivery mode is allowlisted": all(token in portal for token in ['"borderpay_managed"', '"partner_webhook"', 'Email delivery mode is invalid']),
    "partner-managed email requires active webhook": 'Add an active webhook to every approved project' in portal and '.eq("is_active", true)' in portal,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("partner white-label audit failed: " + ", ".join(failed))
print(f"Partner white-label end-to-end audit passed ({len(checks)}/{len(checks)}).")
