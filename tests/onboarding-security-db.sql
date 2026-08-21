-- Run after applying migrations to a disposable Supabase database:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/onboarding-security-db.sql
-- The transaction always rolls back; it never creates a durable tenant.

begin;

do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_auth uuid := gen_random_uuid();
  v_count integer;
begin
  insert into public.api_tenants (
    id, tenant_name, default_mode, is_active, beta_access_enabled, metadata
  ) values (
    v_tenant,
    'Onboarding Security Test Tenant',
    'sandbox',
    true,
    true,
    jsonb_build_object('onboarding', jsonb_build_object(
      'individual_signup_enabled', true,
      'business_signup_enabled', true,
      'white_label_signup_enabled', true
    ))
  );

  insert into public.api_keys (
    id, tenant_id, key_prefix, key_hash, scopes, is_active
  ) values (
    v_key, v_tenant, 'bpk_test_fixture', repeat('a', 64),
    array['onboarding:write']::text[], true
  );

  insert into public.api_onboarding_authorizations (
    id, tenant_id, api_key_id, token_hash, external_user_id,
    allowed_account_types, onboarding_channel, expires_at
  ) values (
    v_auth, v_tenant, v_key, repeat('b', 64), 'external-1',
    array['individual'::public.account_type], 'white_label', now() + interval '10 minutes'
  );

  select count(*) into v_count
    from public.consume_api_onboarding_authorization(repeat('b', 64), 'individual');
  if v_count <> 1 then raise exception 'first authorization consume failed'; end if;

  select count(*) into v_count
    from public.consume_api_onboarding_authorization(repeat('b', 64), 'individual');
  if v_count <> 0 then raise exception 'authorization replay succeeded'; end if;

  insert into public.api_onboarding_authorizations (
    id, tenant_id, api_key_id, token_hash, external_user_id,
    allowed_account_types, onboarding_channel, created_at, expires_at
  ) values (
    gen_random_uuid(), v_tenant, v_key, repeat('c', 64), 'external-expired',
    array['individual'::public.account_type], 'api', now() - interval '2 hours', now() - interval '1 hour'
  );
  select count(*) into v_count
    from public.consume_api_onboarding_authorization(repeat('c', 64), 'individual');
  if v_count <> 0 then raise exception 'expired authorization succeeded'; end if;

  insert into public.api_onboarding_authorizations (
    id, tenant_id, api_key_id, token_hash, external_user_id,
    allowed_account_types, onboarding_channel, expires_at
  ) values (
    gen_random_uuid(), v_tenant, v_key, repeat('d', 64), 'external-type',
    array['individual'::public.account_type], 'api', now() + interval '10 minutes'
  );
  select count(*) into v_count
    from public.consume_api_onboarding_authorization(repeat('d', 64), 'business');
  if v_count <> 0 then raise exception 'modified account_type succeeded'; end if;

  update public.api_keys set is_active = false, revoked_at = now() where id = v_key;
  insert into public.api_onboarding_authorizations (
    id, tenant_id, api_key_id, token_hash, external_user_id,
    allowed_account_types, onboarding_channel, expires_at
  ) values (
    gen_random_uuid(), v_tenant, v_key, repeat('e', 64), 'external-revoked-key',
    array['individual'::public.account_type], 'api', now() + interval '10 minutes'
  );
  select count(*) into v_count
    from public.consume_api_onboarding_authorization(repeat('e', 64), 'individual');
  if v_count <> 0 then raise exception 'revoked API key authorization succeeded'; end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('users', 'user_profiles')
       and cmd in ('ALL', 'INSERT')
       and roles && array['public', 'authenticated']::name[]
  ) then
    raise exception 'owner profile INSERT policy still exists';
  end if;

  if coalesce((select lower(value) = 'false' from public.app_config where key = 'direct_individual_signup_enabled'), false) is not true then
    raise exception 'direct Individual signup is not disabled';
  end if;
  if coalesce((select lower(value) = 'true' from public.app_config where key = 'direct_business_signup_enabled'), false) is not true then
    raise exception 'direct Business signup is not enabled';
  end if;

  if has_table_privilege('authenticated', 'public.account_origin_provenance', 'INSERT')
     or has_table_privilege('anon', 'public.account_origin_provenance', 'INSERT') then
    raise exception 'browser role can forge account origin provenance';
  end if;

  insert into public.account_origin_provenance (
    user_id, account_type, origin_kind, onboarding_channel, source_path, account_created_at
  ) values (
    gen_random_uuid(), 'business', 'direct', 'direct',
    'supabase/functions/auth-signup', now()
  );

  insert into public.account_origin_provenance (
    user_id, account_type, origin_kind, onboarding_channel, source_path,
    account_created_at, tenant_id, api_key_id, authorization_id, external_user_id
  ) values (
    gen_random_uuid(), 'individual', 'partner', 'white_label',
    'supabase/functions/auth-signup', now(), v_tenant, v_key, v_auth, 'external-partner'
  );

  insert into public.account_origin_provenance (
    user_id, account_type, origin_kind, onboarding_channel, source_path,
    account_created_at, source_reference
  ) values (
    gen_random_uuid(), 'business', 'imported', 'import',
    'approved_account_import', now(), 'approved-import-batch'
  );

  begin
    update public.account_origin_provenance
       set origin_kind = 'direct'
     where origin_kind = 'imported';
    raise exception 'immutable account origin row was updated';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

rollback;
