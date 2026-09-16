-- Keep review fixtures out of live Bridge requests and restore existing wallets first.
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
    AND NOT starts_with(btrim(up.bridge_customer_id), 'demo_bridge_customer_')
    AND (scope.user_id IS NULL OR scope.expires_at <= now() + interval '20 minutes'
         OR scope.bridge_customer_id IS DISTINCT FROM up.bridge_customer_id
         OR scope.source IS DISTINCT FROM 'bridge_customer_api')
    AND (job.user_id IS NULL OR job.next_attempt_at <= now())
  ORDER BY EXISTS (
    SELECT 1 FROM public.bridge_wallets w
    WHERE w.bridge_customer_id = up.bridge_customer_id AND lower(w.status) = 'active'
  ) DESC, job.next_attempt_at NULLS FIRST, scope.expires_at NULLS FIRST, up.id
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
  ON CONFLICT (user_id) DO UPDATE
    SET lease_token = EXCLUDED.lease_token, next_attempt_at = EXCLUDED.next_attempt_at,
        updated_at = now()
    WHERE jobs.next_attempt_at <= now()
  RETURNING jobs.user_id, jobs.lease_token;
$function$;
REVOKE ALL ON FUNCTION public.claim_wallet_scope_refresh_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wallet_scope_refresh_batch(integer) TO service_role;
