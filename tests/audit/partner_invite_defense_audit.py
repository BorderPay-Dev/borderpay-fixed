#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = (root / "supabase/functions/partner-onboarding/index.ts").read_text()

checks = {
    "bounded body parsing": "readBoundedJson<any>(req, 65_536)" in source,
    "trusted gateway IP": "extractPublicClientIp(req)" in source,
    "warm-isolate rate limit": "allowInviteAttempt" in source,
    "Enterprise assessment": "recaptchaenterprise.googleapis.com" in source,
    "Google credential stays in header": (
        'authHeaders["X-Goog-Api-Key"] = apiKey' in source
        and 'authHeaders.Authorization = `Bearer ${await googleAccessToken(serviceAccount)}`' in source
        and "?key=" not in source
    ),
    "token is action-bound": 'expectedAction: "PARTNER_INVITE"' in source and 'action === "PARTNER_INVITE"' in source,
    "token is hostname-bound": '=== "portal.borderpayafrica.com"' in source,
    "risk score is enforced": "score >= 0.7" in source,
    "enforcement can fail closed": "PARTNER_INVITE_CAPTCHA_REQUIRED" in source,
    "captcha precedes database rate query": source.find("verifyPartnerInviteCaptcha") < source.find('from("partner_access_invite_requests")'),
}

for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if not all(checks.values()):
    raise SystemExit(1)
print(f"partner invite defense audit passed ({len(checks)}/{len(checks)}).")
