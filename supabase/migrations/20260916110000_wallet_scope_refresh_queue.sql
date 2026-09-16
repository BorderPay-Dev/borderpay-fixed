-- Background refresh keeps installed clients independent of on-screen requests.
CREATE TABLE IF NOT EXISTS public.wallet_scope_refresh_jobs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_scope_refresh_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_scope_refresh_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_scope_refresh_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_wallet_scope_refresh_batch(p_limit integer DEFAULT 20)
RETURNS TABLE(user_id uuid, lease_token uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $function$
  INSERT INTO public.wallet_scope_refresh_jobs AS jobs(user_id, lease_token, next_attempt_at)
  SELECT up.id, gen_random_uuid(), now() + interval '5 minutes'
  FROM public.user_profiles up
  LEFT JOIN public.sca_customer_scopes scope ON scope.user_id = up.id
  LEFT JOIN public.wallet_scope_refresh_jobs job ON job.user_id = up.id
  WHERE coalesce(up.account_type, 'individual') <> 'business'
    AND lower(coalesce(up.bridge_kyc_status, '')) = 'approved'
    AND nullif(btrim(up.bridge_customer_id), '') IS NOT NULL
    AND (scope.user_id IS NULL OR scope.expires_at <= now() + interval '20 minutes'
         OR scope.bridge_customer_id IS DISTINCT FROM up.bridge_customer_id
         OR scope.source IS DISTINCT FROM 'bridge_customer_api')
    AND (job.user_id IS NULL OR job.next_attempt_at <= now())
  ORDER BY job.next_attempt_at NULLS FIRST, scope.expires_at NULLS FIRST, up.id
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
  ON CONFLICT (user_id) DO UPDATE
    SET lease_token = EXCLUDED.lease_token, next_attempt_at = EXCLUDED.next_attempt_at,
        updated_at = now()
    WHERE jobs.next_attempt_at <= now()
  RETURNING jobs.user_id, jobs.lease_token;
$function$;
REVOKE ALL ON FUNCTION public.claim_wallet_scope_refresh_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wallet_scope_refresh_batch(integer) TO service_role;
