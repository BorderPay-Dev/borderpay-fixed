-- Add staleness/lag observability fields to Flutterwave projection tables.
-- These fields let ops detect missing webhook propagation versus provider-poll updates.

alter table if exists public.flutterwave_collections
  add column if not exists last_provider_status_at timestamptz,
  add column if not exists last_webhook_event_at timestamptz;

alter table if exists public.flutterwave_transfers
  add column if not exists last_provider_status_at timestamptz,
  add column if not exists last_webhook_event_at timestamptz;

create index if not exists flutterwave_collections_provider_status_idx
  on public.flutterwave_collections (last_provider_status_at desc);

create index if not exists flutterwave_collections_webhook_status_idx
  on public.flutterwave_collections (last_webhook_event_at desc);

create index if not exists flutterwave_transfers_provider_status_idx
  on public.flutterwave_transfers (last_provider_status_at desc);

create index if not exists flutterwave_transfers_webhook_status_idx
  on public.flutterwave_transfers (last_webhook_event_at desc);
