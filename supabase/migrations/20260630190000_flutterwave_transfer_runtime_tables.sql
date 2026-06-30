-- Flutterwave transfer runtime tables (Stage 1 backend conformance)
--
-- Purpose:
-- - Persist payout transfer lifecycle for reconciliation
-- - Persist webhook envelopes with idempotent event keys
-- - Enable deterministic status propagation without UI/provider mismatch

create table if not exists public.flutterwave_transfers (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  user_id               uuid references auth.users(id) on delete set null,
  direction             text not null default 'payout' check (direction in ('payout', 'receive')),
  reference             text,
  provider_transfer_id  text,
  source                text not null default 'flutterwave',
  idempotency_key       text,
  amount                numeric(20, 8),
  currency              text,
  destination_country   text,
  destination_currency  text,
  channel               text check (channel in ('bank', 'mobile_money')),
  status                text not null default 'submitted'
                         check (status in ('submitted', 'processing', 'completed', 'failed', 'reversed', 'unknown')),
  provider_status       text,
  request_payload       jsonb not null default '{}'::jsonb,
  provider_response     jsonb not null default '{}'::jsonb,
  metadata              jsonb not null default '{}'::jsonb,
  last_error            text,
  last_synced_at        timestamptz,
  webhook_last_event_id text
);

create unique index if not exists flw_transfers_reference_uq
  on public.flutterwave_transfers (reference)
  where reference is not null;

create unique index if not exists flw_transfers_provider_id_uq
  on public.flutterwave_transfers (provider_transfer_id)
  where provider_transfer_id is not null;

create index if not exists flw_transfers_user_idx
  on public.flutterwave_transfers (user_id, created_at desc);

create index if not exists flw_transfers_status_idx
  on public.flutterwave_transfers (status, updated_at desc);

create table if not exists public.flutterwave_webhook_events (
  id                   uuid primary key default gen_random_uuid(),
  event_id             text not null unique,
  event_type           text,
  signature_ok         boolean not null default false,
  payload              jsonb not null default '{}'::jsonb,
  payload_hash         text,
  headers              jsonb not null default '{}'::jsonb,
  transfer_reference   text,
  provider_transfer_id text,
  processing_status    text not null default 'received'
                        check (processing_status in ('received', 'processed', 'duplicate', 'failed', 'ignored')),
  processing_error     text,
  received_at          timestamptz not null default now(),
  processed_at         timestamptz
);

create index if not exists flw_webhook_status_idx
  on public.flutterwave_webhook_events (processing_status, received_at desc);

create index if not exists flw_webhook_transfer_ref_idx
  on public.flutterwave_webhook_events (transfer_reference);

create index if not exists flw_webhook_provider_id_idx
  on public.flutterwave_webhook_events (provider_transfer_id);

alter table public.flutterwave_transfers enable row level security;
alter table public.flutterwave_webhook_events enable row level security;

drop policy if exists flw_transfers_owner_read on public.flutterwave_transfers;
create policy flw_transfers_owner_read on public.flutterwave_transfers
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists flw_transfers_admin_read on public.flutterwave_transfers;
create policy flw_transfers_admin_read on public.flutterwave_transfers
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists flw_transfers_service_role on public.flutterwave_transfers;
create policy flw_transfers_service_role on public.flutterwave_transfers
  for all to service_role
  using (true) with check (true);

drop policy if exists flw_webhooks_admin_read on public.flutterwave_webhook_events;
create policy flw_webhooks_admin_read on public.flutterwave_webhook_events
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists flw_webhooks_service_role on public.flutterwave_webhook_events;
create policy flw_webhooks_service_role on public.flutterwave_webhook_events
  for all to service_role
  using (true) with check (true);
