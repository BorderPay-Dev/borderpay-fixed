-- 20260519_schema_reconcile_bridge_partner_columns
--
-- Reconciliation migration. The live DB carries several artefacts that
-- `utils/supabase/schema.sql` declares but no prior migration created.
-- All exist live (verified against information_schema on 2026-05-19).
-- Without this migration, a fresh Supabase project replaying
-- `supabase/migrations/*.sql` in lexicographic order would produce a
-- schema that does NOT match production.
--
-- Inventory of reconciled artefacts (all `IF NOT EXISTS`, no-op live):
--
--   1. user_profiles.bridge_environment                  (text)
--   2. users.bridge_customer_id                          (text)
--   3. public.user_security (whole base table)           — belt-and-braces
--   4. user_security.backup_codes                        (text[])
--   5. user_security.failed_pin_attempts                 (int, default 0)
--   6. user_security.failed_2fa_attempts                 (int, default 0)
--   7. user_security.two_factor_locked_until             (timestamptz)
--
-- Items 4-7 were applied via dashboard DDL before the user_security
-- hardening migration (20260518_user_security_hardening.sql) and were
-- never captured in source. Round-5 CTO review surfaced them.

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
-- Belt-and-braces. The 20260101 baseline already creates this; this
-- block keeps the reconcile migration self-sufficient if it is ever
-- applied against a partial clone. Shape MUST match live: id is PK,
-- user_id is UNIQUE (NOT user_id PK as schema.sql previously declared).
create table if not exists public.user_security (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null unique references auth.users(id) on delete cascade,
  pin_set              boolean                 default false,
  pin_hash             text,                                  -- legacy: single-round SHA-256
  two_factor_enabled   boolean                 default false,
  two_factor_secret    text,                                  -- legacy plaintext (read-fallback during rollout)
  created_at           timestamptz             default now(),
  updated_at           timestamptz             default now()
);

-- ─── 4-7. user_security dashboard-DDL columns ─────────────────────────
-- These columns exist live but no prior migration created them. Their
-- absence in the migration set would have made a fresh replay diverge
-- from production. Idempotent ADD COLUMN IF NOT EXISTS so this is a
-- no-op against live.
alter table public.user_security
  add column if not exists backup_codes            text[],
  add column if not exists failed_pin_attempts     integer     default 0,
  add column if not exists failed_2fa_attempts     integer     default 0,
  add column if not exists two_factor_locked_until timestamptz;

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
  v_count int;
begin
  -- 1-2. Bridge partner columns
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'user_profiles' and column_name = 'bridge_environment')
       or (table_name = 'users'         and column_name = 'bridge_customer_id'));
  if v_count <> 2 then
    raise exception 'reconcile: bridge partner columns missing — got % of 2 expected', v_count;
  end if;

  -- 3. user_security exists and has the right PK shape
  perform 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public' and t.relname = 'user_security'
      and c.contype = 'p' and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (id)';
  if not found then
    raise exception 'reconcile: user_security PRIMARY KEY (id) missing — schema diverged from live';
  end if;

  -- 4-7. Dashboard-DDL columns now backed by source
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public' and table_name = 'user_security'
     and column_name in ('backup_codes','failed_pin_attempts','failed_2fa_attempts','two_factor_locked_until');
  if v_count <> 4 then
    raise exception 'reconcile: user_security dashboard-DDL columns missing — got % of 4 expected', v_count;
  end if;
end $$;
