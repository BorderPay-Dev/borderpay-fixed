-- Keep the partner webhook worker bearer token out of public app_config.
-- app_config_get is a legacy SECURITY DEFINER RPC and remains executable by
-- client roles for compatibility, so it is not an authoritative secret store.

create schema if not exists api_private;
revoke all on schema api_private from public;
revoke all on schema api_private from anon, authenticated;

create table if not exists api_private.api_webhook_runtime_secrets (
  singleton boolean primary key default true check (singleton),
  worker_token text not null check (length(worker_token) >= 32),
  updated_at timestamptz not null default now()
);

revoke all on table api_private.api_webhook_runtime_secrets from public;
revoke all on table api_private.api_webhook_runtime_secrets from anon, authenticated;

-- Preserve the currently configured token during rollout, then remove the
-- client-readable copy. Production rotates this value after the migration.
insert into api_private.api_webhook_runtime_secrets (singleton, worker_token)
select true, value
from public.app_config
where key = 'api_webhook_worker_token'
  and length(coalesce(value, '')) >= 32
on conflict (singleton) do update
set worker_token = excluded.worker_token,
    updated_at = now();

delete from public.app_config where key = 'api_webhook_worker_token';

create or replace function public.invoke_api_webhook_worker()
returns bigint
language plpgsql
security definer
set search_path = public, api_private, extensions
as $$
declare
  v_url text := nullif(public.app_config_get('api_webhook_worker_url'), '');
  v_token text;
  v_request_id bigint;
begin
  select worker_token into v_token
  from api_private.api_webhook_runtime_secrets
  where singleton;

  if v_url is null or v_token is null then
    raise notice 'API webhook worker invocation skipped: runtime config missing';
    return null;
  end if;
  if v_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/api-webhook-worker$' then
    raise exception 'API webhook worker URL is not an approved Supabase function URL';
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := '{"batch_size":50}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.invoke_api_webhook_worker() from public, anon, authenticated;
grant execute on function public.invoke_api_webhook_worker() to service_role;
