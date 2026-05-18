-- ============================================================================
-- BorderPay Africa — Supabase canonical schema
-- ----------------------------------------------------------------------------
-- This file is a SOURCE-CONTROLLED SNAPSHOT of the production schema. It
-- intentionally aligns with what is actually deployed (public.user_profiles,
-- public.users, public.kyc_submissions, etc.) — NOT the historical
-- public.profiles draft that lived here before.
--
-- For day-to-day schema changes use a timestamped file in
-- /supabase/migrations/. This snapshot exists so a fresh project can be
-- spun up cleanly + so reviewers can see the truthful target.
--
-- Reading order:
--   1. Extensions
--   2. Helper functions / enums
--   3. user_profiles  (canonical profile table — read by every app surface)
--   4. users          (legacy profile mirror — kept in sync via trigger)
--   5. business_profiles
--   6. wallets / transactions / cards / kyc_submissions / kyc_documents
--   7. RLS policies
--   8. Triggers (sync, guards, mirrors)
--   9. Compatibility view: public.profiles → public.user_profiles
-- ============================================================================

-- ─── 1. Extensions ───────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── 2. Enums ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum ('individual', 'business');
  end if;
  if not exists (select 1 from pg_type where typname = 'kyc_status') then
    create type public.kyc_status as enum ('unverified','pending','submitted','under_review','verified','approved','rejected','failed');
  end if;
end $$;

