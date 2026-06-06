-- Reject path for the compliance review queue (#B Plan B) — APPLIED to production 2026-06-07 (project orwrcpwsffjlvzuraxjc).
--
-- Companion to authorize_verification (20260606120000). An admin rejecting a
-- profile flips verification_review_status to 'rejected' and stamps the actor.
-- Rejected profiles never trigger a billable provider (KYC/KYB) call — this is
-- the runway-protecting gate for unverified accounts.

CREATE OR REPLACE FUNCTION public.reject_verification(p_user_id uuid, p_actor uuid)
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
     SET verification_review_status  = 'rejected',
         verification_authorized_at  = now(),
         verification_authorized_by  = p_actor
   WHERE id = p_user_id;

  RETURN QUERY
    SELECT up.id, up.email, up.account_type
      FROM public.user_profiles up
     WHERE up.id = p_user_id;
END
$$;

REVOKE ALL ON FUNCTION public.reject_verification(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_verification(uuid, uuid) TO service_role;
