-- Saved external stablecoin wallet addresses (Rise.works-style direct payout).
--
-- A user saves their own external address (e.g. their Binance USDC/Base address)
-- once, then withdraws to it from inside the app — gated by passcode/biometric,
-- routed through the existing Bridge stablecoin transfer. No FX, no float.

create table if not exists public.external_wallets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,
  chain       text not null,                 -- base|ethereum|polygon|arbitrum|optimism|tron|solana
  asset       text not null,                 -- USDC|USDT
  address     text not null,
  status      text not null default 'active', -- active|removed
  created_at  timestamptz not null default now(),
  unique (user_id, chain, address)
);

alter table public.external_wallets enable row level security;

-- Owner can read their own saved wallets (lets the screen read + cache directly).
drop policy if exists external_wallets_select_own on public.external_wallets;
create policy external_wallets_select_own on public.external_wallets
  for select using (auth.uid() = user_id);

-- Writes go through the service-role edge function (server-side address
-- validation), so no INSERT/UPDATE/DELETE policy for end users.
