-- ============================================================================
-- 20260510_bridge_phase1_first_class_tables.sql
-- ----------------------------------------------------------------------------
-- Phase 1: first-class Bridge tables. ADDITIVE only — no Maplerad columns
-- dropped, no `wallets.virtual_account_number` overloaded for crypto.
--
--   1. business_profiles: Bridge KYB columns
--   2. bridge_virtual_accounts: USD/EUR/GBP virtual accounts (one row per VA)
--   3. bridge_wallets:          custodial stablecoin wallets
--   4. bridge_transfers:        Bridge transfer state mirror
--   5. RLS policies on all three (owner read; service role full; admin read)
--   6. Index for webhook → entity backlink
-- ============================================================================

-- ── 1. business_profiles: KYB columns ──────────────────────────────────────
alter table public.business_profiles
  add column if not exists bridge_customer_id      text,
  add column if not exists bridge_kyb_status       text
    check (bridge_kyb_status in ('not_started','pending','under_review','approved','rejected') or bridge_kyb_status is null),
  add column if not exists bridge_kyb_link_id      text,
  add column if not exists bridge_kyb_link_url     text,
  add column if not exists bridge_kyb_completed_at timestamptz,
  add column if not exists updated_at              timestamptz not null default now();

create index if not exists business_profiles_bridge_customer_idx
  on public.business_profiles (bridge_customer_id) where bridge_customer_id is not null;

-- ── 2. bridge_virtual_accounts ─────────────────────────────────────────────
-- Note on naming: `business_user_id` (not `business_profile_id`) intentionally
-- mirrors the value it stores — auth.uid of the business owner — which equals
-- business_profiles.user_id (1:1). Lets RLS check `auth.uid() = business_user_id`
-- directly without a sub-select.
create table if not exists public.bridge_virtual_accounts (
  id                          uuid        primary key default gen_random_uuid(),
  user_id                     uuid        references auth.users(id) on delete cascade,
  business_user_id            uuid        references public.business_profiles(user_id) on delete cascade,
  bridge_customer_id          text        not null,
  bridge_virtual_account_id   text        not null unique,
  currency                    text        not null
    check (currency in ('USD','EUR','GBP')),
  rail                        text
    check (rail in ('ach_push','ach_pull','wire','sepa','faster_payments') or rail is null),
  account_details             jsonb       not null default '{}'::jsonb,  -- bank/routing/iban/bic
  status                      text        not null default 'active'
    check (status in ('active','suspended','closed')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint bva_owner_xor check ((user_id is not null) or (business_user_id is not null))
);

create index if not exists bva_user_idx     on public.bridge_virtual_accounts (user_id) where user_id is not null;
create index if not exists bva_business_idx on public.bridge_virtual_accounts (business_user_id) where business_user_id is not null;
create index if not exists bva_customer_idx on public.bridge_virtual_accounts (bridge_customer_id);
create index if not exists bva_currency_idx on public.bridge_virtual_accounts (currency);

alter table public.bridge_virtual_accounts enable row level security;
drop policy if exists bva_owner_read     on public.bridge_virtual_accounts;
create policy bva_owner_read     on public.bridge_virtual_accounts for select to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);
drop policy if exists bva_admin_read     on public.bridge_virtual_accounts;
create policy bva_admin_read     on public.bridge_virtual_accounts for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bva_service_role   on public.bridge_virtual_accounts;
create policy bva_service_role   on public.bridge_virtual_accounts for all to service_role using (true) with check (true);

