-- 20260518_maplerad_triggers_sweep
--
-- Root cause of "Database error creating new user" (HTTP 500 on every
-- signup): two legacy triggers on user_profiles
-- (mirror_user_profile_to_users, sync_users_maplerad_id) tried to write
-- to users.maplerad_customer_id, which was dropped earlier in the Bridge
-- migration. Any INSERT into user_profiles (including the on-signup
-- trigger) aborted with "column does not exist", which rolled back the
-- auth.users INSERT.
--
-- Applied via Supabase MCP on 2026-05-17 as
-- `maplerad_sweep_drop_triggers_columns_audit_tables`. Committed here so
-- the schema is reproducible from source.

-- 1) triggers
drop trigger if exists trg_mirror_user_profile_to_users on public.user_profiles;
drop trigger if exists trg_sync_users_maplerad_id      on public.user_profiles;
drop trigger if exists trg_audit_provider_migration    on public.user_profiles;
drop trigger if exists trg_sync_user_profile_from_kyc  on public.kyc_submissions;

-- 2) trigger / helper functions
drop function if exists public.mirror_user_profile_to_users()   cascade;
drop function if exists public.sync_users_maplerad_id()         cascade;
drop function if exists public.audit_provider_migration()       cascade;
drop function if exists public.sync_user_profile_from_kyc()     cascade;
drop function if exists public.insert_maplerad_card_call_audit  cascade;

-- 3) audit + provider-migration log tables
drop table if exists public.maplerad_call_audit       cascade;
drop table if exists public.provider_migration_audit  cascade;

-- 4) Maplerad columns on user_profiles + users.
--    Each column is dropped IF EXISTS so a missing column is a no-op.
alter table public.user_profiles
  drop column if exists maplerad_customer_id,
  drop column if exists maplerad_tier,
  drop column if exists maplerad_status,
  drop column if exists maplerad_environment,
  drop column if exists maplerad_kyc_link,
  drop column if exists maplerad_kyc_link_url,
  drop column if exists maplerad_kyc_link_id,
  drop column if exists maplerad_account_status,
  drop column if exists maplerad_provider_meta;

alter table public.users
  drop column if exists maplerad_customer_id,
  drop column if exists maplerad_tier,
  drop column if exists maplerad_status,
  drop column if exists maplerad_environment;
