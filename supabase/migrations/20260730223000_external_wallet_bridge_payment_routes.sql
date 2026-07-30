alter table public.external_wallets
  add column if not exists bridge_payment_route_id text,
  add column if not exists bridge_payment_route_status text,
  add column if not exists bridge_payment_route_raw jsonb,
  add column if not exists bridge_payment_route_created_at timestamptz,
  add column if not exists bridge_payment_route_error text;

create index if not exists external_wallets_bridge_payment_route_id_idx
  on public.external_wallets(bridge_payment_route_id)
  where bridge_payment_route_id is not null;

create index if not exists external_wallets_active_route_lookup_idx
  on public.external_wallets(user_id, asset, chain, address)
  where status = 'active';
