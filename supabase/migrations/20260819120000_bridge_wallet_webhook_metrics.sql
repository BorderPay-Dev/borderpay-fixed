-- Bridge wallet dashboard metrics derived only from completed,
-- signature-verified wallet activity webhooks.

create or replace function public.admin_bridge_wallet_webhook_metrics()
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
    select
      b.event_id,
      b.payload_hash,
      b.received_at,
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
      and b.event_type = 'bridge_wallet.activity.created'
  ), normalized as (
    select
      event_id,
      payload_hash,
      coalesce(nullif(obj ->> 'id',''), event_id) as activity_id,
      nullif(obj ->> 'bridge_wallet_id','') as bridge_wallet_id,
      lower(nullif(obj ->> 'type','')) as activity_type,
      upper(nullif(obj ->> 'currency','')) as currency,
      public.revenue_json_numeric(obj -> 'amount') as amount,
      public.revenue_json_numeric(obj -> 'available_balance') as available_balance,
      coalesce(
        case when (obj ->> 'created_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (obj ->> 'created_at')::timestamptz end,
        received_at
      ) as occurred_at,
      obj
    from raw
  ), activities as (
    select distinct on (activity_id) *
    from normalized
    where activity_id is not null
      and bridge_wallet_id is not null
      and currency is not null
      and amount is not null
      and amount >= 0
    order by activity_id, occurred_at desc
  ), currency_volume as (
    select currency, sum(amount) as amount, count(*) as transaction_count
    from activities group by currency
  ), latest_balances as (
    select distinct on (bridge_wallet_id, currency)
      bridge_wallet_id, currency, available_balance, occurred_at
    from activities
    where available_balance is not null
    order by bridge_wallet_id, currency, occurred_at desc
  ), currency_balances as (
    select currency, sum(available_balance) as amount, count(*) as observed_wallets
    from latest_balances group by currency
  ), weekly as (
    select
      date_trunc('week', occurred_at)::date as week_start,
      currency,
      sum(amount) filter (where activity_type in ('deposit','direct_deposit')) as cash_in,
      sum(amount) filter (where activity_type = 'withdrawal') as cash_out,
      count(*) as transaction_count
    from activities
    where occurred_at >= date_trunc('week', now()) - interval '12 weeks'
    group by date_trunc('week', occurred_at)::date, currency
  )
  select jsonb_build_object(
    'source', 'completed_signature_verified_bridge_wallet_activity_webhooks',
    'generated_at', now(),
    'complete', true,
    'transactions', count(*),
    'into_wallets', count(*) filter (where activity_type in ('deposit','direct_deposit')),
    'out_of_wallets', count(*) filter (where activity_type = 'withdrawal'),
    'between_wallets', count(*) filter (where activity_type not in ('deposit','direct_deposit','withdrawal')),
    'volume_by_currency', coalesce((
      select jsonb_object_agg(currency, amount order by currency) from currency_volume
    ), '{}'::jsonb),
    'transaction_count_by_currency', coalesce((
      select jsonb_object_agg(currency, transaction_count order by currency) from currency_volume
    ), '{}'::jsonb),
    'balance_by_currency', coalesce((
      select jsonb_object_agg(currency, amount order by currency) from currency_balances
    ), '{}'::jsonb),
    'balance_observed_wallets_by_currency', coalesce((
      select jsonb_object_agg(currency, observed_wallets order by currency) from currency_balances
    ), '{}'::jsonb),
    'weekly_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', week_start,
        'currency', currency,
        'cash_in', coalesce(cash_in,0),
        'cash_out', coalesce(cash_out,0),
        'net', coalesce(cash_in,0) - coalesce(cash_out,0),
        'transaction_count', transaction_count
      ) order by week_start, currency) from weekly
    ), '[]'::jsonb),
    'recent_transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.activity_id,
        'wallet_id', recent.bridge_wallet_id,
        'type', recent.activity_type,
        'currency', recent.currency,
        'amount', recent.amount,
        'available_balance', recent.available_balance,
        'occurred_at', recent.occurred_at,
        'event_id', recent.event_id,
        'payload_hash', recent.payload_hash
      ) order by recent.occurred_at desc)
      from (select * from activities order by occurred_at desc limit 500) recent
    ), '[]'::jsonb)
  ) into v_result
  from activities;

  return v_result;
end;
$$;

revoke all on function public.admin_bridge_wallet_webhook_metrics() from public, anon;
grant execute on function public.admin_bridge_wallet_webhook_metrics() to authenticated, service_role;

comment on function public.admin_bridge_wallet_webhook_metrics() is
  'Read-only Bridge wallet metrics from completed signature-verified wallet activity webhooks.';
