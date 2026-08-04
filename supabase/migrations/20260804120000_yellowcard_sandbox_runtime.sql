-- Yellow Card sandbox runtime persistence.
--
-- This table is intentionally admin/service-role only. Provider responses can
-- contain regulated identity and destination data and must not be exposed via
-- the user-facing PostgREST surface.

alter table public.provider_corridor_policy
  drop constraint if exists provider_corridor_policy_provider_check;

alter table public.provider_corridor_policy
  add constraint provider_corridor_policy_provider_check
  check (provider in ('bridge', 'yellow_card'));

create table if not exists public.yellowcard_transactions (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  user_id                  uuid references auth.users(id) on delete set null,
  environment              text not null default 'sandbox'
                           check (environment in ('sandbox', 'production')),
  direction                text not null check (direction in ('receive', 'payout')),
  sequence_id              text not null,
  provider_transaction_id  text,
  provider_reference       text,
  deposit_id               text,
  country_code             text not null,
  currency                 text not null,
  channel                  text not null check (channel in ('bank', 'mobile_money')),
  provider_channel_id      text not null,
  provider_network_id      text,
  local_amount             numeric(20, 8),
  usd_amount               numeric(20, 8),
  converted_amount         numeric(20, 8),
  settlement_currency      text,
  settlement_network       text,
  status                   text not null default 'submitted',
  provider_status          text,
  service_fee_local        numeric(20, 8),
  service_fee_usd          numeric(20, 8),
  network_fee_local        numeric(20, 8),
  network_fee_usd          numeric(20, 8),
  partner_fee_local        numeric(20, 8),
  partner_fee_usd          numeric(20, 8),
  request_payload          jsonb not null default '{}'::jsonb,
  provider_response        jsonb not null default '{}'::jsonb,
  metadata                 jsonb not null default '{}'::jsonb,
  last_error               text,
  last_synced_at           timestamptz
);

create unique index if not exists yellowcard_transactions_sequence_uq
  on public.yellowcard_transactions (environment, sequence_id);

create unique index if not exists yellowcard_transactions_provider_id_uq
  on public.yellowcard_transactions (environment, provider_transaction_id)
  where provider_transaction_id is not null;

create index if not exists yellowcard_transactions_user_idx
  on public.yellowcard_transactions (user_id, created_at desc);

create index if not exists yellowcard_transactions_status_idx
  on public.yellowcard_transactions (environment, status, updated_at desc);

alter table public.yellowcard_transactions enable row level security;

drop policy if exists yellowcard_transactions_admin_read on public.yellowcard_transactions;
create policy yellowcard_transactions_admin_read on public.yellowcard_transactions
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists yellowcard_transactions_service_role on public.yellowcard_transactions;
create policy yellowcard_transactions_service_role on public.yellowcard_transactions
  for all to service_role
  using (true) with check (true);

revoke all on table public.yellowcard_transactions from anon;
