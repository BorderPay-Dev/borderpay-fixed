-- Canonical maintenance pricing from September 2026 onward.
-- Historical August invoices remain USD 15.00; business periods beginning
-- September 2026 are USD 29.99. This migration does not collect funds.
begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_monthly_fee_check;

alter table public.subscriptions
  add constraint subscriptions_monthly_fee_check
  check (monthly_fee in (5.00, 15.00, 29.99));

create or replace function public.subscription_fee_for_period(
  p_account_type text,
  p_billing_period date
)
returns numeric
language plpgsql
immutable
strict
as $subscription_fee_for_period$
begin
  if p_account_type = 'individual' then
    return 5.00;
  end if;
  if p_account_type = 'business' and p_billing_period < date '2026-09-01' then
    return 15.00;
  end if;
  if p_account_type = 'business' then
    return 29.99;
  end if;
  raise exception 'Unsupported subscription account type: %', p_account_type;
end;
$subscription_fee_for_period$;

revoke all on function public.subscription_fee_for_period(text,date)
  from public, anon, authenticated;
grant execute on function public.subscription_fee_for_period(text,date)
  to service_role;

create or replace function public.apply_subscription_period_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $apply_subscription_period_fee$
begin
  new.monthly_fee := public.subscription_fee_for_period(new.account_type, new.next_billing_date);
  return new;
end;
$apply_subscription_period_fee$;

drop trigger if exists subscriptions_apply_period_fee on public.subscriptions;
create trigger subscriptions_apply_period_fee
before insert or update of account_type, next_billing_date
on public.subscriptions
for each row execute function public.apply_subscription_period_fee();

-- Move current/future business subscriptions to the published fee without
-- modifying the immutable amount on existing August invoice rows.
update public.subscriptions
set monthly_fee = public.subscription_fee_for_period(account_type, next_billing_date),
    updated_at = now()
where monthly_fee is distinct from public.subscription_fee_for_period(account_type, next_billing_date);

do $assertions$
begin
  if public.subscription_fee_for_period('business', date '2026-08-31') <> 15.00 then
    raise exception 'August Business maintenance fee must remain 15.00';
  end if;
  if public.subscription_fee_for_period('business', date '2026-09-30') <> 29.99 then
    raise exception 'September Business maintenance fee must be 29.99';
  end if;
  if public.subscription_fee_for_period('individual', date '2026-09-30') <> 5.00 then
    raise exception 'Historical Individual maintenance fee must remain 5.00';
  end if;
end;
$assertions$;

commit;
