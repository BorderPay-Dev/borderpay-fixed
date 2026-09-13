-- Reconcile partner invoice payments only after a signed Flutterwave webhook
-- has been re-verified against the provider API by the Edge Function.
begin;

alter table public.partner_invoices
  add column if not exists provider_transaction_id text,
  add column if not exists provider_payment_event_id text;

create unique index if not exists partner_invoices_flutterwave_reference_uidx
  on public.partner_invoices (payment_reference)
  where payment_method = 'flutterwave' and payment_reference is not null;

create unique index if not exists partner_invoices_flutterwave_transaction_uidx
  on public.partner_invoices (provider_transaction_id)
  where payment_method = 'flutterwave' and provider_transaction_id is not null;

create or replace function public.complete_partner_invoice_flutterwave(
  p_payment_reference text,
  p_provider_transaction_id text,
  p_amount numeric,
  p_currency text,
  p_event_id text
) returns public.partner_invoices
language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.partner_invoices;
begin
  if nullif(btrim(p_payment_reference), '') is null
     or nullif(btrim(p_provider_transaction_id), '') is null
     or nullif(btrim(p_event_id), '') is null then
    raise exception 'Verified payment identity is required';
  end if;

  select * into v_invoice
    from public.partner_invoices
    where payment_method = 'flutterwave'
      and payment_reference = btrim(p_payment_reference)
    for update;
  if not found then raise exception 'Partner invoice not found'; end if;
  if v_invoice.status = 'void' then raise exception 'A void invoice cannot be paid'; end if;
  if upper(btrim(p_currency)) <> v_invoice.currency then raise exception 'Payment currency mismatch'; end if;
  if abs(p_amount - v_invoice.total) >= 0.005 then raise exception 'Payment amount mismatch'; end if;

  if v_invoice.status = 'paid' then
    if v_invoice.provider_transaction_id = btrim(p_provider_transaction_id) then return v_invoice; end if;
    raise exception 'Invoice is already paid by another transaction';
  end if;

  update public.partner_invoices
     set amount_paid = total,
         status = 'paid',
         paid_at = now(),
         provider_transaction_id = btrim(p_provider_transaction_id),
         provider_payment_event_id = btrim(p_event_id),
         updated_at = now()
   where id = v_invoice.id
   returning * into v_invoice;

  insert into public.partner_portal_audit_log (organization_id, event_type, metadata)
  values (v_invoice.organization_id, 'partner_invoice_paid_flutterwave', jsonb_build_object(
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'provider_transaction_id', v_invoice.provider_transaction_id,
    'payment_event_id', v_invoice.provider_payment_event_id,
    'amount', v_invoice.amount_paid,
    'currency', v_invoice.currency
  ));
  return v_invoice;
end;
$$;

revoke all on function public.complete_partner_invoice_flutterwave(text,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.complete_partner_invoice_flutterwave(text,text,numeric,text,text) to service_role;

commit;
