-- Provider-backed maintenance collection for confirmed non-EEA accounts.
-- A subscription is paid only after signed Bridge transfer evidence reaches
-- the canonical webhook processor.
begin;

create table if not exists public.subscription_bridge_collections (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  billing_period date not null,
  amount numeric(12,2) not null check (amount > 0),
  collected_amount numeric(12,2) not null default 0 check (collected_amount >= 0),
  status text not null default 'prepared' check (status in ('prepared','submitted','completed','failed')),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(subscription_id,billing_period)
);

create table if not exists public.subscription_bridge_collection_legs (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.subscription_bridge_collections(id) on delete restrict,
  source_bridge_wallet_id text not null,
  bridge_customer_id text not null,
  destination_address text not null,
  asset text not null check (asset in ('USDC','USDT')),
  network text not null check (network in ('BASE','TRON')),
  amount_minor bigint not null check (amount_minor > 0),
  provider_transfer_id text unique,
  status text not null default 'prepared' check (status in ('prepared','submitted','completed','failed')),
  provider_state text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(collection_id,asset)
);

create index if not exists subscription_bridge_collections_status_idx
  on public.subscription_bridge_collections(status,created_at);
create index if not exists subscription_bridge_collection_legs_status_idx
  on public.subscription_bridge_collection_legs(status,created_at);

alter table public.subscription_bridge_collections enable row level security;
alter table public.subscription_bridge_collection_legs enable row level security;
drop policy if exists subscription_bridge_collections_owner_read on public.subscription_bridge_collections;
create policy subscription_bridge_collections_owner_read
  on public.subscription_bridge_collections for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists subscription_bridge_collections_admin_read on public.subscription_bridge_collections;
create policy subscription_bridge_collections_admin_read
  on public.subscription_bridge_collections for select to authenticated
  using ((select public.is_borderpay_admin()));
drop policy if exists subscription_bridge_collections_service on public.subscription_bridge_collections;
create policy subscription_bridge_collections_service
  on public.subscription_bridge_collections for all to service_role using (true) with check (true);
drop policy if exists subscription_bridge_collection_legs_owner_read on public.subscription_bridge_collection_legs;
create policy subscription_bridge_collection_legs_owner_read
  on public.subscription_bridge_collection_legs for select to authenticated
  using (exists (
    select 1 from public.subscription_bridge_collections c
    where c.id = collection_id and c.user_id = (select auth.uid())
  ));
drop policy if exists subscription_bridge_collection_legs_admin_read on public.subscription_bridge_collection_legs;
create policy subscription_bridge_collection_legs_admin_read
  on public.subscription_bridge_collection_legs for select to authenticated
  using ((select public.is_borderpay_admin()));
drop policy if exists subscription_bridge_collection_legs_service on public.subscription_bridge_collection_legs;
create policy subscription_bridge_collection_legs_service
  on public.subscription_bridge_collection_legs for all to service_role using (true) with check (true);

