-- Invoke the Bridge EEA SCA monitor every five minutes. Endpoint and token
-- live in Supabase Vault; no credential or project URL is stored in source.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_sca_monitoring()
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
  select decrypted_secret into worker_url
    from vault.decrypted_secrets
   where name = 'sca_monitoring_worker_url'
   order by updated_at desc limit 1;

  select decrypted_secret into worker_token
    from vault.decrypted_secrets
   where name = 'sca_monitoring_worker_token'
   order by updated_at desc limit 1;

  if worker_url is null
     or worker_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/sca-monitoring$' then
    raise exception 'SCA monitoring worker URL is missing or invalid';
  end if;
  if worker_token is null or length(worker_token) < 32 then
    raise exception 'SCA monitoring worker token is missing or invalid';
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
    raise exception 'SCA monitoring worker invocation was not queued';
  end if;
  return request_id;
end;
$$;
revoke all on function public.invoke_sca_monitoring()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bridge-eea-sca-monitoring') then
    perform cron.unschedule('bridge-eea-sca-monitoring');
  end if;
  perform cron.schedule(
    'bridge-eea-sca-monitoring',
    '*/5 * * * *',
    'select public.invoke_sca_monitoring();'
  );
end;
$$;
