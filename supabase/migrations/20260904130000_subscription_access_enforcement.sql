-- Account-maintenance access lifecycle.
-- Provider changes are queued here and executed by the authenticated billing
-- worker. SQL never performs network calls and every provider action has a
-- deterministic idempotency key.
begin;

create table if not exists public.subscription_provider_access_actions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  bridge_virtual_account_id text not null,
  bridge_customer_id text not null,
  action text not null check (action in ('deactivate','reactivate')),
  reason text not null default 'subscription_nonpayment',
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  last_error text,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscription_provider_access_actions_pending_idx
  on public.subscription_provider_access_actions(status,next_attempt_at,created_at)
  where status in ('pending','failed');
create index if not exists subscription_provider_access_actions_subscription_idx
  on public.subscription_provider_access_actions(subscription_id,created_at desc);

alter table public.subscription_provider_access_actions enable row level security;
drop policy if exists subscription_provider_access_actions_admin_read on public.subscription_provider_access_actions;
create policy subscription_provider_access_actions_admin_read
  on public.subscription_provider_access_actions for select to authenticated
  using ((select public.is_borderpay_admin()));
drop policy if exists subscription_provider_access_actions_service on public.subscription_provider_access_actions;
create policy subscription_provider_access_actions_service
  on public.subscription_provider_access_actions for all to service_role
  using (true) with check (true);

revoke all on public.subscription_provider_access_actions from public,anon,authenticated;
grant select on public.subscription_provider_access_actions to authenticated;
grant all on public.subscription_provider_access_actions to service_role;

create or replace function public.reconcile_subscription_access_actions(
  p_dry_run boolean default true,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $reconcile_subscription_access_actions$
declare
  deactivate_count integer := 0;
  reactivate_count integer := 0;
  safe_limit integer := greatest(1,least(coalesce(p_limit,100),500));
begin
  update public.subscription_provider_access_actions
  set status='failed',
      last_error='stale_processing_claim_recovered',
      next_attempt_at=now(),
      updated_at=now()
  where status='processing'
    and last_attempt_at < now()-interval '15 minutes';

  select count(*)::integer into deactivate_count
  from (
    select 1
    from public.subscriptions s
    join public.bridge_virtual_accounts va
      on va.user_id=s.user_id or va.business_user_id=s.user_id
    where s.status='active'
      and s.restricted_at is not null
      and va.status='active'
      and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
      and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
    limit safe_limit
  ) q;

  select count(*)::integer into reactivate_count
  from (
    select 1
    from public.subscriptions s
    join public.bridge_virtual_accounts va
      on va.user_id=s.user_id or va.business_user_id=s.user_id
    where s.status='active'
      and s.payment_status='active'
      and s.restricted_at is null
      and va.status='deactivated'
      and va.deactivation_reason='subscription_nonpayment'
      and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
      and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
    limit safe_limit
  ) q;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run',true,
      'would_queue_deactivate',deactivate_count,
      'would_queue_reactivate',reactivate_count
    );
  end if;

  insert into public.subscription_provider_access_actions(
    subscription_id,user_id,bridge_virtual_account_id,bridge_customer_id,action,reason,idempotency_key
  )
  select s.id,s.user_id,va.bridge_virtual_account_id,va.bridge_customer_id,'deactivate','subscription_nonpayment',
    'subscription:deactivate:'||s.id::text||':'||extract(epoch from s.restricted_at)::bigint::text||':'||va.bridge_virtual_account_id
  from public.subscriptions s
  join public.bridge_virtual_accounts va
    on va.user_id=s.user_id or va.business_user_id=s.user_id
  where s.status='active'
    and s.restricted_at is not null
    and va.status='active'
    and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
    and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
  order by s.restricted_at,va.created_at
  limit safe_limit
  on conflict(idempotency_key) do nothing;

  insert into public.subscription_provider_access_actions(
    subscription_id,user_id,bridge_virtual_account_id,bridge_customer_id,action,reason,idempotency_key
  )
  select s.id,s.user_id,va.bridge_virtual_account_id,va.bridge_customer_id,'reactivate','subscription_payment_confirmed',
    'subscription:reactivate:'||s.id::text||':'||coalesce(extract(epoch from s.last_billed_at)::bigint::text,'never')||':'||va.bridge_virtual_account_id
  from public.subscriptions s
  join public.bridge_virtual_accounts va
    on va.user_id=s.user_id or va.business_user_id=s.user_id
  where s.status='active'
    and s.payment_status='active'
    and s.restricted_at is null
    and va.status='deactivated'
    and va.deactivation_reason='subscription_nonpayment'
    and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
    and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
  order by s.last_billed_at nulls last,va.created_at
  limit safe_limit
  on conflict(idempotency_key) do nothing;

  return jsonb_build_object(
    'dry_run',false,
    'eligible_deactivate',deactivate_count,
    'eligible_reactivate',reactivate_count
  );
