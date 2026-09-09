-- Invoke the external certification-audit delivery worker once per minute.
-- Runtime configuration is read from Supabase Vault so no credential or
-- project-specific endpoint is embedded in migration history.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_certification_audit_delivery()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  worker_url text;
  worker_token text;
  request_id bigint;
begin
  select decrypted_secret
    into worker_url
    from vault.decrypted_secrets
   where name = 'certification_audit_worker_url'
   order by updated_at desc
   limit 1;

  select decrypted_secret
    into worker_token
    from vault.decrypted_secrets
   where name = 'certification_audit_worker_token'
   order by updated_at desc
   limit 1;

  if worker_url is null
     or worker_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/certification-audit-delivery$' then
    raise exception 'certification audit worker URL is missing or invalid';
  end if;
  if worker_token is null or length(worker_token) < 32 then
    raise exception 'certification audit worker token is missing or invalid';
  end if;

  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || worker_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;

  if request_id is null then
    raise exception 'certification audit worker invocation was not queued';
  end if;
  return request_id;
end;
$$;

revoke all on function public.invoke_certification_audit_delivery()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'certification-audit-delivery'
  ) then
    perform cron.unschedule('certification-audit-delivery');
  end if;
  perform cron.schedule(
    'certification-audit-delivery',
    '* * * * *',
    'select public.invoke_certification_audit_delivery();'
  );
end;
$$;
