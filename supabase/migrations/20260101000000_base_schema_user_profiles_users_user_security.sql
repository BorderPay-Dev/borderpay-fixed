-- 20260101_base_schema_user_profiles_users_user_security
--
-- Baseline schema. The migration set in this directory previously
-- started at 20260320 with `ALTER TABLE public.user_profiles ...`
-- statements, but no file in the directory actually CREATEd the base
-- tables — they were created in production through Supabase dashboard
-- DDL prior to migrations being version-controlled. A fresh project
-- replay (`psql -f supabase/migrations/*.sql` in lexicographic order)
-- would fail at the first ALTER because the tables did not exist.
--
-- This file declares the baseline as the migration set's earliest
-- entry. Every statement is `IF NOT EXISTS`, so it is a no-op on the
-- live DB (the migration runner records it as applied without
-- modifying any row) and only takes effect when a clean project is
-- being provisioned from migrations.
--
-- Live shape was captured from production information_schema on
-- 2026-05-19. Round-5 CTO feedback flagged that the previous baseline
-- omitted three things that prevent a clean replay producing the
-- live shape — fixed in this revision:
--
--   1. Trigger functions created by 20260507_account_type_business_profiles.sql
--      (`mirror_user_profile_to_users`) and
--      20260507_bridge_integration_phase0.sql (`audit_provider_migration`)
--      both reference NEW.maplerad_customer_id. On a fresh replay
--      those functions exist BEFORE the 20260518 sweep, so the trigger
--      target column must exist for the same window — added as a
--      transitional column on both `users` and `user_profiles`. The
--      20260518_maplerad_triggers_sweep migration drops it again at
--      the right point in history.
--
--   2. Live `user_security` has `id uuid PRIMARY KEY DEFAULT
--      gen_random_uuid()` and a UNIQUE constraint on `user_id`, NOT
--      `user_id PRIMARY KEY` as the previous baseline declared.
--      Captured from live `pg_constraint`.
--
--   3. The `kyc_status` enum live carries 6 values, not the 8 that
--      `utils/supabase/schema.sql` previously aspirated. `submitted`
--      and `under_review` were never created in production and no
--      migration adds them; removed from schema.sql in the same
--      round, so the baseline now matches what `schema.sql` declares.
--
-- Subsequent migrations in this directory then ADD/DROP columns on
-- top of this baseline, exactly as they have already been applied to
-- production.

-- ─── Enums ─────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum ('individual', 'business');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'kyc_status') then
    create type public.kyc_status as enum (
      'unverified',
      'pending',
      'verified',
      'failed',
      'approved',
      'rejected'
    );
  end if;
end $$;

-- ─── public.users ──────────────────────────────────────────────────────
-- Legacy "users" mirror table. The canonical identity row is
-- public.user_profiles; this exists for downstream code that joins
-- against a flatter shape. Mirror is kept by triggers (see
-- 20260507_account_type_business_profiles.sql and the cleanup in
-- 20260518_maplerad_triggers_sweep.sql).
--
-- maplerad_customer_id is declared transitionally so the mirror
-- trigger created by 20260507_account_type_business_profiles.sql can
-- compile and execute against this table during the migration window
-- between 20260507 and 20260518. The 20260518 sweep drops it.
create table if not exists public.users (
  id                   uuid                                  primary key references auth.users(id) on delete cascade,
  email                text                                  not null,
  full_name            text,
  phone                text,
  country              text,
  account_type         public.account_type                   not null default 'individual'::public.account_type,
  kyc_status           public.kyc_status                              default 'unverified'::public.kyc_status,
  wallet_activated     boolean                                        default false,
  maplerad_customer_id text,                                 -- TRANSITIONAL: dropped by 20260518_maplerad_triggers_sweep
  created_at           timestamptz                                    default now(),
  updated_at           timestamptz                                    default now()
);
-- Note: users.bridge_customer_id is added later via
-- 20260519_schema_reconcile_bridge_partner_columns.sql so that any
-- pre-existing clones that already had this column get a no-op upgrade.

