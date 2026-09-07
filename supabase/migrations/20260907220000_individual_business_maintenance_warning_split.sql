begin;

-- Individual product access is no longer recoverable after the final August
-- maintenance deadline. Business restrictions remain payment-recoverable.
-- No identity, ledger, balance, or transaction record is deleted here.
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
        and sei.paid_at is null
        and nullif(trim(coalesce(sei.payment_link,'')),'') is not null
      order by sei.billing_period desc,sei.created_at desc
      limit 1
    ) invoice on true
    where s.status='active'
      and s.payment_status in ('failed','pending')
      and s.grace_started_at is not null
      and s.restricted_at is null
      and up.account_frozen_at is null
      and lower(coalesce(up.account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
      and lower(coalesce(up.bridge_account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
  loop
    if r.reminder_sent_at is null and r.grace_started_at <= now()-interval '3 days' then
      idem := 'subscription:day3_reminder:'||r.invoice_id::text;
      insert into public.notifications(user_id,type,title,body,metadata)
      values(
        r.user_id,
        'system',
        case when r.account_type='individual'
          then 'Individual account maintenance payment required'
          else 'Business account maintenance payment due'
        end,
        case when r.account_type='individual'
          then 'Pay the August maintenance invoice by September 8, 2026. If payment is not confirmed, Individual access will be permanently closed and virtual accounts deactivated.'
          else 'Your Business maintenance invoice remains unpaid. Pay it to keep receiving accounts, wallets, and sensitive financial screens available.'
        end,
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
          'deadline','September 8, 2026',
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

    if r.grace_started_at <= now()-interval '7 days'
       or (
         r.account_type='individual'
         and r.billing_period='2026-08-31'::date
         and current_date >= '2026-09-08'::date
       )
    then
      idem := 'subscription:day7_final_warning:'||r.invoice_id::text;
      insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
      values(
        r.user_id,
        r.account_type||'.subscription_external_invoice',
        lower(trim(r.email)),
        jsonb_build_object(
          'customer_name',coalesce(r.company_name,r.full_name),
          'notice','final_warning',
          'deadline','September 8, 2026',
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

  return jsonb_build_object('reminded',reminded,'final_warnings_queued',final_warnings,'restricted',0);
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
  individual_offboarded integer := 0;
  idem text;
begin
  for r in
    select s.id,s.user_id,s.account_type,s.monthly_fee,sei.id as invoice_id,sei.billing_period,j.sent_at
    from public.subscriptions s
    join public.subscription_external_invoices sei
      on sei.subscription_id=s.id
     and sei.provider='flutterwave'
     and sei.status='payment_link_created'
     and sei.paid_at is null
    join public.subscription_email_jobs j
      on j.user_id=s.user_id
     and j.idempotency_key='subscription:day7_final_warning:'||sei.id::text
     and j.status='sent'
     and j.sent_at is not null
    where s.status='active'
      and s.payment_status in ('failed','pending')
      and (
        s.grace_started_at <= now()-interval '7 days'
        or (s.account_type='individual' and sei.billing_period='2026-08-31'::date and current_date >= '2026-09-08'::date)
      )
      and s.restricted_at is null
    order by s.grace_started_at
    for update of s skip locked
  loop
    update public.subscriptions
    set restricted_at=now(),
        metadata=case when r.account_type='individual'
          then coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'individual_product_access','permanently_closed',
            'individual_product_closed_at',now(),
            'closure_reason','august_maintenance_nonpayment'
          )
          else coalesce(metadata,'{}'::jsonb)
        end,
        updated_at=now()
    where id=r.id and restricted_at is null and payment_status in ('failed','pending');
    if not found then continue; end if;

    if r.account_type='individual' then
      update public.user_profiles
      set account_status='offboarded',
          account_frozen_at=coalesce(account_frozen_at,now()),
          account_frozen_reason='Individual product closed after unpaid August 2026 maintenance invoice',
          updated_at=now()
      where id=r.user_id and account_type='individual';
      individual_offboarded := individual_offboarded+1;
    end if;

    idem := 'subscription:restricted:'||r.invoice_id::text;
    insert into public.notifications(user_id,type,title,body,metadata)
    values(
      r.user_id,
      'system',
      case when r.account_type='individual' then 'Individual account access closed' else 'Business account access restricted' end,
      case when r.account_type='individual'
        then 'Your BorderPay Individual product access has been permanently closed and your virtual accounts are being deactivated. Contact Support for assistance with any remaining balance.'
        else 'Receiving accounts, wallets, and sensitive financial screens are temporarily unavailable until the overdue maintenance invoice is paid.'
      end,
      jsonb_build_object('idempotency_key',idem,'amount',r.monthly_fee,'invoice_id',r.invoice_id,'account_type',r.account_type)
    )
    on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;

    if not exists (
      select 1 from public.subscription_admin_logs
      where subscription_id=r.id and action='account_access_restricted' and details->>'invoice_id'=r.invoice_id::text
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
          'account_type',r.account_type,
          'restriction_kind',case when r.account_type='individual' then 'permanent_product_closure' else 'temporary_until_paid' end,
          'final_warning_sent_at',r.sent_at
        )
      );
    end if;
    restricted := restricted+1;
  end loop;

  return jsonb_build_object('restricted',restricted,'individual_offboarded',individual_offboarded);
end;
$finalize_subscription_restrictions$;

revoke all on function public.finalize_subscription_restrictions() from public,anon,authenticated;
grant execute on function public.finalize_subscription_restrictions() to service_role;

-- Permanent Individual closures must never enter the payment-reactivation
-- queue. Business restrictions preserve the existing verified-pay restore.
create or replace function public.reconcile_subscription_access_actions(
  p_dry_run boolean default true,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $reconcile_subscription_access_actions$
declare
  deactivate_count integer := 0;
  reactivate_count integer := 0;
  safe_limit integer := greatest(1,least(coalesce(p_limit,100),500));
begin
  update public.subscription_provider_access_actions
  set status='failed',last_error='stale_processing_claim_recovered',next_attempt_at=now(),updated_at=now()
  where status='processing' and last_attempt_at < now()-interval '15 minutes';

  select count(*)::integer into deactivate_count from (
    select 1 from public.subscriptions s
    join public.bridge_virtual_accounts va on va.user_id=s.user_id or va.business_user_id=s.user_id
    where s.status='active' and s.restricted_at is not null and va.status='active'
      and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
      and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
    limit safe_limit
  ) q;

  select count(*)::integer into reactivate_count from (
    select 1 from public.subscriptions s
    join public.bridge_virtual_accounts va on va.user_id=s.user_id or va.business_user_id=s.user_id
    where s.status='active' and s.account_type='business' and s.payment_status='active' and s.restricted_at is null
      and va.status='deactivated' and va.deactivation_reason='subscription_nonpayment'
      and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
      and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
    limit safe_limit
  ) q;

  if p_dry_run then
    return jsonb_build_object('dry_run',true,'would_queue_deactivate',deactivate_count,'would_queue_reactivate',reactivate_count);
  end if;

  insert into public.subscription_provider_access_actions(
    subscription_id,user_id,bridge_virtual_account_id,bridge_customer_id,action,reason,idempotency_key
  )
  select s.id,s.user_id,va.bridge_virtual_account_id,va.bridge_customer_id,'deactivate',
    case when s.account_type='individual' then 'individual_product_closed' else 'subscription_nonpayment' end,
    'subscription:deactivate:'||s.id::text||':'||extract(epoch from s.restricted_at)::bigint::text||':'||va.bridge_virtual_account_id
  from public.subscriptions s
  join public.bridge_virtual_accounts va on va.user_id=s.user_id or va.business_user_id=s.user_id
  where s.status='active' and s.restricted_at is not null and va.status='active'
    and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
    and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
  order by s.restricted_at,va.created_at limit safe_limit
  on conflict(idempotency_key) do nothing;

  insert into public.subscription_provider_access_actions(
    subscription_id,user_id,bridge_virtual_account_id,bridge_customer_id,action,reason,idempotency_key
  )
  select s.id,s.user_id,va.bridge_virtual_account_id,va.bridge_customer_id,'reactivate','subscription_payment_confirmed',
    'subscription:reactivate:'||s.id::text||':'||coalesce(extract(epoch from s.last_billed_at)::bigint::text,'never')||':'||va.bridge_virtual_account_id
  from public.subscriptions s
  join public.bridge_virtual_accounts va on va.user_id=s.user_id or va.business_user_id=s.user_id
  where s.status='active' and s.account_type='business' and s.payment_status='active' and s.restricted_at is null
    and va.status='deactivated' and va.deactivation_reason='subscription_nonpayment'
    and nullif(trim(coalesce(va.bridge_customer_id,'')),'') is not null
    and nullif(trim(coalesce(va.bridge_virtual_account_id,'')),'') is not null
  order by s.last_billed_at nulls last,va.created_at limit safe_limit
  on conflict(idempotency_key) do nothing;

  return jsonb_build_object('dry_run',false,'eligible_deactivate',deactivate_count,'eligible_reactivate',reactivate_count);
end;
$reconcile_subscription_access_actions$;

revoke all on function public.reconcile_subscription_access_actions(boolean,integer) from public,anon,authenticated;
grant execute on function public.reconcile_subscription_access_actions(boolean,integer) to service_role;

-- Queue today's deadline warning only for the supplied $5 August Individual
-- Flutterwave invoices. Every condition is rechecked at execution time.
with eligible as (
  select
    sei.id as invoice_id,
    sei.user_id,
    sei.amount,
    sei.currency,
    sei.billing_period,
    sei.payment_link,
    sei.provider_reference,
    up.full_name
  from public.subscription_external_invoices sei
  join public.subscriptions s on s.id=sei.subscription_id and s.user_id=sei.user_id
  join public.user_profiles up on up.id=sei.user_id
  where sei.user_id = any(array[
    '459d56ac-ca79-4c8d-b46f-0cb56daa6b07','0e40f044-5f2e-43ed-adcf-5d4437a8c455',
    '919d03d6-5a6a-4620-b2b2-f83c6df5a699','30a4d987-2768-4134-9b23-f73654d475fc',
    'f3a6300f-0464-467c-a332-514db22ebc37','4134a8b3-7167-4ec9-b35a-4172e723968a',
    '456679ac-40c3-43af-bd65-216b95632be6','3ed4e220-258f-4fb7-a604-6b85e0341032',
    '2f1a9515-fdee-482d-98c4-7593339d92c9','dd072c67-9710-4570-9f5b-e4bf67d62d9c',
    '5bbcb7a6-5b8a-4545-a9c8-8e7246ff1a09','f8182bc8-0622-4f6b-b50e-6db8e5e0b2d8',
    '00343a6b-9fc2-46a1-bdc6-9302f2a38807','58c7fe8c-d461-4005-8a36-3720f92c500f',
    '786c7998-3558-4b02-b308-0acae038fa8a','9685dddd-ff59-47a2-afe5-f947977564ef',
    '7585f63a-2ece-4703-ad66-2f0a5459064e','d7ba4f7f-28cf-4ca1-b740-8ed7133d3420',
    'b9c1b319-9bde-4950-bb1b-df6699ccc38a','d57f77b6-af60-43a7-b627-2daae675579e',
    'cc4c1a8a-a02a-4a1d-92ad-f360d2514a5e','16599ff7-104a-430f-abdd-ddadb67a6a46',
    '28b8edb5-d3c3-4194-8cd5-274efc0d9b8d'
  ]::uuid[])
    and sei.provider='flutterwave'
    and sei.billing_period='2026-08-31'::date
    and sei.amount=5.00
    and sei.currency='USD'
    and sei.status='payment_link_created'
    and sei.paid_at is null
    and nullif(trim(coalesce(sei.payment_link,'')),'') is not null
    and s.status='active'
    and s.account_type='individual'
    and s.payment_status in ('failed','pending')
    and s.restricted_at is null
    and up.account_type='individual'
    and up.account_frozen_at is null
    and lower(coalesce(up.account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
    and lower(coalesce(up.bridge_account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
    and nullif(trim(coalesce(up.email,'')),'') is not null
)
insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
select
  e.user_id,
  'individual.subscription_external_invoice',
  lower(trim(up.email)),
  jsonb_build_object(
    'customer_name',e.full_name,
    'notice','reminder',
    'deadline','September 8, 2026',
    'amount',e.amount,
    'currency',e.currency,
    'billing_period',e.billing_period,
    'payment_link',e.payment_link,
    'transaction_reference',e.provider_reference
  ),
  'subscription:individual_deadline_warning:2026-09-08:'||e.invoice_id::text
from eligible e
join public.user_profiles up on up.id=e.user_id
on conflict(idempotency_key) do nothing;

with eligible as (
  select sei.id as invoice_id,sei.user_id,sei.amount
  from public.subscription_external_invoices sei
  join public.subscriptions s on s.id=sei.subscription_id and s.user_id=sei.user_id
  join public.user_profiles up on up.id=sei.user_id
  where sei.billing_period='2026-08-31'::date and sei.amount=5.00 and sei.currency='USD'
    and sei.provider='flutterwave' and sei.status='payment_link_created' and sei.paid_at is null
    and s.status='active' and s.account_type='individual' and s.payment_status in ('failed','pending') and s.restricted_at is null
    and up.account_type='individual' and up.account_frozen_at is null
    and sei.user_id = any(array[
      '459d56ac-ca79-4c8d-b46f-0cb56daa6b07','0e40f044-5f2e-43ed-adcf-5d4437a8c455','919d03d6-5a6a-4620-b2b2-f83c6df5a699',
      '30a4d987-2768-4134-9b23-f73654d475fc','f3a6300f-0464-467c-a332-514db22ebc37','4134a8b3-7167-4ec9-b35a-4172e723968a',
      '456679ac-40c3-43af-bd65-216b95632be6','3ed4e220-258f-4fb7-a604-6b85e0341032','2f1a9515-fdee-482d-98c4-7593339d92c9',
      'dd072c67-9710-4570-9f5b-e4bf67d62d9c','5bbcb7a6-5b8a-4545-a9c8-8e7246ff1a09','f8182bc8-0622-4f6b-b50e-6db8e5e0b2d8',
      '00343a6b-9fc2-46a1-bdc6-9302f2a38807','58c7fe8c-d461-4005-8a36-3720f92c500f','786c7998-3558-4b02-b308-0acae038fa8a',
      '9685dddd-ff59-47a2-afe5-f947977564ef','7585f63a-2ece-4703-ad66-2f0a5459064e','d7ba4f7f-28cf-4ca1-b740-8ed7133d3420',
      'b9c1b319-9bde-4950-bb1b-df6699ccc38a','d57f77b6-af60-43a7-b627-2daae675579e','cc4c1a8a-a02a-4a1d-92ad-f360d2514a5e',
      '16599ff7-104a-430f-abdd-ddadb67a6a46','28b8edb5-d3c3-4194-8cd5-274efc0d9b8d'
    ]::uuid[])
)
insert into public.notifications(user_id,type,title,body,metadata)
select
  e.user_id,'system','Final payment deadline: September 8',
  'Pay your August Individual maintenance invoice by September 8, 2026. If payment is not confirmed, Individual access will be permanently closed and virtual accounts deactivated.',
  jsonb_build_object('idempotency_key','subscription:individual_deadline_warning:2026-09-08:'||e.invoice_id::text,'amount',e.amount,'invoice_id',e.invoice_id)
from eligible e
on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;

commit;
