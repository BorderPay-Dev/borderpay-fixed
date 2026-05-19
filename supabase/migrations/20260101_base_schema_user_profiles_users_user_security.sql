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
-- 2026-05-19 (see CTO_REVIEW_HANDOFF round 4). Subsequent migrations
-- in this directory then ADD/DROP columns on top of this baseline,
-- exactly as they have already been applied to production.

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
create table if not exists public.users (
  id                 uuid                                  primary key references auth.users(id) on delete cascade,
  email              text                                  not null,
  full_name          text,
  phone              text,
  country            text,
  account_type       public.account_type                   not null default 'individual'::public.account_type,
  kyc_status         public.kyc_status                              default 'unverified'::public.kyc_status,
  wallet_activated   boolean                                        default false,
  created_at         timestamptz                                    default now(),
  updated_at         timestamptz                                    default now()
);
-- Note: users.bridge_customer_id is added later via
-- 20260519_schema_reconcile_bridge_partner_columns.sql so that any
-- pre-existing clones that already had this column get a no-op upgrade.

-- ─── public.user_profiles ──────────────────────────────────────────────
-- Canonical identity + KYC + partner-routing surface. Most application
-- code reads from here. Subsequent migrations add Bridge partner
-- columns, hardening fields, and constraints; this declaration is the
-- foundation those ALTERs build on.
create table if not exists public.user_profiles (
  id                          uuid                                  primary key references auth.users(id) on delete cascade,
  email                       text,
  full_name                   text,
  phone                       text,
  country                     text,
  account_type                public.account_type                   not null default 'individual'::public.account_type,
  kyc_status                  public.kyc_status                              default 'unverified'::public.kyc_status,
  kyc_level                   integer                                        default 0,
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
-- Per-user security factors. The round-3 hardening migration
-- (20260518_user_security_hardening.sql) ALTERs this table to add the
-- v2 + encrypted + attempts columns; this declaration provides the
-- base shape so that ALTER has something to alter on a fresh project.
create table if not exists public.user_security (
  user_id              uuid                                  primary key references auth.users(id) on delete cascade,
  pin_set              boolean                               not null default false,
  pin_hash             text,                                 -- legacy: single-round SHA-256
  two_factor_enabled   boolean                               not null default false,
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
end $$;
