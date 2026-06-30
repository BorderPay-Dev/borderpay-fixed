-- Scope Flutterwave transfer idempotency to user + reference.
-- Prevents accidental cross-user collisions on globally-shared reference values.

drop index if exists public.flw_transfers_reference_uq;

create unique index if not exists flw_transfers_user_reference_uq
  on public.flutterwave_transfers (user_id, reference)
  where user_id is not null and reference is not null;

