-- DRY-RUN PACKAGE: DB Lifecycle Lock (RPC-only mutation model)
-- -----------------------------------------------------------------------------
-- IMPORTANT: This script is intentionally non-runnable by default.
-- Remove the guard block only after explicit approval, staged rehearsal, and
-- deployment-window signoff.

do $$
begin
  raise exception 'DRY_RUN_ONLY: remove guard in 20260621_db_lifecycle_lock_rpc_only.sql before execution';
end
$$;

-- [Execution intent]
-- 1) Revoke direct UPDATE on lifecycle tables from application roles.
-- 2) Keep lifecycle mutation through canonical RPCs only.
-- 3) Preserve read paths and non-lifecycle writes where required.

begin;

-- Step 0: Baseline snapshots (operator copy-out before apply)
-- select grantee, table_schema, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name in ('pending_events','bridge_webhook_events','bridge_transfers')
-- order by table_name, grantee, privilege_type;

-- Step 1: Revoke direct status mutation surface.
revoke update on table public.pending_events from anon, authenticated, service_role;
revoke update on table public.bridge_webhook_events from anon, authenticated, service_role;
revoke update on table public.bridge_transfers from anon, authenticated, service_role;

-- Step 2: Re-grant minimal non-status updates only if required by runtime.
-- NOTE: Keep this list as tight as possible. DO NOT include lifecycle status
-- columns under RPC-only model.
-- grant update (target_entity_type, target_entity_id) on public.bridge_webhook_events to service_role;

-- Step 3: Ensure canonical lifecycle RPC execute grants exist.
-- These should be the ONLY mutation entry points for pending_events lifecycle.
-- Signature list may differ by environment; operator must verify via pg_proc.
grant execute on function public.claim_pending_events(text, integer) to service_role;
grant execute on function public.complete_pending_event(text, jsonb) to service_role;
grant execute on function public.fail_pending_event(text, text, integer) to service_role;
grant execute on function public.reap_stuck_processing(integer) to service_role;

-- Optional (if adopting transition_state RPC in a later patch):
-- grant execute on function public.transition_lifecycle_state(text, text, jsonb) to service_role;

commit;

-- Post-apply verification (read-only)
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name in ('pending_events','bridge_webhook_events','bridge_transfers')
-- order by table_name, grantee, privilege_type;
--
-- select proname
-- from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname in ('claim_pending_events','complete_pending_event','fail_pending_event','reap_stuck_processing')
-- order by proname;
