-- Keep incomplete provider events visible as unvalued evidence without allowing
-- a NULL currency to abort the entire admin revenue response.

create or replace function public.admin_terminal_deposit_revenue_summary()
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

  with raw as (
    select b.event_id, b.event_type, b.received_at,
      case
        when jsonb_typeof(b.payload->'event_object')='object' then b.payload->'event_object'
        when jsonb_typeof(b.payload->'data')='object' then b.payload->'data'
        else b.payload
      end obj
    from public.bridge_webhook_events b
    join public.pending_events q on q.id=b.pending_event_id and q.status='completed'
    where b.signature_ok=true
      and b.event_type in ('virtual_account.activity.created','virtual_account.activity.updated')
  ), normalized as (
    select *,
      coalesce(nullif(obj->>'deposit_id',''), nullif(obj->'receipt'->>'deposit_id',''),
        nullif(obj->'receipt'->>'id',''), nullif(obj->'deposit'->>'id','')) deposit_id,
      lower(coalesce(obj->>'state', obj->>'status', obj->>'type', '')) lifecycle_status
    from raw
  ), refunded as (
    select distinct deposit_id
    from normalized
    where deposit_id is not null
      and lifecycle_status in ('refunded','returned','canceled','cancelled','refund_complete','refund_completed')
  ), successful_raw as (
    select distinct on (deposit_id)
      deposit_id,
      public.revenue_json_numeric(obj->'amount') gross_source_amount,
      coalesce(public.revenue_json_numeric(obj->'developer_fee_amount'),0) developer_fee,
      coalesce(public.revenue_json_numeric(obj->'exchange_fee_amount'),0) exchange_fee,
      coalesce(public.revenue_json_numeric(obj->'gas_fee'),0) gas_fee,
      event_id,
      received_at
    from normalized
    where lower(obj->>'type')='payment_processed'
      and deposit_id is not null
    order by deposit_id, received_at desc
  ), successful as (
    select s.*
    from successful_raw s
    where not exists (select 1 from refunded r where r.deposit_id=s.deposit_id)
  ), wallet_settlement as (
    select distinct on (metadata->'raw'->'payment_route'->>'deposit_id')
      metadata->'raw'->'payment_route'->>'deposit_id' deposit_id,
      upper(metadata->'raw'->'source'->>'currency') source_currency,
      upper(currency) settlement_currency,
      public.revenue_json_numeric(metadata->'raw'->'amount') settlement_amount,
      event_id wallet_event_id
    from public.bridge_balance_ledger
    where entity_type='wallet' and direction='credit'
      and metadata->'raw'->'payment_route'->>'deposit_id' is not null
      and lower(metadata->'raw'->>'type')='deposit'
    order by metadata->'raw'->'payment_route'->>'deposit_id', created_at desc
  ), valued as (
    select s.*, w.source_currency, w.settlement_currency, w.settlement_amount, w.wallet_event_id,
      s.gross_source_amount-s.developer_fee-s.exchange_fee-s.gas_fee net_source_amount,
      case when w.settlement_currency in ('USD','USDC','USDT')
        and s.gross_source_amount-s.developer_fee-s.exchange_fee-s.gas_fee > 0
        then s.developer_fee*w.settlement_amount/(s.gross_source_amount-s.developer_fee-s.exchange_fee-s.gas_fee)
      end usd_equivalent_fee
    from successful s left join wallet_settlement w using (deposit_id)
  ), native as (
    select source_currency as currency, sum(developer_fee) as fee
    from valued
    where source_currency is not null and btrim(source_currency) <> ''
    group by source_currency
  )
  select jsonb_build_object(
    'source', 'terminal_signed_payment_and_linked_wallet_settlement_refund_excluded',
    'generated_at', now(),
    'complete', count(*) filter (where developer_fee > 0 and usd_equivalent_fee is null) = 0,
    'successful_payments', count(*),
    'valued_payments', count(*) filter (where usd_equivalent_fee is not null),
    'unvalued_fee_payments', count(*) filter (where developer_fee > 0 and usd_equivalent_fee is null),
    'refunded_payments_excluded', (select count(*) from successful_raw s join refunded r using (deposit_id)),
    'total_usd_equivalent', round(coalesce(sum(usd_equivalent_fee),0),2),
    'native_successful_fees', coalesce((
      select jsonb_object_agg(currency, fee order by currency) from native
    ), '{}'::jsonb)
  ) into v_result
  from valued;

  return v_result;
end;
$$;

revoke all on function public.admin_terminal_deposit_revenue_summary() from public, anon;
grant execute on function public.admin_terminal_deposit_revenue_summary() to authenticated, service_role;

create or replace function public.admin_terminal_settled_revenue_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deposits jsonb;
  v_drains jsonb;
  v_ledger jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.is_borderpay_admin() then
    raise exception 'admin access required';
  end if;

  v_deposits := public.admin_terminal_deposit_revenue_summary();
  v_drains := public.admin_liquidation_drain_revenue_coverage();

  with signed_ledger as (
    select *, case when event_kind='earned' then 1 else -1 end sign
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
    select upper(fee_currency) currency, sum(sign*net_revenue) fee
    from signed_ledger
    where fee_currency is not null and btrim(fee_currency) <> ''
    group by upper(fee_currency)
  )
  select jsonb_build_object(
    'usd', usd,
    'earned_sources', earned_sources,
    'unvalued', unvalued,
    'native', coalesce((select jsonb_object_agg(currency,fee) from native),'{}'::jsonb)
  ) into v_ledger
  from totals;

  return jsonb_build_object(
    'source','terminal_signed_deposits_payouts_and_linked_settlement',
    'generated_at',now(),
    'complete',coalesce((v_deposits->>'complete')::boolean,false)
      and coalesce((v_drains->>'complete')::boolean,false)
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
        union all
        select key,value::numeric from jsonb_each_text(coalesce(v_ledger->'native','{}'::jsonb))
      ) x
      where currency is not null and btrim(currency) <> ''
      group by currency having sum(fee)<>0
    ) n)
  );
end;
$$;

revoke all on function public.admin_terminal_settled_revenue_summary() from public, anon;
grant execute on function public.admin_terminal_settled_revenue_summary() to authenticated, service_role;

comment on function public.admin_terminal_settled_revenue_summary() is
  'Terminal signed revenue summary; incomplete currency evidence is counted as unvalued and cannot abort admin reporting.';
