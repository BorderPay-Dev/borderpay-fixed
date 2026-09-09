-- Make signed Bridge webhooks the authoritative revenue evidence source.
-- Projection tables remain useful read models, but they are no longer revenue
-- writers because some legitimate Bridge flows do not create those rows.

drop trigger if exists trg_capture_bridge_transfer_revenue on public.bridge_transfers;
drop trigger if exists trg_capture_bridge_va_revenue on public.bridge_balance_ledger;

create or replace function public.admin_bridge_revenue_webhook_coverage()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_borderpay_admin() then
    raise exception 'admin access required';
  end if;

  with raw_events as (
    select e.event_id, e.event_type, e.payload_hash, e.received_at, e.processed_at,
      case
        when jsonb_typeof(e.payload -> 'event_object') = 'object' then e.payload -> 'event_object'
        when jsonb_typeof(e.payload -> 'data') = 'object' then e.payload -> 'data'
        else e.payload
      end as obj,
      e.payload
    from public.bridge_webhook_events e
    join public.pending_events q on q.id = e.pending_event_id and q.status = 'completed'
    where e.signature_ok = true
  ), normalized as (
    select r.*,
      coalesce(r.obj -> 'receipt', '{}'::jsonb) as receipt,
      lower(coalesce(nullif(r.obj ->> 'state',''), nullif(r.obj ->> 'status',''),
        nullif(r.obj ->> 'type',''), nullif(r.payload ->> 'event_object_status',''), '')) as object_status,
      case
        when lower(r.event_type) like '%transfer%' and lower(r.event_type) not like '%virtual_account%'
          then 'bridge_transfer'
        when lower(r.event_type) like '%virtual_account%'
          and (lower(r.event_type) like '%activity%' or lower(r.event_type) like '%deposit%'
            or lower(r.event_type) like '%credit%' or lower(r.event_type) like '%transfer%')
          then 'bridge_virtual_account'
        else null
      end as source_type
    from raw_events r
  ), candidates as (
    select n.*,
      case when n.source_type = 'bridge_transfer' then
        coalesce(nullif(n.obj ->> 'transfer_id',''), nullif(n.obj ->> 'id',''), nullif(n.payload ->> 'event_object_id',''))
      else
        coalesce(nullif(n.obj ->> 'deposit_id',''), nullif(n.receipt ->> 'deposit_id',''),
          nullif(n.receipt ->> 'id',''), nullif(n.obj -> 'deposit' ->> 'id',''),
          nullif(n.obj ->> 'reference',''), nullif(n.obj -> 'source' ->> 'tracking_number',''))
      end as source_id,
      coalesce(
        public.revenue_json_numeric(n.receipt -> 'developer_fee_amount'),
        public.revenue_json_numeric(n.receipt -> 'developer_fee'),
        public.revenue_json_numeric(n.receipt -> 'service_charge_amount'),
        public.revenue_json_numeric(n.obj -> 'developer_fee_amount'),
        public.revenue_json_numeric(n.obj -> 'developerFeeAmount'),
        public.revenue_json_numeric(n.obj -> 'developer_fee'),
        public.revenue_json_numeric(n.obj -> 'developerFee')
      ) as fee_amount,
      (n.receipt ?| array['developer_fee_amount','developer_fee','service_charge_amount']
        or n.obj ?| array['developer_fee_amount','developerFeeAmount','developer_fee','developerFee']) as has_fee_evidence,
      upper(coalesce(nullif(n.receipt ->> 'source_currency',''),
        nullif(n.obj -> 'source' ->> 'currency',''), nullif(n.obj ->> 'currency',''))) as source_currency,
      upper(coalesce(nullif(n.receipt ->> 'destination_currency',''),
        nullif(n.obj -> 'destination' ->> 'currency',''), nullif(n.obj ->> 'destination_currency',''))) as destination_currency,
      coalesce(
        public.revenue_json_numeric(n.receipt -> 'initial_amount'),
        public.revenue_json_numeric(n.receipt -> 'incoming_amount'),
        public.revenue_json_numeric(n.receipt -> 'source_amount'),
        public.revenue_json_numeric(n.obj -> 'initial_amount'),
        public.revenue_json_numeric(n.obj -> 'incoming_amount'),
        public.revenue_json_numeric(n.obj -> 'source_amount'),
        public.revenue_json_numeric(n.obj -> 'amount')
      ) as source_amount,
      case
        when n.source_type = 'bridge_virtual_account' then 'credit'
        when lower(coalesce(n.obj -> 'source' ->> 'type', n.obj -> 'source' ->> 'payment_rail', ''))
          in ('wallet','bridge_wallet') then 'debit'
        when lower(coalesce(n.obj -> 'destination' ->> 'type', n.obj -> 'destination' ->> 'payment_rail', ''))
          in ('wallet','bridge_wallet') then 'credit'
        when lower(coalesce(n.obj -> 'source' ->> 'type', n.obj -> 'source' ->> 'payment_rail', ''))
          in ('virtual_account','external_bank','ach','wire','sepa','faster_payments') then 'credit'
        else 'debit'
      end as direction,
      coalesce(n.processed_at, n.received_at) as occurred_at
    from normalized n
    where (n.source_type = 'bridge_transfer' and n.object_status in
      ('payment_processed','succeeded','success','completed','complete'))
      or (n.source_type = 'bridge_virtual_account' and n.object_status in
      ('funds_received','payment_received','credit_received','payment_processed','processed','succeeded','success'))
  ), deduped as (
    select distinct on (source_type, source_id) *
    from candidates
    where source_id is not null
    order by source_type, source_id, has_fee_evidence desc, coalesce(processed_at, received_at) desc
  ), coverage as (
    select d.*,
      exists (
        select 1 from public.provider_revenue_events p
        where p.provider = 'bridge' and p.environment = 'live'
          and p.source_type = d.source_type and p.source_id = d.source_id
          and p.event_kind = 'earned' and p.revenue_category = 'developer_fee'
      ) as captured
    from deduped d
  ), volume as (
    select source_currency as currency, coalesce(sum(source_amount),0) as amount
    from coverage where source_currency is not null and source_amount is not null
    group by source_currency
  ), weekly as (
    select date_trunc('week', occurred_at)::date as week_start, source_currency as currency,
      coalesce(sum(source_amount) filter (where direction = 'credit'),0) as cash_in,
      coalesce(sum(source_amount) filter (where direction = 'debit'),0) as cash_out,
      count(*) as source_count
    from coverage
    where source_currency is not null and source_amount is not null
      and occurred_at >= date_trunc('week', now()) - interval '12 weeks'
    group by date_trunc('week', occurred_at)::date, source_currency
  )
  select jsonb_build_object(
    'source', 'signature_verified_bridge_webhook_events',
    'generated_at', now(),
    'terminal_sources', count(*),
    'fee_evidence_sources', count(*) filter (where has_fee_evidence and fee_amount is not null),
    'captured_sources', count(*) filter (where captured),
    'missing_fee_evidence_sources', count(*) filter (where not has_fee_evidence or fee_amount is null),
    'uncaptured_fee_evidence_sources', count(*) filter (where has_fee_evidence and fee_amount is not null and not captured),
    'complete', count(*) filter (where not has_fee_evidence or fee_amount is null or not captured) = 0,
    'source_volume_by_currency', coalesce((
      select jsonb_object_agg(currency, amount order by currency) from volume
    ), '{}'::jsonb),
    'weekly_actual_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', week_start,
        'currency', currency,
        'cash_in', cash_in,
        'cash_out', cash_out,
        'net', cash_in - cash_out,
        'source_count', source_count
      ) order by week_start, currency) from weekly
    ), '[]'::jsonb),
    'recent_terminal_sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.source_id,
        'source_type', recent.source_type,
        'event_type', recent.event_type,
        'direction', recent.direction,
        'amount', recent.source_amount,
        'currency', recent.source_currency,
        'destination_currency', recent.destination_currency,
        'status', recent.object_status,
        'occurred_at', recent.occurred_at,
        'fee_evidence', recent.has_fee_evidence,
        'revenue_captured', recent.captured
      ) order by recent.occurred_at desc)
      from (
        select * from coverage order by occurred_at desc limit 500
      ) recent
    ), '[]'::jsonb)
  ) into v_result
  from coverage;

  return v_result;
