-- Maintenance collection is region-bound:
--   * confirmed non-EEA accounts may use the Bridge-backed collection path;
--   * EEA accounts receive an external Flutterwave invoice;
--   * unresolved geography never falls through to a wallet debit.
begin;

create table if not exists public.subscription_external_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  billing_period date not null,
  provider text not null check (provider = 'flutterwave'),
  scope_country text not null check (scope_country ~ '^[A-Z]{2}$'),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'pending_configuration' check (status in (
    'pending_configuration','payment_link_created','paid','failed','expired','cancelled'
  )),
  provider_reference text unique,
  provider_transaction_id text unique,
  payment_link text,
  attempt_count integer not null default 0,
  last_error text,
  expires_at timestamptz,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id, billing_period)
);

create index if not exists subscription_external_invoices_pending_idx
  on public.subscription_external_invoices(status, created_at)
  where status in ('pending_configuration','payment_link_created');
create index if not exists subscription_external_invoices_user_idx
  on public.subscription_external_invoices(user_id, created_at desc);

alter table public.subscription_external_invoices enable row level security;
drop policy if exists subscription_external_invoices_owner_read on public.subscription_external_invoices;
create policy subscription_external_invoices_owner_read
  on public.subscription_external_invoices for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists subscription_external_invoices_admin_read on public.subscription_external_invoices;
create policy subscription_external_invoices_admin_read
  on public.subscription_external_invoices for select to authenticated
  using ((select public.is_borderpay_admin()));
drop policy if exists subscription_external_invoices_service on public.subscription_external_invoices;
create policy subscription_external_invoices_service
  on public.subscription_external_invoices for all to service_role
  using (true) with check (true);

