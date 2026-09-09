-- Native-currency revenue totals. This avoids presenting a partial USD total
-- as total company revenue when settled EUR/GBP fees have no captured FX rate.

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

  with native as (
    select
      upper(fee_currency) as currency,
      sum(gross_customer_fee) filter (where event_kind = 'earned') as earned,
      sum(gross_customer_fee) filter (where event_kind = 'reversal') as reversed,
      sum(case when event_kind = 'earned' then gross_customer_fee else -gross_customer_fee end) as net,
      count(*) filter (where event_kind = 'earned') as earned_rows,
      count(*) filter (where event_kind = 'reversal') as reversal_rows
    from public.provider_revenue_events
    where environment = 'live'
    group by upper(fee_currency)
  )
  select jsonb_build_object(
    'source', 'immutable_provider_revenue_events_native_currency',
    'generated_at', now(),
    'complete', true,
    'currencies', coalesce(jsonb_agg(jsonb_build_object(
      'currency', currency,
      'earned', coalesce(earned, 0),
      'reversed', coalesce(reversed, 0),
      'net', coalesce(net, 0),
      'earned_rows', earned_rows,
      'reversal_rows', reversal_rows
    ) order by currency), '[]'::jsonb)
  ) into v_result
  from native;

  return v_result;
end;
$$;

revoke all on function public.admin_provider_revenue_native_summary() from public, anon;
grant execute on function public.admin_provider_revenue_native_summary() to authenticated, service_role;

comment on function public.admin_provider_revenue_native_summary() is
  'Read-only native-currency gross, reversal, and net revenue from immutable live provider revenue events.';
