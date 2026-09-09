-- Capture actual external digital-dollar liquidation fees from terminal signed
-- drain webhooks. The provider receipt is revenue truth. Fee-policy compliance
-- is reported separately: USDC/Base routes are configured for 1%; USDT/Tron
-- routes are free. Cross-token routes remain rejected.

alter table public.provider_revenue_events
  drop constraint if exists provider_revenue_events_source_type_check;
alter table public.provider_revenue_events
  add constraint provider_revenue_events_source_type_check check (
    source_type in ('bridge_transfer','bridge_virtual_account','bridge_liquidation_drain','yellow_card_transaction')
  );

create or replace function public.record_bridge_liquidation_drain_revenue(
  p_source_id text,
  p_source_event_id text,
  p_event_kind text,
  p_source_amount numeric,
  p_source_currency text,
  p_destination_currency text,
  p_developer_fee numeric,
  p_evidence jsonb,
  p_occurred_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_source text := upper(nullif(trim(p_source_currency),''));
  v_destination text := upper(nullif(trim(p_destination_currency),''));
  v_amount numeric := p_source_amount;
  v_fee numeric := p_developer_fee;
  v_expected numeric;
  v_policy_compliant boolean;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
  if nullif(trim(p_source_id),'') is null then raise exception 'drain source id is required'; end if;
  if p_event_kind not in ('earned','reversal') then raise exception 'invalid drain revenue event kind'; end if;
  if p_evidence is null or p_evidence = '{}'::jsonb
     or coalesce((p_evidence->>'signature_verified_at_ingress')::boolean,false) is not true
     or p_evidence->>'source' <> 'bridge_webhook_events' then
    raise exception 'signed drain webhook evidence is required';
  end if;
  if p_occurred_at is null then raise exception 'occurred_at is required'; end if;

  if p_event_kind = 'reversal' then
    select source_amount,source_currency,destination_currency,gross_customer_fee
      into v_amount,v_source,v_destination,v_fee
    from public.provider_revenue_events
    where provider='bridge' and environment='live'
      and source_type='bridge_liquidation_drain' and source_id=trim(p_source_id)
      and event_kind='earned' and revenue_category='developer_fee';
    if not found then return null; end if;
  else
    if v_source not in ('USDC','USDT') or v_destination not in ('USDC','USDT') then
      raise exception 'unsupported external digital-dollar route';
    end if;
    if v_source <> v_destination then raise exception 'cross-token payout revenue is forbidden'; end if;
    if v_amount is null or v_amount <= 0 or v_fee is null or v_fee < 0 then
      raise exception 'complete drain amount and fee evidence is required';
    end if;
    v_expected := case when v_source='USDC' then round(v_amount*0.01,2) else 0 end;
    v_policy_compliant := abs(v_fee-v_expected)<=0.01;
  end if;

  insert into public.provider_revenue_events(
    provider,environment,source_type,source_id,source_event_id,event_kind,
    revenue_category,settlement_status,fee_currency,gross_customer_fee,
    provider_cost,net_revenue,source_amount,source_currency,destination_currency,
    usd_rate,reconciliation_status,evidence,occurred_at
  ) values (
    'bridge','live','bridge_liquidation_drain',trim(p_source_id),nullif(trim(p_source_event_id),''),p_event_kind,
    'developer_fee',case when p_event_kind='earned' then 'settled' else 'reversed' end,
    v_source,v_fee,0,v_fee,v_amount,v_source,v_destination,1,
    case when p_event_kind='reversal' or v_policy_compliant then 'reconciled' else 'exception' end,
    p_evidence || jsonb_build_object(
      'fee_policy_expected',v_expected,
      'fee_policy_observed',v_fee,
      'fee_policy_compliant',coalesce(v_policy_compliant,true)
    ),p_occurred_at
  ) on conflict (provider,environment,source_type,source_id,event_kind,revenue_category)
    do nothing returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_bridge_liquidation_drain_revenue(text,text,text,numeric,text,text,numeric,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.record_bridge_liquidation_drain_revenue(text,text,text,numeric,text,text,numeric,jsonb,timestamptz) to service_role;

-- Backfill only terminal signed and completed provider evidence.
with raw as (
  select b.received_at,b.event_id,b.event_type,b.payload_hash,
    case when jsonb_typeof(b.payload->'event_object')='object' then b.payload->'event_object'
         when jsonb_typeof(b.payload->'data')='object' then b.payload->'data' else b.payload end obj
  from public.bridge_webhook_events b join public.pending_events q on q.id=b.pending_event_id and q.status='completed'
  where b.signature_ok and lower(b.event_type) like '%liquidation_address.drain%'
), latest as (
  select distinct on (obj->>'id') * from raw where obj->>'id' is not null
  order by obj->>'id',received_at desc
), terminal as (
  select obj->>'id' source_id,event_id,event_type,payload_hash,received_at,obj,
    upper(obj->>'currency') source_currency,
    upper(obj->'receipt'->>'destination_currency') destination_currency,
    public.revenue_json_numeric(obj->'receipt'->'initial_amount') initial_amount,
    public.revenue_json_numeric(obj->'receipt'->'developer_fee') developer_fee
  from latest where lower(obj->>'state')='payment_processed'
)
insert into public.provider_revenue_events(
  provider,environment,source_type,source_id,source_event_id,event_kind,revenue_category,
  settlement_status,fee_currency,gross_customer_fee,provider_cost,net_revenue,
  source_amount,source_currency,destination_currency,usd_rate,reconciliation_status,evidence,occurred_at
)
select 'bridge','live','bridge_liquidation_drain',source_id,event_id,'earned','developer_fee',
  'settled',source_currency,developer_fee,0,developer_fee,initial_amount,source_currency,
  destination_currency,1,
  case when (source_currency='USDC' and abs(developer_fee-round(initial_amount*0.01,2))<=0.01)
         or (source_currency='USDT' and developer_fee=0) then 'reconciled' else 'exception' end,
  jsonb_build_object(
    'source','bridge_webhook_events','signature_verified_at_ingress',true,
    'event_id',event_id,'event_type',event_type,'payload_hash',payload_hash,'event_object',obj,
    'fee_policy_expected',case when source_currency='USDC' then round(initial_amount*0.01,2) else 0 end,
    'fee_policy_observed',developer_fee,
    'fee_policy_compliant',(source_currency='USDC' and abs(developer_fee-round(initial_amount*0.01,2))<=0.01)
      or (source_currency='USDT' and developer_fee=0)
  ),received_at
from terminal
where source_currency in ('USDC','USDT') and destination_currency=source_currency
  and initial_amount is not null and initial_amount>0 and developer_fee is not null and developer_fee>=0
on conflict (provider,environment,source_type,source_id,event_kind,revenue_category) do nothing;

create or replace function public.admin_liquidation_drain_revenue_coverage()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  with raw as (
    select b.received_at,
      case when jsonb_typeof(b.payload->'event_object')='object' then b.payload->'event_object'
           when jsonb_typeof(b.payload->'data')='object' then b.payload->'data' else b.payload end obj
    from public.bridge_webhook_events b join public.pending_events q on q.id=b.pending_event_id and q.status='completed'
    where b.signature_ok and lower(b.event_type) like '%liquidation_address.drain%'
  ), latest as (
    select distinct on (obj->>'id') obj,received_at from raw where obj->>'id' is not null
    order by obj->>'id',received_at desc
  ), terminal as (
    select obj->>'id' id,upper(obj->>'currency') source_currency,
      upper(obj->'receipt'->>'destination_currency') destination_currency,
      public.revenue_json_numeric(obj->'receipt'->'initial_amount') initial_amount,
      public.revenue_json_numeric(obj->'receipt'->'developer_fee') developer_fee
    from latest where lower(obj->>'state')='payment_processed'
  ) select jsonb_build_object(
    'source','completed_signature_verified_liquidation_drain_webhooks',
    'terminal_drains',count(*),'usdc_drains',count(*) filter(where source_currency='USDC'),
    'usdt_drains',count(*) filter(where source_currency='USDT'),
    'cross_token_drains',count(*) filter(where source_currency<>destination_currency),
    'fee_policy_exception_drains',count(*) filter(where
      (source_currency='USDC' and abs(developer_fee-round(initial_amount*0.01,2))>0.01)
      or (source_currency='USDT' and developer_fee<>0)),
    'invalid_evidence_drains',count(*) filter(where source_currency not in ('USDC','USDT')
      or destination_currency<>source_currency or initial_amount is null or initial_amount<=0
      or developer_fee is null or developer_fee<0),
    'captured_drains',count(*) filter(where exists(select 1 from public.provider_revenue_events p
      where p.source_type='bridge_liquidation_drain' and p.source_id=terminal.id and p.event_kind='earned')),
    'usdc_fee',coalesce(sum(developer_fee) filter(where source_currency='USDC'),0),
    'usdt_fee',coalesce(sum(developer_fee) filter(where source_currency='USDT'),0),
    'fee_policy_compliant',count(*) filter(where
      (source_currency='USDC' and abs(developer_fee-round(initial_amount*0.01,2))>0.01)
      or (source_currency='USDT' and developer_fee<>0))=0,
    'complete',count(*) filter(where source_currency not in ('USDC','USDT')
      or source_currency<>destination_currency or initial_amount is null or initial_amount<=0
      or developer_fee is null or developer_fee<0
      or not exists(select 1 from public.provider_revenue_events p where p.source_type='bridge_liquidation_drain' and p.source_id=terminal.id and p.event_kind='earned'))=0
  ) from terminal;
$$;
revoke all on function public.admin_liquidation_drain_revenue_coverage() from public,anon,authenticated;
grant execute on function public.admin_liquidation_drain_revenue_coverage() to service_role;

alter function public.admin_terminal_settled_revenue_summary() rename to admin_terminal_deposit_revenue_summary;

create function public.admin_terminal_settled_revenue_summary()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_deposits jsonb; v_drains jsonb; v_ledger jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.is_borderpay_admin() then raise exception 'admin access required'; end if;
  v_deposits:=public.admin_terminal_deposit_revenue_summary();
  v_drains:=public.admin_liquidation_drain_revenue_coverage();
  with signed_ledger as (
    select *,case when event_kind='earned' then 1 else -1 end sign
    from public.provider_revenue_events
    where provider='bridge' and environment='live'
      and source_type in ('bridge_liquidation_drain','bridge_transfer')
      and coalesce((evidence->>'signature_verified_at_ingress')::boolean,
                   (evidence->>'signature_verified')::boolean,false)=true
  ), totals as (
    select coalesce(sum(sign*net_revenue*usd_rate),0) usd,
      count(*) filter(where event_kind='earned' and net_revenue>0) earned_sources,
      count(*) filter(where net_revenue>0 and usd_rate is null) unvalued
    from signed_ledger
  ), native as (
    select fee_currency currency,sum(sign*net_revenue) fee from signed_ledger group by fee_currency
  ) select jsonb_build_object('usd',usd,'earned_sources',earned_sources,'unvalued',unvalued,
      'native',coalesce((select jsonb_object_agg(currency,fee) from native),'{}'::jsonb)) into v_ledger from totals;

  return jsonb_build_object(
    'source','terminal_signed_deposits_payouts_and_linked_settlement',
    'generated_at',now(),
    'complete',coalesce((v_deposits->>'complete')::boolean,false) and coalesce((v_drains->>'complete')::boolean,false)
      and coalesce((v_ledger->>'unvalued')::int,0)=0,
    'successful_payments',coalesce((v_deposits->>'successful_payments')::int,0),
    'valued_payments',coalesce((v_deposits->>'valued_payments')::int,0),
    'unvalued_fee_payments',coalesce((v_deposits->>'unvalued_fee_payments')::int,0)+coalesce((v_ledger->>'unvalued')::int,0),
    'payout_fee_sources',coalesce((v_ledger->>'earned_sources')::int,0),
    'liquidation_drain_coverage',v_drains,
    'total_usd_equivalent',round(coalesce((v_deposits->>'total_usd_equivalent')::numeric,0)+coalesce((v_ledger->>'usd')::numeric,0),2),
    'native_successful_fees',(select coalesce(jsonb_object_agg(currency,fee),'{}'::jsonb) from (
      select currency,sum(fee) fee from (
        select key currency,value::numeric fee from jsonb_each_text(coalesce(v_deposits->'native_successful_fees','{}'::jsonb))
        union all select key,value::numeric from jsonb_each_text(coalesce(v_ledger->'native','{}'::jsonb))
      ) x group by currency having sum(fee)<>0
    ) n)
  );
end;
$$;
revoke all on function public.admin_terminal_settled_revenue_summary() from public,anon;
grant execute on function public.admin_terminal_settled_revenue_summary() to authenticated,service_role;
