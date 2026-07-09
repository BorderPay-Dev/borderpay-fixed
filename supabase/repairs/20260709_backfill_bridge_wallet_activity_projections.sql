-- One-time production repair: backfill Bridge wallet activity projections.
--
-- Root cause:
-- Completed bridge_wallet.activity.created events were present, but historical
-- projection rows were missing for transactions, notifications, and the
-- canonical bridge_balance_ledger. Owner resolution is from bridge_wallets,
-- using Bridge wallet IDs from the webhook payload.
--
-- Safety:
-- This script is idempotent. It only processes completed Bridge wallet activity
-- events with a mapped wallet and no existing bridge_balance_ledger row.

with source as (
  select
    w.event_id,
    w.payload,
    w.payload->'event_object' as obj,
    coalesce(w.processed_at, w.received_at, now()) as event_at,
    bw.user_id,
    bw.business_user_id,
    bw.bridge_customer_id,
    bw.bridge_wallet_id,
    upper(coalesce(w.payload->'event_object'->>'currency', bw.currency, 'USDC')) as currency,
    abs(coalesce((w.payload->'event_object'->>'amount')::numeric, 0)) as amount,
    lower(coalesce(w.payload->'event_object'->>'type', '')) as activity_type
  from public.bridge_webhook_events w
  join public.bridge_wallets bw
    on bw.bridge_wallet_id = coalesce(
      w.payload->'event_object'->>'bridge_wallet_id',
      w.payload->'event_object'->>'wallet_id',
      w.payload->>'event_object_id'
    )
  where w.processing_status = 'completed'
    and lower(w.event_type) = 'bridge_wallet.activity.created'
    and coalesce((w.payload->'event_object'->>'amount')::numeric, 0) <> 0
    and not exists (
      select 1
      from public.bridge_balance_ledger b
      where b.event_id = w.event_id
    )
)
insert into public.transactions (
  user_id,
  type,
  amount,
  currency,
  status,
  reference,
  metadata,
  provider,
  description,
  created_at,
  updated_at
)
select
  coalesce(source.user_id, source.business_user_id),
  case
    when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then 'transfer'::transaction_type
    else 'deposit'::transaction_type
  end,
  source.amount,
  source.currency,
  'completed'::transaction_status,
  'bridge:' || source.event_id,
  jsonb_build_object(
    'source', 'bridge',
    'kind', 'wallet_activity',
    'activity_type', nullif(source.activity_type, ''),
    'direction', case
      when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then 'debit'
      else 'credit'
    end,
    'bridge_event_id', source.event_id,
    'bridge_wallet_id', source.bridge_wallet_id,
    'bridge_customer_id', source.bridge_customer_id,
    'raw', source.obj
  ),
  'bridge'::payment_provider,
  case
    when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then 'Wallet transfer debit'
    else 'Wallet deposit credit'
  end,
  source.event_at,
  now()
from source
where coalesce(source.user_id, source.business_user_id) is not null
on conflict (reference) do nothing;

with source as (
  select
    w.event_id,
    w.payload->'event_object' as obj,
    coalesce(w.processed_at, w.received_at, now()) as event_at,
    bw.user_id,
    bw.business_user_id,
    bw.bridge_customer_id,
    bw.bridge_wallet_id,
    upper(coalesce(w.payload->'event_object'->>'currency', bw.currency, 'USDC')) as currency,
    abs(coalesce((w.payload->'event_object'->>'amount')::numeric, 0)) as amount,
    lower(coalesce(w.payload->'event_object'->>'type', '')) as activity_type
  from public.bridge_webhook_events w
  join public.bridge_wallets bw
    on bw.bridge_wallet_id = coalesce(
      w.payload->'event_object'->>'bridge_wallet_id',
      w.payload->'event_object'->>'wallet_id',
      w.payload->>'event_object_id'
    )
  where w.processing_status = 'completed'
    and lower(w.event_type) = 'bridge_wallet.activity.created'
    and coalesce((w.payload->'event_object'->>'amount')::numeric, 0) <> 0
    and not exists (
      select 1
      from public.bridge_balance_ledger b
      where b.event_id = w.event_id
    )
)
insert into public.notifications (
  user_id,
  type,
  title,
  body,
  metadata,
  created_at
)
select
  coalesce(source.user_id, source.business_user_id),
  'transaction',
  case
    when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then 'Transfer sent'
    else 'Deposit received'
  end,
  case
    when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then
      'Sent ' || source.amount::text || ' ' || source.currency || ' via wallet activity.'
    else
      'Received ' || source.amount::text || ' ' || source.currency || ' via wallet activity.'
  end,
  jsonb_build_object(
    'bridge_event_id', source.event_id,
    'bridge_wallet_id', source.bridge_wallet_id,
    'amount', source.amount,
    'currency', source.currency,
    'direction', case
      when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then 'debit'
      else 'credit'
    end,
    'source', 'bridge'
  ),
  source.event_at
