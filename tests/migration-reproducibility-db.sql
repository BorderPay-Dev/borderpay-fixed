\set ON_ERROR_STOP on

do $$
declare
  v_missing text[];
  v_count integer;
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 72 then
    raise exception 'expected 72 applied migrations, found %',
      (select count(*) from supabase_migrations.schema_migrations);
  end if;

  select array_agg(name order by name)
    into v_missing
  from unnest(array[
    'accounts', 'admin_action_audit', 'admin_alerts', 'admin_users',
    'api_onboarding_audit', 'api_onboarding_authorizations', 'api_partner_approvals',
    'api_tenant_end_users', 'api_tenant_provider_resources', 'api_tenants',
    'api_webhook_deliveries', 'api_webhook_events', 'billing_transactions',
    'bridge_external_accounts', 'bridge_transfers', 'bridge_virtual_accounts',
    'bridge_wallets', 'cards', 'kyc_verifications', 'ledger_entries',
    'notifications', 'operator_bridge_accounts', 'pending_events', 'provider_revenue_events', 'stablecoin_transactions',
    'subscriptions', 'transactions', 'user_profiles', 'users', 'wallets',
    'webhook_logs'
  ]) as required(name)
  where to_regclass('public.' || required.name) is null;

  if v_missing is not null then
    raise exception 'missing required public relations: %', v_missing;
  end if;

  if to_regprocedure('public.consume_api_onboarding_authorization(text,public.account_type)') is null then
    raise exception 'consume_api_onboarding_authorization is missing';
  end if;

  if to_regprocedure('public.api_gateway_assert_tenant_resource(uuid,text,text,text)') is null then
    raise exception 'tenant resource ownership assertion is missing';
  end if;

  if to_regprocedure('public.api_gateway_register_tenant_resource(uuid,uuid,uuid,text,text,text,uuid,text,jsonb)') is null then
    raise exception 'tenant resource ownership registration is missing';
  end if;

  if to_regprocedure('public.api_webhook_enqueue_event(uuid,uuid,uuid,text,text,jsonb,timestamp with time zone)') is null then
    raise exception 'partner webhook enqueue function is missing';
  end if;

  if to_regprocedure('public.api_webhook_claim_deliveries(text,integer,integer)') is null then
    raise exception 'partner webhook claim function is missing';
  end if;

  if to_regclass('api_private.api_webhook_runtime_secrets') is null then
    raise exception 'private partner webhook runtime-secret store is missing';
  end if;

  if exists (select 1 from public.app_config where key = 'api_webhook_worker_token') then
    raise exception 'partner webhook worker token remains in public app_config';
  end if;

  if to_regprocedure('public.assert_subscription_revenue_wallets_ready()') is null then
    raise exception 'subscription revenue-wallet readiness assertion is missing';
  end if;

  if to_regprocedure('public.is_operator_bridge_customer(text)') is null then
    raise exception 'operator Bridge customer classifier is missing';
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'operator_bridge_accounts'
    and (column_name, data_type, is_nullable) in (
      ('bridge_customer_id', 'text', 'NO'),
      ('label', 'text', 'NO'),
      ('purpose', 'text', 'NO'),
      ('active', 'boolean', 'NO'),
      ('metadata', 'jsonb', 'NO'),
      ('created_at', 'timestamp with time zone', 'NO'),
      ('updated_at', 'timestamp with time zone', 'NO')
    );

  if v_count <> 7 then
    raise exception 'operator_bridge_accounts column contract mismatch';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'operator_bridge_accounts'
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (bridge_customer_id)'
  ) then
    raise exception 'operator_bridge_accounts primary key mismatch';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'is_operator_bridge_customer'
      and p.prosecdef
      and p.provolatile = 's'
  ) then
    raise exception 'operator classifier must be stable security definer';
  end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'api_tenant_end_users',
      'api_tenant_provider_resources',
      'api_onboarding_authorizations',
      'api_onboarding_audit',
      'api_partner_approvals',
      'operator_bridge_accounts',
      'user_profiles',
      'users'
    )
    and c.relrowsecurity;

  if v_count <> 8 then
    raise exception 'expected RLS on 8 onboarding/profile/operator/resource/approval relations, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'api_tenant_end_users',
      'api_onboarding_authorizations',
      'api_onboarding_audit'
    );

  if v_count <> 6 then
    raise exception 'expected 6 onboarding policies, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'operator_bridge_accounts'
    and policyname in (
      'operator_bridge_accounts_admin_read',
      'operator_bridge_accounts_service_role'
    );

  if v_count <> 2 then
    raise exception 'expected 2 operator account policies, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'api_partner_approvals'
    and policyname in (
      'api_partner_approvals_admin_read',
      'api_partner_approvals_service_role'
    );

  if v_count <> 2 then
    raise exception 'expected 2 API partner approval policies, found %', v_count;
  end if;

  if exists (select 1 from public.billing_revenue_wallets) then
    raise exception 'fresh replay must not fabricate billing revenue-wallet rows';
  end if;

  if not exists (
    select 1
    from public.operator_bridge_accounts
    where bridge_customer_id = '89a7491e-8592-4d23-bb4f-3870f2ddd73b'
      and label = 'BorderPay Africa, Inc.'
      and purpose = 'operator_partner_admin'
      and active
      and metadata @> '{"exclude_from_customer_lifecycle": true, "exclude_from_parity_checks": true}'::jsonb
  ) then
    raise exception 'authoritative operator lifecycle-exclusion configuration is missing';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260814090000'
  ) then
    raise exception 'tenant onboarding security migration is not applied';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260818120000'
  ) then
    raise exception 'API partner approval gate migration is not applied';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260818123000'
  ) then
    raise exception 'tenant assets storage migration is not applied';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260818190000'
  ) then
    raise exception 'unapproved API tenant quarantine migration is not applied';
  end if;

  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260818200000'
  ) then
    raise exception 'provider revenue ledger migration is not applied';
  end if;

  if to_regclass('public.provider_revenue_events') is null then
    raise exception 'provider revenue ledger is missing';
  end if;

  if to_regprocedure('public.admin_provider_revenue_summary()') is null then
    raise exception 'authoritative provider revenue summary RPC is missing';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'tenant-assets'
      and name = 'tenant-assets'
      and public
      and file_size_limit = 1048576
      and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[]
  ) then
    raise exception 'tenant-assets storage bucket contract mismatch';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (qual ilike '%tenant-assets%' or with_check ilike '%tenant-assets%')
  ) then
    raise exception 'tenant-assets must not expose browser storage-object policies';
  end if;
end
$$;

do $$
begin
  begin
    perform public.assert_subscription_revenue_wallets_ready();
    raise exception 'readiness assertion unexpectedly accepted an unconfigured fresh database';
  exception
    when raise_exception then
      if sqlerrm <> 'Active BorderPay whitelist wallets for USDC/Base and USDT/Tron are required' then
        raise;
      end if;
  end;
end
$$;

select 'migration reproducibility assertions passed' as result;
