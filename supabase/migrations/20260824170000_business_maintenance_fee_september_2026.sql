-- Future-dated Business maintenance pricing.
-- August 2026 Business billing remains USD 15.00. Business billing periods
-- on or after 2026-09-01 are USD 29.99. Individual billing remains USD 5.00.

alter table public.subscriptions
  drop constraint if exists subscriptions_monthly_fee_check;

alter table public.subscriptions
  add constraint subscriptions_monthly_fee_check
  check (monthly_fee in (5.00, 15.00, 29.99));

create or replace function public.subscription_fee_for_period(
  p_account_type text,
  p_billing_period date
) returns numeric
language plpgsql
immutable
strict
as $fee$
begin
  if p_account_type = 'individual' then
    return 5.00;
  elsif p_account_type = 'business' and p_billing_period < date '2026-09-01' then
    return 15.00;
  elsif p_account_type = 'business' then
    return 29.99;
  end if;
  raise exception 'Unsupported subscription account type: %', p_account_type;
end;
$fee$;

revoke all on function public.subscription_fee_for_period(text,date) from public, anon, authenticated;
grant execute on function public.subscription_fee_for_period(text,date) to service_role;

create or replace function public.apply_subscription_period_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $trigger$
begin
  new.monthly_fee := public.subscription_fee_for_period(new.account_type, new.next_billing_date);
  return new;
end;
$trigger$;

revoke all on function public.apply_subscription_period_fee() from public, anon, authenticated;

drop trigger if exists subscriptions_apply_period_fee on public.subscriptions;
create trigger subscriptions_apply_period_fee
before insert or update of account_type, next_billing_date
on public.subscriptions
for each row execute function public.apply_subscription_period_fee();

-- Canonicalize existing rows according to their actual next billing period.
-- An overdue August period remains 15.00 until it is billed; the existing
-- billing function then advances next_billing_date and the trigger selects
-- 29.99 for the September period.
update public.subscriptions
set monthly_fee = public.subscription_fee_for_period(account_type, next_billing_date),
    updated_at = now()
where monthly_fee is distinct from public.subscription_fee_for_period(account_type, next_billing_date);

create or replace function public.ensure_internal_subscription(
  p_user_id uuid, p_first_billing_date date default '2026-08-31'::date,
  p_send_verified_email boolean default true
) returns public.subscriptions language plpgsql security definer set search_path = public as $$
declare
  v_profile record; v_business record; v_sub public.subscriptions; v_type text;
  v_fee numeric; v_verified_at timestamptz; v_name text; v_template text;
  v_first_billing_date date;
begin
  select id, email, full_name, account_type::text, kyc_status::text,
         coalesce(kyc_verified_at, bridge_kyc_completed_at, updated_at, now()) verified_at
    into v_profile from public.user_profiles where id = p_user_id;
  if not found or lower(coalesce(v_profile.kyc_status,'')) <> 'verified' then
    raise exception 'User is not verified';
  end if;
  v_type := case when v_profile.account_type = 'business' then 'business' else 'individual' end;
  if v_type = 'business' then
    select company_name, bridge_kyb_status,
           coalesce(bridge_kyb_completed_at, updated_at, now()) verified_at
      into v_business from public.business_profiles where user_id = p_user_id;
    if not found or lower(coalesce(v_business.bridge_kyb_status,'')) not in ('approved','verified') then
      raise exception 'Business is not KYB verified';
    end if;
    v_verified_at := v_business.verified_at;
    v_name := coalesce(v_business.company_name, v_profile.full_name);
  else
    v_verified_at := v_profile.verified_at;
    v_name := v_profile.full_name;
  end if;

  v_first_billing_date := greatest(p_first_billing_date, current_date);
  v_fee := public.subscription_fee_for_period(v_type, v_first_billing_date);

  insert into public.subscriptions(user_id, account_type, monthly_fee, next_billing_date, verified_at)
  values(p_user_id, v_type, v_fee, v_first_billing_date, v_verified_at)
  on conflict(user_id) do update set
    account_type=excluded.account_type,
    monthly_fee=public.subscription_fee_for_period(excluded.account_type, subscriptions.next_billing_date),
    verified_at=excluded.verified_at,
    updated_at=now()
  returning * into v_sub;

  perform public.emit_subscription_event(p_user_id, v_sub.id, null, 'subscription.created',
    'subscription.created:' || v_sub.id::text,
    jsonb_build_object('account_type',v_type,'monthly_fee',v_sub.monthly_fee,'currency','USD','next_billing_date',v_sub.next_billing_date));

  if p_send_verified_email and nullif(trim(coalesce(v_profile.email,'')),'') is not null then
    v_template := v_type || '.account_verified_subscription';
    insert into public.subscription_email_jobs(user_id, template, recipient, props, idempotency_key)
    values(p_user_id, v_template, lower(trim(v_profile.email)),
      jsonb_build_object('customer_name',v_name,'account_type',v_type,'monthly_fee',v_sub.monthly_fee,'billing_start_date',v_sub.next_billing_date),
      'subscription:verified:' || p_user_id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return v_sub;
end $$;

revoke all on function public.ensure_internal_subscription(uuid,date,boolean) from public,anon,authenticated;
grant execute on function public.ensure_internal_subscription(uuid,date,boolean) to service_role;

do $assertions$
begin
  if public.subscription_fee_for_period('business', date '2026-08-31') <> 15.00 then
    raise exception 'August Business maintenance fee must remain 15.00';
  end if;
  if public.subscription_fee_for_period('business', date '2026-09-01') <> 29.99 then
    raise exception 'September Business maintenance fee must be 29.99';
  end if;
  if public.subscription_fee_for_period('individual', date '2026-09-01') <> 5.00 then
    raise exception 'Individual maintenance fee must remain 5.00';
  end if;
end;
$assertions$;