create or replace function public.queue_external_subscription_invoice(
  p_subscription_id uuid,
  p_billing_date date default current_date,
  p_scope_country text default null,
  p_provider text default 'flutterwave'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $queue_external_subscription_invoice$
declare
  s public.subscriptions;
  invoice public.subscription_external_invoices;
  country text := upper(trim(coalesce(p_scope_country, '')));
begin
  if p_provider <> 'flutterwave' then
    raise exception 'Unsupported external subscription provider';
  end if;
  if country !~ '^[A-Z]{2}$' then
    raise exception 'Authoritative ISO-2 scope country is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_subscription_id::text, 0));
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Subscription not found'; end if;
  if s.status <> 'active' then
    return jsonb_build_object('status','skipped','reason','inactive');
  end if;
  if s.next_billing_date > p_billing_date then
    return jsonb_build_object('status','skipped','reason','not_due');
  end if;

  insert into public.subscription_external_invoices(
    subscription_id,user_id,billing_period,provider,scope_country,amount,currency,
    metadata
  ) values (
    s.id,s.user_id,s.next_billing_date,p_provider,country,s.monthly_fee,'USD',
    jsonb_build_object(
      'collection_route','external_invoice',
      'payment_is_confirmed_only_by_verified_provider_webhook',true
    )
  )
  on conflict(subscription_id,billing_period) do update set
    attempt_count = public.subscription_external_invoices.attempt_count + 1,
    updated_at = now()
  returning * into invoice;

  insert into public.subscription_admin_logs(
    user_id,subscription_id,billing_transaction_id,action,details
  )
  select s.user_id,s.id,null,'external_invoice_queued',
    jsonb_build_object(
      'invoice_id',invoice.id,
      'provider',invoice.provider,
      'scope_country',invoice.scope_country,
      'billing_period',invoice.billing_period,
      'amount',invoice.amount,
      'status',invoice.status
    )
  where invoice.attempt_count = 0;

  return jsonb_build_object(
    'status','queued',
    'route','flutterwave_invoice',
    'invoice_id',invoice.id,
    'invoice_status',invoice.status,
    'billing_period',invoice.billing_period,
    'amount',invoice.amount,
    'currency',invoice.currency,
    'idempotent',invoice.attempt_count > 0
  );
end;
$queue_external_subscription_invoice$;

revoke all on function public.queue_external_subscription_invoice(uuid,date,text,text)
  from public, anon, authenticated;
grant execute on function public.queue_external_subscription_invoice(uuid,date,text,text)
  to service_role;

create or replace function public.mark_external_subscription_invoice_link(
  p_invoice_id uuid,
  p_provider_reference text,
  p_payment_link text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $mark_external_subscription_invoice_link$
declare
  invoice public.subscription_external_invoices;
  s public.subscriptions;
  idem text;
begin
  select * into invoice from public.subscription_external_invoices
   where id = p_invoice_id for update;
  if not found then raise exception 'External invoice not found'; end if;
  if invoice.status = 'paid' then
    return jsonb_build_object('status','paid','idempotent',true);
  end if;
  if nullif(trim(coalesce(p_provider_reference,'')),'') is null
     or nullif(trim(coalesce(p_payment_link,'')),'') is null then
    raise exception 'Provider reference and payment link are required';
  end if;

  update public.subscription_external_invoices set
    status = 'payment_link_created',
    provider_reference = p_provider_reference,
    payment_link = p_payment_link,
    expires_at = p_expires_at,
    attempt_count = attempt_count + 1,
    last_error = null,
    updated_at = now()
  where id = invoice.id
  returning * into invoice;

  select * into s from public.subscriptions where id = invoice.subscription_id for update;
  update public.subscriptions set
    payment_status = 'pending',
    grace_started_at = coalesce(grace_started_at, now()),
    updated_at = now()
  where id = s.id;

  idem := 'subscription:external_invoice:' || invoice.id::text;
  insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
  select invoice.user_id,s.account_type || '.subscription_external_invoice',lower(trim(up.email)),
    jsonb_build_object(
      'customer_name',coalesce(bp.company_name,up.full_name),
      'amount',invoice.amount,
      'currency',invoice.currency,
      'billing_period',invoice.billing_period,
      'payment_link',invoice.payment_link,
      'transaction_reference',invoice.provider_reference
    ),idem
  from public.user_profiles up
  left join public.business_profiles bp on bp.user_id = up.id
  where up.id = invoice.user_id
    and nullif(trim(coalesce(up.email,'')),'') is not null
  on conflict(idempotency_key) do nothing;

  return jsonb_build_object(
    'status','payment_link_created',
    'invoice_id',invoice.id,
    'provider_reference',invoice.provider_reference
  );
end;
$mark_external_subscription_invoice_link$;

revoke all on function public.mark_external_subscription_invoice_link(uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_external_subscription_invoice_link(uuid,text,text,timestamptz)
  to service_role;

create or replace function public.complete_external_subscription_invoice(
  p_provider_reference text,
  p_provider_transaction_id text,
  p_amount numeric,
  p_currency text,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $complete_external_subscription_invoice$
declare
  invoice public.subscription_external_invoices;
  s public.subscriptions;
  tx public.billing_transactions;
  idem text;
begin
  select * into invoice from public.subscription_external_invoices
   where provider_reference = p_provider_reference for update;
  if not found then raise exception 'External invoice not found'; end if;
  if invoice.status = 'paid' then
    return jsonb_build_object('status','paid','idempotent',true,'invoice_id',invoice.id);
  end if;
  if upper(trim(coalesce(p_currency,''))) <> invoice.currency
     or round(coalesce(p_amount,0),2) <> invoice.amount then
    raise exception 'Verified provider payment does not match invoice';
  end if;
  if nullif(trim(coalesce(p_provider_transaction_id,'')),'') is null
     or nullif(trim(coalesce(p_event_id,'')),'') is null then
    raise exception 'Verified provider transaction and event identifiers are required';
  end if;

  select * into s from public.subscriptions where id = invoice.subscription_id for update;
  insert into public.billing_transactions(
    subscription_id,user_id,billing_period,amount,collected_amount,status,
    asset_breakdown,completed_at
  ) values (
    s.id,s.user_id,invoice.billing_period,invoice.amount,invoice.amount,'completed',
    jsonb_build_object(
      'provider','flutterwave',
      'currency',invoice.currency,
      'provider_reference',invoice.provider_reference,
      'provider_transaction_id',p_provider_transaction_id,
      'provider_event_id',p_event_id
    ),now()
  )
  on conflict(subscription_id,billing_period) do update set
    collected_amount = excluded.collected_amount,
    status = 'completed',
    failure_code = null,
    asset_breakdown = excluded.asset_breakdown,
    completed_at = coalesce(public.billing_transactions.completed_at, now())
  returning * into tx;

  update public.subscription_external_invoices set
    status = 'paid',
    provider_transaction_id = p_provider_transaction_id,
    paid_at = now(),
    last_error = null,
    metadata = metadata || jsonb_build_object('verified_provider_event_id',p_event_id),
    updated_at = now()
  where id = invoice.id;

  update public.subscriptions set
    payment_status = 'active',
    next_billing_date = public.subscription_next_month_end(invoice.billing_period),
    last_billed_at = now(),
    failure_count = 0,
    grace_started_at = null,
    reminder_sent_at = null,
    restricted_at = null,
    updated_at = now()
  where id = s.id and next_billing_date <= invoice.billing_period;

  idem := 'subscription:payment_completed:' || tx.id::text;
  insert into public.notifications(user_id,type,title,body,metadata)
  values(
    s.user_id,'system','Subscription Payment Successful',
    'Your BorderPay account maintenance fee of $' || to_char(invoice.amount,'FM999999990.00') || ' has been successfully paid.',
    jsonb_build_object(
      'idempotency_key',idem,
      'amount',invoice.amount,
      'asset','USD',
      'provider','flutterwave',
      'date',current_date,
      'transaction_reference',tx.id
    )
  )
  on conflict(user_id,((metadata->>'idempotency_key')))
    where metadata ? 'idempotency_key' do nothing;

  insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
  select s.user_id,s.account_type || '.subscription_payment_status',lower(trim(up.email)),
    jsonb_build_object(
      'customer_name',coalesce(bp.company_name,up.full_name),
      'outcome','completed',
      'amount',invoice.amount,
      'asset','USD via Flutterwave',
      'date',current_date,
      'transaction_reference',tx.id
    ),idem
  from public.user_profiles up
  left join public.business_profiles bp on bp.user_id = up.id
  where up.id = s.user_id
    and nullif(trim(coalesce(up.email,'')),'') is not null
  on conflict(idempotency_key) do nothing;

  perform public.emit_subscription_event(
    s.user_id,s.id,tx.id,'subscription.payment.completed',
    'subscription.payment.completed:' || tx.id::text,
    jsonb_build_object(
      'amount',invoice.amount,
      'asset','USD',
      'provider','flutterwave',
      'provider_transaction_id',p_provider_transaction_id
    )
  );
  insert into public.subscription_admin_logs(
    user_id,subscription_id,billing_transaction_id,action,details
  ) values (
    s.user_id,s.id,tx.id,'external_invoice_paid',
    jsonb_build_object(
      'invoice_id',invoice.id,
      'provider','flutterwave',
      'provider_transaction_id',p_provider_transaction_id,
      'provider_event_id',p_event_id
    )
  );

  return jsonb_build_object('status','paid','invoice_id',invoice.id,'billing_transaction_id',tx.id);
end;
$complete_external_subscription_invoice$;

revoke all on function public.complete_external_subscription_invoice(text,text,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.complete_external_subscription_invoice(text,text,numeric,text,text)
  to service_role;

comment on table public.subscription_external_invoices is
  'EEA maintenance invoices. Creation is not payment; only a verified provider callback may mark paid.';
comment on function public.queue_external_subscription_invoice(uuid,date,text,text) is
  'Queues an EEA maintenance invoice idempotently without debiting a Bridge wallet or advancing billing.';

commit;
