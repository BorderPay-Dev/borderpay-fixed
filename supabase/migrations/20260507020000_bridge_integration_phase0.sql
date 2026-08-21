-- ============================================================================
-- 20260507_bridge_integration_phase0.sql
-- ----------------------------------------------------------------------------
-- Phase 0: ADDITIVE schema only. No Maplerad columns/policies dropped.
--
--   1. payment_provider enum + per-user routing column
--   2. Bridge customer / KYC fields on user_profiles
--   3. Bridge wallet / VA columns on wallets
--   4. Bridge transfer reference on transactions
--   5. bridge_webhook_events (idempotent receiver storage)
--   6. provider_migration_audit (provider switches)
--   7. provider_settings (ops feature flags + cards "Coming Soon")
--   8. Trigger: write provider_migration_audit on any payment_provider change
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    create type public.payment_provider as enum ('maplerad', 'bridge');
  end if;
end $$;

alter table public.user_profiles
  add column if not exists payment_provider public.payment_provider not null
    default 'maplerad'::public.payment_provider,
  add column if not exists bridge_customer_id     text,
  add column if not exists bridge_kyc_status      text
    check (bridge_kyc_status in ('not_started','pending','under_review','approved','rejected') or bridge_kyc_status is null),
  add column if not exists bridge_kyc_link_id     text,
  add column if not exists bridge_kyc_link_url    text,
  add column if not exists bridge_kyc_completed_at timestamptz,
  add column if not exists bridge_account_status  text,
  add column if not exists preferred_currencies   jsonb not null default '["USD"]'::jsonb;

create index if not exists user_profiles_bridge_customer_idx on public.user_profiles (bridge_customer_id) where bridge_customer_id is not null;
create index if not exists user_profiles_provider_idx        on public.user_profiles (payment_provider);

alter table public.wallets
  add column if not exists bridge_wallet_id          text,
  add column if not exists bridge_virtual_account_id text,
  add column if not exists asset_type                text
    check (asset_type in ('stablecoin','fiat_virtual_account','custodial') or asset_type is null),
  add column if not exists stablecoin_chain          text
    check (stablecoin_chain in ('ETH','SOL','BSC','POLYGON','TRON','BASE','OPTIMISM','ARBITRUM') or stablecoin_chain is null),
  add column if not exists provider                  public.payment_provider not null default 'maplerad';

create index if not exists wallets_bridge_wallet_idx on public.wallets (bridge_wallet_id) where bridge_wallet_id is not null;
create index if not exists wallets_bridge_va_idx     on public.wallets (bridge_virtual_account_id) where bridge_virtual_account_id is not null;

alter table public.transactions
  add column if not exists bridge_transfer_id text,
  add column if not exists provider           public.payment_provider not null default 'maplerad';

create index if not exists transactions_bridge_transfer_idx on public.transactions (bridge_transfer_id) where bridge_transfer_id is not null;

create table if not exists public.bridge_webhook_events (
  id                uuid        primary key default gen_random_uuid(),
  event_id          text        not null unique,
  event_type        text        not null,
  signature_ok      boolean     not null default false,
  payload           jsonb       not null,
  payload_hash      text        not null,
  processing_status text        not null default 'received'
                    check (processing_status in ('received','queued','processing','completed','failed','duplicate','rejected')),
  attempts          integer     not null default 0,
  last_error        text,
  pending_event_id  uuid,
  received_at       timestamptz not null default now(),
  queued_at         timestamptz,
  processed_at      timestamptz
);

create index if not exists bwe_status_idx on public.bridge_webhook_events (processing_status, received_at);
create index if not exists bwe_type_idx   on public.bridge_webhook_events (event_type);

alter table public.bridge_webhook_events enable row level security;
drop policy if exists bwe_service_role on public.bridge_webhook_events;
create policy bwe_service_role on public.bridge_webhook_events for all to service_role using (true) with check (true);
drop policy if exists bwe_admin_read   on public.bridge_webhook_events;
create policy bwe_admin_read   on public.bridge_webhook_events for select to authenticated using (public.is_borderpay_admin());

create table if not exists public.provider_migration_audit (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  from_provider public.payment_provider,
  to_provider   public.payment_provider not null,
  reviewer_id  uuid,
  reason       text,
  payload      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists pma_user_idx on public.provider_migration_audit (user_id, created_at desc);

alter table public.provider_migration_audit enable row level security;
drop policy if exists pma_owner_read    on public.provider_migration_audit;
create policy pma_owner_read    on public.provider_migration_audit for select to authenticated using (auth.uid() = user_id);
drop policy if exists pma_admin_read    on public.provider_migration_audit;
create policy pma_admin_read    on public.provider_migration_audit for select to authenticated using (public.is_borderpay_admin());
drop policy if exists pma_service_role  on public.provider_migration_audit;
create policy pma_service_role  on public.provider_migration_audit for all to service_role using (true) with check (true);

create table if not exists public.provider_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.provider_settings (key, value) values
  ('default_provider_for_new_signups', '"maplerad"'::jsonb),
  ('bridge.sandbox_mode',              'true'::jsonb),
  ('bridge.virtual_account.currencies','["USD","EUR","GBP"]'::jsonb),
  ('cards.enabled',                    'false'::jsonb),
  ('cards.coming_soon_message',        '"Card issuance is launching soon. Stay tuned."'::jsonb)
on conflict (key) do nothing;

alter table public.provider_settings enable row level security;
drop policy if exists ps_admin_read    on public.provider_settings;
create policy ps_admin_read    on public.provider_settings for select to authenticated using (public.is_borderpay_admin());
drop policy if exists ps_service_role  on public.provider_settings;
create policy ps_service_role  on public.provider_settings for all to service_role using (true) with check (true);
drop policy if exists ps_public_user_facing on public.provider_settings;
create policy ps_public_user_facing on public.provider_settings for select to authenticated
  using (key like 'cards.%' or key like 'public.%');

create or replace function public.audit_provider_migration()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.payment_provider is distinct from OLD.payment_provider then
    insert into public.provider_migration_audit (user_id, from_provider, to_provider, reviewer_id, payload)
    values (NEW.id, OLD.payment_provider, NEW.payment_provider, auth.uid(),
            jsonb_build_object(
              'bridge_customer_id',   NEW.bridge_customer_id,
              'maplerad_customer_id', NEW.maplerad_customer_id));
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_audit_provider_migration on public.user_profiles;
create trigger trg_audit_provider_migration
  after update of payment_provider on public.user_profiles
  for each row execute function public.audit_provider_migration();
