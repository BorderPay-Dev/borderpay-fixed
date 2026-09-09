-- Authoritative consolidated revenue from terminal successful payments.
-- Each fee is valued using the actual linked wallet settlement for the same
-- provider deposit_id. Intermediate lifecycle events and refunds are excluded.

create or replace function public.admin_terminal_settled_revenue_summary()
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
    select b.event_id, b.received_at,
      case
        when jsonb_typeof(b.payload->'event_object')='object' then b.payload->'event_object'
        when jsonb_typeof(b.payload->'data')='object' then b.payload->'data'
        else b.payload
      end obj
    from public.bridge_webhook_events b
    join public.pending_events q on q.id=b.pending_event_id and q.status='completed'
    where b.signature_ok=true
      and b.event_type in ('virtual_account.activity.created','virtual_account.activity.updated')
  ), successful as (
    select distinct on (obj->>'deposit_id')
      obj->>'deposit_id' deposit_id,
      public.revenue_json_numeric(obj->'amount') gross_source_amount,
      coalesce(public.revenue_json_numeric(obj->'developer_fee_amount'),0) developer_fee,
      coalesce(public.revenue_json_numeric(obj->'exchange_fee_amount'),0) exchange_fee,
      coalesce(public.revenue_json_numeric(obj->'gas_fee'),0) gas_fee,
      event_id,
      received_at
    from raw
    where lower(obj->>'type')='payment_processed'
      and obj->>'deposit_id' is not null
    order by obj->>'deposit_id', received_at desc
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
    from valued group by source_currency
  )
  select jsonb_build_object(
    'source', 'terminal_signed_payment_and_linked_wallet_settlement',
    'generated_at', now(),
    'complete', count(*) filter (where developer_fee > 0 and usd_equivalent_fee is null) = 0,
    'successful_payments', count(*),
    'valued_payments', count(*) filter (where usd_equivalent_fee is not null),
    'unvalued_fee_payments', count(*) filter (where developer_fee > 0 and usd_equivalent_fee is null),
    'total_usd_equivalent', round(coalesce(sum(usd_equivalent_fee),0),2),
    'native_successful_fees', coalesce((
      select jsonb_object_agg(currency, fee order by currency) from native
    ), '{}'::jsonb)
  ) into v_result
  from valued;

  return v_result;
end;
$$;

revoke all on function public.admin_terminal_settled_revenue_summary() from public, anon;
grant execute on function public.admin_terminal_settled_revenue_summary() to authenticated, service_role;

comment on function public.admin_terminal_settled_revenue_summary() is
  'Terminal successful fees valued using actual linked stablecoin wallet settlements; lifecycle duplicates and refunds excluded.';
