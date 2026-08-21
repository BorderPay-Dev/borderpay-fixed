-- Immutable account-origin provenance for certification and lifecycle policy.
--
-- This table is intentionally additive. Existing identities are not backfilled:
-- absence of a row means UNKNOWN, never "direct" or "not imported".

create table if not exists public.account_origin_provenance (
  user_id               uuid primary key,
  account_type          public.account_type not null,
  origin_kind           text not null check (origin_kind in ('direct','partner','imported','migrated')),
  onboarding_channel    text not null check (onboarding_channel in ('direct','api','white_label','import','migration')),
  source_path           text not null,
  account_created_at    timestamptz not null,
  recorded_at           timestamptz not null default now(),
  tenant_id             uuid,
  api_key_id            uuid,
  authorization_id      uuid,
  external_user_id      text,
  source_reference      text,
  check (
    (origin_kind = 'direct'
      and onboarding_channel = 'direct'
      and source_path = 'supabase/functions/auth-signup'
      and tenant_id is null and api_key_id is null
      and authorization_id is null and external_user_id is null)
    or
    (origin_kind = 'partner'
      and onboarding_channel in ('api','white_label')
      and source_path = 'supabase/functions/auth-signup'
      and tenant_id is not null and api_key_id is not null
      and authorization_id is not null and external_user_id is not null)
    or
    (origin_kind = 'imported'
      and onboarding_channel = 'import'
      and source_path = 'approved_account_import'
      and source_reference is not null and length(trim(source_reference)) > 0)
    or
    (origin_kind = 'migrated'
      and onboarding_channel = 'migration'
      and source_path = 'approved_account_migration'
      and source_reference is not null and length(trim(source_reference)) > 0)
  )
);

create index if not exists account_origin_provenance_kind_idx
  on public.account_origin_provenance (origin_kind, recorded_at desc);
create index if not exists account_origin_provenance_tenant_idx
  on public.account_origin_provenance (tenant_id, recorded_at desc)
  where tenant_id is not null;

alter table public.account_origin_provenance enable row level security;
revoke all on table public.account_origin_provenance from public, anon, authenticated;
revoke update, delete, truncate on table public.account_origin_provenance from service_role;
grant select, insert on table public.account_origin_provenance to service_role;

drop policy if exists account_origin_provenance_service_read on public.account_origin_provenance;
create policy account_origin_provenance_service_read on public.account_origin_provenance
  for select to service_role using (true);
drop policy if exists account_origin_provenance_service_insert on public.account_origin_provenance;
create policy account_origin_provenance_service_insert on public.account_origin_provenance
  for insert to service_role with check (true);
drop policy if exists account_origin_provenance_admin_read on public.account_origin_provenance;
create policy account_origin_provenance_admin_read on public.account_origin_provenance
  for select to authenticated using (public.is_borderpay_admin());

create or replace function public.reject_account_origin_provenance_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'account_origin_provenance is immutable' using errcode = '42501';
end;
$$;

revoke all on function public.reject_account_origin_provenance_mutation() from public, anon, authenticated;

drop trigger if exists account_origin_provenance_immutable
  on public.account_origin_provenance;
create trigger account_origin_provenance_immutable
before update or delete on public.account_origin_provenance
for each row execute function public.reject_account_origin_provenance_mutation();

comment on table public.account_origin_provenance is
  'Immutable creation-origin record. Missing row means unknown; it never proves non-imported status.';
