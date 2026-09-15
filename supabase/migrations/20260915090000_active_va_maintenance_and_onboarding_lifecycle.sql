-- Maintenance billing follows active receiving-account infrastructure, not
-- verification alone. Incomplete business applications receive an idempotent
-- 1/3/7/21/30-day lifecycle; day 30 freezes but never deletes the record.
begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_monthly_fee_check;

update public.subscriptions
set monthly_fee = case when account_type = 'business' then 29.99 else 5.00 end,
    updated_at = now()
where monthly_fee is distinct from case when account_type = 'business' then 29.99 else 5.00 end;

alter table public.subscriptions
  add constraint subscriptions_monthly_fee_check
  check (monthly_fee in (5.00, 29.99));

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
  if lower(p_account_type) = 'individual' then return 5.00; end if;
  if lower(p_account_type) = 'business' then return 29.99; end if;
  raise exception 'Unsupported subscription account type: %', p_account_type;
end;
$subscription_fee_for_period$;

revoke all on function public.subscription_fee_for_period(text,date)
  from public, anon, authenticated;
grant execute on function public.subscription_fee_for_period(text,date)
  to service_role;

-- Keep paid history immutable. Close unpaid prior periods and obsolete $15
-- links without representing them as paid.
update public.subscription_external_invoices sei
set status = 'cancelled',
    payment_link = null,
    expires_at = now(),
    last_error = 'superseded_by_active_va_billing_policy',
    metadata = coalesce(sei.metadata, '{}'::jsonb) || jsonb_build_object(
      'superseded_at', now(),
      'superseded_reason', 'active_va_billing_policy'
    ),
    updated_at = now()
from public.subscriptions s
where s.id = sei.subscription_id
  and sei.paid_at is null
  and sei.status in ('pending_configuration','payment_link_created','failed')
  and sei.billing_period < public.subscription_current_month_end(current_date);

-- A current/future $15 link cannot be reused because its provider amount is
-- immutable. Reset the local row so the collector creates a $29.99 link.
update public.subscription_external_invoices sei
set amount=29.99,status='pending_configuration',provider_reference=null,
    provider_transaction_id=null,payment_link=null,attempt_count=0,last_error=null,
    expires_at=null,
    metadata=coalesce(sei.metadata,'{}'::jsonb)||jsonb_build_object('reissued_from_amount',sei.amount,'reissued_at',now()),
    updated_at=now()
from public.subscriptions s
where s.id=sei.subscription_id and s.account_type='business'
  and sei.paid_at is null and sei.amount<>29.99
  and sei.billing_period>=public.subscription_current_month_end(current_date);

