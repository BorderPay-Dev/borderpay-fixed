-- Add provider traceability fields for Flutterwave transfer runtime.

alter table if exists public.flutterwave_transfers
  add column if not exists provider_request_id text,
  add column if not exists provider_http_status integer;

create index if not exists flw_transfers_provider_request_id_idx
  on public.flutterwave_transfers (provider_request_id)
  where provider_request_id is not null;

