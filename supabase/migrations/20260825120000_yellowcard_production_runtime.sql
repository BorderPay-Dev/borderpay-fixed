-- Authoritative Yellow Card production transaction and signed-webhook schema.
-- Existing sandbox rows, if any, remain immutable historical records; new
-- runtime writes use production explicitly and the default is production.

alter table public.provider_corridor_policy
  drop constraint if exists provider_corridor_policy_provider_check;
alter table public.provider_corridor_policy
  add constraint provider_corridor_policy_provider_check
  check (provider in ('bridge', 'yellow_card'));

create table if not exists public.yellowcard_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  direction text not null check (direction in ('receive', 'payout')),
  sequence_id text not null,
  provider_transaction_id text,
  provider_reference text,
  deposit_id text,
  country_code text not null,
  currency text not null,
  channel text not null check (channel in ('bank', 'mobile_money')),
  provider_channel_id text not null,
  provider_network_id text,
  local_amount numeric(20, 8),
  usd_amount numeric(20, 8),
  converted_amount numeric(20, 8),
  settlement_currency text,
  settlement_network text,
  status text not null default 'submitted',
  provider_status text,
  service_fee_local numeric(20, 8),
  service_fee_usd numeric(20, 8),
  network_fee_local numeric(20, 8),
  network_fee_usd numeric(20, 8),
  partner_fee_local numeric(20, 8),
  partner_fee_usd numeric(20, 8),
  request_payload jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_error text,
  last_synced_at timestamptz
);

alter table public.yellowcard_transactions alter column environment set default 'production';
create unique index if not exists yellowcard_transactions_sequence_uq
  on public.yellowcard_transactions (environment, sequence_id);
create unique index if not exists yellowcard_transactions_provider_id_uq
  on public.yellowcard_transactions (environment, provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists yellowcard_transactions_user_idx
  on public.yellowcard_transactions (user_id, created_at desc);
create index if not exists yellowcard_transactions_status_idx
  on public.yellowcard_transactions (environment, status, updated_at desc);
alter table public.yellowcard_transactions enable row level security;
drop policy if exists yellowcard_transactions_admin_read on public.yellowcard_transactions;
create policy yellowcard_transactions_admin_read on public.yellowcard_transactions
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists yellowcard_transactions_service_role on public.yellowcard_transactions;
create policy yellowcard_transactions_service_role on public.yellowcard_transactions
  for all to service_role using (true) with check (true);
revoke all on table public.yellowcard_transactions from public, anon, authenticated;
grant select on table public.yellowcard_transactions to authenticated;
grant select, insert, update on table public.yellowcard_transactions to service_role;

create table if not exists public.yellowcard_webhook_events (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('sandbox', 'production')),
  event_fingerprint text not null unique,
  sequence_id text not null,
  provider_transaction_id text,
  event_name text not null,
  status text not null,
  api_key_prefix text not null,
  signature_verified boolean not null check (signature_verified = true),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  executed_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists yellowcard_webhook_events_sequence_idx
  on public.yellowcard_webhook_events(environment, sequence_id, executed_at desc);
alter table public.yellowcard_webhook_events enable row level security;
drop policy if exists yellowcard_webhook_events_admin_read on public.yellowcard_webhook_events;
create policy yellowcard_webhook_events_admin_read on public.yellowcard_webhook_events
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists yellowcard_webhook_events_service_insert on public.yellowcard_webhook_events;
create policy yellowcard_webhook_events_service_insert on public.yellowcard_webhook_events
  for insert to service_role with check (signature_verified = true and environment = 'production');

create or replace function public.yellowcard_webhook_events_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'yellowcard_webhook_events is immutable';
end;
$$;
drop trigger if exists trg_yellowcard_webhook_events_immutable on public.yellowcard_webhook_events;
create trigger trg_yellowcard_webhook_events_immutable
  before update or delete on public.yellowcard_webhook_events
  for each row execute function public.yellowcard_webhook_events_immutable();
drop trigger if exists trg_yellowcard_webhook_events_no_truncate on public.yellowcard_webhook_events;
create trigger trg_yellowcard_webhook_events_no_truncate
  before truncate on public.yellowcard_webhook_events
  for each statement execute function public.yellowcard_webhook_events_immutable();
revoke all on table public.yellowcard_webhook_events from public, anon, authenticated;
grant select on table public.yellowcard_webhook_events to authenticated;
grant select, insert on table public.yellowcard_webhook_events to service_role;
revoke update, delete, truncate on public.yellowcard_webhook_events from service_role;

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
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_transaction record;
  v_previous_executed_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_environment <> 'production'
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

  if not p_project_transaction then return jsonb_build_object('code', 'supported_event_recorded'); end if;
  if p_direction not in ('receive', 'payout') then raise exception 'invalid yellow card transaction direction'; end if;

  select * into v_transaction
  from public.yellowcard_transactions
  where environment = 'production' and sequence_id = p_sequence_id
  for update;
  if not found then return jsonb_build_object('code', 'transaction_not_found_retry'); end if;
  if v_transaction.direction is distinct from p_direction then return jsonb_build_object('code', 'direction_mismatch'); end if;
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
      provider_response = coalesce(provider_response, '{}'::jsonb) || jsonb_build_object('webhook', p_raw_payload),
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

comment on table public.yellowcard_transactions is
  'Yellow Card transaction state. Runtime writes production only; historical sandbox rows may remain for audit.';
comment on table public.yellowcard_webhook_events is
  'Immutable raw Yellow Card callbacks accepted only after production HMAC verification.';
