-- ============================================================================
-- 20260619124500_queue_runtime_prereq_assertions.sql
-- ----------------------------------------------------------------------------
-- Deployment guardrail:
--   Assert that webhook queue runtime objects exist before go-live migration
--   chains proceed. These objects were historically created out-of-band in
--   some environments; missing objects cause silent queue breakage at runtime.
--
-- This migration is intentionally assertion-only (no destructive DDL).
-- ============================================================================

set search_path = public, pg_temp;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.pending_events') is null then
    v_missing := array_append(v_missing, 'table public.pending_events');
  end if;

  if to_regclass('public.webhook_logs') is null then
    v_missing := array_append(v_missing, 'table public.webhook_logs');
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_pending_events'
  ) then
    v_missing := array_append(v_missing, 'function public.claim_pending_events(...)');
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_pending_event'
  ) then
    v_missing := array_append(v_missing, 'function public.complete_pending_event(...)');
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fail_pending_event'
  ) then
    v_missing := array_append(v_missing, 'function public.fail_pending_event(...)');
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reap_stuck_processing'
  ) then
    v_missing := array_append(v_missing, 'function public.reap_stuck_processing(...)');
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception
      'Queue runtime prerequisites missing: %',
      array_to_string(v_missing, ', ')
      using errcode = 'P0001',
            hint = 'Apply the queue baseline DDL before continuing deployment. Stop go-live until these objects exist.';
  end if;
end;
$$;
