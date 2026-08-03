-- Flutterwave V4 payout reconciliation fields. Provider payloads remain in
-- provider_response; these columns make operational reconciliation queryable.
alter table if exists public.flutterwave_transfers
  add column if not exists provider_trace_id text,
  add column if not exists provider_recipient_id text,
  add column if not exists provider_fee_amount numeric,
  add column if not exists provider_fee_currency text;

create index if not exists flutterwave_transfers_provider_trace_idx
  on public.flutterwave_transfers (provider_trace_id)
  where provider_trace_id is not null;

create index if not exists flutterwave_transfers_provider_recipient_idx
  on public.flutterwave_transfers (provider_recipient_id)
  where provider_recipient_id is not null;
