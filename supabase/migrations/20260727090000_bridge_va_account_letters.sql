-- Store official Bridge-issued account letters per virtual account.
-- The PDFs stay private in Storage and are sent through the server-side email path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bridge-va-documents',
  'bridge-va-documents',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf'];

create table if not exists public.bridge_virtual_account_documents (
  id uuid primary key default gen_random_uuid(),
  bridge_virtual_account_id text not null references public.bridge_virtual_accounts(bridge_virtual_account_id) on delete cascade,
  document_type text not null default 'account_letter' check (document_type = 'account_letter'),
  currency text not null check (currency in ('USD','EUR','GBP')),
  user_id uuid references auth.users(id) on delete cascade,
  business_user_id uuid references public.business_profiles(user_id) on delete cascade,
  storage_bucket text not null default 'bridge-va-documents',
  storage_path text not null,
  original_filename text,
  content_type text not null default 'application/pdf',
  uploaded_by uuid references auth.users(id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bvad_owner_xor check ((user_id is not null) or (business_user_id is not null)),
  constraint bvad_unique_letter unique (bridge_virtual_account_id, document_type)
);

create index if not exists bvad_user_idx on public.bridge_virtual_account_documents (user_id) where user_id is not null;
create index if not exists bvad_business_idx on public.bridge_virtual_account_documents (business_user_id) where business_user_id is not null;
create index if not exists bvad_currency_idx on public.bridge_virtual_account_documents (currency);

alter table public.bridge_virtual_account_documents enable row level security;

drop policy if exists bvad_owner_read on public.bridge_virtual_account_documents;
create policy bvad_owner_read on public.bridge_virtual_account_documents
  for select to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);

drop policy if exists bvad_admin_read on public.bridge_virtual_account_documents;
create policy bvad_admin_read on public.bridge_virtual_account_documents
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists bvad_service_role on public.bridge_virtual_account_documents;
create policy bvad_service_role on public.bridge_virtual_account_documents
  for all to service_role using (true) with check (true);

drop trigger if exists trg_bvad_updated on public.bridge_virtual_account_documents;
create trigger trg_bvad_updated before update on public.bridge_virtual_account_documents
  for each row execute function public.set_updated_at();
