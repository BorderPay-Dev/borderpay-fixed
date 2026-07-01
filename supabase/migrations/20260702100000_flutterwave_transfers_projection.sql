-- Flutterwave transfer projection + reconciliation state.
--
-- Keeps outbound payout lifecycle from Flutterwave idempotent and queryable
-- for reconciliation and transaction projection.

create table if not exists public.flutterwave_transfers (
  id                        uuid primary key default gen_random_uuid(),
  reference                 text not null unique,
  flutterwave_transfer_id   text,
  flutterwave_event_id      text,
  user_id                   uuid references auth.users(id) on delete set null,
  business_user_id          uuid references public.business_profiles(user_id) on delete set null,
  amount                    numeric(18,2),
  currency                  text,
  status                    text not null default 'pending'
                            check (status in ('pending','processing','completed','failed','cancelled')),
  provider_request_id       text,
  provider_http_status      integer,
  metadata                  jsonb not null default '{}'::jsonb,
  raw_payload               jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists flutterwave_transfers_user_idx
  on public.flutterwave_transfers (user_id, created_at desc)
  where user_id is not null;

create index if not exists flutterwave_transfers_business_user_idx
  on public.flutterwave_transfers (business_user_id, created_at desc)
  where business_user_id is not null;

create index if not exists flutterwave_transfers_status_idx
  on public.flutterwave_transfers (status, updated_at desc);

create index if not exists flutterwave_transfers_transfer_id_idx
  on public.flutterwave_transfers (flutterwave_transfer_id)
  where flutterwave_transfer_id is not null;

alter table public.flutterwave_transfers enable row level security;

drop policy if exists flutterwave_transfers_owner_read on public.flutterwave_transfers;
create policy flutterwave_transfers_owner_read
  on public.flutterwave_transfers
  for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);

drop policy if exists flutterwave_transfers_admin_read on public.flutterwave_transfers;
create policy flutterwave_transfers_admin_read
  on public.flutterwave_transfers
  for select
  to authenticated
  using (public.is_borderpay_admin());

drop policy if exists flutterwave_transfers_service_role on public.flutterwave_transfers;
create policy flutterwave_transfers_service_role
  on public.flutterwave_transfers
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_flutterwave_transfers_updated on public.flutterwave_transfers;
create trigger trg_flutterwave_transfers_updated
before update on public.flutterwave_transfers
for each row execute function public.set_updated_at();
