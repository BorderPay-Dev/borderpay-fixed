begin;

-- A maintenance restriction is a three-stage lifecycle:
--   1. Flutterwave invoice, 2. day-3 reminder, 3. day-7 final warning.
-- The restriction is applied only after the final warning email is recorded as
-- sent. Provider failures therefore cannot silently lock a customer account.
create or replace function public.apply_subscription_grace_controls()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $apply_subscription_grace_controls$
declare
  r record;
  reminded integer := 0;
  final_warnings integer := 0;
  idem text;
begin
  for r in
    select
      s.*,
      up.email,
      up.full_name,
      bp.company_name,
      invoice.id as invoice_id,
      invoice.billing_period,
      invoice.amount as invoice_amount,
      invoice.currency as invoice_currency,
      invoice.payment_link,
      invoice.provider_reference
    from public.subscriptions s
    join public.user_profiles up on up.id=s.user_id
    left join public.business_profiles bp on bp.user_id=s.user_id
    join lateral (
      select sei.*
      from public.subscription_external_invoices sei
      where sei.subscription_id=s.id
        and sei.provider='flutterwave'
        and sei.status='payment_link_created'
        and nullif(trim(coalesce(sei.payment_link,'')),'') is not null
      order by sei.billing_period desc,sei.created_at desc
      limit 1
    ) invoice on true
    where s.status='active'
      and s.payment_status in ('failed','pending')
      and s.grace_started_at is not null
      and s.restricted_at is null
  loop
    if r.reminder_sent_at is null and r.grace_started_at <= now()-interval '3 days' then
      idem := 'subscription:day3_reminder:'||r.invoice_id::text;
      insert into public.notifications(user_id,type,title,body,metadata)
      values(
        r.user_id,
        'system',
        'Account maintenance payment due',
        'Your account maintenance payment is still pending. Pay the invoice to keep receiving accounts and wallets available.',
        jsonb_build_object('idempotency_key',idem,'amount',r.invoice_amount,'invoice_id',r.invoice_id)
      )
      on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;

      insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
      values(
        r.user_id,
        r.account_type||'.subscription_external_invoice',
        lower(trim(r.email)),
        jsonb_build_object(
          'customer_name',coalesce(r.company_name,r.full_name),
          'notice','reminder',
          'amount',r.invoice_amount,
          'currency',r.invoice_currency,
          'billing_period',r.billing_period,
          'payment_link',r.payment_link,
          'transaction_reference',r.provider_reference
        ),
        idem
      )
      on conflict(idempotency_key) do nothing;

      update public.subscriptions
      set reminder_sent_at=now(),updated_at=now()
      where id=r.id and reminder_sent_at is null;
      reminded := reminded+1;
    end if;

    if r.grace_started_at <= now()-interval '7 days' then
      idem := 'subscription:day7_final_warning:'||r.invoice_id::text;
      insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
      values(
        r.user_id,
        r.account_type||'.subscription_external_invoice',
        lower(trim(r.email)),
        jsonb_build_object(
          'customer_name',coalesce(r.company_name,r.full_name),
          'notice','final_warning',
          'amount',r.invoice_amount,
          'currency',r.invoice_currency,
          'billing_period',r.billing_period,
          'payment_link',r.payment_link,
          'transaction_reference',r.provider_reference
        ),
        idem
      )
      on conflict(idempotency_key) do nothing;
      final_warnings := final_warnings+1;
    end if;
  end loop;

  return jsonb_build_object(
    'reminded',reminded,
    'final_warnings_queued',final_warnings,
    'restricted',0
  );
end;
$apply_subscription_grace_controls$;

revoke all on function public.apply_subscription_grace_controls() from public,anon,authenticated;
grant execute on function public.apply_subscription_grace_controls() to service_role;

create or replace function public.finalize_subscription_restrictions()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $finalize_subscription_restrictions$
declare
  r record;
  restricted integer := 0;
  idem text;
begin
  for r in
    select s.id,s.user_id,s.monthly_fee,sei.id as invoice_id,sei.billing_period,j.sent_at
    from public.subscriptions s
    join public.subscription_external_invoices sei
      on sei.subscription_id=s.id
     and sei.provider='flutterwave'
     and sei.status='payment_link_created'
    join public.subscription_email_jobs j
      on j.user_id=s.user_id
     and j.idempotency_key='subscription:day7_final_warning:'||sei.id::text
     and j.status='sent'
     and j.sent_at is not null
    where s.status='active'
      and s.payment_status in ('failed','pending')
      and s.grace_started_at <= now()-interval '7 days'
      and s.restricted_at is null
    order by s.grace_started_at
    for update of s skip locked
  loop
    update public.subscriptions
    set restricted_at=now(),updated_at=now()
    where id=r.id
      and restricted_at is null
      and payment_status in ('failed','pending');
    if not found then continue; end if;

    idem := 'subscription:restricted:'||r.invoice_id::text;
    insert into public.notifications(user_id,type,title,body,metadata)
    values(
      r.user_id,
      'system',
      'Account access restricted',
      'Receiving accounts, wallets, and sensitive financial screens are unavailable until the overdue maintenance invoice is paid.',
      jsonb_build_object('idempotency_key',idem,'amount',r.monthly_fee,'invoice_id',r.invoice_id)
    )
    on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;

    if not exists (
      select 1 from public.subscription_admin_logs
      where subscription_id=r.id
        and action='account_access_restricted'
        and details->>'invoice_id'=r.invoice_id::text
    ) then
      insert into public.subscription_admin_logs(user_id,subscription_id,action,details)
      values(
        r.user_id,
        r.id,
        'account_access_restricted',
        jsonb_build_object(
          'grace_days',7,
          'billing_period',r.billing_period,
          'invoice_id',r.invoice_id,
          'final_warning_sent_at',r.sent_at
        )
      );
    end if;
    restricted := restricted+1;
  end loop;

  return jsonb_build_object('restricted',restricted);
end;
$finalize_subscription_restrictions$;

revoke all on function public.finalize_subscription_restrictions() from public,anon,authenticated;
grant execute on function public.finalize_subscription_restrictions() to service_role;

commit;