-- ─── 3. user_profiles (CANONICAL) ────────────────────────────────────────────
-- Used by every app surface (Dashboard, Profile, KYC, Cards, Wallets, etc.)
-- and by every deployed edge function. Treat as the single source of truth.
create table if not exists public.user_profiles (
  id                              uuid        primary key references auth.users(id) on delete cascade,
  email                           text        not null,
  full_name                       text,
  phone                           text,
  country                         text,
  account_type                    public.account_type not null default 'individual',
  kyc_status                      public.kyc_status   not null default 'unverified',
  kyc_level                       integer     not null default 0,
  maplerad_customer_id            text,
  is_admin                        boolean     not null default false,
  address                         text,
  city                            text,
  state                           text,
  postal_code                     text,
  date_of_birth                   date,
  language                        text        default 'en',
  profile_picture_url             text,
  address_verification_status     text        default 'none',
  kyc_verified_at                 timestamptz,
  id_number                       text,
  gender                          text,
  maplerad_status                 text,
  account_status                  text,
  enrolled_at                     timestamptz,
  maplerad_sandbox_customer_id    text,
  maplerad_tier                   smallint,
  maplerad_tier0_enrolled_at      timestamptz,
  maplerad_tier2_enrolled_at      timestamptz,
  tier0_email_sent_at             timestamptz,
  admin_kyc_approved_at           timestamptz,
  admin_kyc_reviewer              uuid,
  admin_kyc_decision              text,
  admin_kyc_notes                 text,
  maplerad_environment            text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- ─── 4. users (legacy mirror; kept in sync by trigger) ───────────────────────
create table if not exists public.users (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  full_name            text,
  phone                text,
  country              text,
  account_type         public.account_type not null default 'individual',
  kyc_status           public.kyc_status   default 'unverified',
  wallet_activated     boolean default false,
  maplerad_customer_id text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- ─── 5. business_profiles ────────────────────────────────────────────────────
create table if not exists public.business_profiles (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null unique references auth.users(id) on delete cascade,
  company_name         text        not null,
  registration_number  text,
  country              text,
  company_email        text,
  company_phone        text,
  industry             text,
  website              text,
  address              text,
  city                 text,
  state                text,
  postal_code          text,
  status               text        not null default 'active'
                        check (status in ('active','suspended','closed')),
  metadata             jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ─── 6. wallets / transactions / cards / kyc_documents / kyc_submissions ─────
-- These tables already exist in production with their full shape. Re-creating
-- them here exactly is unnecessary (and risks divergence). Refer to the
-- migration files in /supabase/migrations for column-level history.

-- ─── 6a. user_security (PIN / TOTP / WebAuthn pivot) ────────────────────────
-- Authoritative server-side store for security factors. The previous
-- client-side flow stored hashes/secrets in localStorage; that is gone.
-- See migrations 20260518_user_security_hardening.sql and
-- 20260518_webauthn_credentials.sql for the canonical DDL.
create table if not exists public.user_security (
  user_id                       uuid        primary key references auth.users(id) on delete cascade,
  -- PIN
  pin_set                       boolean     not null default false,
  pin_hash                      text,                                -- legacy: single-round SHA-256 (pin || user.id). Lazy-upgraded on verify.
  pin_hash_v2                   text,                                -- v2: 'v2$' || base64(salt) || '$' || base64(pbkdf2-sha256(pin, salt, 100000))
  pin_failed_attempts           smallint    not null default 0,      -- consecutive failures
  pin_locked_until              timestamptz,                         -- non-null → verify-pin returns 423 locked
  pin_updated_at                timestamptz not null default now(),
  -- TOTP
  two_factor_enabled            boolean     not null default false,
  two_factor_secret             text,                                -- legacy plaintext (read-fallback during rollout; setup-2fa fails closed without key)
  two_factor_secret_encrypted   bytea,                               -- AES-256-GCM: 12-byte IV || ciphertext || 16-byte tag. Key = TOTP_ENCRYPTION_KEY env.
  two_factor_enc_version        smallint    default 1,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index if not exists user_security_pin_locked_until_idx
  on public.user_security (pin_locked_until)
 where pin_locked_until is not null;
alter table public.user_security enable row level security;
drop policy if exists user_security_owner          on public.user_security;
create policy user_security_owner          on public.user_security
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists user_security_service_role   on public.user_security;
create policy user_security_service_role   on public.user_security
  for all to service_role using (true) with check (true);

-- ─── 6b. webauthn_credentials / webauthn_challenges ─────────────────────────
-- Server-verified platform-authenticator credentials. The 4 edge functions
-- under /supabase/functions/webauthn-* persist and verify against these
-- tables using @simplewebauthn/server.
create table if not exists public.webauthn_credentials (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  credential_id   text        not null unique,                       -- base64url
  public_key      text        not null,                              -- base64url COSE
  counter         bigint      not null default 0,                    -- RFC 8809 monotonic counter
  transports      text[]      not null default '{}'::text[],
  device_type     text,                                              -- 'platform' | 'cross-platform'
  backed_up       boolean     not null default false,
  nickname        text,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);
create index if not exists webauthn_credentials_user_idx on public.webauthn_credentials (user_id);
alter table public.webauthn_credentials enable row level security;
drop policy if exists webauthn_owner_read   on public.webauthn_credentials;
create policy webauthn_owner_read   on public.webauthn_credentials for select to authenticated using (auth.uid() = user_id);
drop policy if exists webauthn_owner_delete on public.webauthn_credentials;
create policy webauthn_owner_delete on public.webauthn_credentials for delete to authenticated using (auth.uid() = user_id);
drop policy if exists webauthn_service_role on public.webauthn_credentials;
create policy webauthn_service_role on public.webauthn_credentials for all to service_role using (true) with check (true);

create table if not exists public.webauthn_challenges (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references auth.users(id) on delete cascade,
  challenge       text        not null,                              -- base64url
  purpose         text        not null check (purpose in ('register','authenticate')),
  rp_id           text        not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists webauthn_challenges_expires_idx
  on public.webauthn_challenges (expires_at)
 where consumed_at is null;
alter table public.webauthn_challenges enable row level security;
drop policy if exists webauthn_chal_service_role on public.webauthn_challenges;
create policy webauthn_chal_service_role on public.webauthn_challenges
  for all to service_role using (true) with check (true);

-- ─── 7. RLS policies (canonical, summary) ────────────────────────────────────
alter table public.user_profiles      enable row level security;
alter table public.users              enable row level security;
alter table public.business_profiles  enable row level security;

-- user_profiles
drop policy if exists profiles_own              on public.user_profiles;
create policy profiles_own              on public.user_profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists admin_read_all_profiles   on public.user_profiles;
create policy admin_read_all_profiles   on public.user_profiles for select to authenticated
  using (public.is_borderpay_admin());
drop policy if exists admin_update_profiles     on public.user_profiles;
create policy admin_update_profiles     on public.user_profiles for update to authenticated
  using (public.is_borderpay_admin())
  with check (public.is_borderpay_admin());

-- business_profiles  (LOCKED DOWN — see migration 20260507_lock_down_business_promotion.sql)
--
--   • SELECT/UPDATE for owner
--   • ALL  for admin (is_borderpay_admin) and service_role
--   • NO  INSERT for owner. Authenticated users CANNOT create their own
--          business_profiles row directly. INSERT goes through:
--            – `auth-signup` v87 (service_role)
--            – `complete_business_signup(...)` SECURITY DEFINER RPC
--              (signup-window guarded)
--            – `admin_promote_to_business(...)` SECURITY DEFINER RPC
--              (admin only)
drop policy if exists business_profiles_owner_select  on public.business_profiles;
create policy business_profiles_owner_select  on public.business_profiles for select to authenticated using (auth.uid() = user_id);

-- Explicitly drop any legacy owner-INSERT policy so a fresh-project apply
-- of this snapshot lands in the same locked-down state as production.
drop policy if exists business_profiles_owner_insert  on public.business_profiles;

drop policy if exists business_profiles_owner_update  on public.business_profiles;
create policy business_profiles_owner_update  on public.business_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists business_profiles_admin_all     on public.business_profiles;
create policy business_profiles_admin_all     on public.business_profiles for all to authenticated using (public.is_borderpay_admin()) with check (public.is_borderpay_admin());

drop policy if exists business_profiles_service_role  on public.business_profiles;
create policy business_profiles_service_role  on public.business_profiles for all to service_role using (true) with check (true);

-- ─── 8. updated_at touch helper (used by multiple triggers) ──────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin NEW.updated_at = now(); return NEW; end; $$;

drop trigger if exists trg_user_profiles_touch on public.user_profiles;
create trigger trg_user_profiles_touch     before update on public.user_profiles     for each row execute function public.touch_updated_at();
drop trigger if exists trg_business_profiles_touch on public.business_profiles;
create trigger trg_business_profiles_touch before update on public.business_profiles for each row execute function public.touch_updated_at();

-- ─── 9. Compatibility view: legacy `public.profiles` -> public.user_profiles
-- Some older code paths may still reference public.profiles. The view keeps
-- them functional WITHOUT writing to a separate table — every read reflects
-- canonical user_profiles state.
do $$
begin
  if exists (select 1 from pg_class where relname = 'profiles' and relkind = 'r') then
    raise notice 'public.profiles is a TABLE — leaving it alone (legacy data).';
  else
    -- create a view if neither table nor view exists
    if not exists (select 1 from pg_class where relname = 'profiles' and relkind = 'v') then
      execute 'create view public.profiles as
        select id, full_name, phone, country,
               kyc_status::text, account_type::text,
               profile_picture_url,
               created_at, updated_at
          from public.user_profiles';
    end if;
  end if;
end $$;

-- ============================================================================
-- For the full set of triggers (sync_account_type_to_business,
-- guard_user_profile_account_type, mirror_user_profile_to_users,
-- is_borderpay_admin), see migrations/20260507_account_type_business_profiles.sql
-- and migrations/20260409_fix_rls_admin_policies.sql.
-- ============================================================================
