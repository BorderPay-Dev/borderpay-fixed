begin;

-- Queue the September 8 deadline reminder for the six supplied $15 August
-- Business invoices. Eligibility is revalidated so paid, restricted, frozen,
-- paused, or offboarded accounts cannot receive a stale warning.
with eligible as (
  select
    sei.id as invoice_id,
    sei.user_id,
    sei.amount,
    sei.currency,
    sei.billing_period,
    sei.payment_link,
    sei.provider_reference,
    coalesce(bp.company_name,up.full_name) as customer_name,
    lower(trim(up.email)) as recipient
  from public.subscription_external_invoices sei
  join public.subscriptions s on s.id=sei.subscription_id and s.user_id=sei.user_id
  join public.user_profiles up on up.id=sei.user_id
  left join public.business_profiles bp on bp.user_id=sei.user_id
  where sei.user_id = any(array[
    '25620aba-6284-4cec-bf6f-9b770c3ff333',
    '525f2936-7f82-4730-91f3-495f38423bae',
    'aef293b2-c24a-4967-a573-2908c18cfdbe',
    '38db066e-1ae3-4b2d-88b0-cbdeb83d5759',
    'd19304b1-5e39-4ab7-b1e4-905303aef008',
    'be9f9508-cc94-48d2-ab0e-fd4eec41f36e'
  ]::uuid[])
    and sei.provider='flutterwave'
    and sei.billing_period='2026-08-31'::date
    and sei.amount=15.00
    and sei.currency='USD'
    and sei.status='payment_link_created'
    and sei.paid_at is null
    and nullif(trim(coalesce(sei.payment_link,'')),'') is not null
    and s.status='active'
    and s.account_type='business'
    and s.payment_status in ('failed','pending')
    and s.restricted_at is null
    and up.account_type='business'
    and up.account_frozen_at is null
    and lower(coalesce(up.account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
    and lower(coalesce(up.bridge_account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
    and nullif(trim(coalesce(up.email,'')),'') is not null
)
insert into public.subscription_email_jobs(user_id,template,recipient,props,idempotency_key)
select
  e.user_id,
  'business.subscription_external_invoice',
  e.recipient,
  jsonb_build_object(
    'customer_name',e.customer_name,
    'notice','reminder',
    'deadline','September 8, 2026',
    'amount',e.amount,
    'currency',e.currency,
    'billing_period',e.billing_period,
    'payment_link',e.payment_link,
    'transaction_reference',e.provider_reference
  ),
  'subscription:business_deadline_warning:2026-09-08:'||e.invoice_id::text
from eligible e
on conflict(idempotency_key) do nothing;

with eligible as (
  select sei.id as invoice_id,sei.user_id,sei.amount
  from public.subscription_external_invoices sei
  join public.subscriptions s on s.id=sei.subscription_id and s.user_id=sei.user_id
  join public.user_profiles up on up.id=sei.user_id
  where sei.user_id = any(array[
    '25620aba-6284-4cec-bf6f-9b770c3ff333','525f2936-7f82-4730-91f3-495f38423bae',
    'aef293b2-c24a-4967-a573-2908c18cfdbe','38db066e-1ae3-4b2d-88b0-cbdeb83d5759',
    'd19304b1-5e39-4ab7-b1e4-905303aef008','be9f9508-cc94-48d2-ab0e-fd4eec41f36e'
  ]::uuid[])
    and sei.provider='flutterwave' and sei.billing_period='2026-08-31'::date
    and sei.amount=15.00 and sei.currency='USD' and sei.status='payment_link_created' and sei.paid_at is null
    and s.status='active' and s.account_type='business' and s.payment_status in ('failed','pending') and s.restricted_at is null
    and up.account_type='business' and up.account_frozen_at is null
    and lower(coalesce(up.account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
    and lower(coalesce(up.bridge_account_status,'')) not in ('frozen','paused','suspended','rejected','offboarded','deactivated','closed')
)
insert into public.notifications(user_id,type,title,body,metadata)
select
  e.user_id,
  'system',
  'Business maintenance payment deadline: September 8',
  'Pay your August Business maintenance invoice by September 8, 2026 to avoid temporary restriction of receiving accounts, wallets, and sensitive financial screens.',
  jsonb_build_object(
    'idempotency_key','subscription:business_deadline_warning:2026-09-08:'||e.invoice_id::text,
    'amount',e.amount,
    'invoice_id',e.invoice_id
  )
from eligible e
on conflict(user_id,((metadata->>'idempotency_key'))) where metadata ? 'idempotency_key' do nothing;

commit;
