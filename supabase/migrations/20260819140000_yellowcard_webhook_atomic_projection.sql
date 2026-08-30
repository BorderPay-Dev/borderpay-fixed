-- Apply signed Yellow Card evidence and transaction projection atomically.
-- Signature verification remains in the Edge receiver; this RPC is callable
-- only by service_role and locks the correlated transaction before ordering.

create or replace function public.apply_yellowcard_webhook_event(
  p_environment text,
  p_event_fingerprint text,
  p_sequence_id text,
  p_provider_transaction_id text,
  p_event_name text,
  p_status text,
  p_api_key_prefix text,
  p_raw_payload jsonb,
  p_executed_at timestamptz,
  p_direction text,
  p_project_transaction boolean,
  p_error_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction record;
  v_previous_executed_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_environment not in ('sandbox', 'production')
     or nullif(p_event_fingerprint, '') is null
     or nullif(p_sequence_id, '') is null
     or nullif(p_provider_transaction_id, '') is null
     or nullif(p_event_name, '') is null
     or nullif(p_status, '') is null
     or p_raw_payload is null
     or jsonb_typeof(p_raw_payload) <> 'object'
     or p_executed_at is null then
    raise exception 'invalid yellow card webhook contract';
  end if;

  insert into public.yellowcard_webhook_events (
    environment, event_fingerprint, sequence_id, provider_transaction_id,
    event_name, status, api_key_prefix, signature_verified, raw_payload, executed_at
  ) values (
    p_environment, p_event_fingerprint, p_sequence_id, p_provider_transaction_id,
    p_event_name, p_status, p_api_key_prefix, true, p_raw_payload, p_executed_at
  ) on conflict (event_fingerprint) do nothing;

  if not p_project_transaction then
    return jsonb_build_object('code', 'supported_event_recorded');
  end if;
  if p_direction not in ('receive', 'payout') then
    raise exception 'invalid yellow card transaction direction';
  end if;

  select * into v_transaction
  from public.yellowcard_transactions
  where environment = p_environment and sequence_id = p_sequence_id
  for update;

  if not found then
    return jsonb_build_object('code', 'transaction_not_found_retry');
  end if;
  if v_transaction.direction is distinct from p_direction then
    return jsonb_build_object('code', 'direction_mismatch');
  end if;
  if v_transaction.provider_transaction_id is not null
     and v_transaction.provider_transaction_id is distinct from p_provider_transaction_id then
    return jsonb_build_object('code', 'provider_transaction_mismatch');
  end if;

  begin
    v_previous_executed_at := nullif(v_transaction.metadata ->> 'yellowcard_webhook_executed_at', '')::timestamptz;
  exception when others then
    v_previous_executed_at := null;
  end;
  if v_previous_executed_at is not null and v_previous_executed_at >= p_executed_at then
    return jsonb_build_object('code', 'stale_event_ignored');
  end if;

  update public.yellowcard_transactions
  set provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
      provider_status = p_status,
      status = p_status,
      provider_response = coalesce(provider_response, '{}'::jsonb)
        || jsonb_build_object('webhook', p_raw_payload),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'yellowcard_webhook_event', p_event_name,
        'yellowcard_webhook_executed_at', p_executed_at,
        'yellowcard_webhook_signature_verified', true
      ),
      last_error = nullif(p_error_code, ''),
      last_synced_at = now(),
      updated_at = now()
  where id = v_transaction.id;

  return jsonb_build_object('code', 'webhook_applied');
end;
$$;

revoke all on function public.apply_yellowcard_webhook_event(
  text,text,text,text,text,text,text,jsonb,timestamptz,text,boolean,text
) from public, anon, authenticated;
grant execute on function public.apply_yellowcard_webhook_event(
  text,text,text,text,text,text,text,jsonb,timestamptz,text,boolean,text
) to service_role;

-- Row triggers do not fire for TRUNCATE. Add a statement trigger so the raw
-- evidence ledger cannot be cleared through service-role table privileges.
drop trigger if exists trg_yellowcard_webhook_events_no_truncate on public.yellowcard_webhook_events;
create trigger trg_yellowcard_webhook_events_no_truncate
  before truncate on public.yellowcard_webhook_events
  for each statement execute function public.yellowcard_webhook_events_immutable();

revoke update, delete, truncate on public.yellowcard_webhook_events from service_role;

comment on function public.apply_yellowcard_webhook_event(
  text,text,text,text,text,text,text,jsonb,timestamptz,text,boolean,text
) is 'Atomically records verified Yellow Card evidence and projects ordered Receive/Send state.';
