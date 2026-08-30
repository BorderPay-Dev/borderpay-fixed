-- Production Yellow Card just-in-time payout orchestration.
-- This migration creates durable intent/reservation state only. Provider calls
-- remain fail closed until the production worker is deployed and enabled.
begin;

create table if not exists public.yellowcard_jit_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  sequence_id uuid not null unique,
  bridge_wallet_id text not null references public.bridge_wallets(bridge_wallet_id) on delete restrict,
  settlement_asset text not null check (settlement_asset in ('USDC','USDT','EURC')),
  settlement_network text not null check (settlement_network in ('BASE','TRON')),
  settlement_amount numeric(30,12) not null check (settlement_amount > 0),
  settlement_amount_minor bigint not null check (settlement_amount_minor > 0),
  customer_debit_amount numeric(30,12) not null check (customer_debit_amount > settlement_amount),
  customer_debit_amount_minor bigint not null check (customer_debit_amount_minor > settlement_amount_minor),
  destination_country text not null check (destination_country ~ '^[A-Z]{2}$'),
  destination_currency text not null check (destination_currency ~ '^[A-Z]{3}$'),
  destination_amount numeric(30,6) not null check (destination_amount > 0),
  channel text not null check (channel in ('bank','mobile_money')),
  provider_fee_amount_local numeric(30,6) not null default 0 check (provider_fee_amount_local >= 0),
  provider_fee_currency text not null check (provider_fee_currency ~ '^[A-Z]{3}$'),
  borderpay_fee_amount numeric(30,12) not null check (borderpay_fee_amount > 0),
  borderpay_fee_amount_minor bigint not null check (borderpay_fee_amount_minor > 0),
  state text not null default 'PENDING_SWEEP' check (state in (
    'PENDING_SWEEP',
    'SEND_INTENT_CREATED',
    'TREASURY_SWEEP_SENT',
    'YELLOW_CARD_CREDITED',
    'DISPATCHED_TO_RAILS',
    'COMPLETED',
    'FAILED'
  )),
  bridge_transfer_id text,
  yellowcard_credit_transaction_id text,
  yellowcard_send_transaction_id text,
  yellowcard_send_sequence_id text,
  yellowcard_funding_address text,
  yellowcard_funding_expires_at timestamptz,
  provider_status text,
  failure_code text,
  failure_detail text,
  sweep_sent_at timestamptz,
  yellowcard_send_created_at timestamptz,
  yellowcard_credited_at timestamptz,
  dispatched_at timestamptz,
  sla_started_at timestamptz,
  sla_due_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  worker_lock_token uuid,
  worker_locked_until timestamptz,
  last_worker_error text,
  recipient_ciphertext text not null,
  recipient_key_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check ((settlement_asset = 'USDT' and settlement_network = 'TRON') or
         (settlement_asset in ('USDC','EURC') and settlement_network = 'BASE'))
);

create index if not exists yellowcard_jit_payouts_worker_idx
  on public.yellowcard_jit_payouts(state, next_attempt_at, worker_locked_until, updated_at);
create index if not exists yellowcard_jit_payouts_user_idx
  on public.yellowcard_jit_payouts(user_id, created_at desc);
create unique index if not exists yellowcard_jit_payouts_bridge_transfer_uidx
  on public.yellowcard_jit_payouts(bridge_transfer_id) where bridge_transfer_id is not null;
create unique index if not exists yellowcard_jit_payouts_credit_uidx
  on public.yellowcard_jit_payouts(yellowcard_credit_transaction_id)
  where yellowcard_credit_transaction_id is not null;
create unique index if not exists yellowcard_jit_payouts_send_uidx
  on public.yellowcard_jit_payouts(yellowcard_send_transaction_id)
  where yellowcard_send_transaction_id is not null;

