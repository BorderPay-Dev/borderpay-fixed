-- Preserve native-currency revenue by provider so Bridge payout estimates do
-- not include (or double count) Yellow Card revenue.

create or replace function public.admin_provider_revenue_native_summary()
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

  with provider_native as (
    select
      provider,
      upper(fee_currency) as currency,
      coalesce(sum(gross_customer_fee) filter (where event_kind = 'earned'), 0) as earned,
      coalesce(sum(gross_customer_fee) filter (where event_kind = 'reversal'), 0) as reversed,
      coalesce(sum(case when event_kind = 'earned' then gross_customer_fee else -gross_customer_fee end), 0) as net,
      count(*) filter (where event_kind = 'earned') as earned_rows,
      count(*) filter (where event_kind = 'reversal') as reversal_rows
    from public.provider_revenue_events
    where environment = 'live'
    group by provider, upper(fee_currency)
  ), native as (
    select
      currency,
      sum(earned) as earned,
      sum(reversed) as reversed,
      sum(net) as net,
      sum(earned_rows) as earned_rows,
      sum(reversal_rows) as reversal_rows
    from provider_native
    group by currency
  ), provider_payloads as (
    select
      provider,
      jsonb_build_object(
        'complete', true,
        'currencies', jsonb_agg(jsonb_build_object(
          'currency', currency,
          'earned', earned,
          'reversed', reversed,
          'net', net,
          'earned_rows', earned_rows,
          'reversal_rows', reversal_rows
        ) order by currency)
      ) as payload
    from provider_native
    group by provider
  )
  select jsonb_build_object(
    'source', 'immutable_provider_revenue_events_native_currency_by_provider',
    'generated_at', now(),
    'complete', true,
    'currencies', coalesce((select jsonb_agg(jsonb_build_object(
      'currency', currency,
      'earned', earned,
      'reversed', reversed,
      'net', net,
      'earned_rows', earned_rows,
      'reversal_rows', reversal_rows
    ) order by currency) from native), '[]'::jsonb),
    'providers', coalesce((select jsonb_object_agg(provider, payload) from provider_payloads), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_provider_revenue_native_summary() from public, anon;
grant execute on function public.admin_provider_revenue_native_summary() to authenticated, service_role;

comment on function public.admin_provider_revenue_native_summary() is
  'Read-only native-currency earned, reversed and net revenue from immutable live provider events, split by provider.';
