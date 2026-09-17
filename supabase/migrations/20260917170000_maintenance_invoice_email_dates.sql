-- Invoice creation may precede the due date; overdue controls may not.
begin;

CREATE OR REPLACE FUNCTION public.apply_subscription_grace_controls()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      invoice.provider_reference,
      greatest(s.grace_started_at, invoice.billing_period::timestamptz) as effective_grace_started_at
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
        and sei.billing_period <= current_date
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
    if r.reminder_sent_at is null and r.effective_grace_started_at <= now()-interval '3 days' then
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
          then 'Your maintenance invoice dated ' || to_char(r.billing_period, 'FMMonth FMDD, YYYY') || ' remains unpaid. Payment deadline: ' || to_char(r.effective_grace_started_at + interval '7 days', 'FMMonth FMDD, YYYY') || '. Contact Support if you have already paid.'
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
          'deadline',to_char(r.effective_grace_started_at + interval '7 days', 'YYYY-MM-DD'),
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

    if r.effective_grace_started_at <= now()-interval '7 days'
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
          'deadline',to_char(r.effective_grace_started_at + interval '7 days', 'YYYY-MM-DD'),
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_subscription_restrictions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     and sei.billing_period <= current_date
    join public.subscription_email_jobs j
      on j.user_id=s.user_id
     and j.idempotency_key='subscription:day7_final_warning:'||sei.id::text
     and j.status='sent'
     and j.sent_at is not null
    where s.status='active'
      and s.payment_status in ('failed','pending')
      and (
        greatest(s.grace_started_at, sei.billing_period::timestamptz) <= now()-interval '7 days'
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
$function$;

CREATE OR REPLACE FUNCTION public.mark_external_subscription_invoice_link(p_invoice_id uuid, p_provider_reference text, p_payment_link text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    grace_started_at = greatest(coalesce(grace_started_at, now()), invoice.billing_period::timestamptz),
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
$function$;

-- Preserve an audit record before correcting premature grace timestamps.
insert into public.subscription_admin_logs(user_id,subscription_id,action,details)
select s.user_id,s.id,'maintenance_email_date_repair',
  jsonb_build_object('invoice_id',i.id,'billing_period',i.billing_period,
    'previous_grace_started_at',s.grace_started_at,'previous_reminder_sent_at',s.reminder_sent_at)
from public.subscriptions s join public.subscription_external_invoices i on i.subscription_id=s.id
where s.status='active' and i.status='payment_link_created' and i.paid_at is null
  and i.billing_period > current_date and s.grace_started_at < i.billing_period::timestamptz;

update public.subscriptions s
set grace_started_at=i.billing_period::timestamptz,
    reminder_sent_at=case when s.reminder_sent_at < i.billing_period::timestamptz then null else s.reminder_sent_at end,
    updated_at=now()
from public.subscription_external_invoices i
where i.subscription_id=s.id and s.status='active'
  and i.status='payment_link_created' and i.paid_at is null and i.billing_period > current_date
  and s.grace_started_at < i.billing_period::timestamptz;

-- Do not replay obsolete invoices. Keep the original job and diagnostic history.
update public.subscription_email_jobs j set status='failed',next_attempt_at='infinity',
  last_error='suppressed:invoice_not_payable_or_subscription_inactive'
from public.subscription_external_invoices i join public.subscriptions s on s.id=i.subscription_id
where j.user_id=i.user_id and j.props->>'transaction_reference'=i.provider_reference
  and j.template in ('business.subscription_external_invoice','individual.subscription_external_invoice')
  and j.status in ('pending','failed')
  and (i.status<>'payment_link_created' or i.paid_at is not null or s.status<>'active');

-- Repair only existing unsent jobs; preserve billing periods, references and amounts.
update public.subscription_email_jobs j set status='pending',attempt_count=0,last_error=null,
  next_attempt_at=greatest(now(),case coalesce(j.props->>'notice','invoice')
    when 'reminder' then greatest(s.grace_started_at,i.billing_period::timestamptz)+interval '3 days'
    when 'final_warning' then greatest(s.grace_started_at,i.billing_period::timestamptz)+interval '7 days'
    else i.billing_period::timestamptz+interval '15 minutes' end),
  props=j.props || jsonb_build_object('amount',i.amount,'currency',i.currency,'billing_period',i.billing_period,
    'payment_link',i.payment_link,'transaction_reference',i.provider_reference,
    'deadline',to_char(greatest(s.grace_started_at,i.billing_period::timestamptz)+interval '7 days','YYYY-MM-DD'))
from public.subscription_external_invoices i join public.subscriptions s on s.id=i.subscription_id
where j.user_id=i.user_id and j.props->>'transaction_reference'=i.provider_reference
  and j.template in ('business.subscription_external_invoice','individual.subscription_external_invoice')
  and j.status in ('pending','failed') and s.status='active' and i.status='payment_link_created'
  and i.paid_at is null and i.payment_link is not null
  and coalesce(j.props->>'notice','invoice') in ('invoice','reminder','final_warning');

-- Correct premature in-app reminders without emitting another notification.
update public.notifications n set title='Maintenance invoice available',
  body='Your maintenance invoice is available. Billing date: ' || to_char(i.billing_period,'FMMonth FMDD, YYYY') || '. You may pay externally before this date.',
  metadata=n.metadata || jsonb_build_object('notice_corrected_at',now(),'reason','invoice_not_yet_due')
from public.subscription_external_invoices i
where n.user_id=i.user_id and n.metadata->>'invoice_id'=i.id::text
  and n.metadata->>'idempotency_key' in ('subscription:day3_reminder:'||i.id::text,'subscription:day7_final_warning:'||i.id::text)
  and i.billing_period>current_date and i.status='payment_link_created' and i.paid_at is null
  and not (n.metadata ? 'notice_corrected_at');

commit;