create or replace function public.prepare_bridge_subscription_collection(
  p_subscription_id uuid,
  p_billing_date date,
  p_provider_balances jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $prepare_bridge_subscription_collection$
declare
  s public.subscriptions;
  collection public.subscription_bridge_collections;
  usdc record;
  usdt record;
  usdc_destination text;
  usdt_destination text;
  fee_minor bigint;
  usdc_take bigint := 0;
  usdt_take bigint := 0;
  legs jsonb;
begin
  if jsonb_typeof(p_provider_balances) <> 'array' then
    raise exception 'Authoritative Bridge wallet balances are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_subscription_id::text, 0));
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Subscription not found'; end if;
  if s.status <> 'active' then return jsonb_build_object('status','skipped','reason','inactive'); end if;
  if s.next_billing_date > p_billing_date then return jsonb_build_object('status','skipped','reason','not_due'); end if;

  select * into collection from public.subscription_bridge_collections
   where subscription_id = s.id and billing_period = s.next_billing_date;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',l.id,'source_bridge_wallet_id',l.source_bridge_wallet_id,
      'bridge_customer_id',l.bridge_customer_id,'destination_address',l.destination_address,
      'asset',l.asset,'network',l.network,'amount_minor',l.amount_minor,
      'provider_transfer_id',l.provider_transfer_id,'status',l.status
    ) order by l.asset),'[]'::jsonb) into legs
    from public.subscription_bridge_collection_legs l where l.collection_id = collection.id;
    return jsonb_build_object('status',collection.status,'collection_id',collection.id,'legs',legs,'idempotent',true);
  end if;

  fee_minor := round(s.monthly_fee * 1000000)::bigint;
  select bw.bridge_wallet_id,bw.bridge_customer_id,
    greatest((provider_balance.value->>'available_minor')::bigint,0)
      - coalesce((select sum(r.amount_minor) from public.subscription_bridge_collection_legs r
        where r.source_bridge_wallet_id=bw.bridge_wallet_id and r.status in ('prepared','submitted')),0) as available_minor
  into usdc
  from public.bridge_wallets bw
  cross join lateral jsonb_array_elements(p_provider_balances) provider_balance(value)
  where (bw.user_id=s.user_id or bw.business_user_id=s.user_id)
    and bw.status='active' and upper(bw.currency)='USDC' and lower(bw.chain)='base'
    and provider_balance.value->>'bridge_wallet_id'=bw.bridge_wallet_id
  order by available_minor desc limit 1;

  select bw.bridge_wallet_id,bw.bridge_customer_id,
    greatest((provider_balance.value->>'available_minor')::bigint,0)
      - coalesce((select sum(r.amount_minor) from public.subscription_bridge_collection_legs r
        where r.source_bridge_wallet_id=bw.bridge_wallet_id and r.status in ('prepared','submitted')),0) as available_minor
  into usdt
  from public.bridge_wallets bw
  cross join lateral jsonb_array_elements(p_provider_balances) provider_balance(value)
  where (bw.user_id=s.user_id or bw.business_user_id=s.user_id)
    and bw.status='active' and upper(bw.currency)='USDT' and lower(bw.chain)='tron'
    and provider_balance.value->>'bridge_wallet_id'=bw.bridge_wallet_id
  order by available_minor desc limit 1;

  if greatest(coalesce(usdc.available_minor,0),0) + greatest(coalesce(usdt.available_minor,0),0) < fee_minor then
    return jsonb_build_object(
      'status','failed','reason','insufficient_balance',
      'USDC_available',greatest(coalesce(usdc.available_minor,0),0)/1000000.0,
      'USDT_available',greatest(coalesce(usdt.available_minor,0),0)/1000000.0
    );
  end if;

  select mw.address into usdc_destination
  from public.billing_revenue_wallets rw
  join public.maintenance_wallet_whitelist mw on mw.id=rw.whitelist_wallet_id
  where rw.status='active' and mw.active and rw.asset='USDC' and rw.network='BASE';
  select mw.address into usdt_destination
  from public.billing_revenue_wallets rw
  join public.maintenance_wallet_whitelist mw on mw.id=rw.whitelist_wallet_id
  where rw.status='active' and mw.active and rw.asset='USDT' and rw.network='TRON';
  if usdc_destination is null or usdt_destination is null then
    raise exception 'Corporate maintenance treasury whitelist is incomplete';
  end if;

  usdc_take := least(greatest(coalesce(usdc.available_minor,0),0),fee_minor);
  usdt_take := fee_minor-usdc_take;
  insert into public.subscription_bridge_collections(subscription_id,user_id,billing_period,amount)
  values(s.id,s.user_id,s.next_billing_date,s.monthly_fee) returning * into collection;

  if usdc_take > 0 then
    insert into public.subscription_bridge_collection_legs(
      collection_id,source_bridge_wallet_id,bridge_customer_id,destination_address,asset,network,amount_minor
    ) values(collection.id,usdc.bridge_wallet_id,usdc.bridge_customer_id,usdc_destination,'USDC','BASE',usdc_take);
  end if;
  if usdt_take > 0 then
    insert into public.subscription_bridge_collection_legs(
      collection_id,source_bridge_wallet_id,bridge_customer_id,destination_address,asset,network,amount_minor
    ) values(collection.id,usdt.bridge_wallet_id,usdt.bridge_customer_id,usdt_destination,'USDT','TRON',usdt_take);
  end if;

  select jsonb_agg(jsonb_build_object(
    'id',l.id,'source_bridge_wallet_id',l.source_bridge_wallet_id,
    'bridge_customer_id',l.bridge_customer_id,'destination_address',l.destination_address,
    'asset',l.asset,'network',l.network,'amount_minor',l.amount_minor,
    'provider_transfer_id',l.provider_transfer_id,'status',l.status
  ) order by l.asset) into legs
  from public.subscription_bridge_collection_legs l where l.collection_id=collection.id;
  return jsonb_build_object('status','prepared','collection_id',collection.id,'legs',legs,'idempotent',false);