create or replace function public.maintenance_account_is_billable(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $maintenance_account_is_billable$
  select exists(
    select 1
    from public.user_profiles up
    left join public.business_profiles bp on bp.user_id=up.id
    join auth.users au on au.id=up.id and au.deleted_at is null
    where up.id=p_user_id
      and lower(up.account_type::text) in ('business','individual')
      and lower(coalesce(up.kyc_status::text,''))='verified'
      and (lower(up.account_type::text)='individual'
        or lower(coalesce(bp.bridge_kyb_status::text,'')) in ('approved','verified'))
      and lower(coalesce(up.account_status::text,'active')) not in
        ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
      and lower(coalesce(up.bridge_account_status::text,'active')) not in
        ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
      and exists(
        select 1 from public.bridge_virtual_accounts va
        where coalesce(va.business_user_id,va.user_id)=up.id
          and lower(va.status::text) in ('active','activated')
      )
  )
$maintenance_account_is_billable$;

revoke all on function public.maintenance_account_is_billable(uuid)
  from public, anon, authenticated;
grant execute on function public.maintenance_account_is_billable(uuid)
  to service_role;

create or replace function public.maintenance_billing_eligibility_snapshot()
returns table(
  account_type text,
  verified_accounts bigint,
  billable_active_va_accounts bigint,
  excluded_without_active_va bigint,
  active_virtual_accounts bigint,
  inactive_virtual_accounts bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $maintenance_billing_eligibility_snapshot$
  with verified as (
    select up.id, lower(up.account_type::text) account_type,up.email,up.full_name,bp.company_name
    from public.user_profiles up
    left join public.business_profiles bp on bp.user_id = up.id
    join auth.users au on au.id = up.id and au.deleted_at is null
    where lower(up.account_type::text) in ('business','individual')
      and lower(coalesce(up.kyc_status::text,'')) = 'verified'
      and (
        lower(up.account_type::text) = 'individual'
        or lower(coalesce(bp.bridge_kyb_status::text,'')) in ('approved','verified')
      )
      and lower(coalesce(up.account_status::text,'active')) not in
        ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
      and lower(coalesce(up.bridge_account_status::text,'active')) not in
        ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
  ), va as (
    select coalesce(business_user_id,user_id) user_id,
      count(*) filter (where lower(status::text) in ('active','activated')) active_count,
      count(*) filter (where lower(status::text) not in ('active','activated')) inactive_count
    from public.bridge_virtual_accounts
    group by coalesce(business_user_id,user_id)
  )
  select v.account_type,
    count(*)::bigint,
    count(*) filter (where coalesce(va.active_count,0) > 0)::bigint,
    count(*) filter (where coalesce(va.active_count,0) = 0)::bigint,
    coalesce(sum(va.active_count),0)::bigint,
    coalesce(sum(va.inactive_count),0)::bigint
  from verified v left join va on va.user_id = v.id
  group by v.account_type order by v.account_type
$maintenance_billing_eligibility_snapshot$;

revoke all on function public.maintenance_billing_eligibility_snapshot()
  from public, anon, authenticated;
grant execute on function public.maintenance_billing_eligibility_snapshot()
  to service_role;

create or replace function public.sync_active_va_maintenance_subscriptions(
  p_billing_period date default public.subscription_current_month_end(current_date),
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $sync_active_va_maintenance_subscriptions$
declare
  r record;
  eligible_count integer := 0;
  activated_count integer := 0;
  paused_count integer := 0;
begin
  if p_billing_period <> public.subscription_current_month_end(p_billing_period) then
    raise exception 'Billing period must be the final day of its calendar month';
  end if;

  -- Pause subscriptions and unpaid invoices when no active VA remains.
  select count(*)::integer into paused_count
  from public.subscriptions s
  where s.status = 'active'
    and not public.maintenance_account_is_billable(s.user_id);

  if not p_dry_run then
    update public.subscription_external_invoices sei
    set status='cancelled', payment_link=null, expires_at=now(),
        last_error='account_not_billable_or_no_active_virtual_account',
        metadata=coalesce(sei.metadata,'{}'::jsonb)||jsonb_build_object('cancelled_at',now(),'reason','account_not_billable_or_no_active_virtual_account'),
        updated_at=now()
    from public.subscriptions s
    where s.id=sei.subscription_id and s.status='active'
      and sei.paid_at is null
      and sei.status in ('pending_configuration','payment_link_created','failed')
      and not public.maintenance_account_is_billable(s.user_id);

    update public.subscriptions s
    set status='cancelled', payment_status='active', grace_started_at=null,
        reminder_sent_at=null, restricted_at=null,
        metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object('billing_paused_reason','account_not_billable_or_no_active_virtual_account','billing_paused_at',now()),
        updated_at=now()
    where s.status='active'
      and not public.maintenance_account_is_billable(s.user_id);
  end if;

  for r in
    select up.id,lower(up.account_type::text) account_type,up.email,up.full_name,bp.company_name
    from public.user_profiles up
    left join public.business_profiles bp on bp.user_id=up.id
    join auth.users au on au.id=up.id and au.deleted_at is null
    where lower(up.account_type::text) in ('business','individual')
      and lower(coalesce(up.kyc_status::text,''))='verified'
      and (lower(up.account_type::text)='individual'
        or lower(coalesce(bp.bridge_kyb_status::text,'')) in ('approved','verified'))
      and lower(coalesce(up.account_status::text,'active')) not in
        ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
      and lower(coalesce(up.bridge_account_status::text,'active')) not in
        ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
      and exists (
        select 1 from public.bridge_virtual_accounts va
        where coalesce(va.business_user_id,va.user_id)=up.id
          and lower(va.status::text) in ('active','activated')
      )
    order by up.id
  loop
    eligible_count := eligible_count + 1;
    if not p_dry_run then
      perform public.ensure_internal_subscription(r.id,p_billing_period,false);
      update public.subscriptions
      set status='active', monthly_fee=case when r.account_type='business' then 29.99 else 5.00 end,
          next_billing_date=p_billing_period,
          metadata=(coalesce(metadata,'{}'::jsonb)-'billing_paused_reason'-'billing_paused_at')||jsonb_build_object('active_va_eligibility_checked_at',now()),
          updated_at=now()
      where user_id=r.id;
      insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
      select r.id,r.account_type||'.account_maintenance_fee',lower(trim(r.email)),
        jsonb_build_object(
          'company_name',r.company_name,'full_name',r.full_name,
          'billing_start_date',p_billing_period
        ),
        'subscription:active_va_maintenance:'||p_billing_period::text||':'||r.id::text
      where nullif(trim(coalesce(r.email,'')),'') is not null
      on conflict(idempotency_key) do nothing;
      activated_count := activated_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run',p_dry_run,'billing_period',p_billing_period,
    'eligible',eligible_count,'activated',activated_count,'paused_no_active_va',paused_count
  );
end;
$sync_active_va_maintenance_subscriptions$;

revoke all on function public.sync_active_va_maintenance_subscriptions(date,boolean)
  from public, anon, authenticated;
grant execute on function public.sync_active_va_maintenance_subscriptions(date,boolean)
  to service_role;

create table if not exists public.business_onboarding_lifecycle_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lifecycle_day integer not null check (lifecycle_day in (1,3,7,21,30)),
  action text not null check (action in ('welcome','reminder','warning','frozen')),
  provider_status text not null,
  created_at timestamptz not null default now(),
  unique(user_id,lifecycle_day)
);

alter table public.business_onboarding_lifecycle_actions enable row level security;
drop policy if exists business_onboarding_lifecycle_actions_admin on public.business_onboarding_lifecycle_actions;
create policy business_onboarding_lifecycle_actions_admin
  on public.business_onboarding_lifecycle_actions for select to authenticated
  using ((select public.is_borderpay_admin()));
drop policy if exists business_onboarding_lifecycle_actions_service on public.business_onboarding_lifecycle_actions;
create policy business_onboarding_lifecycle_actions_service
  on public.business_onboarding_lifecycle_actions for all to service_role
  using (true) with check (true);

create or replace function public.run_business_onboarding_lifecycle(
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $run_business_onboarding_lifecycle$
declare
  r record;
  target_day integer;
  target_action text;
  candidate_count integer := 0;
  queued_count integer := 0;
  frozen_count integer := 0;
  idem text;
begin
  for r in
    select up.id,up.email,up.full_name,bp.company_name,au.created_at,
      lower(coalesce(bp.bridge_kyb_status::text,up.bridge_kyc_status::text,'not_started')) provider_status,
      floor(extract(epoch from (now()-au.created_at))/86400)::integer age_days
    from public.user_profiles up
    join public.business_profiles bp on bp.user_id=up.id
    join auth.users au on au.id=up.id and au.deleted_at is null
    where lower(up.account_type::text)='business'
      and lower(coalesce(bp.bridge_kyb_status::text,up.bridge_kyc_status::text,'not_started')) in ('not_started','incomplete')
      and lower(coalesce(up.account_status::text,'active')) not in ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
      and lower(coalesce(up.bridge_account_status::text,'active')) not in ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
      and nullif(trim(coalesce(up.email,'')),'') is not null
    order by au.created_at,up.id
  loop
    target_day := case when r.age_days>=30 then 30 when r.age_days>=21 then 21
      when r.age_days>=7 then 7 when r.age_days>=3 then 3 when r.age_days>=1 then 1 else null end;
    if target_day is null then continue; end if;
    target_action := case when target_day=1 then 'welcome' when target_day in (3,7) then 'reminder'
      when target_day=21 then 'warning' else 'frozen' end;
    if exists(select 1 from public.business_onboarding_lifecycle_actions a where a.user_id=r.id and a.lifecycle_day=target_day) then
      continue;
    end if;
    candidate_count := candidate_count+1;
    if p_dry_run then continue; end if;

    insert into public.business_onboarding_lifecycle_actions(user_id,lifecycle_day,action,provider_status)
    values(r.id,target_day,target_action,r.provider_status)
    on conflict(user_id,lifecycle_day) do nothing;
    if not found then continue; end if;

    idem := 'business:onboarding:day'||target_day::text||':'||r.id::text;
    insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
    values(r.id,'business.onboarding_lifecycle',lower(trim(r.email)),
      jsonb_build_object('company_name',coalesce(r.company_name,r.full_name),'stage','day_'||target_day::text),idem)
    on conflict(idempotency_key) do nothing;
    insert into public.notifications(user_id,type,title,body,metadata)
    values(r.id,'system',
      case when target_day=30 then 'Incomplete business application frozen' else 'Complete your business verification' end,
      case when target_day=30
        then 'Your incomplete application was frozen after 30 days. The record was retained. Contact Support to resume onboarding.'
        else 'Continue business verification to activate eligible BorderPay services.' end,
      jsonb_build_object('idempotency_key',idem,'lifecycle_day',target_day,'provider_status',r.provider_status))
    on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;
    queued_count := queued_count+1;

    if target_day=30 then
      update public.user_profiles up
      set account_status='frozen',account_frozen_at=coalesce(account_frozen_at,now()),
          account_frozen_reason='Business onboarding incomplete after 30 days',updated_at=now()
      where up.id=r.id
        and lower(coalesce(up.account_status::text,'active')) not in ('paused','frozen','offboarded','rejected','closed','deleted','suspended')
        and exists(select 1 from public.business_profiles current_bp where current_bp.user_id=up.id
          and lower(coalesce(current_bp.bridge_kyb_status::text,up.bridge_kyc_status::text,'not_started')) in ('not_started','incomplete'));
      if found then frozen_count:=frozen_count+1; end if;
    end if;
  end loop;
  return jsonb_build_object('dry_run',p_dry_run,'eligible_actions',candidate_count,'queued',queued_count,'frozen',frozen_count);
end;
$run_business_onboarding_lifecycle$;

revoke all on function public.run_business_onboarding_lifecycle(boolean)
  from public, anon, authenticated;
grant execute on function public.run_business_onboarding_lifecycle(boolean)
  to service_role;

commit;
