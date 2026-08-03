#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
campaign = (ROOT / "supabase/functions/notify-active-global-accounts/index.ts").read_text()
layout = (ROOT / "supabase/functions/_shared/email-templates/layout.ts").read_text()
individual = (ROOT / "supabase/functions/_shared/email-templates/individual/virtual-account-limits.ts").read_text()
business = (ROOT / "supabase/functions/_shared/email-templates/business/virtual-account-limits.ts").read_text()

checks = {
    "explicit campaign mode": '"limits_campaign"' in campaign,
    "active VA database filter": '.eq("status", "active")' in campaign,
    "target users filtered before database limit": 'query = query.or(`user_id.in.(${ids}),business_user_id.in.(${ids})`)' in campaign,
    "confirmed email required": "email_confirmed_at" in campaign,
    "individual Bridge verification required": "bridge_kyc_status" in campaign,
    "business Bridge verification required": "bridge_kyb_status" in campaign,
    "paused and suspended accounts excluded": '"paused"' in campaign and '"suspended"' in campaign,
    "campaign uses limits template": '"business.virtual_account_limits"' in campaign and '"individual.virtual_account_limits"' in campaign,
    "campaign idempotency": "campaign:virtual-account-limits" in campaign,
    "clean layout is opt-in": 'surface?:    "default" | "clean"' in layout,
    "individual limits opts into clean layout": 'surface: "clean"' in individual,
    "business limits opts into clean layout": 'surface: "clean"' in business,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("virtual_account_limits_campaign_audit: FAIL\n- " + "\n- ".join(failed))
print("virtual_account_limits_campaign_audit: PASS")
