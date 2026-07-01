-- Harden Flutterwave idempotency key scope to include provider source.
-- This prevents cross-provider collisions if another adapter reuses user+reference.

drop index if exists public.flw_transfers_user_reference_uq;

create unique index if not exists flw_transfers_user_source_reference_uq
  on public.flutterwave_transfers (user_id, source, reference)
  where user_id is not null and source is not null and reference is not null;

