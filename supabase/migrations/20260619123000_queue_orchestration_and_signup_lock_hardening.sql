-- ============================================================================
-- 20260619123000_queue_orchestration_and_signup_lock_hardening.sql
-- ----------------------------------------------------------------------------
-- High-severity hardening bundle:
--   1) Queue orchestration no longer depends on placeholder URLs
--      (YOUR_PROJECT_REF). Trigger/cron now use DB GUCs and fail-closed.
--   2) Signup abuse limiter is made race-safe under concurrency using
--      transaction-scoped advisory locks.
-- ============================================================================

set search_path = public, extensions, pg_temp;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1) Queue orchestration hardening (config-driven, no hardcoded project ref)
--
-- Runtime config resolution (backward-compatible):
--   Preferred:
--     current_setting('app.process_pending_events_url', true)
--     current_setting('app.process_pending_events_jwt', true)
--   Fallback (legacy, already used in production today):
--     app_config_get('worker_url')
--     app_config_get('worker_auth_token')
-- ---------------------------------------------------------------------------

create or replace function public.fire_pending_event_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text := coalesce(
    nullif(current_setting('app.process_pending_events_url', true), ''),
    nullif(public.app_config_get('worker_url'), '')
  );
  v_jwt text := coalesce(
    nullif(current_setting('app.process_pending_events_jwt', true), ''),
    nullif(public.app_config_get('worker_auth_token'), '')
  );
begin
  -- Fail closed when config is absent: event remains queued and pg_cron drain
  -- path will process once configured.
  if v_url is null or v_jwt is null then
    return NEW;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_jwt
               ),
    body    := jsonb_build_object(
                 'type',   'INSERT',
                 'table',  'pending_events',
                 'record', row_to_json(NEW)
               ),
    timeout_milliseconds := 2000
  );
  return NEW;
end;
$$;

-- Wrapper called by pg_cron every minute; reads current DB settings at runtime
-- so URL/JWT rotation does not require migration edits.
create or replace function public.invoke_process_pending_events_drain(
  p_batch_size int default 50
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text := coalesce(
    nullif(current_setting('app.process_pending_events_url', true), ''),
    nullif(public.app_config_get('worker_url'), '')
  );
  v_jwt text := coalesce(
    nullif(current_setting('app.process_pending_events_jwt', true), ''),
    nullif(public.app_config_get('worker_auth_token'), '')
  );
begin
  if v_url is null or v_jwt is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_jwt
               ),
    body    := jsonb_build_object('mode', 'drain', 'batch_size', greatest(1, least(coalesce(p_batch_size, 50), 100))),
    timeout_milliseconds := 25000
  );
end;
$$;

revoke all on function public.invoke_process_pending_events_drain(int) from public;
grant execute on function public.invoke_process_pending_events_drain(int) to service_role;

-- Recreate cron schedules idempotently.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-pending-events-drain') then
    perform cron.unschedule('process-pending-events-drain');
  end if;
  perform cron.schedule(
    'process-pending-events-drain',
    '*/1 * * * *',
    'select public.invoke_process_pending_events_drain(50);'
  );

  if exists (select 1 from cron.job where jobname = 'reap-stuck-processing') then
    perform cron.unschedule('reap-stuck-processing');
  end if;
  perform cron.schedule(
    'reap-stuck-processing',
    '*/5 * * * *',
    'select public.reap_stuck_processing(300);'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Signup abuse limiter race hardening
-- ---------------------------------------------------------------------------

create or replace function public.enforce_signup_abuse_protection(
  p_email text,
  p_ip inet default null,
  p_user_agent text default null,
  p_email_limit_per_hour int default 5,
  p_ip_limit_per_hour int default 25,
  p_cooldown_seconds int default 20
)
returns table (
  allowed boolean,
  code text,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_email text;
  v_hash text;
  v_email_count int := 0;
  v_ip_count int := 0;
  v_last_at timestamptz;
  v_retry int := 0;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    return query select false, 'email_required'::text, 0;
    return;
  end if;

  v_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');

  -- Serialize checks+insert per normalized email (and per IP when present)
  -- to prevent burst concurrency from bypassing limits.
  perform pg_advisory_xact_lock(hashtextextended('signup_email:' || v_hash, 0));
  if p_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('signup_ip:' || host(p_ip), 0));
  end if;

  select count(*)::int into v_email_count
    from public.signup_abuse_events
   where email_hash = v_hash
     and created_at > v_now - interval '1 hour';

  if p_ip is not null then
    select count(*)::int into v_ip_count
      from public.signup_abuse_events
     where ip_address = p_ip
       and created_at > v_now - interval '1 hour';
  end if;

  select max(created_at) into v_last_at
    from public.signup_abuse_events
   where email_hash = v_hash
      or (p_ip is not null and ip_address = p_ip);

  if v_last_at is not null and v_last_at > v_now - make_interval(secs => greatest(1, p_cooldown_seconds)) then
    v_retry := greatest(1, ceil(extract(epoch from ((v_last_at + make_interval(secs => greatest(1, p_cooldown_seconds))) - v_now)))::int);
    return query select false, 'cooldown'::text, v_retry;
    return;
  end if;

  if v_email_count >= greatest(1, p_email_limit_per_hour) then
    return query select false, 'email_rate_limited'::text, 3600;
    return;
  end if;

  if p_ip is not null and v_ip_count >= greatest(1, p_ip_limit_per_hour) then
    return query select false, 'ip_rate_limited'::text, 3600;
    return;
  end if;

  insert into public.signup_abuse_events (email_hash, ip_address, user_agent)
  values (v_hash, p_ip, left(coalesce(p_user_agent, ''), 512));

  return query select true, 'ok'::text, 0;
end;
$$;

revoke all on function public.enforce_signup_abuse_protection(text, inet, text, int, int, int) from public;
grant execute on function public.enforce_signup_abuse_protection(text, inet, text, int, int, int) to service_role;
