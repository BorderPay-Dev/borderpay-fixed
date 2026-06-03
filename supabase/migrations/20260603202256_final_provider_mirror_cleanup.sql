-- 20260603202256_final_provider_mirror_cleanup
--
-- user_profiles is the canonical customer/provider identity table. The
-- legacy public.users mirror must not carry provider ids because it creates
-- split-brain reads (for example: stale users.bridge_customer_id vs current
-- user_profiles.bridge_customer_id).
--
-- This migration is intentionally defensive: previous sweeps removed the
-- Maplerad columns, but live databases that drifted during the migration
-- window can safely apply these IF EXISTS drops again.

alter table public.users
  drop column if exists bridge_customer_id,
  drop column if exists maplerad_customer_id,
  drop column if exists maplerad_tier,
  drop column if exists maplerad_status,
  drop column if exists maplerad_environment;

alter table public.user_profiles
  drop column if exists maplerad_customer_id,
  drop column if exists maplerad_tier,
  drop column if exists maplerad_status,
  drop column if exists maplerad_environment,
  drop column if exists maplerad_kyc_link,
  drop column if exists maplerad_kyc_link_url,
  drop column if exists maplerad_kyc_link_id,
  drop column if exists maplerad_account_status,
  drop column if exists maplerad_provider_meta;
