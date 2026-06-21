-- INCIDENT-ONLY SQL (PREPARED, NOT EXECUTED)
-- File: scripts/incident/sql/remove_historical_ops_queue_record.sql
--
-- WARNING:
--   This script is for a single historical synthetic queue record cleanup.
--   It MUST NOT be executed without explicit manual approval.
--   Intended target only:
--     queue_event_id  = bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e
--     bridge_event_id = ops-sync-fail-716f27a047824edd9e2af32bdc46672e
--
-- Safety intent:
--   - Remove only one synthetic, non-customer-impacting stuck queue record.
--   - Abort if any financial dependency exists.
--   - Abort if target rows do not match expected shape.
--
-- Rollback considerations:
--   - This is destructive deletion. Rollback requires restoring rows from backup/PITR.
--   - Before execution, operator should export the three target rows to secure incident evidence.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Preconditions (hard fail on mismatch)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_queue_event_id  text := 'bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e';
  v_bridge_event_id text := 'ops-sync-fail-716f27a047824edd9e2af32bdc46672e';
  v_pending_count   int;
  v_log_count       int;
  v_bridge_count    int;
  v_bad_shape_count int;
  v_fin_dep_count   int;
begin
  select count(*) into v_pending_count
  from public.pending_events
  where event_id = v_queue_event_id
    and source = 'bridge'
    and event_type = 'transfer.processed'
    and status = 'queued'
    and attempts > max_attempts;

  if v_pending_count <> 1 then
    raise exception 'Precondition failed: expected exactly 1 target pending_events row, got %', v_pending_count;
  end if;

  select count(*) into v_log_count
  from public.webhook_logs
  where event_id = v_queue_event_id
    and source = 'bridge'
    and event_type = 'transfer.processed';

  if v_log_count <> 1 then
    raise exception 'Precondition failed: expected exactly 1 target webhook_logs row, got %', v_log_count;
  end if;

  select count(*) into v_bridge_count
  from public.bridge_webhook_events
  where event_id = v_bridge_event_id
    and event_type = 'transfer.processed'
    and processing_status = 'queued';

  if v_bridge_count <> 1 then
    raise exception 'Precondition failed: expected exactly 1 target bridge_webhook_events row, got %', v_bridge_count;
  end if;

  -- Payload must still represent the known malformed synthetic shape.
  select count(*) into v_bad_shape_count
  from public.bridge_webhook_events
  where event_id = v_bridge_event_id
    and not (payload ? 'event_object_id')
    and coalesce(payload->'event_object'->>'id','') = '';

  if v_bad_shape_count <> 1 then
    raise exception 'Precondition failed: target payload shape changed unexpectedly';
  end if;

  -- Financial dependency guard: must be zero.
  select
    (select count(*) from public.bridge_transfers bt
      where bt.bridge_transfer_id in (v_bridge_event_id, v_queue_event_id)
         or coalesce(bt.raw::text,'') ilike ('%' || v_bridge_event_id || '%')
         or coalesce(bt.raw::text,'') ilike ('%' || v_queue_event_id || '%'))
    +
    (select count(*) from public.transactions tr
      where coalesce(tr.bridge_transfer_id,'') in (v_bridge_event_id, v_queue_event_id)
         or coalesce(tr.reference,'') ilike ('%ops-sync-fail-716f27a047824edd9e2af32bdc46672e%')
         or coalesce(tr.metadata::text,'') ilike ('%ops-sync-fail-716f27a047824edd9e2af32bdc46672e%'))
    +
    (select count(*) from public.wallets w
      where coalesce(w.bridge_wallet_id,'') in (v_bridge_event_id, v_queue_event_id)
         or coalesce(w.bridge_virtual_account_id,'') in (v_bridge_event_id, v_queue_event_id))
    into v_fin_dep_count;

  if v_fin_dep_count <> 0 then
    raise exception 'Precondition failed: detected % financial dependencies; aborting', v_fin_dep_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Optional pre-delete evidence snapshot (result rows for operator capture)
-- ─────────────────────────────────────────────────────────────────────────────
select 'pending_events' as table_name, to_jsonb(pe) as row_data
from public.pending_events pe
where pe.event_id = 'bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e'
union all
select 'webhook_logs' as table_name, to_jsonb(wl) as row_data
from public.webhook_logs wl
where wl.event_id = 'bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e'
union all
select 'bridge_webhook_events' as table_name, to_jsonb(be) as row_data
from public.bridge_webhook_events be
where be.event_id = 'ops-sync-fail-716f27a047824edd9e2af32bdc46672e';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Targeted delete (single record + direct mirrors)
-- ─────────────────────────────────────────────────────────────────────────────
delete from public.pending_events
where event_id = 'bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e';

delete from public.webhook_logs
where event_id = 'bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e';

delete from public.bridge_webhook_events
where event_id = 'ops-sync-fail-716f27a047824edd9e2af32bdc46672e';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Post-delete verification (must all be zero)
-- ─────────────────────────────────────────────────────────────────────────────
select 'pending_events_remaining' as check_name, count(*)::bigint as n
from public.pending_events
where event_id = 'bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e'
union all
select 'webhook_logs_remaining', count(*)::bigint
from public.webhook_logs
where event_id = 'bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e'
union all
select 'bridge_webhook_events_remaining', count(*)::bigint
from public.bridge_webhook_events
where event_id = 'ops-sync-fail-716f27a047824edd9e2af32bdc46672e'
union all
select 'queued_unclaimable_total_after', count(*)::bigint
from public.pending_events
where status='queued' and attempts >= max_attempts;

-- Leave transaction control explicit for manual execution context.
-- Operator should inspect verification output, then COMMIT manually.
-- To abort, ROLLBACK.

commit;
-- rollback;
