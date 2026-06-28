-- Maintenance policy alignment (P0)
-- - Keep KYC/KYB free at start (no upfront verification fee charge here).
-- - Enforce recurring maintenance only for active assets.
-- - Track overdue-since timestamps for operational controls.
-- - Preserve existing transfer-block behavior, now including wallet maintenance.

set search_path = public, pg_temp;

alter table public.user_profiles
  add column if not exists maintenance_overdue_since timestamptz,
  add column if not exists wallet_maintenance_overdue_since timestamptz;

-- Align wallet monthly maintenance baseline to provider cost ($0.25).
update public.commercial_pricing_rules
   set value_numeric = 25,
       updated_at = now(),
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'provider_cost_aligned')
 where fee_code = 'maintenance.wallet.monthly'
   and is_active = true;

-- Currency-aware VA maintenance:
-- USD/EUR/GBP = 200 minor, MXN = 150 minor, BRL/COP = 180 minor.
create or replace function public.charge_va_maintenance(p_user_id uuid)
returns table (charged boolean, amount_usd_minor integer, overdue boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', now())::date;
  v_active integer := 0;
  v_fee integer := 0;
  v_balance integer := 0;
  v_paid boolean := false;
begin
  with active_vas as (
    select upper(currency) as ccy
      from public.bridge_virtual_accounts
     where status = 'active'
       and (
         user_id = p_user_id
         or business_user_id = p_user_id
       )
  )
  select
    count(*)::integer,
    coalesce(sum(
      case ccy
        when 'USD' then 200
        when 'EUR' then 200
        when 'GBP' then 200
        when 'MXN' then 150
        when 'BRL' then 180
        when 'COP' then 180
        else 200
      end
    ), 0)::integer
  into v_active, v_fee
  from active_vas;

  if v_fee <= 0 then
    update public.user_profiles
       set maintenance_overdue = false,
           maintenance_overdue_since = null,
           maintenance_last_charged_at = now()
     where id = p_user_id;

    insert into public.va_maintenance_charges
      (user_id, period_month, active_accounts, amount_usd_minor, status)
    values
      (p_user_id, v_period, 0, 0, 'paid')
    on conflict (user_id, period_month) do update
      set active_accounts = excluded.active_accounts,
          amount_usd_minor = excluded.amount_usd_minor,
          status = excluded.status;

    return query select false, 0, false;
    return;
  end if;

  select coalesce(sum(available_balance_minor), 0)::integer
    into v_balance
    from public.bridge_virtual_account_balances
   where upper(currency) = 'USD'
     and user_id = p_user_id;

  if v_balance >= v_fee then
    update public.bridge_virtual_account_balances
       set available_balance_minor = available_balance_minor - v_fee,
           updated_at = now()
     where id = (
       select id
         from public.bridge_virtual_account_balances
        where user_id = p_user_id
          and upper(currency) = 'USD'
        order by available_balance_minor desc, updated_at desc
        limit 1
     );
    v_paid := true;
  end if;

  insert into public.va_maintenance_charges
    (user_id, period_month, active_accounts, amount_usd_minor, status)
  values
    (p_user_id, v_period, v_active, v_fee, case when v_paid then 'paid' else 'unpaid' end)
  on conflict (user_id, period_month) do update
    set active_accounts = excluded.active_accounts,
        amount_usd_minor = excluded.amount_usd_minor,
        status = excluded.status;

  update public.user_profiles
     set maintenance_overdue = not v_paid,
         maintenance_overdue_since = case
           when v_paid then null
           else coalesce(maintenance_overdue_since, now())
         end,
         maintenance_last_charged_at = now()
   where id = p_user_id;

  return query select v_paid, v_fee, (not v_paid);
end
$$;

revoke all on function public.charge_va_maintenance(uuid) from public, anon, authenticated;
grant execute on function public.charge_va_maintenance(uuid) to service_role;

-- Wallet maintenance should apply only when active wallets exist.
create or replace function public.charge_wallet_maintenance(
  p_user_id uuid,
  p_currency text default 'USD'
)
returns table (charged boolean, amount_minor integer, overdue boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', now())::date;
  v_currency text := upper(coalesce(p_currency, 'USD'));
  v_wallet_unit_minor integer := 0;
  v_active_wallets integer := 0;
  v_amount_minor integer := 0;
  v_balance_minor bigint := 0;
  v_paid boolean := false;
begin
  select coalesce((public.resolve_commercial_pricing_rule(
    'maintenance.wallet.monthly',
    null,
    v_currency,
    null,
    now()
  )->>'value_numeric')::numeric, 25)::integer
  into v_wallet_unit_minor;

  select count(*)::integer
    into v_active_wallets
    from public.bridge_wallets bw
   where bw.status = 'active'
     and (
       bw.user_id = p_user_id
       or bw.business_user_id = p_user_id
     );

  v_amount_minor := greatest(v_wallet_unit_minor, 0) * greatest(v_active_wallets, 0);

  if v_amount_minor <= 0 then
    update public.user_profiles
       set wallet_maintenance_overdue = false,
           wallet_maintenance_overdue_since = null,
           wallet_maintenance_last_charged_at = now()
     where id = p_user_id;

    insert into public.wallet_maintenance_charges
      (user_id, period_month, currency, amount_minor, status)
    values
      (p_user_id, v_period, v_currency, 0, 'paid')
    on conflict (user_id, period_month, currency) do update
      set amount_minor = excluded.amount_minor,
          status = excluded.status,
          updated_at = now();

    return query select false, 0, false;
    return;
  end if;

  select coalesce(sum(available_balance_minor), 0)
    into v_balance_minor
    from public.bridge_virtual_account_balances
   where user_id = p_user_id
     and upper(currency) = v_currency;

  if v_balance_minor >= v_amount_minor then
    update public.bridge_virtual_account_balances
       set available_balance_minor = available_balance_minor - v_amount_minor,
           updated_at = now()
     where id = (
       select id
         from public.bridge_virtual_account_balances
        where user_id = p_user_id
          and upper(currency) = v_currency
        order by available_balance_minor desc, updated_at desc
        limit 1
     );
    v_paid := true;
  end if;

  insert into public.wallet_maintenance_charges
    (user_id, period_month, currency, amount_minor, status)
  values
    (p_user_id, v_period, v_currency, v_amount_minor, case when v_paid then 'paid' else 'unpaid' end)
  on conflict (user_id, period_month, currency) do update
    set amount_minor = excluded.amount_minor,
        status = excluded.status,
        updated_at = now();

  update public.user_profiles
     set wallet_maintenance_overdue = not v_paid,
         wallet_maintenance_overdue_since = case
           when v_paid then null
           else coalesce(wallet_maintenance_overdue_since, now())
         end,
         wallet_maintenance_last_charged_at = now()
   where id = p_user_id;

  return query select v_paid, v_amount_minor, (not v_paid);
end
$$;

revoke all on function public.charge_wallet_maintenance(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_wallet_maintenance(uuid, text) to service_role;