from source
where coalesce(source.user_id, source.business_user_id) is not null
  and not exists (
    select 1
    from public.notifications n
    where n.user_id = coalesce(source.user_id, source.business_user_id)
      and n.type = 'transaction'
      and n.metadata @> jsonb_build_object('bridge_event_id', source.event_id)
  );

with source as (
  select
    w.event_id,
    w.payload->'event_object' as obj,
    coalesce(w.processed_at, w.received_at, now()) as event_at,
    bw.user_id,
    bw.business_user_id,
    bw.bridge_customer_id,
    bw.bridge_wallet_id,
    upper(coalesce(w.payload->'event_object'->>'currency', bw.currency, 'USDC')) as currency,
    abs(coalesce((w.payload->'event_object'->>'amount')::numeric, 0)) as amount,
    lower(coalesce(w.payload->'event_object'->>'type', '')) as activity_type
  from public.bridge_webhook_events w
  join public.bridge_wallets bw
    on bw.bridge_wallet_id = coalesce(
      w.payload->'event_object'->>'bridge_wallet_id',
      w.payload->'event_object'->>'wallet_id',
      w.payload->>'event_object_id'
    )
  where w.processing_status = 'completed'
    and lower(w.event_type) = 'bridge_wallet.activity.created'
    and coalesce((w.payload->'event_object'->>'amount')::numeric, 0) <> 0
    and not exists (
      select 1
      from public.bridge_balance_ledger b
      where b.event_id = w.event_id
    )
)
insert into public.bridge_balance_ledger (
  event_id,
  provider,
  entity_type,
  entity_id,
  user_id,
  business_user_id,
  currency,
  amount_minor,
  direction,
  metadata,
  created_at
)
select
  source.event_id,
  'bridge',
  'wallet',
  source.bridge_wallet_id,
  source.user_id,
  source.business_user_id,
  source.currency,
  round(source.amount * power(10::numeric, case when source.currency in ('USDC', 'USDT', 'PYUSD', 'USDB', 'EURC') then 6 else 2 end))::bigint,
  case
    when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then 'debit'
    else 'credit'
  end,
  jsonb_build_object(
    'source', 'bridge',
    'kind', 'wallet_activity',
    'activity_type', nullif(source.activity_type, ''),
    'direction', case
      when source.activity_type in ('withdrawal', 'debit', 'transfer_out', 'payout') then 'debit'
      else 'credit'
    end,
    'bridge_event_id', source.event_id,
    'bridge_wallet_id', source.bridge_wallet_id,
    'bridge_customer_id', source.bridge_customer_id,
    'raw', source.obj,
    'repair', '20260709_backfill_bridge_wallet_activity_projections'
  ),
  source.event_at
from source
on conflict (event_id) do nothing;

update public.bridge_webhook_events w
set
  target_entity_type = 'wallet',
  target_entity_id = coalesce(
    w.payload->'event_object'->>'bridge_wallet_id',
    w.payload->'event_object'->>'wallet_id',
    w.payload->>'event_object_id'
  )
where w.processing_status = 'completed'
  and lower(w.event_type) = 'bridge_wallet.activity.created'
  and coalesce((w.payload->'event_object'->>'amount')::numeric, 0) <> 0
  and target_entity_id is null;
