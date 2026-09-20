begin;
alter table public.predeposit_assets drop constraint predeposit_assets_kind_check;
alter table public.predeposit_assets add constraint predeposit_assets_kind_check check(kind in
 ('signed_agreement','executed_contract','purchase_order','buyer_business_proof','end_use_declaration','logistics','source_of_funds','order_dashboard','platform_order_export','warehouse_receipt','dispatch_log','logo','signature','merchant_invoice'));
create table public.predeposit_document_checks(
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references auth.users(id),
 request_id uuid not null,
 invoice_asset_id uuid not null references public.predeposit_assets(id),
 contract_asset_id uuid not null references public.predeposit_assets(id),
 invoice_sha256 text not null check(invoice_sha256 ~ '^[a-f0-9]{64}$'),
 contract_sha256 text not null check(contract_sha256 ~ '^[a-f0-9]{64}$'),
 merchant_name text not null,
 prompt_version text not null,
 status text not null default 'queued' check(status in ('queued','reviewing','matched','needs_attention','unavailable')),
 jobs jsonb not null default '{}',
 result jsonb,
 attempts integer not null default 0,
 lease_id uuid, lease_until timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_user_id,request_id),check(invoice_asset_id<>contract_asset_id)
);
create index predeposit_document_check_queue on public.predeposit_document_checks(status,lease_until,created_at);
create index predeposit_document_check_owner on public.predeposit_document_checks(owner_user_id,created_at desc);
create function public.predeposit_document_check_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Document review records are retained';end if;
 if tg_op='UPDATE' then
  if old.status in ('matched','needs_attention','unavailable') then raise exception 'Completed document reviews are immutable';end if;
  if (new.owner_user_id,new.request_id,new.invoice_asset_id,new.contract_asset_id,new.invoice_sha256,new.contract_sha256,new.merchant_name,new.prompt_version) is distinct from
     (old.owner_user_id,old.request_id,old.invoice_asset_id,old.contract_asset_id,old.invoice_sha256,old.contract_sha256,old.merchant_name,old.prompt_version)
  then raise exception 'Document review inputs are immutable';end if;
  return new;
 end if;
 if not exists(select 1 from public.predeposit_assets a where a.id=new.invoice_asset_id and a.owner_user_id=new.owner_user_id and a.kind='merchant_invoice' and a.mime_type='application/pdf' and a.sha256=new.invoice_sha256 and a.scan_status<>'rejected' and a.verification_status<>'rejected')
 or not exists(select 1 from public.predeposit_assets a where a.id=new.contract_asset_id and a.owner_user_id=new.owner_user_id and a.kind='executed_contract' and a.sha256=new.contract_sha256 and a.scan_status<>'rejected' and a.verification_status<>'rejected')
 then raise exception 'Review documents must belong to this merchant';end if;
 return new;
end;$$;
create trigger document_check_guard before insert or update or delete on public.predeposit_document_checks for each row execute function public.predeposit_document_check_guard();
alter table public.predeposit_document_checks enable row level security;
create policy document_check_owner_read on public.predeposit_document_checks for select to authenticated using(owner_user_id=(select auth.uid()));
revoke all on public.predeposit_document_checks from public,anon,authenticated;
grant select on public.predeposit_document_checks to authenticated;
grant all on public.predeposit_document_checks to service_role;
create function public.claim_predeposit_document_check(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.predeposit_document_checks%rowtype;
begin
 select * into r from public.predeposit_document_checks where id=p_id for update skip locked;
 if not found or r.status not in ('queued','reviewing') or coalesce(r.lease_until,'-infinity'::timestamptz)>now() then return null;end if;
 if r.attempts>=12 then
  update public.predeposit_document_checks set status='unavailable',result='{"status":"unavailable","findings":[{"code":"review_timeout","explanation":"Document review could not finish. Please try again."}],"authenticity_verified":false}',lease_id=null,lease_until=null,updated_at=now() where id=p_id;
  return null;
 end if;
 update public.predeposit_document_checks set status='reviewing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=p_id returning * into r;
 return to_jsonb(r);
end;$$;
revoke all on function public.claim_predeposit_document_check(uuid) from public,anon,authenticated;
grant execute on function public.claim_predeposit_document_check(uuid) to service_role;
revoke all on function public.predeposit_document_check_guard() from public,anon,authenticated;
-- Preserve the existing dispatcher and deposit reconciliation, but wake it for document jobs too.
do $$
declare definition text;
begin
 if to_regprocedure('public.invoke_predeposit_worker()') is not null then
  select pg_get_functiondef('public.invoke_predeposit_worker()'::regprocedure) into definition;
  if position('if not exists(select 1 from public.predeposit_invoices' in definition)=0 then raise exception 'Unexpected worker dispatcher; review before updating';end if;
  definition:=replace(definition,'if not exists(select 1 from public.predeposit_invoices',
   'if not exists(select 1 from public.predeposit_document_checks where status in (''queued'',''reviewing'') and (lease_until is null or lease_until<now())) and not exists(select 1 from public.predeposit_invoices');
  execute definition;
 end if;
end;$$;
commit;
