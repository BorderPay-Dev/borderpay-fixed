-- Stepped verification gate (#4 + #5) — APPLIED to production 2026-06-07 (project orwrcpwsffjlvzuraxjc).
--
-- Adds the manual-review state that gates billable Bridge KYC/KYB calls. Bridge
-- bills per verification ($2 KYC / $10 KYB), so the rule is:
--   onboarding enabled (env) AND paid plan AND admin-authorized → may verify.
--
-- This migration only adds columns + an authorization RPC; the live gate logic
-- lives in _shared/launch-gates.ts and the bridge-* edge functions. Applying
-- this migration is a separate, explicitly-gated step (no auto-apply).

-- 1) Review state on user_profiles (covers individual KYC + business-owner KYB).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS verification_review_status text NOT NULL DEFAULT 'pending_manual_review',
  ADD COLUMN IF NOT EXISTS verification_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_authorized_by uuid;

DO $$ BEGIN
  ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_verification_review_status_chk
    CHECK (verification_review_status IN ('pending_manual_review', 'authorized', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1b) Sensible backfill so already-verified/rejected users aren't dumped into
--     the manual-review queue; only genuinely-unreviewed users stay pending.
UPDATE public.user_profiles
   SET verification_review_status = CASE
     WHEN lower(coalesce(kyc_status::text,'')) IN ('verified','approved','full enrollment')
       OR lower(coalesce(admin_kyc_decision::text,'')) = 'approved'
       OR lower(coalesce(bridge_kyc_status::text,'')) = 'approved'
       OR lower(coalesce(bridge_account_status::text,'')) = 'active'   THEN 'authorized'
     WHEN lower(coalesce(kyc_status::text,'')) IN ('rejected','failed')
       OR lower(coalesce(admin_kyc_decision::text,'')) = 'rejected'
       OR lower(coalesce(bridge_kyc_status::text,'')) = 'rejected'
       OR lower(coalesce(bridge_account_status::text,'')) = 'rejected' THEN 'rejected'
     ELSE 'pending_manual_review'
   END;

-- 2) Admin authorization RPC. The caller's admin-ness is checked against
--    p_actor (the authenticated admin's id, supplied by the authorize-verification
--    edge function from a verified JWT). SECURITY DEFINER; execute restricted to
--    service_role. Returns the target's id/email/account_type so the edge
--    function can fire the "finish your document uploads" prompt email.
CREATE OR REPLACE FUNCTION public.authorize_verification(p_user_id uuid, p_actor uuid)
RETURNS TABLE (user_id uuid, email text, account_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT COALESCE(is_admin, false) FROM public.user_profiles WHERE id = p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles
     SET verification_review_status  = 'authorized',
         verification_authorized_at  = now(),
         verification_authorized_by  = p_actor
   WHERE id = p_user_id;

  RETURN QUERY
    SELECT up.id, up.email, up.account_type
      FROM public.user_profiles up
     WHERE up.id = p_user_id;
END
$$;

REVOKE ALL ON FUNCTION public.authorize_verification(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_verification(uuid, uuid) TO service_role;
