-- BorderPay custodial subscription billing.
-- All value movement is internal. This migration never invokes a provider or
-- creates an on-chain transfer.
begin;

-- Production already owns these wallet records. Defining the table here keeps
-- a clean migration replay self-contained without changing existing rows.
create table if not exists public.maintenance_wallet_whitelist (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  chain text not null,
  address text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(currency, chain, address)
);

create table if not exists public.billing_revenue_wallets (
  id uuid primary key default gen_random_uuid(),
  whitelist_wallet_id uuid not null unique references public.maintenance_wallet_whitelist(id) on delete restrict,
  asset text not null check (asset in ('USDC','USDT')),
  network text not null check (network in ('BASE','TRON')),
  balance_minor bigint not null default 0 check (balance_minor >= 0),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset, network)
);

insert into public.billing_revenue_wallets(whitelist_wallet_id, asset, network)
select id, upper(currency), upper(chain)
from public.maintenance_wallet_whitelist
where active
  and (upper(currency), lower(chain)) in (('USDC','base'),('USDT','tron'))
on conflict (asset, network) do update
set whitelist_wallet_id=excluded.whitelist_wallet_id, status='active', updated_at=now();

do $required_revenue_wallets$
begin
  if (select count(*) from public.billing_revenue_wallets where status='active') <> 2 then
    raise exception 'Active BorderPay whitelist wallets for USDC/Base and USDT/Tron are required';
  end if;
end $required_revenue_wallets$;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  account_type text not null check (account_type in ('individual','business')),
  monthly_fee numeric(12,2) not null check (monthly_fee in (5.00,15.00)),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'active' check (status in ('active','cancelled')),
  payment_status text not null default 'active' check (payment_status in ('active','failed','pending')),
  next_billing_date date not null,
  verified_at timestamptz not null,
  last_billed_at timestamptz,
  failure_count integer not null default 0,
  grace_started_at timestamptz,
  reminder_sent_at timestamptz,
  restricted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_due_idx on public.subscriptions(next_billing_date)
  where status = 'active';

create table if not exists public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  billing_period date not null,
  type text not null default 'subscription_fee' check (type = 'subscription_fee'),
  asset text check (asset in ('USDC','USDT','MIXED')),
  amount numeric(12,2) not null,
  collected_amount numeric(12,2) not null default 0,
  status text not null check (status in ('started','completed','failed')),
  asset_breakdown jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 1,
  failure_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(subscription_id, billing_period)
);
create index if not exists billing_transactions_user_idx
  on public.billing_transactions(user_id, created_at desc);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  from_wallet_id uuid,
  to_wallet_id uuid,
  user_id uuid not null references auth.users(id) on delete restrict,
  asset text not null check (asset in ('USDC','USDT')),
  amount numeric(18,6) not null check (amount > 0),
  transaction_type text not null check (transaction_type = 'subscription_fee'),
  reference_id uuid not null references public.billing_transactions(id) on delete restrict,
  canonical_ledger_id uuid not null references public.bridge_balance_ledger(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(reference_id, asset)
);
create index if not exists ledger_entries_user_idx on public.ledger_entries(user_id, created_at desc);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  billing_transaction_id uuid references public.billing_transactions(id) on delete set null,
  event_type text not null check (event_type in (
    'subscription.created','subscription.billing.started',
    'subscription.payment.completed','subscription.payment.failed',
    'subscription.cancelled'
  )),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  secret text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_event_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.subscription_events(id) on delete cascade,
  endpoint_id uuid not null references public.subscription_webhook_endpoints(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(event_id, endpoint_id)
);

