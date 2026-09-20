begin;
-- Reconciliation is an independent reader of verified webhooks. It cannot
-- create transfers, alter balances, freeze accounts, or block webhook ingestion.
create table public.predeposit_deposit_bindings(
 id uuid primary key default gen_random_uuid(),
 provider_key text not null check(provider_key='bridge'),
 provider_customer_id text not null,
 provider_deposit_id text not null,
 owner_user_id uuid not null references auth.users(id),
 invoice_id uuid not null references public.predeposit_invoices(id),
 invoice_number text not null,
 account_id text not null,
 currency text not null check(currency in ('USD','EUR','GBP')),
 amount_minor bigint not null check(amount_minor>0),
 sender_name text not null,
 first_event_id text not null,
 matched_at timestamptz not null default now(),
 unique(provider_key,provider_customer_id,provider_deposit_id),
 unique(owner_user_id,invoice_number)
);
create table public.predeposit_deposit_observations(
 id uuid primary key default gen_random_uuid(),
 webhook_event_id text not null unique,
 provider_key text not null default 'bridge' check(provider_key='bridge'),
 provider_customer_id text,
 provider_deposit_id text,
 owner_user_id uuid,
 invoice_id uuid references public.predeposit_invoices(id),
 activity_type text,
 currency text,
 amount_minor bigint,
 event_at timestamptz,
 outcome text not null check(outcome in ('matched','review_required','out_of_scope')),
 reason text not null,
 recorded_at timestamptz not null default now()
);
alter table public.predeposit_deposit_bindings enable row level security;
alter table public.predeposit_deposit_observations enable row level security;
grant select,insert on public.predeposit_deposit_bindings,public.predeposit_deposit_observations to service_role;
create trigger predeposit_binding_append_only before update or delete on public.predeposit_deposit_bindings for each row execute function public.predeposit_append_only();
create trigger predeposit_observation_append_only before update or delete on public.predeposit_deposit_observations for each row execute function public.predeposit_append_only();

create function public.predeposit_money_minor(p_amount text) returns bigint
language plpgsql immutable set search_path=public,pg_temp as $$
declare n numeric;
begin
 if p_amount is null or length(p_amount)>20 or p_amount !~ '^[0-9]+([.][0-9]{1,2})?$' then return null;end if;
 n:=p_amount::numeric*100;
 if n<=0 or n>9007199254740991 then return null;end if;
 return n::bigint;
