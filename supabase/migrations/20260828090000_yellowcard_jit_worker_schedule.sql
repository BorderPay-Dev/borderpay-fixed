begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_yellowcard_jit_worker()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  v_url text;
  v_token text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'yellowcard_jit_worker_url'
   order by updated_at desc
   limit 1;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'yellowcard_jit_worker_token'
   order by updated_at desc
   limit 1;

  -- Missing rollout configuration is an intentional no-op. Do not create a
  -- recurring cron error while production payouts are paused.
  if v_url is null
     or v_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/yellowcard-jit-worker$'
     or v_token is null
     or length(v_token) < 32 then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := jsonb_build_object('batch_size', 5),
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_yellowcard_jit_worker()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'yellowcard-jit-worker') then
    perform cron.unschedule('yellowcard-jit-worker');
  end if;
  perform cron.schedule(
    'yellowcard-jit-worker',
    '* * * * *',
    'select public.invoke_yellowcard_jit_worker();'
  );
end;
$$;

commit;
