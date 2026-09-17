#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
portal = (root / "supabase/functions/partner-onboarding/index.ts").read_text()

checks = {
    "white-label publish requires product approval": 'approved_products.includes("white_label")' in portal,
    "settings save a draft release": 'from("white_label_releases")' in portal and 'draft_tenant_count' in portal,
    "brand and email identity are published": all(key in portal for key in ["brand_name: data.brand_name", "primary_color: data.primary_color", "email_sender_name: data.email_sender_name", "email_reply_to: data.email_reply_to"]),
    "logo upload is type and size bounded": "decodeWhiteLabelLogo" in portal and "1_048_576" in portal and "image/svg" not in portal,
    "logo URL is saved to release draft": "logo_url: publicLogo.publicUrl" in portal,
    "sandbox projects inherit approved products": "approvalCloneError" in portal and "sourceApproval" in portal,
    "white-label cannot create API projects or credentials": all(token in portal for token in [
        'sourceApproval.approved_products.length !== 1',
        'sourceApproval.approved_products[0] !== "api"',
        'White-label projects are provisioned by BorderPay Operations',
    ]),
    "partner CAPTCHA uses Google credential and fails closed": all(token in portal for token in ["FIREBASE_SERVICE_ACCOUNT_JSON", "googleAccessToken", "PARTNER_INVITE_CAPTCHA_REQUIRED", "return !required"]),
    "white-label email delivery is BorderPay managed": all(token in portal for token in [
        'emailDeliveryMode !== "borderpay_managed"',
        'BorderPay manages white-label delivery',
        'email_delivery_mode: emailDeliveryMode',
    ]),
    "partner API webhooks are rejected for white-label model": 'partner API webhooks are not available for this model' in portal,
    "portal webhooks retain deliverable encrypted secrets": all(token in portal for token in ['encryptApiWebhookSecret', 'signing_secret_ciphertext', 'signing_secret_nonce', 'delivery_enabled: true']),
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("partner white-label audit failed: " + ", ".join(failed))
print(f"Partner white-label source contract audit passed ({len(checks)}/{len(checks)}).")
