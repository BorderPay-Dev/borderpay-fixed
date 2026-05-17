-- ============================================================================
-- 20260507_complete_business_signup_rpc.sql
-- ----------------------------------------------------------------------------
-- Server-owned signup finalisation RPC. Lets a freshly-signed-up business
-- user create their own business_profiles row in a tightly-controlled way,
-- without violating the lockdown that removed authenticated owner INSERT.
--
-- Authorization (all required):
--   • caller authenticated (auth.uid() not null) OR service_role
--   • caller has NO existing business_profiles row
--   • caller's user_profiles.account_type is NOT already 'business'
--   • caller's user_profiles.created_at is within the last 30 minutes
--     (signup-window guard — prevents existing individual users from
--      using this RPC as a self-promotion vector; admin RPC is the
--      only post-window path).
--
-- The RPC inserts into business_profiles, which fires
-- sync_account_type_to_business() and writes its own audit row.
-- We additionally write a 'signup' audit row here so the trail is
-- explicit when invoked from a regular authenticated session.
-- ============================================================================

create or replace function public.complete_business_signup(
  p_company_name        text,
  p_registration_number text default null,
  p_country             text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_role         text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_existing     uuid;
  v_profile      record;
  v_age_seconds  numeric;
  v_bp_id        uuid;
  v_old          public.account_type;
  v_window_secs  int := 30 * 60;  -- 30 minutes
begin
  if v_uid is null and v_role <> 'service_role' then
    raise exception 'complete_business_signup: must be authenticated' using errcode = '42501';
  end if;
  if p_company_name is null or length(trim(p_company_name)) = 0 then
    raise exception 'complete_business_signup: company_name required';
  end if;

  -- Idempotency: if the row exists, return its id
  select id into v_existing from public.business_profiles where user_id = v_uid;
  if v_existing is not null then return v_existing; end if;

  select id, account_type, created_at into v_profile
    from public.user_profiles where id = v_uid;
  if v_profile.id is null then
    raise exception 'complete_business_signup: no user_profiles row';
  end if;

  if v_profile.account_type = 'business'::public.account_type then
    raise exception 'complete_business_signup: account is already business; contact support'
      using errcode = '42501';
  end if;

  v_age_seconds := extract(epoch from (now() - v_profile.created_at));
  if v_age_seconds > v_window_secs and v_role <> 'service_role' then
    raise exception 'complete_business_signup: signup window expired (account age %s). Use the admin upgrade path.',
      v_age_seconds::int
      using errcode = '42501';
  end if;

  v_old := v_profile.account_type;

  insert into public.business_profiles (user_id, company_name, registration_number, country, status, metadata)
  values (v_uid, trim(p_company_name), p_registration_number, p_country, 'active',
          jsonb_build_object('source', 'self_signup_finalize'))
  returning id into v_bp_id;

  insert into public.account_type_audit (user_id, from_type, to_type, source, reviewer_id, payload)
  values (
    v_uid, v_old, 'business'::public.account_type,
    'signup',
    v_uid,
    jsonb_build_object(
      'rpc',                 'complete_business_signup',
      'company_name',        p_company_name,
      'registration_number', p_registration_number,
      'country',             p_country,
      'window_seconds',      v_age_seconds
    )
  );

  return v_bp_id;
end;
$$;

revoke all     on function public.complete_business_signup(text, text, text) from public;
grant  execute on function public.complete_business_signup(text, text, text) to authenticated;
