-- DRY-RUN PACKAGE: Optional DB Trigger Guard (defense-in-depth)
-- -----------------------------------------------------------------------------
-- IMPORTANT: Intentionally blocked by default. Remove guard only with explicit
-- approval and after RPC-only lock rollout is stable.

do $$
begin
  raise exception 'DRY_RUN_ONLY: remove guard in 20260621_db_lifecycle_transition_trigger_guard.sql before execution';
end
$$;

begin;

-- Canonical transition checker (SQL mirror of allowed_state_transitions.ts)
create or replace function public.is_valid_lifecycle_transition(
  p_table text,
  p_from text,
  p_to text
) returns boolean
language sql
immutable
as $$
  select
    case
      when lower(coalesce(p_from,'')) = lower(coalesce(p_to,'')) then true

      -- pending_events.status
      when p_table = 'pending_events' and lower(p_from) = 'queued'     and lower(p_to) in ('processing','failed') then true
      when p_table = 'pending_events' and lower(p_from) = 'processing' and lower(p_to) in ('completed','failed','queued') then true
      when p_table = 'pending_events' and lower(p_from) = 'failed'     and lower(p_to) = 'queued' then true

      -- bridge_webhook_events.processing_status
      when p_table = 'bridge_webhook_events' and lower(p_from) = 'received' and lower(p_to) in ('queued','rejected') then true
      when p_table = 'bridge_webhook_events' and lower(p_from) = 'queued'   and lower(p_to) in ('completed','failed') then true
      when p_table = 'bridge_webhook_events' and lower(p_from) = 'failed'   and lower(p_to) = 'queued' then true

      -- bridge_transfers.state
      when p_table = 'bridge_transfers' and lower(p_from) = 'pending' and lower(p_to) in ('succeeded','failed','cancelled','returned','refunded') then true

      else false
    end
$$;

create or replace function public.enforce_lifecycle_transition_guard()
returns trigger
language plpgsql
as $$
declare
  v_table text := tg_table_name;
  v_from text;
  v_to   text;
begin
  if tg_table_name = 'pending_events' then
    v_from := old.status;
    v_to := new.status;
  elsif tg_table_name = 'bridge_webhook_events' then
    v_from := old.processing_status;
    v_to := new.processing_status;
  elsif tg_table_name = 'bridge_transfers' then
    v_from := old.state;
    v_to := new.state;
  else
    return new;
  end if;

  if not public.is_valid_lifecycle_transition(v_table, v_from, v_to) then
    raise exception 'INVALID_STATE_TRANSITION: %.% -> %', v_table, v_from, v_to;
  end if;

  return new;
end
$$;

-- Attach triggers (status-column updates only)
drop trigger if exists trg_enforce_pending_events_transition on public.pending_events;
create trigger trg_enforce_pending_events_transition
before update of status on public.pending_events
for each row execute function public.enforce_lifecycle_transition_guard();

drop trigger if exists trg_enforce_bridge_webhook_events_transition on public.bridge_webhook_events;
create trigger trg_enforce_bridge_webhook_events_transition
before update of processing_status on public.bridge_webhook_events
for each row execute function public.enforce_lifecycle_transition_guard();

drop trigger if exists trg_enforce_bridge_transfers_transition on public.bridge_transfers;
create trigger trg_enforce_bridge_transfers_transition
before update of state on public.bridge_transfers
for each row execute function public.enforce_lifecycle_transition_guard();

commit;

-- Post-apply verification
-- select tgname, tgrelid::regclass as table_name
-- from pg_trigger
-- where tgname in (
--   'trg_enforce_pending_events_transition',
--   'trg_enforce_bridge_webhook_events_transition',
--   'trg_enforce_bridge_transfers_transition'
-- ) and not tgisinternal
-- order by tgname;
