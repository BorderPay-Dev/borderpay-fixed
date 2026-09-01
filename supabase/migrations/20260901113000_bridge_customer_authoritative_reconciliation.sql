-- Bridge customer/KYC/KYB reconciliation is an identity projection repair.
-- It does not create provider resources or perform money movement.

create table if not exists public.bridge_customer_reconcile_runtime (
  singleton boolean primary key default true check (singleton),
  next_offset integer not null default 0 check (next_offset >= 0),
  last_invoked_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.bridge_customer_reconcile_runtime(singleton, next_offset)
values (true, 0)
on conflict (singleton) do nothing;

alter table public.bridge_customer_reconcile_runtime enable row level security;
revoke all on table public.bridge_customer_reconcile_runtime from public, anon, authenticated;
grant select, insert, update on table public.bridge_customer_reconcile_runtime to service_role;

create or replace function public.invoke_bridge_customer_reconcile_batch()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_worker_url text := coalesce(
    nullif(current_setting('app.process_pending_events_url', true), ''),
    nullif(public.app_config_get('worker_url'), '')
  );
  v_worker_token text := coalesce(
    nullif(current_setting('app.process_pending_events_jwt', true), ''),
    nullif(public.app_config_get('worker_auth_token'), '')
  );
  v_url text;
  v_offset integer;
  v_total integer;
  v_limit constant integer := 25;
begin
  if v_worker_url is null or v_worker_token is null then
    raise warning 'Bridge customer reconciliation skipped: worker runtime configuration missing';
    return;
  end if;

  v_url := regexp_replace(v_worker_url, '/process-pending-events/?$', '/bridge-reconcile-customers');
  if v_url = v_worker_url then
    raise warning 'Bridge customer reconciliation skipped: worker URL is not canonical';
    return;
  end if;

  select count(*)::integer into v_total
  from (
    select up.id as user_id
    from public.user_profiles up
    where up.bridge_customer_id is not null
      and coalesce(up.is_admin, false) = false
    union
    select bp.user_id
    from public.business_profiles bp
    left join public.user_profiles up on up.id = bp.user_id
    where bp.bridge_customer_id is not null
      and coalesce(up.is_admin, false) = false
  ) owners;

  select next_offset into v_offset
  from public.bridge_customer_reconcile_runtime
  where singleton = true
  for update;

  if v_total = 0 or v_offset >= v_total then v_offset := 0; end if;

  update public.bridge_customer_reconcile_runtime
  set next_offset = case when v_total = 0 or v_offset + v_limit >= v_total then 0 else v_offset + v_limit end,
      last_invoked_at = now(),
      updated_at = now()
  where singleton = true;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_worker_token
    ),
    body := jsonb_build_object(
      'offset', v_offset,
      'limit', v_limit,
      'dry_run', false
    ),
    timeout_milliseconds := 55000
  );
end;
$function$;

revoke all on function public.invoke_bridge_customer_reconcile_batch() from public, anon, authenticated;
grant execute on function public.invoke_bridge_customer_reconcile_batch() to service_role;

do $schedule$
begin
  if exists (select 1 from cron.job where jobname = 'bridge-customer-reconcile') then
    perform cron.unschedule('bridge-customer-reconcile');
  end if;
  perform cron.schedule(
    'bridge-customer-reconcile',
    '*/5 * * * *',
    'select public.invoke_bridge_customer_reconcile_batch();'
  );
end;
$schedule$;

notify pgrst, 'reload schema';
