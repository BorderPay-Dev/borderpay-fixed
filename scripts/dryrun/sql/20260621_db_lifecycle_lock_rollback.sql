-- DRY-RUN PACKAGE: Rollback for lifecycle lock / trigger guard
-- -----------------------------------------------------------------------------
-- IMPORTANT: Intentionally blocked by default.

do $$
begin
  raise exception 'DRY_RUN_ONLY: remove guard in 20260621_db_lifecycle_lock_rollback.sql before execution';
end
$$;

begin;

-- 1) Drop trigger guard if enabled.
drop trigger if exists trg_enforce_pending_events_transition on public.pending_events;
drop trigger if exists trg_enforce_bridge_webhook_events_transition on public.bridge_webhook_events;
drop trigger if exists trg_enforce_bridge_transfers_transition on public.bridge_transfers;

drop function if exists public.enforce_lifecycle_transition_guard();
drop function if exists public.is_valid_lifecycle_transition(text, text, text);

-- 2) Restore broad update privileges (temporary recovery posture only).
-- NOTE: tighten again after incident recovery.
grant update on table public.pending_events to service_role;
grant update on table public.bridge_webhook_events to service_role;
grant update on table public.bridge_transfers to service_role;

-- Optional: restore to authenticated/anon only if historically present.
-- grant update on table public.pending_events to authenticated;
-- grant update on table public.bridge_webhook_events to authenticated;
-- grant update on table public.bridge_transfers to authenticated;

commit;

-- Verification
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name in ('pending_events','bridge_webhook_events','bridge_transfers')
-- order by table_name, grantee, privilege_type;