end;$$;
create function public.predeposit_exact_name(p_name text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select upper(regexp_replace(btrim(normalize(coalesce(p_name,''),NFKC)),'[[:space:]]+',' ','g'));
$$;

create function public.reconcile_predeposit_bridge_events(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.predeposit_policy%rowtype; start_at timestamptz;
 e record; obj jsonb; activity text; customer text; deposit text; account text; owner_id uuid;
 event_at timestamptz; ccy text; event_ccy text; minor bigint; sender text;
 reason text; matched_invoice uuid; candidate_ids uuid[]; owners uuid[]; va_count integer;
 binding public.predeposit_deposit_bindings%rowtype;
 i public.predeposit_invoices%rowtype;
 processed integer:=0; matched integer:=0; reviews integer:=0;
begin
 select * into p from public.predeposit_policy where singleton;
 if not found or p.mode not in ('observe','enforce') or p.config->>'deposit_reconciliation_enabled' is distinct from 'true' then
  return jsonb_build_object('processed',0,'matched',0,'review_required',0,'enabled',false);
 end if;
 begin start_at:=(p.config->>'deposit_reconciliation_start_at')::timestamptz;
 exception when others then raise exception 'Deposit reconciliation start time is invalid';end;
 if start_at is null then raise exception 'Deposit reconciliation start time is required';end if;
 if not pg_try_advisory_xact_lock(hashtext('predeposit-deposit-reconciliation')) then
  return jsonb_build_object('processed',0,'matched',0,'review_required',0,'busy',true);
 end if;
 for e in
  select w.* from public.bridge_webhook_events w
  where w.signature_ok is true and w.received_at>=start_at
   and w.event_type in ('virtual_account.activity.created','virtual_account.activity.updated')
   and w.payload#>>'{event_object,type}' in ('funds_received','payment_processed')
   and not exists(select 1 from public.predeposit_deposit_observations o where o.webhook_event_id=w.event_id)
  order by w.received_at,w.event_id limit greatest(1,least(coalesce(p_limit,50),200))
 loop
  obj:=e.payload->'event_object';activity:=obj->>'type';
  customer:=nullif(btrim(obj->>'customer_id'),'');deposit:=nullif(btrim(obj->>'deposit_id'),'');
  account:=nullif(btrim(obj->>'virtual_account_id'),'');
  owner_id:=null;ccy:=null;minor:=null;matched_invoice:=null;candidate_ids:=null;
  sender:=public.predeposit_exact_name(obj#>>'{source,sender_name}');
  reason:=null;event_at:=null;
  begin event_at:=(e.payload->>'event_created_at')::timestamptz;exception when others then event_at:=null;end;
  if event_at is null or event_at>e.received_at+interval '5 minutes' then reason:='event_time_invalid';
  elsif event_at<start_at then reason:='event_predates_reconciliation';
  elsif e.payload->>'event_id' is distinct from e.event_id or e.payload->>'event_type' is distinct from e.event_type then reason:='event_envelope_mismatch';
  elsif customer is null or deposit is null or account is null then reason:='deposit_identity_missing';
  end if;
  if reason is null then
   -- Duplicate local rows must not silently select an owner or currency.
   select count(*),array_agg(coalesce(v.business_user_id,v.user_id)),min(upper(v.currency))
    into va_count,owners,ccy from public.bridge_virtual_accounts v
    where v.bridge_virtual_account_id=account and v.bridge_customer_id=customer and ((v.user_id is null) <> (v.business_user_id is null));
   if va_count<>1 or owners[1] is null then reason:='receiving_account_ambiguous';
   else owner_id:=owners[1];end if;
  end if;
  if reason is null then
   if not exists(select 1 from public.user_profiles u where u.id=owner_id and u.account_type::text='business') then
    reason:='outside_business_scope';
   elsif ccy not in ('USD','EUR','GBP') then reason:='source_currency_unknown';
   else
    event_ccy:=upper(obj->>'currency');
    if event_ccy=ccy then
     minor:=public.predeposit_money_minor(obj->>'amount');
     if obj#>>'{receipt,initial_amount}' is not null and public.predeposit_money_minor(obj#>>'{receipt,initial_amount}') is distinct from minor then reason:='source_amount_conflict';end if;
    elsif event_ccy in ('USDC','EURC') then
     -- Settlement amount is a wallet amount, not the invoice's incoming fiat.
     minor:=public.predeposit_money_minor(obj#>>'{receipt,initial_amount}');
    else reason:='source_currency_unknown';end if;
    if minor is null then reason:=coalesce(reason,'source_amount_missing');end if;
   end if;
  end if;
  if reason is null and sender='' then reason:='sender_name_missing';end if;
  if reason is null then
   select * into binding from public.predeposit_deposit_bindings
    where provider_key='bridge' and provider_customer_id=customer and provider_deposit_id=deposit;
   if found then
    if binding.owner_user_id=owner_id and binding.account_id=account and binding.currency=ccy
      and binding.amount_minor=minor and binding.sender_name=sender then
     matched_invoice:=binding.invoice_id;reason:='existing_deposit_binding';
    else reason:='deposit_evidence_conflict';end if;
   else
    select array_agg(q.id) into candidate_ids from (
     select inv.id from public.predeposit_invoices inv
     where inv.owner_user_id=owner_id and inv.provider_key='bridge'
      and inv.review_context->>'provider_customer_id'=customer
      and inv.payload->>'receiving_account_id'=account
      and inv.currency=ccy and inv.total_minor=minor
      and inv.status in ('approved','expired')
      and inv.approval_expires_at>event_at
      and inv.dossier_sha256 is not null and inv.dossier_path is not null
      and public.predeposit_exact_name(inv.payload#>>'{buyer,legal_name}')=sender
      and public.predeposit_exact_name(inv.payload#>>'{remitter,legal_name}')=sender
      and (inv.currency<>'GBP' or (inv.payload#>>'{buyer,type}'='company' and inv.payload#>>'{remitter,type}'='company'))
      and exists(select 1 from public.predeposit_reviews r where r.invoice_id=inv.id and r.decision='approved'
       and r.created_at<=event_at and r.payload_sha256=inv.payload_sha256)
      and exists(select 1 from public.predeposit_access_log a where a.invoice_id=inv.id
       and a.action='payment_instructions_exported' and a.metadata->>'account_id'=account and a.created_at<=event_at)
      and not exists(select 1 from public.predeposit_invoices newer where newer.owner_user_id=inv.owner_user_id
       and newer.invoice_number=inv.invoice_number and newer.revision>inv.revision and newer.created_at<=event_at)
      and not exists(select 1 from public.predeposit_deposit_bindings b where b.owner_user_id=inv.owner_user_id and b.invoice_number=inv.invoice_number)
     limit 2
    ) q;
    if coalesce(array_length(candidate_ids,1),0)=1 then
     select * into i from public.predeposit_invoices where id=candidate_ids[1] for update;
     insert into public.predeposit_deposit_bindings(provider_key,provider_customer_id,provider_deposit_id,owner_user_id,
      invoice_id,invoice_number,account_id,currency,amount_minor,sender_name,first_event_id)
      values('bridge',customer,deposit,owner_id,i.id,i.invoice_number,account,ccy,minor,sender,e.event_id)
      on conflict do nothing;
     if found then matched_invoice:=i.id;reason:='approved_invoice_exact_match';
     else reason:='invoice_already_bound';end if;
    elsif coalesce(array_length(candidate_ids,1),0)>1 then reason:='multiple_matching_invoices';
    else reason:='no_unused_approved_invoice_match';end if;
   end if;
  end if;
  insert into public.predeposit_deposit_observations(webhook_event_id,provider_customer_id,provider_deposit_id,
   owner_user_id,invoice_id,activity_type,currency,amount_minor,event_at,outcome,reason)
   values(e.event_id,customer,deposit,owner_id,matched_invoice,activity,ccy,minor,event_at,
    case when reason='outside_business_scope' then 'out_of_scope' when matched_invoice is null then 'review_required' else 'matched' end,reason);
  processed:=processed+1;
  if matched_invoice is not null then matched:=matched+1;elsif reason<>'outside_business_scope' then reviews:=reviews+1;end if;
 end loop;
 return jsonb_build_object('processed',processed,'matched',matched,'review_required',reviews,'enabled',true);
end;$$;
revoke all on function public.predeposit_money_minor(text),public.predeposit_exact_name(text),public.reconcile_predeposit_bridge_events(integer) from public,anon,authenticated;
grant execute on function public.predeposit_money_minor(text),public.predeposit_exact_name(text),public.reconcile_predeposit_bridge_events(integer) to service_role;
create or replace function public.invoke_predeposit_worker() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token text; v_request bigint;
begin
 if not exists(select 1 from public.predeposit_invoices where status in ('queued','screening') and (lease_until is null or lease_until<now())) and not exists(
  select 1 from public.predeposit_policy p
  where p.singleton and p.mode in ('observe','enforce')
   and p.config->>'deposit_reconciliation_enabled'='true'
   and exists(select 1 from public.bridge_webhook_events w where w.signature_ok is true
    and w.received_at >= (p.config->>'deposit_reconciliation_start_at')::timestamptz
    and w.event_type in ('virtual_account.activity.created','virtual_account.activity.updated')
    and w.payload#>>'{event_object,type}' in ('funds_received','payment_processed')
    and not exists(select 1 from public.predeposit_deposit_observations o where o.webhook_event_id=w.event_id))
 ) then return null;end if;
 if not pg_try_advisory_xact_lock(hashtext('predeposit-worker-dispatch')) then return null;end if;
 select decrypted_secret into v_token from vault.decrypted_secrets where name='borderpay_predeposit_worker_token' limit 1;
 if v_token is null or length(v_token)<32 then raise exception 'Pre-deposit worker credential is not configured';end if;
 select net.http_post(
  url:='https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/predeposit-worker',
  headers:=jsonb_build_object('Content-Type','application/json','X-Predeposit-Worker-Token',v_token),
  body:='{}'::jsonb,timeout_milliseconds:=10000
 ) into v_request;
 insert into public.predeposit_worker_requests(request_id) values(v_request);
 return v_request;
end;$$;

commit;
