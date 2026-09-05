#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
worker = (root / "supabase/functions/affiliate-sso-link/index.ts").read_text()
consumer = (root / "utils/affiliate/openAffiliatePortal.ts").read_text()
migration = (root / "supabase/migrations/20260905144500_affiliate_sso_single_use_nonces.sql").read_text()
banner = (root / "components/referral/AffiliateBanner.tsx").read_text()
screen = (root / "components/referral/ReferralScreen.tsx").read_text()

checks = {
    "auth identity email is authoritative": "canonicalEmail = user.email" in worker and "profile?.email" not in worker,
    "individual Bridge verification is required": 'profile.bridge_kyc_status' in worker and 'verification_required' in worker,
    "business KYB comes from business_profiles": 'from("business_profiles")' in worker and 'bridge_kyb_status' in worker,
    "frozen accounts are denied": "LOCKED_STATUSES" in worker and 'code: "account_frozen"' in worker,
    "secret misconfiguration fails closed": "secret.length < 32" in worker and "}, 503)" in worker,
    "SSO is audience and issuer bound": 'iss: "borderpay-app"' in worker and 'aud: "borderpay-affiliate"' in worker,
    "SSO nonce is persisted": 'from("affiliate_sso_nonces").insert' in worker,
    "nonce table blocks browser roles": "revoke all on table public.affiliate_sso_nonces from anon, authenticated" in migration,
    "affiliate URL is origin bounded": "url.origin === AFFILIATE_ORIGIN" in consumer,
    "banner uses authenticated SSO": "openAffiliatePortal('banner')" in banner,
    "referral CTA uses authenticated SSO": "openAffiliatePortal('referral_screen')" in screen,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("affiliate SSO link audit failed: " + ", ".join(failed))
print(f"Affiliate SSO link audit passed ({len(checks)}/{len(checks)}).")
