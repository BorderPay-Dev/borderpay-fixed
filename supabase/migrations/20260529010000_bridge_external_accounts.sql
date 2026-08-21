-- bridge_external_accounts — customer payout (offramp) destinations.
--
-- A Bridge "external account" is a customer's own fiat bank account that
-- Bridge can pay OUT to (offramp). v1 covers two account types:
--   • us   — USD; ACH / ACH same-day / Wire all settle to the same
--            account_number + routing_number pair (rail is chosen at
--            transfer time, not here).
--   • iban — EUR; SEPA.
--
-- This table is a local mirror of the Bridge-side external account, keyed
-- by Bridge's id. It stores only non-sensitive descriptors (last_4, owner
-- name, currency, rail label) — never full account / routing / IBAN
-- numbers. Those live at Bridge.
--
-- RLS mirrors public.wallets / public.transactions:
--   • <table>_own  : a user can do anything with their own rows.
--   • admin_read_* : borderpay admins can read all.
--
-- NOTE: this migration is additive (new table only). It does not alter or
-- backfill any existing table. Reviewed-apply gated — do not auto-run.

create table if not exists public.bridge_external_accounts (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  bridge_external_account_id text not null,
  bridge_customer_id         text,
  account_type               text not null check (account_type in ('us','iban')),
  currency                   text not null check (currency in ('USD','EUR')),
  account_owner_name         text,
  account_owner_type         text check (account_owner_type in ('individual','business')),
  bank_name                  text,
  last_4                     text,
  -- Informational only: which payout rail(s) this destination supports.
  -- For 'us' this is typically 'ach' (also usable for ach_same_day / wire);
  -- for 'iban' it is 'sepa'. Not used for routing decisions here.
  rail                       text,
  status                     text not null default 'active',
  active                     boolean not null default true,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (bridge_external_account_id)
);

create index if not exists idx_bridge_external_accounts_user
  on public.bridge_external_accounts (user_id);

alter table public.bridge_external_accounts enable row level security;

-- Owner can SELECT/INSERT/UPDATE/DELETE their own rows. In practice writes
-- go through the service-role edge function, but ALL-scope keeps reads
-- working for the dashboard and matches the wallets/transactions pattern.
drop policy if exists external_accounts_own on public.bridge_external_accounts;
create policy external_accounts_own
  on public.bridge_external_accounts
  for all
  using (auth.uid() = user_id);

-- Admin read-all, mirrors admin_read_all_wallets / _transactions.
drop policy if exists admin_read_all_external_accounts on public.bridge_external_accounts;
create policy admin_read_all_external_accounts
  on public.bridge_external_accounts
  for select
  to authenticated
  using (is_borderpay_admin());

-- keep updated_at fresh on update (reuse existing touch_updated_at()).
drop trigger if exists trg_bridge_external_accounts_touch on public.bridge_external_accounts;
create trigger trg_bridge_external_accounts_touch
  before update on public.bridge_external_accounts
  for each row execute function public.touch_updated_at();