end;
$$;

revoke all on function public.admin_bridge_revenue_webhook_coverage() from public, anon;
grant execute on function public.admin_bridge_revenue_webhook_coverage() to authenticated, service_role;

-- Backfill only explicit fee evidence from completed, signature-verified raw
-- Bridge events. Configured percentages are intentionally never substituted.
with raw_events as (
  select e.event_id, e.event_type, e.payload_hash, e.received_at, e.processed_at,
    case
      when jsonb_typeof(e.payload -> 'event_object') = 'object' then e.payload -> 'event_object'
      when jsonb_typeof(e.payload -> 'data') = 'object' then e.payload -> 'data'
      else e.payload
    end as obj,
    e.payload
  from public.bridge_webhook_events e
  join public.pending_events q on q.id = e.pending_event_id and q.status = 'completed'
  where e.signature_ok = true
), normalized as (
  select r.*, coalesce(r.obj -> 'receipt', '{}'::jsonb) as receipt,
    lower(coalesce(nullif(r.obj ->> 'state',''), nullif(r.obj ->> 'status',''),
      nullif(r.obj ->> 'type',''), nullif(r.payload ->> 'event_object_status',''), '')) as object_status,
    case
      when lower(r.event_type) like '%transfer%' and lower(r.event_type) not like '%virtual_account%' then 'bridge_transfer'
      when lower(r.event_type) like '%virtual_account%'
        and (lower(r.event_type) like '%activity%' or lower(r.event_type) like '%deposit%'
          or lower(r.event_type) like '%credit%' or lower(r.event_type) like '%transfer%') then 'bridge_virtual_account'
      else null
    end as source_type
  from raw_events r
), candidates as (
  select n.*,
    case when n.source_type = 'bridge_transfer' then
      coalesce(nullif(n.obj ->> 'transfer_id',''), nullif(n.obj ->> 'id',''), nullif(n.payload ->> 'event_object_id',''))
    else coalesce(nullif(n.obj ->> 'deposit_id',''), nullif(n.receipt ->> 'deposit_id',''),
      nullif(n.receipt ->> 'id',''), nullif(n.obj -> 'deposit' ->> 'id',''),
      nullif(n.obj ->> 'reference',''), nullif(n.obj -> 'source' ->> 'tracking_number','')) end as source_id,
    coalesce(public.revenue_json_numeric(n.receipt -> 'developer_fee_amount'),
      public.revenue_json_numeric(n.receipt -> 'developer_fee'),
      public.revenue_json_numeric(n.receipt -> 'service_charge_amount'),
      public.revenue_json_numeric(n.obj -> 'developer_fee_amount'),
      public.revenue_json_numeric(n.obj -> 'developerFeeAmount'),
      public.revenue_json_numeric(n.obj -> 'developer_fee'),
      public.revenue_json_numeric(n.obj -> 'developerFee')) as fee_amount,
    upper(coalesce(nullif(n.receipt ->> 'source_currency',''),
      nullif(n.obj -> 'source' ->> 'currency',''), nullif(n.obj ->> 'currency',''))) as source_currency,
    upper(coalesce(nullif(n.receipt ->> 'destination_currency',''),
      nullif(n.obj -> 'destination' ->> 'currency',''), nullif(n.obj ->> 'destination_currency',''))) as destination_currency,
    coalesce(public.revenue_json_numeric(n.receipt -> 'initial_amount'),
      public.revenue_json_numeric(n.receipt -> 'incoming_amount'),
      public.revenue_json_numeric(n.receipt -> 'source_amount'),
      public.revenue_json_numeric(n.obj -> 'initial_amount'),
      public.revenue_json_numeric(n.obj -> 'incoming_amount'),
      public.revenue_json_numeric(n.obj -> 'source_amount'),
      public.revenue_json_numeric(n.obj -> 'amount')) as source_amount
  from normalized n
  where (n.source_type = 'bridge_transfer' and n.object_status in
    ('payment_processed','succeeded','success','completed','complete'))
    or (n.source_type = 'bridge_virtual_account' and n.object_status in
    ('funds_received','payment_received','credit_received','payment_processed','processed','succeeded','success'))
), deduped as (
  select distinct on (source_type, source_id) * from candidates
  where source_id is not null and fee_amount is not null and fee_amount >= 0
  order by source_type, source_id, coalesce(processed_at, received_at) desc
)
insert into public.provider_revenue_events (
  provider, environment, source_type, source_id, source_event_id, event_kind,
  revenue_category, settlement_status, fee_currency, gross_customer_fee,
  provider_cost, net_revenue, source_amount, source_currency,
  destination_currency, usd_rate, reconciliation_status, evidence, occurred_at
)
select 'bridge', 'live', d.source_type, d.source_id, d.event_id, 'earned',
  'developer_fee', 'settled', d.source_currency, d.fee_amount,
  0, d.fee_amount, d.source_amount, d.source_currency, d.destination_currency,
  case when d.source_currency in ('USD','USDC','USDT') then 1 end,
  'reconciled', jsonb_build_object(
    'source','bridge_webhook_events', 'event_id',d.event_id,
    'event_type',d.event_type, 'payload_hash',d.payload_hash,
    'signature_verified',true, 'event_object',d.obj
  ), coalesce(d.processed_at, d.received_at)
from deduped d
where d.source_currency is not null
  and not (d.source_type = 'bridge_transfer'
    and d.source_currency = d.destination_currency
    and d.source_currency in ('USDC','USDT') and d.fee_amount <> 0)
on conflict do nothing;

comment on function public.admin_bridge_revenue_webhook_coverage() is
  'Read-only coverage report for terminal signed Bridge webhook revenue evidence; never estimates fees.';
