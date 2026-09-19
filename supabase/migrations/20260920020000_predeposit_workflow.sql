begin;
create table public.predeposit_drafts(
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null references auth.users(id),
 invoice_number text not null,version integer not null default 1,payload jsonb not null default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_user_id,invoice_number)
);
create table public.predeposit_assets(
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('signed_agreement','executed_contract','purchase_order','buyer_business_proof','end_use_declaration','logistics','source_of_funds','order_dashboard','platform_order_export','warehouse_receipt','dispatch_log','logo','signature')),
 storage_path text not null unique,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),size_bytes integer not null check(size_bytes>0 and size_bytes<=20971520),
 scan_status text not null default 'pending' check(scan_status in ('pending','clean','rejected')),
 verification_status text not null default 'pending' check(verification_status in ('pending','verified','rejected')),
 verified_by uuid,verified_at timestamptz,created_at timestamptz not null default now()
);
create table public.predeposit_branding(
 owner_user_id uuid primary key references auth.users(id),
 logo_asset_id uuid references public.predeposit_assets(id),signature_asset_id uuid references public.predeposit_assets(id),
 signer_name text not null default '',updated_at timestamptz not null default now()
);
create table public.predeposit_agreement_templates(
 version text primary key,title text not null,body text not null,
 status text not null default 'draft' check(status in ('draft','approved','retired')),
 approved_by uuid,approved_at timestamptz,
 check(status<>'approved' or (approved_by is not null and approved_at is not null))
);
create table public.predeposit_processing_jobs(
 invoice_id uuid primary key references public.predeposit_invoices(id),jobs jsonb not null default '{}',
 updated_at timestamptz not null default now()
);
create table public.predeposit_access_log(
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.predeposit_invoices(id),
 actor_user_id uuid not null,action text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table public.predeposit_invoices add column draft_id uuid references public.predeposit_drafts(id),
 add column review_context jsonb not null default '{}',add column provider_key text not null default 'bridge',
 add column attempts integer not null default 0;
alter table public.predeposit_documents drop constraint predeposit_documents_storage_path_key;
alter table public.predeposit_documents add constraint predeposit_document_invoice_path unique(invoice_id,storage_path);
create trigger predeposit_access_append_only before update or delete on public.predeposit_access_log for each row execute function public.predeposit_append_only();

create function public.predeposit_asset_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Submitted evidence cannot be deleted';end if;
 if (new.owner_user_id,new.kind,new.storage_path,new.sha256,new.mime_type,new.size_bytes) is distinct from
 (old.owner_user_id,old.kind,old.storage_path,old.sha256,old.mime_type,old.size_bytes) then raise exception 'Evidence bytes and ownership are immutable';end if;
 return new;
end;$$;
create trigger predeposit_asset_snapshot before update or delete on public.predeposit_assets for each row execute function public.predeposit_asset_immutable();

create function public.submit_predeposit_draft(p_owner uuid,p_draft uuid,p_version integer,p_invoice jsonb,p_context jsonb,p_sha text,p_buyer_hash text,p_documents jsonb,p_provider text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.predeposit_drafts%rowtype;i public.predeposit_invoices%rowtype;doc jsonb;
begin
 select * into d from public.predeposit_drafts where id=p_draft and owner_user_id=p_owner for update;
 if not found or d.version<>p_version then raise exception 'Draft changed; reload before submitting';end if;
 select * into i from public.predeposit_invoices where owner_user_id=p_owner and invoice_number=d.invoice_number and revision=d.version;
 if found then return to_jsonb(i);end if;
 if p_provider not in ('bridge','conduit','borderless') then raise exception 'Unsupported provider';end if;
 if (p_invoice->>'revision')::integer<>d.version then raise exception 'Invoice revision does not match draft';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_buyer_hash||(p_invoice->>'currency'),0));
 p_context:=jsonb_set(p_context,'{history}',(
 select jsonb_build_object('available',true,'buyer_invoice_count_30d',count(*),'same_currency_total_minor_30d',coalesce(sum(total_minor),0))
 from (select distinct on(invoice_number) total_minor from public.predeposit_invoices
 where owner_user_id=p_owner and buyer_identity_hash=p_buyer_hash and currency=p_invoice->>'currency'
 and created_at>now()-interval '30 days' and invoice_number<>d.invoice_number and status<>'rejected'
 order by invoice_number,revision desc) histories));
 insert into public.predeposit_invoices(id,draft_id,owner_user_id,invoice_number,revision,currency,total_minor,buyer_identity_hash,payload,payload_sha256,policy_version,review_context,provider_key)
 values((p_invoice->>'id')::uuid,d.id,p_owner,d.invoice_number,d.version,p_invoice->>'currency',(p_context->>'total_minor')::bigint,p_buyer_hash,p_invoice,p_sha,'borderpay-predeposit-2.4.0',p_context,p_provider) returning * into i;
 for doc in select value from jsonb_array_elements(p_documents) loop
  if not exists(select 1 from public.predeposit_assets a where a.id=(doc->>'id')::uuid and a.owner_user_id=p_owner and a.sha256=doc->>'sha256' and a.storage_path=doc->>'storage_path' and a.kind=doc->>'kind' and a.scan_status<>'rejected') then raise exception 'Evidence ownership or hash mismatch';end if;
  insert into public.predeposit_documents(invoice_id,owner_user_id,kind,storage_path,sha256,mime_type,size_bytes)
  values(i.id,p_owner,doc->>'kind',doc->>'storage_path',doc->>'sha256',doc->>'mime_type',(doc->>'size_bytes')::integer);
 end loop;
 return to_jsonb(i);
