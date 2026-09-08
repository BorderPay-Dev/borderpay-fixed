#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sql = (root / "supabase/migrations/20260909090000_b2b_affiliate_fee_discount.sql").read_text()
worker = (root / "supabase/functions/affiliate-sso-link/index.ts").read_text()

checks = {
    "affiliate access is Business-only": 'accountType !== "business"' in worker,
    "Bridge KYB approval is required": 'business.bridge_kyb_status' in worker and 'verified(verificationStatus)' in worker,
    "no second affiliate Auth identity": "createUser" not in worker,
    "existing Business identity is persisted as membership": "join_verified_business_affiliate" in sql and "affiliate_accounts" in sql,
    "new referral attribution resolves verified Business members only": "create or replace function public.resolve_borderpay_referrer_id" in sql and "from public.affiliate_accounts aa" in sql,
    "discount is exactly 2.50 percent": "fee_percent = 2.5000" in sql,
    "each approved referral adds exactly 30 days": "v_window_start + interval '30 days'" in sql,
    "discount windows are sequential": "greatest(now(), coalesce(max(ends_at)" in sql,
    "existing VA discounts wait for provider confirmation": "pending_provider" in sql and "provider_confirmation_required" in sql,
    "discount clock starts only after provider confirmation": "activate_b2b_affiliate_discount" in sql and "ends_at = v_window_start + interval '30 days'" in sql,
    "qualification comes from Business KYB": "trg_b2b_affiliate_kyb_approval" in sql and "bridge_kyb_status" in sql,
    "individual referrals are excluded from reporting": "account_type::text,'')) = 'business'" in sql,
    "cash referral awards are not created": "insert into public.referral_earnings" not in sql,
    "legacy transaction reward triggers are retired": all(token in sql for token in [
        "drop trigger if exists trg_affiliate_transactions_first_tx",
        "drop trigger if exists trg_affiliate_stablecoin_first_tx",
        "drop trigger if exists trg_affiliate_bridge_transfer_first_tx",
    ]),
    "approved referrals are recovered when inviter first joins": "v_existing_referral" in sql and "perform public.qualify_b2b_affiliate_referral(v_existing_referral.referred_id)" in sql,
    "currency-specific standard fees remain unchanged": "case when active_discount.active then 2.5000 else 100.0000 end" in sql,
    "browser roles cannot activate membership": "grant execute on function public.join_verified_business_affiliate(uuid) to service_role" in sql,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("B2B affiliate audit failed: " + ", ".join(failed))
print(f"B2B affiliate audit passed ({len(checks)}/{len(checks)}).")