-- ─── public.user_profiles ──────────────────────────────────────────────
-- Canonical identity + KYC + partner-routing surface. Most application
-- code reads from here. Subsequent migrations add Bridge partner
-- columns, hardening fields, and constraints; this declaration is the
-- foundation those ALTERs build on.
--
-- Nullability captured from live: most descriptive columns are
-- nullable. The `account_type` + `is_admin` columns are NOT NULL with
-- defaults; everything else is permissive. schema.sql previously
-- declared NOT NULL on email/kyc_status/kyc_level/created_at/
-- updated_at — that was aspirational and never deployed; fixed in
-- schema.sql in this round to match live.
--
-- maplerad_customer_id is transitional (see public.users comment
-- above). Dropped by 20260518_maplerad_triggers_sweep.
create table if not exists public.user_profiles (
  id                          uuid                                  primary key references auth.users(id) on delete cascade,
  email                       text,
  full_name                   text,
  phone                       text,
  country                     text,
  account_type                public.account_type                   not null default 'individual'::public.account_type,
  kyc_status                  public.kyc_status                              default 'unverified'::public.kyc_status,
  kyc_level                   integer                                        default 0,
  maplerad_customer_id        text,                                 -- TRANSITIONAL: dropped by 20260518_maplerad_triggers_sweep
  address                     text,
  city                        text,
  state                       text,
  postal_code                 text,
  date_of_birth               date,
  language                    text                                           default 'en'::text,
  profile_picture_url         text,
  address_verification_status text                                           default 'none'::text,
  created_at                  timestamptz                                    default now(),
  updated_at                  timestamptz                                    default now(),
  kyc_verified_at             timestamptz,
  id_number                   text,
  gender                      text,
  account_status              text                                           default 'pending_kyc'::text,
  enrolled_at                 timestamptz,
  tier0_email_sent_at         timestamptz,
  admin_kyc_approved_at       timestamptz,
  admin_kyc_reviewer          uuid,
  admin_kyc_decision          text,
  admin_kyc_notes             text,
  is_admin                    boolean                               not null default false
);
-- Partner columns (payment_provider, bridge_customer_id, bridge_kyc_*,
-- bridge_account_status, preferred_currencies) are added by
-- 20260507_bridge_integration_phase0.sql. The bridge_environment
-- column is added by 20260519_schema_reconcile_bridge_partner_columns.sql.

-- ─── public.user_security ──────────────────────────────────────────────
-- Per-user security factors. Shape captured from live
-- `pg_constraint`: PK is on `id` (uuid, gen_random_uuid()), with a
-- UNIQUE constraint on `user_id`. The previous baseline declared
-- `user_id PRIMARY KEY` — that did not match live and would have
-- produced a different table on fresh replay.
--
-- The round-3 hardening migration (20260518_user_security_hardening.sql)
-- ALTERs this table to add the v2 + encrypted + attempts columns;
-- this declaration provides the base shape so that ALTER has
-- something to alter on a fresh project.
--
-- Three columns that are live (backup_codes, failed_2fa_attempts,
-- two_factor_locked_until) were applied via dashboard DDL outside the
-- migration history. They are added by
-- 20260519_schema_reconcile_bridge_partner_columns.sql so a clean
-- replay still lands on the live shape.
create table if not exists public.user_security (
  id                   uuid                                  primary key default gen_random_uuid(),
  user_id              uuid                                  not null unique references auth.users(id) on delete cascade,
  pin_set              boolean                                        default false,
  pin_hash             text,                                 -- legacy: single-round SHA-256
  two_factor_enabled   boolean                                        default false,
  two_factor_secret    text,                                 -- legacy plaintext (read-fallback during rollout)
  created_at           timestamptz                                    default now(),
  updated_at           timestamptz                                    default now()
);

-- ─── Post-condition assertions ────────────────────────────────────────
-- Catches a partial apply where some object failed silently.
do $$
declare v_count int;
begin
  select count(*) into v_count from information_schema.tables
   where table_schema = 'public' and table_name in ('users','user_profiles','user_security');
  if v_count <> 3 then
    raise exception 'baseline: expected user_profiles + users + user_security, got % tables', v_count;
  end if;

  select count(*) into v_count from pg_type
   where typname in ('account_type','kyc_status') and typnamespace = 'public'::regnamespace;
  if v_count <> 2 then
    raise exception 'baseline: expected account_type + kyc_status enums, got % types', v_count;
  end if;

  -- maplerad_customer_id is checked indirectly: it is created by
  -- CREATE TABLE IF NOT EXISTS when the table is fresh, and dropped by
  -- 20260518_maplerad_triggers_sweep. On a live re-apply the table
  -- already exists and the sweep has run, so the column is absent —
  -- so we deliberately do NOT assert its presence here. The presence
  -- assertion is implicit in the fact that the 20260507_* migrations
  -- (which reference it) ran successfully in the original timeline.

  -- Replay-correctness invariant: user_security PK must be on `id`,
  -- with `user_id` UNIQUE — to match live (captured 2026-05-19).
  perform 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public' and t.relname = 'user_security'
      and c.contype = 'p' and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (id)';
  if not found then
    raise exception 'baseline: user_security PRIMARY KEY (id) missing — replay will diverge from live';
  end if;
end $$;
