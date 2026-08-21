-- ============================================================================
-- 20260510_bridge_webhook_atomic_ingest.sql
-- ----------------------------------------------------------------------------
-- Closes the receiver durability gap in supabase/functions/bridge-webhook.
--
-- Before this migration the receiver did two inserts back-to-back:
--   1. INSERT into bridge_webhook_events
--   2. INSERT into pending_events
-- If (2) failed the event row existed but was never enqueued. Bridge would
-- retry, the unique constraint on event_id would short-circuit (1) into a
-- "duplicate" 200 response, and the orphan would never be processed.
--
-- This migration adds:
--   • ingest_bridge_event(...) — atomic SECURITY DEFINER RPC. Performs both
--     inserts in a single transaction with ON CONFLICT semantics. Returns
--     a row describing whether the event was logged, was a duplicate, or
--     was enqueued.
--   • requeue_stuck_bridge_events(p_age_seconds int) — janitor for any
--     pre-existing rows stuck in processing_status='received' (e.g. from
--     before this migration was deployed). Safe to call repeatedly.
--
-- Both functions run as SECURITY DEFINER and grant EXECUTE to service_role
-- only. The webhook edge function calls these via the service-role key.
-- ============================================================================

set search_path = public, pg_temp;

-- ── 1. Atomic ingest ──────────────────────────────────────────────────────
create or replace function public.ingest_bridge_event(
  p_event_id     text,
  p_event_type   text,
  p_signature_ok boolean,
  p_payload      jsonb,
  p_payload_hash text
)
returns table (
  was_duplicate boolean,
  was_rejected  boolean,
  queued        boolean,
  pending_id    uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_uuid uuid;
  v_pending_id uuid;
  v_now timestamptz := now();
begin
  -- Reject path: signature failed. Audit-only; no enqueue.
  if not p_signature_ok then
    insert into public.bridge_webhook_events
      (event_id, event_type, signature_ok, payload, payload_hash, processing_status, last_error)
    values
      ('rejected_' || p_event_id || '_' || extract(epoch from v_now)::bigint::text,
       'signature_rejected', false, p_payload, p_payload_hash, 'rejected',
       'RSA-SHA256 signature verification failed')
    on conflict (event_id) do nothing;
    return query select false::boolean, true::boolean, false::boolean, null::uuid;
    return;
  end if;

  -- Verified path: insert event row; if duplicate, return early.
  insert into public.bridge_webhook_events
    (event_id, event_type, signature_ok, payload, payload_hash, processing_status, received_at)
  values
    (p_event_id, p_event_type, true, p_payload, p_payload_hash, 'received', v_now)
  on conflict (event_id) do nothing
  returning id into v_event_uuid;

  if v_event_uuid is null then
    return query select true::boolean, false::boolean, false::boolean, null::uuid;
    return;
  end if;

  -- Enqueue. If pending_events insert fails for any reason, the entire
  -- transaction rolls back including the bridge_webhook_events row above —
  -- so the next Bridge retry sees no duplicate and re-runs the whole thing.
  insert into public.pending_events
    (event_id, source, event_type, payload, status)
  values
    ('bridge:' || p_event_id, 'bridge', p_event_type, p_payload, 'queued')
  returning id into v_pending_id;

  update public.bridge_webhook_events
     set processing_status = 'queued',
         queued_at         = v_now,
         pending_event_id  = v_pending_id
   where id = v_event_uuid;

  return query select false::boolean, false::boolean, true::boolean, v_pending_id;
end;
$$;

revoke all on function public.ingest_bridge_event(text, text, boolean, jsonb, text) from public;
grant execute on function public.ingest_bridge_event(text, text, boolean, jsonb, text) to service_role;

-- ── 2. Janitor: requeue rows stuck in 'received' that never reached 'queued' ──
-- Safety net for events that came in before this migration was deployed,
-- and for any future regression that bypasses ingest_bridge_event().
create or replace function public.requeue_stuck_bridge_events(
  p_age_seconds integer default 300,
  p_limit       integer default 100
)
returns table (
  reaped_event_id text,
  pending_id      uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event record;
  v_pending_id uuid;
  v_now timestamptz := now();
begin
  for v_event in
    select id, event_id, event_type, payload
    from public.bridge_webhook_events
    where processing_status = 'received'
      and queued_at is null
      and received_at < v_now - make_interval(secs => p_age_seconds)
    order by received_at asc
    limit p_limit
    for update skip locked
  loop
    -- If a pending_events row already exists for this event, skip.
    if exists (select 1 from public.pending_events where event_id = 'bridge:' || v_event.event_id) then
      update public.bridge_webhook_events
         set processing_status = 'queued',
             queued_at         = v_now
       where id = v_event.id;
      continue;
    end if;

    insert into public.pending_events (event_id, source, event_type, payload, status)
    values ('bridge:' || v_event.event_id, 'bridge', v_event.event_type, v_event.payload, 'queued')
    returning id into v_pending_id;

    update public.bridge_webhook_events
       set processing_status = 'queued',
           queued_at         = v_now,
           pending_event_id  = v_pending_id
     where id = v_event.id;

    reaped_event_id := v_event.event_id;
    pending_id      := v_pending_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.requeue_stuck_bridge_events(integer, integer) from public;
grant execute on function public.requeue_stuck_bridge_events(integer, integer) to service_role;

-- Suggested cron entry (optional; not installed by this migration to keep
-- it idempotent across environments that may not have pg_cron enabled):
--
--   select cron.schedule(
--     'bridge-webhook-reaper',
--     '*/5 * * * *',
--     $$ select public.requeue_stuck_bridge_events(300, 100); $$
--   );