create table if not exists public.yellowcard_jit_payout_events (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.yellowcard_jit_payouts(id) on delete restrict,
  event_key text not null unique,
  from_state text,
  to_state text not null,
  source text not null check (source in ('api','bridge_webhook','yellowcard_webhook','worker','operator')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.yellowcard_jit_payouts enable row level security;
alter table public.yellowcard_jit_payout_events enable row level security;

drop policy if exists yellowcard_jit_payouts_owner_read on public.yellowcard_jit_payouts;
create policy yellowcard_jit_payouts_owner_read on public.yellowcard_jit_payouts
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists yellowcard_jit_payouts_admin_read on public.yellowcard_jit_payouts;
create policy yellowcard_jit_payouts_admin_read on public.yellowcard_jit_payouts
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists yellowcard_jit_payouts_service on public.yellowcard_jit_payouts;
create policy yellowcard_jit_payouts_service on public.yellowcard_jit_payouts
  for all to service_role using (true) with check (true);

drop policy if exists yellowcard_jit_payout_events_owner_read on public.yellowcard_jit_payout_events;
create policy yellowcard_jit_payout_events_owner_read on public.yellowcard_jit_payout_events
  for select to authenticated using (
    exists (
      select 1 from public.yellowcard_jit_payouts p
      where p.id = payout_id and p.user_id = auth.uid()
    )
  );
drop policy if exists yellowcard_jit_payout_events_admin_read on public.yellowcard_jit_payout_events;
create policy yellowcard_jit_payout_events_admin_read on public.yellowcard_jit_payout_events
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists yellowcard_jit_payout_events_service on public.yellowcard_jit_payout_events;
create policy yellowcard_jit_payout_events_service on public.yellowcard_jit_payout_events
  for all to service_role using (true) with check (true);

create or replace function public.yellowcard_jit_payout_events_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'yellowcard_jit_payout_events is immutable';
end;
$$;
drop trigger if exists trg_yellowcard_jit_payout_events_immutable on public.yellowcard_jit_payout_events;
create trigger trg_yellowcard_jit_payout_events_immutable
  before update or delete on public.yellowcard_jit_payout_events
  for each row execute function public.yellowcard_jit_payout_events_immutable();
drop trigger if exists trg_yellowcard_jit_payout_events_no_truncate on public.yellowcard_jit_payout_events;
create trigger trg_yellowcard_jit_payout_events_no_truncate
  before truncate on public.yellowcard_jit_payout_events
  for each statement execute function public.yellowcard_jit_payout_events_immutable();

create or replace function public.reserve_yellowcard_jit_payout(
  p_user_id uuid,
  p_idempotency_key text,
  p_sequence_id uuid,
  p_bridge_wallet_id text,
  p_settlement_asset text,
  p_settlement_network text,
  p_settlement_amount numeric,
  p_destination_country text,
  p_destination_currency text,
  p_destination_amount numeric,
  p_channel text,
  p_provider_fee_amount_local numeric,
  p_recipient_ciphertext text,
  p_recipient_key_version text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_asset text := upper(trim(coalesce(p_settlement_asset,'')));
  v_network text := upper(trim(coalesce(p_settlement_network,'')));
  v_amount_minor bigint;
  v_borderpay_fee_minor bigint;
  v_customer_debit_minor bigint;
  v_available_minor bigint;
  v_reserved_minor bigint;
  v_existing public.yellowcard_jit_payouts%rowtype;
  v_created public.yellowcard_jit_payouts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null or p_sequence_id is null or
     length(trim(coalesce(p_idempotency_key,''))) < 8 or
     length(trim(coalesce(p_idempotency_key,''))) > 128 then
    raise exception 'invalid payout identity';
  end if;
  if p_settlement_amount is null or p_settlement_amount <= 0 then raise exception 'invalid settlement amount'; end if;
  if p_provider_fee_amount_local < 0 then
    raise exception 'invalid fee amount';
  end if;
  if coalesce(p_recipient_ciphertext,'') = '' or coalesce(p_recipient_key_version,'') = '' then
    raise exception 'encrypted recipient required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('yellowcard-jit:' || p_bridge_wallet_id, 0));

  select * into v_existing
  from public.yellowcard_jit_payouts
  where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('created',false,'payout_id',v_existing.id,'state',v_existing.state);
  end if;

  if not exists (
    select 1 from public.bridge_wallets w
    where w.bridge_wallet_id=p_bridge_wallet_id
      and (w.user_id=p_user_id or w.business_user_id=p_user_id)
      and upper(w.currency)=v_asset
      and upper(w.chain)=v_network
      and w.status='active'
  ) then raise exception 'active owned settlement wallet required'; end if;

  v_amount_minor := round(p_settlement_amount * 1000000)::bigint;
  -- Integer arithmetic keeps the database reservation identical to the
  -- TypeScript 200-bps half-up calculation at six-decimal precision.
  v_borderpay_fee_minor := (v_amount_minor * 200 + 5000) / 10000;
  v_customer_debit_minor := v_amount_minor + v_borderpay_fee_minor;
  select coalesce(sum(case when lower(l.direction)='debit' then -abs(l.amount_minor) else abs(l.amount_minor) end),0)
    into v_available_minor
  from public.bridge_balance_ledger l
  where l.entity_type='wallet'
    and l.entity_id=p_bridge_wallet_id
    and upper(l.currency)=v_asset
    and (l.user_id=p_user_id or l.business_user_id=p_user_id);

  select coalesce(sum(p.customer_debit_amount_minor),0) into v_reserved_minor
  from public.yellowcard_jit_payouts p
  where p.bridge_wallet_id=p_bridge_wallet_id
    and p.state in ('PENDING_SWEEP','SEND_INTENT_CREATED','TREASURY_SWEEP_SENT');

  if v_available_minor - v_reserved_minor < v_customer_debit_minor then
    raise exception 'insufficient unreserved wallet balance';
  end if;

  insert into public.yellowcard_jit_payouts(
    user_id,idempotency_key,sequence_id,bridge_wallet_id,
    settlement_asset,settlement_network,settlement_amount,settlement_amount_minor,
    customer_debit_amount,customer_debit_amount_minor,
    destination_country,destination_currency,destination_amount,channel,
    provider_fee_amount_local,provider_fee_currency,borderpay_fee_amount,borderpay_fee_amount_minor,
    recipient_ciphertext,recipient_key_version,metadata
  ) values (
    p_user_id,trim(p_idempotency_key),p_sequence_id,p_bridge_wallet_id,
    v_asset,v_network,p_settlement_amount,v_amount_minor,
    v_customer_debit_minor / 1000000.0,v_customer_debit_minor,
    upper(trim(p_destination_country)),upper(trim(p_destination_currency)),p_destination_amount,lower(trim(p_channel)),
    p_provider_fee_amount_local,upper(trim(p_destination_currency)),v_borderpay_fee_minor / 1000000.0,v_borderpay_fee_minor,
    p_recipient_ciphertext,p_recipient_key_version,coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_created;

  insert into public.yellowcard_jit_payout_events(payout_id,event_key,from_state,to_state,source,evidence)
  values(v_created.id,'reserve:' || v_created.sequence_id,null,'PENDING_SWEEP','api',
    jsonb_build_object(
      'settlement_asset',v_asset,
      'settlement_network',v_network,
      'settlement_amount_minor',v_amount_minor,
      'borderpay_fee_amount_minor',v_borderpay_fee_minor,
      'customer_debit_amount_minor',v_customer_debit_minor
    ));

  return jsonb_build_object('created',true,'payout_id',v_created.id,'state',v_created.state);
end;
$$;

revoke all on function public.reserve_yellowcard_jit_payout(
  uuid,text,uuid,text,text,text,numeric,text,text,numeric,text,numeric,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.reserve_yellowcard_jit_payout(
  uuid,text,uuid,text,text,text,numeric,text,text,numeric,text,numeric,text,text,jsonb
) to service_role;

create or replace function public.claim_yellowcard_jit_payouts(
  p_lock_token uuid,
  p_limit integer default 10,
  p_lease_seconds integer default 90
) returns setof public.yellowcard_jit_payouts
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_lock_token is null or p_limit < 1 or p_limit > 25 or p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'invalid worker claim';
  end if;

  return query
  with candidates as (
    select p.id
    from public.yellowcard_jit_payouts p
    where p.state in ('PENDING_SWEEP','SEND_INTENT_CREATED')
      and p.next_attempt_at <= now()
      and (p.worker_locked_until is null or p.worker_locked_until < now())
    order by p.created_at
    for update skip locked
    limit p_limit
  )
  update public.yellowcard_jit_payouts p set
    worker_lock_token=p_lock_token,
    worker_locked_until=now() + make_interval(secs => p_lease_seconds),
    updated_at=now()
  from candidates c
  where p.id=c.id
  returning p.*;
end;
$$;

revoke all on function public.claim_yellowcard_jit_payouts(uuid,integer,integer)
  from public,anon,authenticated;
grant execute on function public.claim_yellowcard_jit_payouts(uuid,integer,integer)
  to service_role;

create or replace function public.transition_yellowcard_jit_payout(
  p_payout_id uuid,
  p_event_key text,
  p_to_state text,
  p_source text,
  p_evidence jsonb default '{}'::jsonb,
  p_provider_status text default null,
  p_bridge_transfer_id text default null,
  p_yellowcard_credit_transaction_id text default null,
  p_yellowcard_send_transaction_id text default null,
  p_yellowcard_funding_address text default null,
  p_yellowcard_funding_expires_at timestamptz default null,
  p_failure_code text default null,
  p_failure_detail text default null
) returns public.yellowcard_jit_payouts
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row public.yellowcard_jit_payouts%rowtype;
  v_allowed boolean := false;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_event_key is null or p_event_key = '' then raise exception 'event key required'; end if;

  select * into v_row from public.yellowcard_jit_payouts where id=p_payout_id for update;
  if not found then raise exception 'payout not found'; end if;
  if exists(select 1 from public.yellowcard_jit_payout_events where event_key=p_event_key) then return v_row; end if;

  v_allowed :=
    (v_row.state='PENDING_SWEEP' and p_to_state in ('SEND_INTENT_CREATED','FAILED')) or
    (v_row.state='SEND_INTENT_CREATED' and p_to_state in ('TREASURY_SWEEP_SENT','FAILED')) or
    (v_row.state='TREASURY_SWEEP_SENT' and p_to_state in ('YELLOW_CARD_CREDITED','COMPLETED','FAILED')) or
    (v_row.state='YELLOW_CARD_CREDITED' and p_to_state in ('DISPATCHED_TO_RAILS','COMPLETED','FAILED')) or
    (v_row.state='DISPATCHED_TO_RAILS' and p_to_state in ('COMPLETED','FAILED')) or
    (v_row.state=p_to_state);
  if not v_allowed then raise exception 'invalid payout transition: % -> %',v_row.state,p_to_state; end if;

  insert into public.yellowcard_jit_payout_events(payout_id,event_key,from_state,to_state,source,evidence)
  values(v_row.id,p_event_key,v_row.state,p_to_state,p_source,coalesce(p_evidence,'{}'::jsonb));

  update public.yellowcard_jit_payouts set
    state=p_to_state,
    provider_status=coalesce(p_provider_status,provider_status),
    bridge_transfer_id=coalesce(p_bridge_transfer_id,bridge_transfer_id),
    yellowcard_credit_transaction_id=coalesce(p_yellowcard_credit_transaction_id,yellowcard_credit_transaction_id),
    yellowcard_send_transaction_id=coalesce(p_yellowcard_send_transaction_id,yellowcard_send_transaction_id),
    yellowcard_funding_address=coalesce(p_yellowcard_funding_address,yellowcard_funding_address),
    yellowcard_funding_expires_at=coalesce(p_yellowcard_funding_expires_at,yellowcard_funding_expires_at),
    failure_code=case when p_to_state='FAILED' then p_failure_code else failure_code end,
    failure_detail=case when p_to_state='FAILED' then p_failure_detail else failure_detail end,
    sweep_sent_at=case when p_to_state='TREASURY_SWEEP_SENT' then coalesce(sweep_sent_at,v_now) else sweep_sent_at end,
    yellowcard_send_created_at=case when p_to_state='SEND_INTENT_CREATED' then coalesce(yellowcard_send_created_at,v_now) else yellowcard_send_created_at end,
    yellowcard_credited_at=case when p_to_state='YELLOW_CARD_CREDITED' then coalesce(yellowcard_credited_at,v_now) else yellowcard_credited_at end,
    sla_started_at=case when p_to_state='YELLOW_CARD_CREDITED' then coalesce(sla_started_at,v_now) else sla_started_at end,
    sla_due_at=case when p_to_state='YELLOW_CARD_CREDITED' then coalesce(sla_due_at,
      v_now + case when channel='mobile_money' then interval '15 minutes' else interval '24 hours' end) else sla_due_at end,
    dispatched_at=case when p_to_state='DISPATCHED_TO_RAILS' then coalesce(dispatched_at,v_now) else dispatched_at end,
    completed_at=case when p_to_state='COMPLETED' then coalesce(completed_at,v_now) else completed_at end,
    failed_at=case when p_to_state='FAILED' then coalesce(failed_at,v_now) else failed_at end,
    worker_lock_token=null,
    worker_locked_until=null,
    updated_at=v_now
  where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.transition_yellowcard_jit_payout(uuid,text,text,text,jsonb,text,text,text,text,text,timestamptz,text,text)
  from public,anon,authenticated;
grant execute on function public.transition_yellowcard_jit_payout(uuid,text,text,text,jsonb,text,text,text,text,text,timestamptz,text,text)
  to service_role;

revoke insert,update,delete,truncate on public.yellowcard_jit_payout_events from authenticated;
revoke insert,update,delete,truncate on public.yellowcard_jit_payout_events from service_role;
grant select,insert on public.yellowcard_jit_payout_events to service_role;

comment on table public.yellowcard_jit_payouts is
  'Fail-closed production Yellow Card JIT payout state; SLA starts only after verified Yellow Card credit.';

commit;
