-- ============================================================================
-- Run AFTER deploying the `process-pending-events` edge function.
-- Replace YOUR_PROJECT_REF and the Authorization secret with real values.
-- ============================================================================

-- 1. Enable pg_cron + pg_net (Supabase has both pre-installed; idempotent)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Database webhook on INSERT into pending_events.
-- (Supabase usually creates these via the dashboard "Database Webhooks" UI.
--  Equivalent SQL trigger using pg_net is below for IaC-style provisioning.)
create or replace function public.fire_pending_event_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url     text := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-pending-events';
  v_jwt     text := current_setting('app.process_pending_events_jwt', true);
begin
  if v_jwt is null or v_jwt = '' then
    -- Webhook not configured yet — pg_cron will pick the row up.
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

drop trigger if exists trg_fire_pending_event_webhook on public.pending_events;
create trigger trg_fire_pending_event_webhook
  after insert on public.pending_events
  for each row execute function public.fire_pending_event_webhook();

-- 3. pg_cron: drain queue every minute as a safety net.
select cron.schedule(
  'process-pending-events-drain',
  '*/1 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-pending-events',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.process_pending_events_jwt', true)
               ),
    body    := jsonb_build_object('mode','drain','batch_size',50),
    timeout_milliseconds := 25000
  );
  $$
);

-- 4. pg_cron: reap orphan 'processing' rows every 5 minutes.
select cron.schedule(
  'reap-stuck-processing',
  '*/5 * * * *',
  $$ select public.reap_stuck_processing(300); $$
);

-- 5. Stash the worker JWT (service-role token) as a DB GUC so the trigger and
--    cron job can read it without leaking it into pg_cron job definitions.
--    Run this via the Supabase dashboard once:
--      ALTER DATABASE postgres SET app.process_pending_events_jwt TO '<service_role_jwt>';
