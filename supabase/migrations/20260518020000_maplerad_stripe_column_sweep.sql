-- 20260518_maplerad_stripe_column_sweep
--
-- Drops remaining Maplerad columns across feature tables and the Stripe
-- columns on user_subscriptions (we use wallet-debit billing via
-- pay_subscription_invoice_from_va, not Stripe — confirmed by CEO).
-- Backfills the 51 user_profiles rows still flagged
-- payment_provider='maplerad' to 'bridge'.
--
-- Applied via Supabase MCP on 2026-05-17 as
-- `maplerad_stripe_full_column_sweep`.
--
-- Note: the enum VALUE `payment_provider='maplerad'` is intentionally
-- retained. Postgres cannot ALTER TYPE … DROP VALUE without rebuilding
-- the enum and every dependent column; no code reads the value.

-- accounts
alter table public.accounts          drop column if exists maplerad_account_id;

-- cards
alter table public.cards             drop column if exists maplerad_card_id;

-- fee_config
alter table public.fee_config
  drop column if exists is_maplerad_readonly,
  drop column if exists maplerad_fee_cap,
  drop column if exists maplerad_fee_currency,
  drop column if exists maplerad_fee_min,
  drop column if exists maplerad_fee_type,
  drop column if exists maplerad_fee_value;

-- fee_schedule
alter table public.fee_schedule
  drop column if exists maplerad_fee_fixed,
  drop column if exists maplerad_fee_percent;

-- kyc_submissions
alter table public.kyc_submissions   drop column if exists maplerad_customer_id;

-- referral_payouts
alter table public.referral_payouts  drop column if exists maplerad_ref;

-- wallets
alter table public.wallets           drop column if exists maplerad_wallet_id;

-- Stripe columns — we use wallet-debit billing via
-- pay_subscription_invoice_from_va, not Stripe.
alter table public.user_subscriptions
  drop column if exists stripe_customer_id,
  drop column if exists stripe_price_id,
  drop column if exists stripe_subscription_id;

-- Backfill legacy 'maplerad' payment_provider rows to 'bridge'.
update public.user_profiles
   set payment_provider = 'bridge'::payment_provider,
       updated_at       = now()
 where payment_provider = 'maplerad'::payment_provider;
