begin;
-- New module is dark until the instruction-read boundary and compliance configuration are released together.
create table if not exists public.predeposit_policy (
 singleton boolean primary key default true check(singleton),
 version text not null default 'borderpay-predeposit-2.4.0',
 mode text not null default 'disabled' check(mode in ('disabled','observe','enforce')),
 scope text not null default 'business' check(scope in ('business','all_accounts')),
 config jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
insert into public.predeposit_policy(singleton) values(true) on conflict do nothing;

create table if not exists public.predeposit_invoices (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references auth.users(id),
 invoice_number text not null check(length(invoice_number) between 1 and 100),
 revision integer not null check(revision>0),
 currency text not null check(currency in ('USD','EUR','GBP')),
 total_minor bigint not null check(total_minor>0 and total_minor<=9007199254740991),
 buyer_identity_hash text not null check(buyer_identity_hash ~ '^[0-9a-f]{64}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 policy_version text not null,
 status text not null default 'queued' check(status in ('queued','screening','action_required','review_required','approved','rejected','expired')),
 assessment jsonb,
 lease_id uuid, lease_until timestamptz,
 dossier_path text, dossier_sha256 text check(dossier_sha256 is null or dossier_sha256 ~ '^[0-9a-f]{64}$'),
 approval_expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_user_id,invoice_number,revision),
 check(status<>'approved' or (dossier_path is not null and dossier_sha256 is not null and approval_expires_at is not null))
);
create index if not exists predeposit_invoice_owner on public.predeposit_invoices(owner_user_id,created_at desc);
create index if not exists predeposit_invoice_history on public.predeposit_invoices(owner_user_id,buyer_identity_hash,currency,created_at desc);
create index if not exists predeposit_invoice_queue on public.predeposit_invoices(status,lease_until,created_at);

create table if not exists public.predeposit_documents (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.predeposit_invoices(id),
 owner_user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('signed_agreement','executed_contract','purchase_order','buyer_business_proof','end_use_declaration','logistics','source_of_funds','order_dashboard','platform_order_export','warehouse_receipt','dispatch_log','logo','signature')),
 storage_path text not null unique,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes integer not null check(size_bytes>0 and size_bytes<=20971520),
 created_at timestamptz not null default now()
);
create table if not exists public.predeposit_reviews (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.predeposit_invoices(id),
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 policy_version text not null,
 actor_user_id uuid,
 actor_type text not null check(actor_type in ('engine','compliance')),
 decision text not null check(decision in ('action_required','review_required','approved','rejected')),
 reasons jsonb not null default '[]',
 assessment jsonb not null,
 rationale text not null check(length(btrim(rationale))>0),
 created_at timestamptz not null default now()
);
create table if not exists public.predeposit_deposit_matches (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.predeposit_invoices(id),
 provider_event_id text not null unique,
 provider_transaction_id text not null,
 observed_sender text,
 observed_currency text,
 observed_amount_minor bigint,
 match_status text not null check(match_status in ('matched','review_required','unmatched')),
 created_at timestamptz not null default now()
);

create or replace function public.predeposit_keep_snapshot()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Pre-deposit evidence cannot be deleted through the application';end if;
 if new.owner_user_id is distinct from old.owner_user_id
  or new.invoice_number is distinct from old.invoice_number or new.revision is distinct from old.revision
  or new.currency is distinct from old.currency or new.total_minor is distinct from old.total_minor
  or new.buyer_identity_hash is distinct from old.buyer_identity_hash
  or new.payload is distinct from old.payload or new.payload_sha256 is distinct from old.payload_sha256
  or new.policy_version is distinct from old.policy_version then
  raise exception 'Submitted invoice evidence is immutable; create a new revision';
 end if;
 return new;
end;$$;
create trigger predeposit_invoice_snapshot before update or delete on public.predeposit_invoices for each row execute function public.predeposit_keep_snapshot();

create or replace function public.predeposit_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Pre-deposit audit evidence is append-only';end;$$;
create trigger predeposit_document_immutable before update or delete on public.predeposit_documents for each row execute function public.predeposit_append_only();
create trigger predeposit_review_immutable before update or delete on public.predeposit_reviews for each row execute function public.predeposit_append_only();

