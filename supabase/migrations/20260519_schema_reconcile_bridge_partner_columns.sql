-- 20260519_schema_reconcile_bridge_partner_columns
--
-- Reconciliation migration. The live DB carries three artefacts that
-- `utils/supabase/schema.sql` declares but no prior migration created:
--
--   1. user_profiles.bridge_environment       (text)
--   2. users.bridge_customer_id               (text)
--   3. public.user_security (whole base table)
--
-- All three exist live (verified against information_schema on
-- 2026-05-19). Without this migration, a fresh Supabase project
-- replaying `supabase/migrations/*.sql` in lexicographic order would
-- produce a schema that does NOT match production, and the round-3
-- hardening migration would fail because it ALTERs a table that does
-- not yet exist.
--
-- This migration is idempotent: every statement is `IF NOT EXISTS`,
-- so it is a no-op against the current live DB. It exists so the
-- migration set is self-contained.

-- ─── 1. user_profiles.bridge_environment ──────────────────────────────
-- Used by the wallet-provisioning flow to tag whether a customer was
-- created against Bridge live or sandbox. Read-only for the UI.
alter table public.user_profiles
  add column if not exists bridge_environment text;

-- ─── 2. users.bridge_customer_id ──────────────────────────────────────
-- Mirror of user_profiles.bridge_customer_id on the legacy users table,
-- kept in sync by the mirror_user_profile_to_users trigger (which was
-- dropped in 20260518_maplerad_triggers_sweep.sql; the column itself
-- remains for any legacy reader during the deprecation window).
alter table public.users
  add column if not exists bridge_customer_id text;

-- ─── 3. user_security base table ──────────────────────────────────────
-- Holds PIN + TOTP factor state per user. The round-3 hardening
-- migration (20260518_user_security_hardening.sql) adds the v2 / encrypted
-- columns via ALTER TABLE; this CREATE establishes the base shape so
-- the ALTER has something to alter on a fresh project.
create table if not exists public.user_security (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  pin_set              boolean     not null default false,
  pin_hash             text,                                  -- legacy: single-round SHA-256
  two_factor_enabled   boolean     not null default false,
  two_factor_secret    text,                                  -- legacy plaintext (read-fallback during rollout)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- RLS on the base table. The hardening migration assumes RLS is enabled
-- already; declare here so a fresh project lands in the same state.
alter table public.user_security enable row level security;
drop policy if exists user_security_owner          on public.user_security;
create policy user_security_owner          on public.user_security
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists user_security_service_role   on public.user_security;
create policy user_security_service_role   on public.user_security
  for all to service_role using (true) with check (true);

-- ─── Post-condition assertions ────────────────────────────────────────
-- Catches the case where this migration somehow lands on a DB that
-- already has divergent column types or missing constraints. Fails
-- loudly so the migration runner reports it instead of silently
-- producing a partial state.
do $$
declare
  v_be    int;
  v_uc    int;
  v_us    int;
begin
  select count(*) into v_be
    from information_schema.columns
   where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'bridge_environment';
  if v_be <> 1 then raise exception 'reconcile: user_profiles.bridge_environment missing after migration'; end if;

  select count(*) into v_uc
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users' and column_name = 'bridge_customer_id';
  if v_uc <> 1 then raise exception 'reconcile: users.bridge_customer_id missing after migration'; end if;

  select count(*) into v_us
    from information_schema.tables
   where table_schema = 'public' and table_name = 'user_security';
  if v_us <> 1 then raise exception 'reconcile: public.user_security missing after migration'; end if;
end $$;
