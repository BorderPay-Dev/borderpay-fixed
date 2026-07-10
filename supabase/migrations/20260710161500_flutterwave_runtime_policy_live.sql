-- Flutterwave runtime + validated 2026 corridor policy live patch.
--
-- This migration is intentionally isolated from older pending migrations because
-- production already has Flutterwave edge functions deployed, but not the DB
-- tables/policy they require. Runtime remains fail-closed through function env
-- flags and static-egress guards.

begin;

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
  webhook_last_event_id text,
  provider_request_id   text,
  provider_http_status  integer
);

create unique index if not exists flw_transfers_user_source_reference_uq
  on public.flutterwave_transfers (user_id, source, reference)
  where user_id is not null and source is not null and reference is not null;

create unique index if not exists flw_transfers_source_provider_id_uq
  on public.flutterwave_transfers (source, provider_transfer_id)
  where source is not null and provider_transfer_id is not null;

create index if not exists flw_transfers_user_idx
  on public.flutterwave_transfers (user_id, created_at desc);

create index if not exists flw_transfers_status_idx
  on public.flutterwave_transfers (status, updated_at desc);

create index if not exists flw_transfers_provider_request_id_idx
  on public.flutterwave_transfers (provider_request_id)
  where provider_request_id is not null;

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

create table if not exists public.provider_corridor_policy (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  provider              text not null check (provider in ('bridge', 'flutterwave')),
  direction             text not null check (direction in ('receive', 'payout', 'fx')),
  country_code          text not null,
  source_currency       text,
  destination_currency  text,
  channel               text check (channel in ('bank', 'mobile_money', 'wallet')),
  enabled               boolean not null default true,
  requires_bridge_kyc   boolean not null default true,
  priority              integer not null default 100,
  notes                 text
);

create unique index if not exists provider_corridor_policy_uq
  on public.provider_corridor_policy (
    provider,
    direction,
    country_code,
    coalesce(source_currency, ''),
    coalesce(destination_currency, ''),
    coalesce(channel, '')
  );

create index if not exists provider_corridor_policy_lookup_idx
  on public.provider_corridor_policy (
    provider,
    direction,
    country_code,
    enabled,
    priority desc
  );

alter table public.flutterwave_transfers enable row level security;
alter table public.flutterwave_webhook_events enable row level security;
alter table public.provider_corridor_policy enable row level security;

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

drop policy if exists provider_corridor_policy_service_role on public.provider_corridor_policy;
create policy provider_corridor_policy_service_role on public.provider_corridor_policy
  for all to service_role
  using (true) with check (true);

drop policy if exists provider_corridor_policy_admin_read on public.provider_corridor_policy;
create policy provider_corridor_policy_admin_read on public.provider_corridor_policy
  for select to authenticated
  using (public.is_borderpay_admin());

delete from public.provider_corridor_policy
where provider = 'flutterwave';

insert into public.provider_corridor_policy
  (provider, direction, country_code, destination_currency, channel, enabled, requires_bridge_kyc, priority, notes)
values
  -- Collections selected for Flutterwave from the validated commercial fee map.
  ('flutterwave', 'receive', 'EG', 'EGP', 'bank', true, true, 300, 'bp_2026_fw_validated_collection_bank'),
  ('flutterwave', 'receive', 'GH', 'GHS', 'bank', true, true, 300, 'bp_2026_fw_validated_collection_bank'),
  ('flutterwave', 'receive', 'GH', 'GHS', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_collection_mobile_money'),
  ('flutterwave', 'receive', 'MW', 'MWK', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_collection_mobile_money'),
  ('flutterwave', 'receive', 'SN', 'XOF', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_collection_mobile_money'),

  -- Payouts selected for Flutterwave from the validated commercial fee map.
  ('flutterwave', 'payout', 'CM', 'XAF', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'CM', 'XAF', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_payout_mobile_money'),
  ('flutterwave', 'payout', 'CF', 'XAF', 'bank', false, true, 300, 'bp_2026_fw_validated_payout_bank_pending'),
  ('flutterwave', 'payout', 'TD', 'XAF', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'GA', 'XAF', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'GH', 'GHS', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'GH', 'GHS', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_payout_mobile_money'),
  ('flutterwave', 'payout', 'CI', 'XOF', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'KE', 'KES', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'KE', 'KES', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_payout_mobile_money'),
  ('flutterwave', 'payout', 'NG', 'NGN', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'RW', 'RWF', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'RW', 'RWF', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_payout_mobile_money'),
  ('flutterwave', 'payout', 'SN', 'XOF', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'ZA', 'ZAR', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'TZ', 'TZS', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'TZ', 'TZS', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_payout_mobile_money'),
  ('flutterwave', 'payout', 'UG', 'UGX', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank'),
  ('flutterwave', 'payout', 'UG', 'UGX', 'mobile_money', true, true, 300, 'bp_2026_fw_validated_payout_mobile_money'),
  ('flutterwave', 'payout', 'EG', 'EGP', 'bank', true, true, 300, 'bp_2026_fw_validated_payout_bank')
on conflict do nothing;

commit;
