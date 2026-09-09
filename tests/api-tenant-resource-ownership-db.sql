-- Run only against a disposable database after all migrations. The transaction
-- rolls back every fixture.
begin;

do $$
declare
  v_tenant_a uuid := gen_random_uuid();
  v_tenant_b uuid := gen_random_uuid();
  v_key_a uuid := gen_random_uuid();
  v_key_b uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_end_user_a uuid := gen_random_uuid();
  v_end_user_b uuid := gen_random_uuid();
  v_resource uuid;
  v_count integer;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'tenant-a@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'tenant-b@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.api_tenants (id, tenant_name, default_mode, is_active)
  values (v_tenant_a, 'Ownership A', 'sandbox', true),
         (v_tenant_b, 'Ownership B', 'sandbox', true);

  insert into public.api_keys (id, tenant_id, key_prefix, key_hash, scopes, is_active)
  values (v_key_a, v_tenant_a, 'bpk_owner_a', repeat('1', 64), array['*'], true),
         (v_key_b, v_tenant_b, 'bpk_owner_b', repeat('2', 64), array['*'], true);

  -- The same partner reference may exist in separate tenants, but it maps to
  -- distinct immutable auth identities.
  insert into public.api_tenant_end_users (
    id, tenant_id, user_id, external_user_id, account_type, onboarding_channel
  ) values
    (v_end_user_a, v_tenant_a, v_user_a, 'shared-reference', 'business', 'api'),
    (v_end_user_b, v_tenant_b, v_user_b, 'shared-reference', 'business', 'white_label');

  v_resource := public.api_gateway_register_tenant_resource(
    v_tenant_a, v_end_user_a, v_key_a, 'bridge', 'customer', 'cus_authoritative_a'
  );
  if v_resource is null then raise exception 'resource registration returned null'; end if;

  select count(*) into v_count
  from public.api_gateway_assert_tenant_resource(
    v_tenant_a, 'bridge', 'customer', 'cus_authoritative_a'
  );
  if v_count <> 1 then raise exception 'own tenant could not resolve its resource'; end if;

  select count(*) into v_count
  from public.api_gateway_assert_tenant_resource(
    v_tenant_b, 'bridge', 'customer', 'cus_authoritative_a'
  );
  if v_count <> 0 then raise exception 'cross-tenant resource resolved'; end if;

  begin
    perform public.api_gateway_register_tenant_resource(
      v_tenant_b, v_end_user_b, v_key_b, 'bridge', 'customer', 'cus_authoritative_a'
    );
    raise exception 'cross-tenant reassignment succeeded';
  exception
    when insufficient_privilege then null;
  end;

  if not exists (
    select 1 from pg_class c
    where c.oid = 'public.api_tenant_provider_resources'::regclass
      and c.relrowsecurity
  ) then
    raise exception 'resource table RLS is not enabled';
  end if;

  if has_function_privilege('anon',
      'public.api_gateway_assert_tenant_resource(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.api_gateway_register_tenant_resource(uuid,uuid,uuid,text,text,text,uuid,text,jsonb)', 'EXECUTE')
  then
    raise exception 'ownership RPC exposed outside service role';
  end if;
end;
$$;

rollback;