-- ── 3. bridge_wallets (custodial stablecoin) ───────────────────────────────
create table if not exists public.bridge_wallets (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        references auth.users(id) on delete cascade,
  business_user_id    uuid        references public.business_profiles(user_id) on delete cascade,
  bridge_customer_id  text        not null,
  bridge_wallet_id    text        not null unique,
  currency            text        not null,                        -- e.g. 'usdc','usdt','eurc'
  chain               text        not null,                        -- e.g. 'base','ethereum','solana','polygon','arbitrum'
  address             text        not null,
  status              text        not null default 'active'
    check (status in ('active','suspended','closed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bw_owner_xor check ((user_id is not null) or (business_user_id is not null))
);

create index if not exists bw_user_idx     on public.bridge_wallets (user_id) where user_id is not null;
create index if not exists bw_business_idx on public.bridge_wallets (business_user_id) where business_user_id is not null;
create index if not exists bw_customer_idx on public.bridge_wallets (bridge_customer_id);
create index if not exists bw_addr_idx     on public.bridge_wallets (address);

alter table public.bridge_wallets enable row level security;
drop policy if exists bw_owner_read     on public.bridge_wallets;
create policy bw_owner_read     on public.bridge_wallets for select to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);
drop policy if exists bw_admin_read     on public.bridge_wallets;
create policy bw_admin_read     on public.bridge_wallets for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bw_service_role   on public.bridge_wallets;
create policy bw_service_role   on public.bridge_wallets for all to service_role using (true) with check (true);

-- ── 4. bridge_transfers ────────────────────────────────────────────────────
create table if not exists public.bridge_transfers (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        references auth.users(id) on delete cascade,
  business_user_id    uuid        references public.business_profiles(user_id) on delete cascade,
  bridge_transfer_id  text        not null unique,
  source_type         text        not null
    check (source_type in ('virtual_account','wallet','external_bank','external_wallet')),
  destination_type    text        not null
    check (destination_type in ('virtual_account','wallet','external_bank','external_wallet')),
  amount              numeric(38,18) not null,
  currency            text        not null,
  state               text        not null default 'pending'
    check (state in ('pending','processing','succeeded','failed','cancelled','refunded','returned')),
  raw                 jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bt_owner_xor check ((user_id is not null) or (business_user_id is not null))
);

create index if not exists bt_user_idx     on public.bridge_transfers (user_id) where user_id is not null;
create index if not exists bt_business_idx on public.bridge_transfers (business_user_id) where business_user_id is not null;
create index if not exists bt_state_idx    on public.bridge_transfers (state, created_at desc);

alter table public.bridge_transfers enable row level security;
drop policy if exists bt_owner_read     on public.bridge_transfers;
create policy bt_owner_read     on public.bridge_transfers for select to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);
drop policy if exists bt_admin_read     on public.bridge_transfers;
create policy bt_admin_read     on public.bridge_transfers for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bt_service_role   on public.bridge_transfers;
create policy bt_service_role   on public.bridge_transfers for all to service_role using (true) with check (true);

-- ── 5. webhook backlink: which entity a Bridge event mutated ───────────────
alter table public.bridge_webhook_events
  add column if not exists target_entity_type text
    check (target_entity_type in ('customer','virtual_account','wallet','transfer','kyc_link') or target_entity_type is null),
  add column if not exists target_entity_id   text;

create index if not exists bwe_target_idx
  on public.bridge_webhook_events (target_entity_type, target_entity_id)
  where target_entity_id is not null;

-- ── 6. updated_at triggers ─────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin NEW.updated_at = now(); return NEW; end;
$$;

drop trigger if exists trg_bva_updated on public.bridge_virtual_accounts;
create trigger trg_bva_updated before update on public.bridge_virtual_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_bw_updated on public.bridge_wallets;
create trigger trg_bw_updated before update on public.bridge_wallets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_bt_updated on public.bridge_transfers;
create trigger trg_bt_updated before update on public.bridge_transfers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_bp_updated on public.business_profiles;
create trigger trg_bp_updated before update on public.business_profiles
  for each row execute function public.set_updated_at();

-- Note: we do NOT flip default_provider_for_new_signups here. That flip is a
-- separate, controlled operation done via SQL after Bridge has run clean for
-- ≥ 24h on the allowlist.
