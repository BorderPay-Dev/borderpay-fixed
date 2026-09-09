-- Reconcile signed Bridge refunds/returns against previously earned revenue.
-- Failed transactions never create earnings. A refund appends an immutable
-- reversal only when the same provider source already has an earned fee row.

with raw_refunds as (
  select
    b.event_id,
    b.event_type,
    b.payload_hash,
    coalesce(b.processed_at, b.received_at) as occurred_at,
    b.payload,
    case
      when jsonb_typeof(b.payload -> 'event_object') = 'object' then b.payload -> 'event_object'
      when jsonb_typeof(b.payload -> 'data') = 'object' then b.payload -> 'data'
      else b.payload
    end as obj
  from public.bridge_webhook_events b
  join public.pending_events q
    on q.id = b.pending_event_id
   and q.status = 'completed'
  where b.signature_ok = true
), normalized as (
  select r.*,
    case
      when lower(r.event_type) like '%transfer%'
       and lower(r.event_type) not like '%virtual_account%' then 'bridge_transfer'
      when lower(r.event_type) like '%virtual_account%' then 'bridge_virtual_account'
      else null
    end as source_type,
    lower(coalesce(r.obj ->> 'state', r.obj ->> 'status', r.obj ->> 'type', '')) as refund_status,
    case
      when lower(r.event_type) like '%transfer%'
       and lower(r.event_type) not like '%virtual_account%' then
        coalesce(nullif(r.obj ->> 'transfer_id',''), nullif(r.obj ->> 'id',''), nullif(r.payload ->> 'event_object_id',''))
      else
        coalesce(nullif(r.obj ->> 'deposit_id',''), nullif(r.obj -> 'receipt' ->> 'deposit_id',''),
          nullif(r.obj -> 'receipt' ->> 'id',''), nullif(r.obj -> 'deposit' ->> 'id',''))
    end as source_id
  from raw_refunds r
), refunds as (
  select distinct on (source_type, source_id) *
  from normalized
  where source_type is not null
    and source_id is not null
    and refund_status in ('refunded','returned','canceled','cancelled','refund_complete','refund_completed')
  order by source_type, source_id, occurred_at desc
)
insert into public.provider_revenue_events (
  provider, environment, source_type, source_id, source_event_id, event_kind,
  revenue_category, settlement_status, fee_currency, gross_customer_fee,
  provider_cost, net_revenue, source_amount, source_currency,
  destination_currency, usd_rate, reconciliation_status, evidence, occurred_at
)
select
  earned.provider, earned.environment, earned.source_type, earned.source_id,
  refunds.event_id, 'reversal', earned.revenue_category, 'reversed',
  earned.fee_currency, earned.gross_customer_fee, earned.provider_cost,
  earned.net_revenue, earned.source_amount, earned.source_currency,
  earned.destination_currency, earned.usd_rate, 'reconciled',
  jsonb_build_object(
    'source', 'bridge_webhook_events',
    'event_id', refunds.event_id,
    'event_type', refunds.event_type,
    'payload_hash', refunds.payload_hash,
    'signature_verified', true,
    'refund_status', refunds.refund_status,
    'event_object', refunds.obj
  ),
  refunds.occurred_at
from refunds
join public.provider_revenue_events earned
  on earned.provider = 'bridge'
 and earned.environment = 'live'
 and earned.source_type = refunds.source_type
 and earned.source_id = refunds.source_id
 and earned.event_kind = 'earned'
 and earned.revenue_category = 'developer_fee'
on conflict do nothing;
