-- 20260709103000_user_profile_tos_acceptance.sql
-- Durable ToS acceptance gate for Bridge KYC/KYB.
--
-- KYC/KYB must not start from browser-local state alone. The edge functions
-- require user_profiles.tos_accepted_at before any provider verification call.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS tos_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS tos_version text;

CREATE INDEX IF NOT EXISTS user_profiles_tos_accepted_idx
  ON public.user_profiles (tos_accepted_at)
  WHERE tos_accepted_at IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.tos_accepted_at IS
  'Timestamp when the user accepted BorderPay Terms of Service before KYC/KYB.';
COMMENT ON COLUMN public.user_profiles.tos_version IS
  'BorderPay Terms of Service version accepted by the user.';
