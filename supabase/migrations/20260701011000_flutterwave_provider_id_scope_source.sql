-- Scope provider transfer id uniqueness by source.
-- Prevents cross-provider collisions in shared transfer tables.

drop index if exists public.flw_transfers_provider_id_uq;

create unique index if not exists flw_transfers_source_provider_id_uq
  on public.flutterwave_transfers (source, provider_transfer_id)
  where source is not null and provider_transfer_id is not null;