create table if not exists public.subscription_email_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template text not null,
  recipient text not null,
  props jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_admin_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  billing_transaction_id uuid references public.billing_transactions(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists notifications_subscription_idem_idx
  on public.notifications(user_id, ((metadata->>'idempotency_key')))
  where metadata ? 'idempotency_key';

alter table public.billing_revenue_wallets enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_webhook_endpoints enable row level security;
alter table public.subscription_event_deliveries enable row level security;
alter table public.subscription_email_jobs enable row level security;
alter table public.subscription_admin_logs enable row level security;

drop policy if exists subscriptions_owner_read on public.subscriptions;
create policy subscriptions_owner_read on public.subscriptions for select to authenticated using (auth.uid() = user_id);
drop policy if exists subscriptions_admin_read on public.subscriptions;
create policy subscriptions_admin_read on public.subscriptions for select to authenticated using (public.is_borderpay_admin());
drop policy if exists subscriptions_service on public.subscriptions;
create policy subscriptions_service on public.subscriptions for all to service_role using (true) with check (true);

drop policy if exists billing_transactions_owner_read on public.billing_transactions;
create policy billing_transactions_owner_read on public.billing_transactions for select to authenticated using (auth.uid() = user_id);
drop policy if exists billing_transactions_admin_read on public.billing_transactions;
create policy billing_transactions_admin_read on public.billing_transactions for select to authenticated using (public.is_borderpay_admin());
drop policy if exists billing_transactions_service on public.billing_transactions;
create policy billing_transactions_service on public.billing_transactions for all to service_role using (true) with check (true);

drop policy if exists ledger_entries_owner_read on public.ledger_entries;
create policy ledger_entries_owner_read on public.ledger_entries for select to authenticated using (auth.uid() = user_id);
drop policy if exists ledger_entries_admin_read on public.ledger_entries;
create policy ledger_entries_admin_read on public.ledger_entries for select to authenticated using (public.is_borderpay_admin());
drop policy if exists ledger_entries_service on public.ledger_entries;
create policy ledger_entries_service on public.ledger_entries for all to service_role using (true) with check (true);

drop policy if exists subscription_events_owner_read on public.subscription_events;
create policy subscription_events_owner_read on public.subscription_events for select to authenticated using (auth.uid() = user_id);
drop policy if exists subscription_events_admin_read on public.subscription_events;
create policy subscription_events_admin_read on public.subscription_events for select to authenticated using (public.is_borderpay_admin());
drop policy if exists subscription_events_service on public.subscription_events;
create policy subscription_events_service on public.subscription_events for all to service_role using (true) with check (true);

do $policies$
declare t text;
begin
  foreach t in array array['billing_revenue_wallets','subscription_webhook_endpoints','subscription_event_deliveries','subscription_email_jobs','subscription_admin_logs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_borderpay_admin())', t || '_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_service', t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service', t);
  end loop;
end $policies$;

create or replace function public.subscription_next_month_end(p_date date)
returns date language sql immutable strict as $$
  select (date_trunc('month', p_date::timestamp) + interval '2 months - 1 day')::date
$$;

create or replace function public.emit_subscription_event(
  p_user_id uuid, p_subscription_id uuid, p_billing_transaction_id uuid,
  p_event_type text, p_idempotency_key text, p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.subscription_events(user_id, subscription_id, billing_transaction_id, event_type, idempotency_key, payload)
  values (p_user_id, p_subscription_id, p_billing_transaction_id, p_event_type, p_idempotency_key, coalesce(p_payload,'{}'::jsonb))
  on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning id into v_id;
  insert into public.subscription_event_deliveries(event_id, endpoint_id)
  select v_id, id from public.subscription_webhook_endpoints where enabled
  on conflict do nothing;
  return v_id;
end $$;

create or replace function public.ensure_internal_subscription(
  p_user_id uuid, p_first_billing_date date default '2026-08-31'::date,
  p_send_verified_email boolean default true
) returns public.subscriptions language plpgsql security definer set search_path = public as $$
declare
  v_profile record; v_business record; v_sub public.subscriptions; v_type text;
  v_fee numeric; v_verified_at timestamptz; v_name text; v_template text;
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
    v_fee := 15; v_verified_at := v_business.verified_at; v_name := coalesce(v_business.company_name, v_profile.full_name);
  else
    v_fee := 5; v_verified_at := v_profile.verified_at; v_name := v_profile.full_name;
  end if;

  insert into public.subscriptions(user_id, account_type, monthly_fee, next_billing_date, verified_at)
  values(p_user_id, v_type, v_fee, greatest(p_first_billing_date, current_date), v_verified_at)
  on conflict(user_id) do update set
    account_type=excluded.account_type, monthly_fee=excluded.monthly_fee,
    verified_at=excluded.verified_at, updated_at=now()
  returning * into v_sub;

  perform public.emit_subscription_event(p_user_id, v_sub.id, null, 'subscription.created',
    'subscription.created:' || v_sub.id::text,
    jsonb_build_object('account_type',v_type,'monthly_fee',v_fee,'currency','USD','next_billing_date',v_sub.next_billing_date));

  if p_send_verified_email and nullif(trim(coalesce(v_profile.email,'')),'') is not null then
    v_template := v_type || '.account_verified_subscription';
    insert into public.subscription_email_jobs(user_id, template, recipient, props, idempotency_key)
    values(p_user_id, v_template, lower(trim(v_profile.email)),
      jsonb_build_object('customer_name',v_name,'account_type',v_type,'monthly_fee',v_fee,'billing_start_date',v_sub.next_billing_date),
      'subscription:verified:' || p_user_id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return v_sub;
end $$;

create or replace function public.on_subscription_verification_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'user_profiles' then
    if lower(coalesce(new.kyc_status::text,'')) = 'verified'
       and (tg_op = 'INSERT' or lower(coalesce(old.kyc_status::text,'')) <> 'verified') then
      if new.account_type::text = 'individual' or exists(
        select 1 from public.business_profiles bp where bp.user_id=new.id
          and lower(coalesce(bp.bridge_kyb_status,'')) in ('approved','verified')
      ) then
        perform public.ensure_internal_subscription(new.id, public.subscription_next_month_end(current_date), true);
      end if;
    end if;
  elsif tg_table_name = 'business_profiles' then
    if lower(coalesce(new.bridge_kyb_status,'')) in ('approved','verified')
       and (tg_op = 'INSERT' or lower(coalesce(old.bridge_kyb_status,'')) not in ('approved','verified')) then
      if exists(select 1 from public.user_profiles up where up.id=new.user_id and lower(coalesce(up.kyc_status::text,''))='verified') then
        perform public.ensure_internal_subscription(new.user_id, public.subscription_next_month_end(current_date), true);
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists subscription_on_individual_verified on public.user_profiles;
create trigger subscription_on_individual_verified after insert or update of kyc_status on public.user_profiles
for each row execute function public.on_subscription_verification_change();
drop trigger if exists subscription_on_business_verified on public.business_profiles;
create trigger subscription_on_business_verified after insert or update of bridge_kyb_status on public.business_profiles
for each row execute function public.on_subscription_verification_change();

create or replace function public.charge_internal_subscription(p_subscription_id uuid, p_billing_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.subscriptions; tx public.billing_transactions; w record;
  fee_minor bigint; usdc_balance bigint := 0; usdt_balance bigint := 0;
  usdc_take bigint := 0; usdt_take bigint := 0; new_balance bigint; canon uuid;
  result_asset text; idem text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_subscription_id::text, 0));
  select * into s from public.subscriptions where id=p_subscription_id for update;
  if not found then raise exception 'Subscription not found'; end if;
  if s.status <> 'active' then return jsonb_build_object('status','skipped','reason','inactive'); end if;
  if s.next_billing_date > p_billing_date then return jsonb_build_object('status','skipped','reason','not_due'); end if;

  insert into public.billing_transactions(subscription_id,user_id,billing_period,amount,status)
  values(s.id,s.user_id,s.next_billing_date,s.monthly_fee,'started')
  on conflict(subscription_id,billing_period) do update set
    attempt_count=public.billing_transactions.attempt_count+1
  returning * into tx;
  if tx.status='completed' then return jsonb_build_object('status','completed','idempotent',true,'reference',tx.id); end if;
  perform public.emit_subscription_event(s.user_id,s.id,tx.id,'subscription.billing.started',
    'subscription.billing.started:'||tx.id::text,jsonb_build_object('amount',s.monthly_fee,'period',tx.billing_period));

  fee_minor := round(s.monthly_fee * 1000000)::bigint;
  -- Lock wallet identities. The immutable balance ledger remains the source of truth.
  perform 1 from public.bridge_wallets where (user_id=s.user_id or business_user_id=s.user_id)
    and status='active' and ((upper(currency)='USDC' and lower(chain)='base') or (upper(currency)='USDT' and lower(chain)='tron')) for update;

  select coalesce(sum(case when l.direction='credit' then l.amount_minor else -l.amount_minor end),0)
    into usdc_balance from public.bridge_balance_ledger l join public.bridge_wallets bw on bw.bridge_wallet_id=l.entity_id
   where l.entity_type='wallet' and (bw.user_id=s.user_id or bw.business_user_id=s.user_id)
     and upper(l.currency)='USDC' and upper(bw.currency)='USDC' and lower(bw.chain)='base' and bw.status='active';
  select coalesce(sum(case when l.direction='credit' then l.amount_minor else -l.amount_minor end),0)
    into usdt_balance from public.bridge_balance_ledger l join public.bridge_wallets bw on bw.bridge_wallet_id=l.entity_id
   where l.entity_type='wallet' and (bw.user_id=s.user_id or bw.business_user_id=s.user_id)
     and upper(l.currency)='USDT' and upper(bw.currency)='USDT' and lower(bw.chain)='tron' and bw.status='active';

  if greatest(usdc_balance,0)+greatest(usdt_balance,0) < fee_minor then
    update public.billing_transactions set status='failed',collected_amount=0,failure_code='insufficient_balance',
      asset_breakdown=jsonb_build_object('USDC_available',greatest(usdc_balance,0)/1000000.0,'USDT_available',greatest(usdt_balance,0)/1000000.0)
      where id=tx.id;
    update public.subscriptions set payment_status='failed',failure_count=failure_count+1,
      grace_started_at=coalesce(grace_started_at,now()),updated_at=now() where id=s.id;
    idem := 'subscription:payment_failed:'||tx.id::text;
    insert into public.notifications(user_id,type,title,body,metadata)
    values(s.user_id,'system','Subscription Payment Failed',
      'Your BorderPay subscription payment could not be completed because your wallet balance is insufficient. Please deposit funds to continue using your account services.',
      jsonb_build_object('idempotency_key',idem,'amount',s.monthly_fee,'date',current_date,'transaction_reference',tx.id))
    on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;
    insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
    select s.user_id,s.account_type||'.subscription_payment_status',lower(trim(up.email)),
      jsonb_build_object('customer_name',coalesce(bp.company_name,up.full_name),'outcome','failed','amount',s.monthly_fee,'date',current_date,'transaction_reference',tx.id),idem
      from public.user_profiles up left join public.business_profiles bp on bp.user_id=up.id
      where up.id=s.user_id and nullif(trim(coalesce(up.email,'')),'') is not null on conflict(idempotency_key) do nothing;
    perform public.emit_subscription_event(s.user_id,s.id,tx.id,'subscription.payment.failed',
      'subscription.payment.failed:'||tx.id::text,jsonb_build_object('reason','insufficient_balance','amount',s.monthly_fee));
    insert into public.subscription_admin_logs(user_id,subscription_id,billing_transaction_id,action,details)
      values(s.user_id,s.id,tx.id,'payment_failed',jsonb_build_object('reason','insufficient_balance'));
    return jsonb_build_object('status','failed','reason','insufficient_balance','reference',tx.id);
  end if;

  usdc_take := least(greatest(usdc_balance,0),fee_minor);
  usdt_take := fee_minor-usdc_take;
  if usdc_take > 0 then
    select bw.id,bw.bridge_wallet_id into w from public.bridge_wallets bw where (bw.user_id=s.user_id or bw.business_user_id=s.user_id)
      and upper(bw.currency)='USDC' and lower(bw.chain)='base' and bw.status='active' order by bw.created_at limit 1;
    new_balance := usdc_balance-usdc_take;
    insert into public.bridge_balance_ledger(event_id,provider,entity_type,entity_id,user_id,business_user_id,currency,amount_minor,direction,balance_after_minor,metadata)
    values('subscription:'||tx.id::text||':USDC','borderpay_internal','wallet',w.bridge_wallet_id,
      case when s.account_type='individual' then s.user_id end,case when s.account_type='business' then s.user_id end,
      'USDC',usdc_take,'debit',new_balance,jsonb_build_object('billing_transaction_id',tx.id,'internal_only',true)) returning id into canon;
    update public.billing_revenue_wallets set balance_minor=balance_minor+usdc_take,updated_at=now() where asset='USDC' and network='BASE' returning whitelist_wallet_id into w;
    insert into public.ledger_entries(from_wallet_id,to_wallet_id,user_id,asset,amount,transaction_type,reference_id,canonical_ledger_id)
      values((select id from public.bridge_wallets where bridge_wallet_id=(select entity_id from public.bridge_balance_ledger where id=canon)),w.whitelist_wallet_id,s.user_id,'USDC',usdc_take/1000000.0,'subscription_fee',tx.id,canon);
  end if;
  if usdt_take > 0 then
    select bw.id,bw.bridge_wallet_id into w from public.bridge_wallets bw where (bw.user_id=s.user_id or bw.business_user_id=s.user_id)
      and upper(bw.currency)='USDT' and lower(bw.chain)='tron' and bw.status='active' order by bw.created_at limit 1;
    new_balance := usdt_balance-usdt_take;
    insert into public.bridge_balance_ledger(event_id,provider,entity_type,entity_id,user_id,business_user_id,currency,amount_minor,direction,balance_after_minor,metadata)
    values('subscription:'||tx.id::text||':USDT','borderpay_internal','wallet',w.bridge_wallet_id,
      case when s.account_type='individual' then s.user_id end,case when s.account_type='business' then s.user_id end,
      'USDT',usdt_take,'debit',new_balance,jsonb_build_object('billing_transaction_id',tx.id,'internal_only',true)) returning id into canon;
    update public.billing_revenue_wallets set balance_minor=balance_minor+usdt_take,updated_at=now() where asset='USDT' and network='TRON' returning whitelist_wallet_id into w;
    insert into public.ledger_entries(from_wallet_id,to_wallet_id,user_id,asset,amount,transaction_type,reference_id,canonical_ledger_id)
      values((select id from public.bridge_wallets where bridge_wallet_id=(select entity_id from public.bridge_balance_ledger where id=canon)),w.whitelist_wallet_id,s.user_id,'USDT',usdt_take/1000000.0,'subscription_fee',tx.id,canon);
  end if;
  result_asset := case when usdc_take>0 and usdt_take>0 then 'MIXED' when usdc_take>0 then 'USDC' else 'USDT' end;
  update public.billing_transactions set status='completed',asset=result_asset,collected_amount=s.monthly_fee,completed_at=now(),
    asset_breakdown=jsonb_build_object('USDC',usdc_take/1000000.0,'USDT',usdt_take/1000000.0),failure_code=null where id=tx.id;
  update public.subscriptions set payment_status='active',next_billing_date=public.subscription_next_month_end(next_billing_date),
    last_billed_at=now(),failure_count=0,grace_started_at=null,reminder_sent_at=null,restricted_at=null,updated_at=now() where id=s.id;
  idem := 'subscription:payment_completed:'||tx.id::text;
  insert into public.notifications(user_id,type,title,body,metadata)
    values(s.user_id,'system','Subscription Payment Successful',
      'Your BorderPay account maintenance fee of $'||to_char(s.monthly_fee,'FM999999990.00')||' has been successfully deducted.',
      jsonb_build_object('idempotency_key',idem,'amount',s.monthly_fee,'asset',result_asset,'asset_breakdown',jsonb_build_object('USDC',usdc_take/1000000.0,'USDT',usdt_take/1000000.0),'date',current_date,'transaction_reference',tx.id))
    on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;
  insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
  select s.user_id,s.account_type||'.subscription_payment_status',lower(trim(up.email)),
    jsonb_build_object('customer_name',coalesce(bp.company_name,up.full_name),'outcome','completed','amount',s.monthly_fee,'asset',result_asset,'asset_breakdown',jsonb_build_object('USDC',usdc_take/1000000.0,'USDT',usdt_take/1000000.0),'date',current_date,'transaction_reference',tx.id),idem
    from public.user_profiles up left join public.business_profiles bp on bp.user_id=up.id
    where up.id=s.user_id and nullif(trim(coalesce(up.email,'')),'') is not null on conflict(idempotency_key) do nothing;
  perform public.emit_subscription_event(s.user_id,s.id,tx.id,'subscription.payment.completed',
    'subscription.payment.completed:'||tx.id::text,jsonb_build_object('amount',s.monthly_fee,'asset',result_asset,'asset_breakdown',jsonb_build_object('USDC',usdc_take/1000000.0,'USDT',usdt_take/1000000.0)));
  insert into public.subscription_admin_logs(user_id,subscription_id,billing_transaction_id,action,details)
    values(s.user_id,s.id,tx.id,'payment_completed',jsonb_build_object('asset',result_asset,'USDC',usdc_take/1000000.0,'USDT',usdt_take/1000000.0));
  return jsonb_build_object('status','completed','reference',tx.id,'asset',result_asset);
end $$;

-- Replace the legacy maintenance schedulers. Historical records remain
-- readable for audit, but no legacy job can charge after this migration.
do $retire_legacy_jobs$
declare j record;
begin
  for j in select jobid from cron.job
    where command ilike '%run_monthly_billing_cycle%'
       or command ilike '%enforce_maintenance_grace%'
       or command ilike '%maintenance-collect%'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
  insert into public.subscription_admin_logs(action,details)
  values('legacy_maintenance_billing_retired',jsonb_build_object('retired_at',now()));
end $retire_legacy_jobs$;

-- Keep historical functions for auditability, but make every legacy charge
-- path non-executable. The new service-role RPCs below are the only writers.
revoke all on function public.run_monthly_billing_cycle(date,text) from public,anon,authenticated,service_role;
revoke all on function public.enforce_maintenance_grace(integer) from public,anon,authenticated,service_role;
revoke all on function public.charge_va_maintenance(uuid) from public,anon,authenticated,service_role;
revoke all on function public.charge_wallet_maintenance(uuid,text) from public,anon,authenticated,service_role;

select cron.schedule(
  'subscription-billing-daily', '10 0 * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.app_config_get('worker_auth_token')),
    body := '{"mode":"bill_due"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);
select cron.schedule(
  'subscription-grace-daily', '25 0 * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.app_config_get('worker_auth_token')),
    body := '{"mode":"grace"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);
select cron.schedule(
  'subscription-delivery-drain', '*/5 * * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.app_config_get('worker_auth_token')),
    body := '{"mode":"emails"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);
select cron.schedule(
  'subscription-webhook-drain', '*/5 * * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.app_config_get('worker_auth_token')),
    body := '{"mode":"events"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);

create or replace function public.apply_subscription_grace_controls()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; reminded int:=0; restricted int:=0; idem text;
begin
  for r in select s.*,up.email,up.full_name,bp.company_name from public.subscriptions s
    join public.user_profiles up on up.id=s.user_id left join public.business_profiles bp on bp.user_id=s.user_id
    where s.status='active' and s.payment_status='failed' and s.grace_started_at is not null
  loop
    if r.reminder_sent_at is null and r.grace_started_at <= now()-interval '3 days' then
      idem:='subscription:day3_reminder:'||r.id::text||':'||r.next_billing_date::text;
      insert into public.notifications(user_id,type,title,body,metadata) values(r.user_id,'system','Subscription Payment Reminder',
        'Your account maintenance payment is still pending. Deposit USDC or USDT to keep all account features available.',jsonb_build_object('idempotency_key',idem))
        on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;
      insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
        values(r.user_id,r.account_type||'.subscription_payment_status',lower(trim(r.email)),jsonb_build_object('customer_name',coalesce(r.company_name,r.full_name),'outcome','reminder','amount',r.monthly_fee),idem)
        on conflict(idempotency_key) do nothing;
      update public.subscriptions set reminder_sent_at=now(),updated_at=now() where id=r.id;
      reminded:=reminded+1;
    end if;
    if r.restricted_at is null and r.grace_started_at <= now()-interval '7 days' then
      update public.subscriptions set restricted_at=now(),updated_at=now() where id=r.id;
      insert into public.subscription_admin_logs(user_id,subscription_id,action,details) values(r.user_id,r.id,'premium_features_restricted',jsonb_build_object('grace_days',7));
      restricted:=restricted+1;
    end if;
  end loop;
  return jsonb_build_object('reminded',reminded,'restricted',restricted);
end $$;

create or replace function public.subscription_feature_restricted(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.subscriptions where user_id=p_user_id and status='active' and restricted_at is not null)
$$;

create or replace function public.cancel_internal_subscription(p_subscription_id uuid)
returns public.subscriptions language plpgsql security definer set search_path=public as $$
declare s public.subscriptions;
begin
  update public.subscriptions set status='cancelled',updated_at=now() where id=p_subscription_id returning * into s;
  if not found then raise exception 'Subscription not found'; end if;
  perform public.emit_subscription_event(s.user_id,s.id,null,'subscription.cancelled','subscription.cancelled:'||s.id::text,'{}');
  insert into public.subscription_admin_logs(user_id,subscription_id,action) values(s.user_id,s.id,'subscription_cancelled');
  return s;
end $$;

-- Existing verified accounts: activate now, bill for the first time at month-end,
-- and leave their legacy KYC/KYB emails untouched. The announcement is queued
-- separately by the worker after deployment verification.
do $backfill$
declare r record;
begin
  for r in
    select up.id from public.user_profiles up
    left join public.business_profiles bp on bp.user_id=up.id
    where lower(coalesce(up.kyc_status::text,''))='verified'
      and (up.account_type::text='individual' or lower(coalesce(bp.bridge_kyb_status,'')) in ('approved','verified'))
  loop
    begin perform public.ensure_internal_subscription(r.id,'2026-08-31'::date,false);
    exception when others then
      insert into public.subscription_admin_logs(user_id,action,details) values(r.id,'subscription_backfill_failed',jsonb_build_object('error',sqlerrm));
    end;
  end loop;
end $backfill$;

revoke all on function public.charge_internal_subscription(uuid,date) from public,anon,authenticated;
revoke all on function public.ensure_internal_subscription(uuid,date,boolean) from public,anon,authenticated;
revoke all on function public.apply_subscription_grace_controls() from public,anon,authenticated;
revoke all on function public.cancel_internal_subscription(uuid) from public,anon,authenticated;
grant execute on function public.charge_internal_subscription(uuid,date) to service_role;
grant execute on function public.ensure_internal_subscription(uuid,date,boolean) to service_role;
grant execute on function public.apply_subscription_grace_controls() to service_role;
grant execute on function public.cancel_internal_subscription(uuid) to service_role;
grant execute on function public.subscription_feature_restricted(uuid) to authenticated,service_role;

commit;