end;
$reconcile_subscription_access_actions$;

revoke all on function public.reconcile_subscription_access_actions(boolean,integer) from public,anon,authenticated;
grant execute on function public.reconcile_subscription_access_actions(boolean,integer) to service_role;

-- Pending Flutterwave invoices and failed wallet collections share the same
-- grace clock. Day 3 reminds; day 7 restricts and queues provider enforcement.
create or replace function public.apply_subscription_grace_controls()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $apply_subscription_grace_controls$
declare r record; reminded int:=0; restricted int:=0; idem text;
begin
  for r in
    select s.*,up.email,up.full_name,bp.company_name
    from public.subscriptions s
    join public.user_profiles up on up.id=s.user_id
    left join public.business_profiles bp on bp.user_id=s.user_id
    where s.status='active'
      and s.payment_status in ('failed','pending')
      and s.grace_started_at is not null
  loop
    if r.reminder_sent_at is null and r.grace_started_at <= now()-interval '3 days' then
      idem:='subscription:day3_reminder:'||r.id::text||':'||r.next_billing_date::text;
      insert into public.notifications(user_id,type,title,body,metadata)
      values(r.user_id,'system','Account maintenance payment due',
        'Your account maintenance payment is still pending. Pay the invoice to keep receiving accounts and wallets available.',
        jsonb_build_object('idempotency_key',idem,'amount',r.monthly_fee))
      on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;
      insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
      values(r.user_id,r.account_type||'.subscription_payment_status',lower(trim(r.email)),
        jsonb_build_object('customer_name',coalesce(r.company_name,r.full_name),'outcome','reminder','amount',r.monthly_fee),idem)
      on conflict(idempotency_key) do nothing;
      update public.subscriptions set reminder_sent_at=now(),updated_at=now() where id=r.id;
      reminded:=reminded+1;
    end if;
    if r.restricted_at is null and r.grace_started_at <= now()-interval '7 days' then
      update public.subscriptions set restricted_at=now(),updated_at=now() where id=r.id;
      idem:='subscription:restricted:'||r.id::text||':'||r.next_billing_date::text;
      insert into public.notifications(user_id,type,title,body,metadata)
      values(r.user_id,'system','Account access restricted',
        'Receiving accounts and wallets are unavailable until the overdue maintenance invoice is paid.',
        jsonb_build_object('idempotency_key',idem,'amount',r.monthly_fee))
      on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;
      insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
      values(r.user_id,r.account_type||'.subscription_payment_status',lower(trim(r.email)),
        jsonb_build_object('customer_name',coalesce(r.company_name,r.full_name),'outcome','restricted','amount',r.monthly_fee),idem)
      on conflict(idempotency_key) do nothing;
      insert into public.subscription_admin_logs(user_id,subscription_id,action,details)
      values(r.user_id,r.id,'account_access_restricted',jsonb_build_object('grace_days',7,'billing_period',r.next_billing_date));
      restricted:=restricted+1;
    end if;
  end loop;
  return jsonb_build_object('reminded',reminded,'restricted',restricted);
end;
$apply_subscription_grace_controls$;

revoke all on function public.apply_subscription_grace_controls() from public,anon,authenticated;
grant execute on function public.apply_subscription_grace_controls() to service_role;

commit;
