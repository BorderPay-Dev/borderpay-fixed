begin;

do $$
begin
  if to_regclass('public.api_webhook_events') is null then
    raise exception 'missing public.api_webhook_events';
  end if;
  if to_regclass('public.api_webhook_deliveries') is null then
    raise exception 'missing public.api_webhook_deliveries';
  end if;
  if to_regclass('api_private.api_webhook_runtime_secrets') is null then
    raise exception 'missing private API webhook runtime-secret store';
  end if;
  if to_regprocedure('public.api_webhook_enqueue_event(uuid,uuid,uuid,text,text,jsonb,timestamp with time zone)') is null then
    raise exception 'missing api_webhook_enqueue_event RPC';
  end if;
  if to_regprocedure('public.api_webhook_claim_deliveries(text,integer,integer)') is null then
    raise exception 'missing api_webhook_claim_deliveries RPC';
  end if;
  if to_regprocedure('public.api_webhook_finish_delivery(uuid,text,boolean,integer,text,boolean)') is null then
    raise exception 'missing api_webhook_finish_delivery RPC';
  end if;
  if to_regprocedure('public.invoke_api_webhook_worker()') is null then
    raise exception 'missing invoke_api_webhook_worker RPC';
  end if;
  if to_regprocedure('public.api_webhook_enqueue_completed_provider_event()') is null then
    raise exception 'missing completed-provider-event trigger function';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_api_webhook_enqueue_completed_provider_event'
      and tgrelid = 'public.pending_events'::regclass
      and not tgisinternal
  ) then
    raise exception 'missing completed-provider-event trigger';
  end if;
end $$;

do $$
declare
  v_table text;
  v_anon boolean;
  v_authenticated boolean;
  v_service boolean;
begin
  foreach v_table in array array['api_webhook_events', 'api_webhook_deliveries'] loop
    select c.relrowsecurity into strict v_service
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_table;
    if not v_service then raise exception 'RLS disabled for %', v_table; end if;
  end loop;

  select has_function_privilege('anon', 'public.api_webhook_enqueue_event(uuid,uuid,uuid,text,text,jsonb,timestamp with time zone)', 'EXECUTE') into v_anon;
  select has_function_privilege('authenticated', 'public.api_webhook_enqueue_event(uuid,uuid,uuid,text,text,jsonb,timestamp with time zone)', 'EXECUTE') into v_authenticated;
  select has_function_privilege('service_role', 'public.api_webhook_enqueue_event(uuid,uuid,uuid,text,text,jsonb,timestamp with time zone)', 'EXECUTE') into v_service;
  if v_anon or v_authenticated or not v_service then
    raise exception 'api_webhook_enqueue_event privileges are not fail closed';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from public.app_config where key = 'api_webhook_worker_token'
  ) then
    raise exception 'API webhook worker token must not be stored in public app_config';
  end if;
  if has_schema_privilege('anon', 'api_private', 'USAGE')
     or has_schema_privilege('authenticated', 'api_private', 'USAGE') then
    raise exception 'client roles can use the private API webhook schema';
  end if;
  if has_table_privilege('anon', 'api_private.api_webhook_runtime_secrets', 'SELECT')
     or has_table_privilege('authenticated', 'api_private.api_webhook_runtime_secrets', 'SELECT') then
    raise exception 'client roles can read the API webhook runtime secret';
  end if;
end $$;

rollback;
