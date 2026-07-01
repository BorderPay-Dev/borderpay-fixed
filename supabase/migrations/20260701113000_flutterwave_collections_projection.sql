-- Flutterwave collections projection + reconciliation.
--
-- Purpose:
-- - Persist initiated/updated collection lifecycle for idempotent reconciliation.
-- - Provide a stable lookup from tx_ref/collection_id -> user/account context.
-- - Keep projection reads provider-agnostic from public transactions/notifications.

create table if not exists public.flutterwave_collections (
  id                      uuid primary key default gen_random_uuid(),
  tx_ref                  text not null unique,
  flutterwave_collection_id text,
  flutterwave_event_id    text,
  user_id                 uuid references auth.users(id) on delete set null,
  business_user_id        uuid references public.business_profiles(user_id) on delete set null,
  amount                  numeric(18,2),
  currency                text,
  status                  text not null default 'pending'
                          check (status in ('pending','processing','completed','failed','cancelled')),
  provider_request_id     text,
  provider_http_status    integer,
  metadata                jsonb not null default '{}'::jsonb,
  raw_payload             jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists flutterwave_collections_user_idx
  on public.flutterwave_collections (user_id, created_at desc)
  where user_id is not null;

create index if not exists flutterwave_collections_business_user_idx
  on public.flutterwave_collections (business_user_id, created_at desc)
  where business_user_id is not null;

create index if not exists flutterwave_collections_status_idx
  on public.flutterwave_collections (status, updated_at desc);

create index if not exists flutterwave_collections_collection_id_idx
  on public.flutterwave_collections (flutterwave_collection_id)
  where flutterwave_collection_id is not null;

alter table public.flutterwave_collections enable row level security;

drop policy if exists flutterwave_collections_owner_read on public.flutterwave_collections;
create policy flutterwave_collections_owner_read
  on public.flutterwave_collections
  for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);

drop policy if exists flutterwave_collections_admin_read on public.flutterwave_collections;
create policy flutterwave_collections_admin_read
  on public.flutterwave_collections
  for select
  to authenticated
  using (public.is_borderpay_admin());

drop policy if exists flutterwave_collections_service_role on public.flutterwave_collections;
create policy flutterwave_collections_service_role
  on public.flutterwave_collections
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_flutterwave_collections_updated on public.flutterwave_collections;
create trigger trg_flutterwave_collections_updated
before update on public.flutterwave_collections
for each row execute function public.set_updated_at();