end;$$;

create or replace function public.claim_predeposit_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.predeposit_invoices%rowtype;
begin
 select * into i from public.predeposit_invoices where id=p_invoice_id for update skip locked;
 if not found or i.status not in ('queued','screening') or coalesce(i.lease_until,'-infinity'::timestamptz)>now() then return null;end if;
 if i.attempts>=30 then
  update public.predeposit_invoices set status='review_required',lease_id=null,lease_until=null,assessment=jsonb_build_object('status','review_required','reasons',jsonb_build_array('screening_retry_exhausted')),updated_at=now() where id=i.id;
  return null;
 end if;
 update public.predeposit_invoices set status='screening',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 where id=i.id returning * into i;
 return to_jsonb(i);
end;$$;

create function public.complete_predeposit_review(p_invoice uuid,p_lease uuid,p_actor uuid,p_decision text,p_assessment jsonb,p_dossier_path text,p_dossier_sha text,p_rationale text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.predeposit_invoices%rowtype;v_actor text;
begin
 select * into i from public.predeposit_invoices where id=p_invoice for update;
 if not found then return false;end if;
 if p_actor is not null then
  if not exists(select 1 from public.admin_users where user_id=p_actor and upper(role::text) in ('ADMIN_SUPER','SUPER_ADMIN','ADMIN','COMPLIANCE','ADMIN_COMPLIANCE')) then raise exception 'Compliance operator required';end if;
  if i.status not in ('action_required','review_required') then raise exception 'Invoice is not awaiting a decision';end if;
  v_actor:='compliance';
 else
  if i.status<>'screening' or i.lease_id is distinct from p_lease or i.lease_until<=now() then return false;end if;
  v_actor:='engine';
 end if;
 if p_decision not in ('approved','action_required','review_required','rejected') or length(btrim(coalesce(p_rationale,'')))<10 then raise exception 'Decision rationale required';end if;
 if p_assessment->>'payload_sha256' is distinct from i.payload_sha256 or p_assessment->>'policy_version' is distinct from i.policy_version then raise exception 'Evidence digest mismatch';end if;
 if exists(select 1 from public.predeposit_invoices where owner_user_id=i.owner_user_id and invoice_number=i.invoice_number and revision>i.revision) then raise exception 'A newer invoice revision exists';end if;
 if p_decision='approved' then
  if p_assessment->>'status' is distinct from 'approved' or p_dossier_path is null or coalesce(p_dossier_sha,'') !~ '^[a-f0-9]{64}$'
   or p_assessment->>'assessed_sha256' is null then raise exception 'Approved assessment and dossier required';end if;
  if i.currency='GBP' and (i.payload#>>'{buyer,type}' is distinct from 'company' or i.payload#>>'{remitter,type}' is distinct from 'company') then raise exception 'GBP is strictly corporate B2B';end if;
 end if;
 insert into public.predeposit_reviews(invoice_id,payload_sha256,policy_version,actor_user_id,actor_type,decision,reasons,assessment,rationale)
 values(i.id,i.payload_sha256,i.policy_version,p_actor,v_actor,p_decision,coalesce(p_assessment->'reasons','[]'),p_assessment,p_rationale);
 update public.predeposit_invoices set status=p_decision,assessment=p_assessment,dossier_path=p_dossier_path,dossier_sha256=p_dossier_sha,
 approval_expires_at=case when p_decision='approved' then now()+interval '7 days' else null end,lease_id=null,lease_until=null,updated_at=now() where id=i.id;
 return true;
end;$$;
-- Approval is revoked when a newer revision is submitted; a provider/account change also invalidates export.
create function public.predeposit_expire_prior() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin update public.predeposit_invoices set status='expired',updated_at=now()
 where owner_user_id=new.owner_user_id and invoice_number=new.invoice_number and revision<new.revision and status='approved';return new;end;$$;
create trigger predeposit_expire_prior_revision after insert on public.predeposit_invoices for each row execute function public.predeposit_expire_prior();

alter table public.predeposit_drafts enable row level security;
alter table public.predeposit_assets enable row level security;
alter table public.predeposit_branding enable row level security;
alter table public.predeposit_agreement_templates enable row level security;
alter table public.predeposit_processing_jobs enable row level security;
alter table public.predeposit_access_log enable row level security;
create policy predeposit_drafts_read on public.predeposit_drafts for select to authenticated using(owner_user_id=auth.uid());
create policy predeposit_assets_read on public.predeposit_assets for select to authenticated using(owner_user_id=auth.uid());
create policy predeposit_branding_read on public.predeposit_branding for select to authenticated using(owner_user_id=auth.uid());
grant select on public.predeposit_drafts,public.predeposit_assets,public.predeposit_branding to authenticated;
grant all on public.predeposit_drafts,public.predeposit_assets,public.predeposit_branding,public.predeposit_agreement_templates,public.predeposit_processing_jobs,public.predeposit_access_log to service_role;
revoke all on function public.submit_predeposit_draft(uuid,uuid,integer,jsonb,jsonb,text,text,jsonb,text),public.complete_predeposit_review(uuid,uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_predeposit_draft(uuid,uuid,integer,jsonb,jsonb,text,text,jsonb,text),public.complete_predeposit_review(uuid,uuid,uuid,text,jsonb,text,text,text) to service_role;

create function public.predeposit_context_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin if (new.review_context,new.provider_key,new.draft_id) is distinct from (old.review_context,old.provider_key,old.draft_id)
 then raise exception 'Review context and provider binding are immutable';end if;return new;end;$$;
create trigger predeposit_context_snapshot before update on public.predeposit_invoices for each row execute function public.predeposit_context_immutable();
create table public.predeposit_operator_log(id uuid primary key default gen_random_uuid(),actor_user_id uuid not null,action text not null,object_id text,details jsonb not null,created_at timestamptz not null default now());
alter table public.predeposit_operator_log enable row level security;
grant all on public.predeposit_operator_log to service_role;
create trigger predeposit_operator_append_only before update or delete on public.predeposit_operator_log for each row execute function public.predeposit_append_only();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('predeposit-render-assets','predeposit-render-assets',false,20971520,array['application/octet-stream','font/ttf']) on conflict do nothing;


create function public.predeposit_terms_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.status in ('approved','retired') then
  if tg_op='DELETE' or (new.version,new.title,new.body,new.approved_by,new.approved_at) is distinct from (old.version,old.title,old.body,old.approved_by,old.approved_at) or new.status not in ('approved','retired') then raise exception 'Approved terms are immutable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger predeposit_terms_snapshot before update or delete on public.predeposit_agreement_templates for each row execute function public.predeposit_terms_immutable();
create table public.predeposit_evidence_verifications(
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.predeposit_invoices(id),
 actor_user_id uuid not null,patch jsonb not null,rationale text not null,created_at timestamptz not null default now()
);
alter table public.predeposit_evidence_verifications enable row level security;
grant all on public.predeposit_evidence_verifications to service_role;
create trigger predeposit_verifications_append_only before update or delete on public.predeposit_evidence_verifications for each row execute function public.predeposit_append_only();
commit;
