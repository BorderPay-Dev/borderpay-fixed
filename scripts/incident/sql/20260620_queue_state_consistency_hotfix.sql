-- INCIDENT-ONLY TOOL
-- This script redefines queue lifecycle RPCs and must never be used in
-- normal deploy/migration flows. Execute only with explicit incident approval.

set search_path = public, pg_temp;

create or replace function public.complete_pending_event(
  p_event_id text,
  p_summary jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  update public.webhook_logs
     set status = 'completed',
         completed_at = now()
   where event_id = p_event_id;

  update public.pending_events
     set status = 'completed',
         completed_at = now(),
         last_error = null,
         updated_at = now()
   where event_id = p_event_id;

end;
$function$;

create or replace function public.fail_pending_event(
  p_event_id text,
  p_error text,
  p_backoff_seconds integer default null::integer
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_current  public.pending_events%rowtype;
  v_backoff  integer;
  v_terminal boolean;
begin
  select *
    into v_current
    from public.pending_events
   where event_id = p_event_id
   for update;

  if not found then
    return;
  end if;

  v_terminal := v_current.attempts >= v_current.max_attempts;
  v_backoff := coalesce(
    p_backoff_seconds,
    least(900, 30 * (2 ^ greatest(v_current.attempts - 1, 0))::int)
  );

  update public.pending_events
     set status          = case when v_terminal then 'failed' else 'queued' end,
         locked_by       = null,
         locked_at       = null,
         last_error      = p_error,
         next_attempt_at = case
           when v_terminal then now()
           else now() + (v_backoff || ' seconds')::interval
         end,
         updated_at      = now()
   where event_id = p_event_id;

  update public.webhook_logs
     set status     = case when v_terminal then 'failed' else 'queued' end,
         attempts   = v_current.attempts,
         last_error = p_error
   where event_id = p_event_id;
end;
$function$;