end;
$prepare_bridge_subscription_collection$;

revoke all on function public.prepare_bridge_subscription_collection(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_bridge_subscription_collection(uuid,date,jsonb) to service_role;

create or replace function public.record_bridge_subscription_collection_submission(
  p_leg_id uuid,
  p_provider_transfer_id text default null,
  p_provider_state text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $record_bridge_subscription_collection_submission$
declare
  leg public.subscription_bridge_collection_legs;
begin
  select * into leg from public.subscription_bridge_collection_legs where id=p_leg_id for update;
  if not found then raise exception 'Bridge subscription collection leg not found'; end if;

  if nullif(trim(coalesce(p_provider_transfer_id,'')),'') is not null then
    update public.subscription_bridge_collection_legs set
      provider_transfer_id=coalesce(provider_transfer_id,p_provider_transfer_id),
      status=case when status='prepared' then 'submitted' else status end,
      provider_state=lower(nullif(trim(coalesce(p_provider_state,'')),'')),
      last_error=null,
      updated_at=now()
    where id=leg.id
      and (provider_transfer_id is null or provider_transfer_id=p_provider_transfer_id);
    if not found then raise exception 'Provider transfer id conflicts with prepared collection leg'; end if;
    update public.subscription_bridge_collections set status='submitted',updated_at=now()
      where id=leg.collection_id and status='prepared';
  elsif nullif(trim(coalesce(p_error,'')),'') is not null then
    update public.subscription_bridge_collection_legs set
      last_error=left(p_error,500),updated_at=now()
    where id=leg.id and provider_transfer_id is null;
  else
    raise exception 'Provider transfer id or error is required';
  end if;

  return jsonb_build_object(
    'leg_id',leg.id,
    'collection_id',leg.collection_id,
    'submitted',nullif(trim(coalesce(p_provider_transfer_id,'')),'') is not null
  );
end;
$record_bridge_subscription_collection_submission$;

revoke all on function public.record_bridge_subscription_collection_submission(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_bridge_subscription_collection_submission(uuid,text,text,text) to service_role;

create or replace function public.reconcile_bridge_subscription_collection_leg(
  p_provider_transfer_id text,
  p_provider_state text,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $reconcile_bridge_subscription_collection_leg$
declare
  leg public.subscription_bridge_collection_legs;
  collection public.subscription_bridge_collections;
  s public.subscriptions;
  tx public.billing_transactions;
  mapped text;
  completed_total numeric(12,2);
  idem text;
begin
  mapped := case
    when lower(p_provider_state) in ('payment_processed','completed','succeeded','success') then 'completed'
    when lower(p_provider_state) in ('failed','canceled','cancelled','returned','refunded') then 'failed'
    else 'submitted' end;
  select * into leg from public.subscription_bridge_collection_legs
   where provider_transfer_id=p_provider_transfer_id for update;
  if not found then return jsonb_build_object('matched',false); end if;
  select * into collection from public.subscription_bridge_collections where id=leg.collection_id for update;
  select * into s from public.subscriptions where id=collection.subscription_id for update;

  if leg.status in ('completed','failed') then
    if leg.status=mapped then
      return jsonb_build_object('matched',true,'status',leg.status,'collection_id',collection.id,'idempotent',true);
    end if;
    raise exception 'Bridge subscription collection terminal state conflict: % -> %', leg.status, mapped;
  end if;

  update public.subscription_bridge_collection_legs set
    status=mapped,provider_state=lower(p_provider_state),
    last_error=case when mapped='failed' then 'bridge_transfer_'||lower(p_provider_state) else null end,
    completed_at=case when mapped='completed' then coalesce(completed_at,now()) else completed_at end,
    updated_at=now()
  where id=leg.id;

  if exists(select 1 from public.subscription_bridge_collection_legs where collection_id=collection.id and status='failed') then
    update public.subscription_bridge_collections set status='failed',failure_code='bridge_transfer_failed',updated_at=now()
      where id=collection.id;
    update public.subscriptions set payment_status='failed',failure_count=failure_count+1,
      grace_started_at=coalesce(grace_started_at,now()),updated_at=now() where id=s.id;
    return jsonb_build_object('matched',true,'status','failed','collection_id',collection.id);
  end if;
  if exists(select 1 from public.subscription_bridge_collection_legs where collection_id=collection.id and status<>'completed') then
    update public.subscription_bridge_collections set status='submitted',updated_at=now() where id=collection.id;
    return jsonb_build_object('matched',true,'status','submitted','collection_id',collection.id);
  end if;

  select coalesce(sum(amount_minor),0)/1000000.0 into completed_total
    from public.subscription_bridge_collection_legs where collection_id=collection.id;
  if round(completed_total,2) <> collection.amount then
    raise exception 'Completed Bridge collection legs do not equal maintenance amount';
  end if;
  insert into public.billing_transactions(
    subscription_id,user_id,billing_period,amount,collected_amount,status,asset,asset_breakdown,completed_at
  ) select s.id,s.user_id,collection.billing_period,collection.amount,collection.amount,'completed',
      case when count(*)>1 then 'MIXED' else max(asset) end,
      jsonb_object_agg(asset,amount_minor/1000000.0),now()
    from public.subscription_bridge_collection_legs where collection_id=collection.id
  on conflict(subscription_id,billing_period) do update set
    collected_amount=excluded.collected_amount,status='completed',asset=excluded.asset,
    asset_breakdown=excluded.asset_breakdown,failure_code=null,
    completed_at=coalesce(public.billing_transactions.completed_at,now())
  returning * into tx;

  update public.subscription_bridge_collections set status='completed',collected_amount=amount,
    failure_code=null,completed_at=coalesce(completed_at,now()),updated_at=now() where id=collection.id;
  update public.billing_revenue_wallets rw set
    balance_minor=rw.balance_minor+x.amount_minor,updated_at=now()
  from (
    select asset,network,sum(amount_minor)::bigint amount_minor
    from public.subscription_bridge_collection_legs where collection_id=collection.id group by asset,network
  ) x where rw.asset=x.asset and rw.network=x.network;
  update public.subscriptions set payment_status='active',
    next_billing_date=public.subscription_next_month_end(collection.billing_period),last_billed_at=now(),
    failure_count=0,grace_started_at=null,reminder_sent_at=null,restricted_at=null,updated_at=now()
  where id=s.id and next_billing_date<=collection.billing_period;

  idem := 'subscription:payment_completed:'||tx.id::text;
  insert into public.notifications(user_id,type,title,body,metadata)
  values(s.user_id,'system','Subscription Payment Successful',
    'Your BorderPay account maintenance fee of $'||to_char(collection.amount,'FM999999990.00')||' has been successfully paid.',
    jsonb_build_object('idempotency_key',idem,'amount',collection.amount,'date',current_date,'transaction_reference',tx.id))
  on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;
  insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
  select s.user_id,s.account_type||'.subscription_payment_status',lower(trim(up.email)),
    jsonb_build_object('customer_name',coalesce(bp.company_name,up.full_name),'outcome','completed',
      'amount',collection.amount,'asset',tx.asset,'date',current_date,'transaction_reference',tx.id),idem
  from public.user_profiles up left join public.business_profiles bp on bp.user_id=up.id
  where up.id=s.user_id and nullif(trim(coalesce(up.email,'')),'') is not null
  on conflict(idempotency_key) do nothing;
  perform public.emit_subscription_event(s.user_id,s.id,tx.id,'subscription.payment.completed',
    'subscription.payment.completed:'||tx.id::text,
    jsonb_build_object('amount',collection.amount,'asset',tx.asset,'provider','bridge','event_id',p_event_id));
  insert into public.subscription_admin_logs(user_id,subscription_id,billing_transaction_id,action,details)
  values(s.user_id,s.id,tx.id,'bridge_treasury_collection_completed',
    jsonb_build_object('collection_id',collection.id,'provider_event_id',p_event_id));
  return jsonb_build_object('matched',true,'status','completed','collection_id',collection.id,'billing_transaction_id',tx.id);
end;
$reconcile_bridge_subscription_collection_leg$;

revoke all on function public.reconcile_bridge_subscription_collection_leg(text,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_bridge_subscription_collection_leg(text,text,text) to service_role;

commit;