create or replace function public.predeposit_document_owner()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.predeposit_invoices i where i.id=new.invoice_id and i.owner_user_id=new.owner_user_id and i.status='queued') then
  raise exception 'Document must belong to the queued invoice owner';end if;
 return new;
end;$$;
create trigger predeposit_document_owner_check before insert on public.predeposit_documents for each row execute function public.predeposit_document_owner();

-- Durable lease: stale workers cannot complete a newer review or unlock instructions.
create or replace function public.claim_predeposit_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice public.predeposit_invoices%rowtype;
begin
 select * into v_invoice from public.predeposit_invoices where id=p_invoice_id for update skip locked;
 if not found then return null;end if;
 if v_invoice.status not in ('queued','screening') or coalesce(v_invoice.lease_until,'-infinity'::timestamptz)>now() then return null;end if;
 update public.predeposit_invoices set status='screening',lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
 where id=p_invoice_id returning * into v_invoice;
 return to_jsonb(v_invoice);
end;$$;

create or replace function public.finish_predeposit_screening(p_invoice_id uuid,p_lease_id uuid,p_assessment jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice public.predeposit_invoices%rowtype;v_status text;
begin
 select * into v_invoice from public.predeposit_invoices where id=p_invoice_id for update;
 if not found or v_invoice.status<>'screening' or v_invoice.lease_id is distinct from p_lease_id or v_invoice.lease_until<=now() then return false;end if;
 v_status:=p_assessment->>'status';
 -- Final approval requires an independently verified evidence dossier.
 if v_status not in ('action_required','review_required') then v_status:='review_required';end if;
 if p_assessment->>'payload_sha256' is distinct from v_invoice.payload_sha256 or p_assessment->>'policy_version' is distinct from v_invoice.policy_version then raise exception 'Review does not match submitted evidence';end if;
 insert into public.predeposit_reviews(invoice_id,payload_sha256,policy_version,actor_type,decision,reasons,assessment,rationale)
 values(v_invoice.id,v_invoice.payload_sha256,v_invoice.policy_version,'engine',v_status,coalesce(p_assessment->'reasons','[]'::jsonb),p_assessment,'Automated pre-deposit screening; final evidence review required');
 update public.predeposit_invoices set status=v_status,assessment=p_assessment,lease_id=null,lease_until=null,updated_at=now() where id=p_invoice_id;
 return true;
end;$$;

-- All client writes go through authenticated Edge handlers; clients cannot self-approve.
alter table public.predeposit_policy enable row level security;
alter table public.predeposit_invoices enable row level security;
alter table public.predeposit_documents enable row level security;
alter table public.predeposit_reviews enable row level security;
alter table public.predeposit_deposit_matches enable row level security;
create policy predeposit_invoice_owner_read on public.predeposit_invoices for select to authenticated using(owner_user_id=(select auth.uid()));
create policy predeposit_document_owner_read on public.predeposit_documents for select to authenticated using(owner_user_id=(select auth.uid()));
create policy predeposit_review_owner_read on public.predeposit_reviews for select to authenticated using(exists(select 1 from public.predeposit_invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid())));
create policy predeposit_match_owner_read on public.predeposit_deposit_matches for select to authenticated using(exists(select 1 from public.predeposit_invoices i where i.id=invoice_id and i.owner_user_id=(select auth.uid())));
grant select on public.predeposit_invoices,public.predeposit_documents,public.predeposit_reviews,public.predeposit_deposit_matches to authenticated;
grant all on public.predeposit_policy,public.predeposit_invoices,public.predeposit_documents,public.predeposit_reviews,public.predeposit_deposit_matches to service_role;
revoke all on function public.claim_predeposit_invoice(uuid) from public,anon,authenticated;
revoke all on function public.finish_predeposit_screening(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_predeposit_invoice(uuid) to service_role;
grant execute on function public.finish_predeposit_screening(uuid,uuid,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('predeposit-evidence','predeposit-evidence',false,20971520,array['application/pdf','image/png','image/jpeg'])
on conflict(id) do nothing;
-- No browser storage write policies: the server assigns paths and verifies bytes/hash.
commit;
