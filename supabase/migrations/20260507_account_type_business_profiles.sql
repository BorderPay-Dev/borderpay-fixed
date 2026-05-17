-- ============================================================================
-- 20260507_account_type_business_profiles.sql  (v2)
-- ----------------------------------------------------------------------------
-- Source-controlled migration that mirrors the production state. Idempotent
-- and additive. Safe to apply on top of an already-migrated DB.
--
--   1. account_type enum — created if missing; both labels enforced
--   2. users.account_type + user_profiles.account_type columns — added if
--      missing, then HARDENED with explicit DEFAULT, NOT NULL, type
--      conversion (text → enum if legacy), and CHECK constraint
--   3. Backfill of any null/legacy values to 'individual'
--   4. business_profiles table + RLS + indexes
--   5. INSERT trigger (sync_account_type_to_business): flips users +
--      user_profiles account_type to 'business' when business_profiles
--      gets a row. Sets app.bp_internal_sync='true' so the guard knows
--      this is the legitimate path.
--   6. UPDATE OF account_type guard triggers on both tables. They allow
--      the change ONLY when one of these is true:
--        a) request.jwt.claim.role = 'service_role'
--        b) app.bp_internal_sync GUC = 'true' (set by sync trigger)
--        c) public.is_borderpay_admin() returns true
--        d) the change is individual→business AND a business_profiles
--           row exists for this user (belt-and-suspenders)
--      Otherwise NEW.account_type is reverted to OLD.account_type.
--   7. mirror_user_profile_to_users — keeps the legacy users mirror row
--      in sync with user_profiles
-- ============================================================================

-- ─── 1. Enum type ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum ('individual', 'business');
  end if;
end $$;

-- ─── 2a. Add columns if missing (defaults applied to new rows) ────────────────
alter table public.users
  add column if not exists account_type public.account_type
    not null default 'individual'::public.account_type;

alter table public.user_profiles
  add column if not exists account_type public.account_type
    not null default 'individual'::public.account_type;

-- ─── 3. Backfill any NULLs (defensive) ────────────────────────────────────────
update public.users         set account_type = 'individual' where account_type is null;
update public.user_profiles set account_type = 'individual' where account_type is null;

-- ─── 2b. Convert text→enum (only fires if column was historically text) ──────
do $$
declare
  v_users_udt    text;
  v_profiles_udt text;
begin
  select udt_name into v_users_udt
    from information_schema.columns
   where table_schema='public' and table_name='users' and column_name='account_type';
  select udt_name into v_profiles_udt
    from information_schema.columns
   where table_schema='public' and table_name='user_profiles' and column_name='account_type';

  if v_users_udt = 'text' then
    update public.users
       set account_type = case when account_type in ('individual','business')
                                 then account_type else 'individual' end;
    alter table public.users
      alter column account_type drop default,
      alter column account_type type public.account_type using account_type::public.account_type,
      alter column account_type set default 'individual'::public.account_type;
  end if;
  if v_profiles_udt = 'text' then
    update public.user_profiles
       set account_type = case when account_type in ('individual','business')
                                 then account_type else 'individual' end;
    alter table public.user_profiles
      alter column account_type drop default,
      alter column account_type type public.account_type using account_type::public.account_type,
      alter column account_type set default 'individual'::public.account_type;
  end if;
end $$;

-- ─── 2c. Force DEFAULT + NOT NULL (catches pre-existing nullable columns) ────
alter table public.users         alter column account_type set default 'individual'::public.account_type;
alter table public.users         alter column account_type set not null;
alter table public.user_profiles alter column account_type set default 'individual'::public.account_type;
alter table public.user_profiles alter column account_type set not null;

-- ─── 2d. Defensive CHECK constraints (named, idempotent) ─────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'users_account_type_check'
       and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_account_type_check
      check (account_type in ('individual','business'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'user_profiles_account_type_check'
       and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_account_type_check
      check (account_type in ('individual','business'));
  end if;
end $$;

-- ─── 4. business_profiles table + RLS ────────────────────────────────────────
create table if not exists public.business_profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id) on delete cascade,
  company_name         text not null,
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
  status               text not null default 'active'
                        check (status in ('active','suspended','closed')),
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists business_profiles_user_idx    on public.business_profiles (user_id);
create index if not exists business_profiles_country_idx on public.business_profiles (country) where country is not null;

alter table public.business_profiles enable row level security;

drop policy if exists business_profiles_owner_select on public.business_profiles;
create policy business_profiles_owner_select on public.business_profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists business_profiles_owner_insert on public.business_profiles;
create policy business_profiles_owner_insert on public.business_profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists business_profiles_owner_update on public.business_profiles;
create policy business_profiles_owner_update on public.business_profiles
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists business_profiles_admin_all on public.business_profiles;
create policy business_profiles_admin_all on public.business_profiles
  for all to authenticated
  using (public.is_borderpay_admin()) with check (public.is_borderpay_admin());

drop policy if exists business_profiles_service_role on public.business_profiles;
create policy business_profiles_service_role on public.business_profiles
  for all to service_role using (true) with check (true);

drop trigger if exists trg_business_profiles_touch on public.business_profiles;
create trigger trg_business_profiles_touch
  before update on public.business_profiles
  for each row execute function public.touch_updated_at();

-- ─── 5. INSERT trigger: flip account_type to business ───────────────────────
-- Sets app.bp_internal_sync='true' (transaction-local) so the guard
-- triggers know to allow the resulting account_type UPDATE.
create or replace function public.sync_account_type_to_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.bp_internal_sync', 'true', true);  -- is_local=true

  update public.user_profiles
     set account_type = 'business'::public.account_type,
         updated_at   = now()
   where id = NEW.user_id
     and (account_type is null or account_type = 'individual'::public.account_type);

  update public.users
     set account_type = 'business'::public.account_type,
         updated_at   = now()
   where id = NEW.user_id
     and (account_type is null or account_type = 'individual'::public.account_type);

  perform set_config('app.bp_internal_sync', 'false', true);

  return NEW;
end;
$$;

drop trigger if exists trg_sync_account_type_to_business on public.business_profiles;
create trigger trg_sync_account_type_to_business
  after insert on public.business_profiles
  for each row execute function public.sync_account_type_to_business();

-- ─── 6. Guard triggers: BLOCK self-promotion, ALLOW the legitimate paths ────
create or replace function public.guard_user_profile_account_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role         text    := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_internal     boolean := coalesce(current_setting('app.bp_internal_sync', true), 'false') = 'true';
  v_is_admin     boolean := false;
  v_has_business boolean := false;
begin
  -- a) service role can change anything
  if v_role = 'service_role' then return NEW; end if;
  -- b) the legitimate sync trigger
  if v_internal              then return NEW; end if;
  -- c) admins (compliance / ops)
  begin v_is_admin := public.is_borderpay_admin();
  exception when others then v_is_admin := false;
  end;
  if v_is_admin then return NEW; end if;
  -- d) individual→business AND a business_profiles row exists (safety net)
  if NEW.account_type is distinct from OLD.account_type
     and OLD.account_type = 'individual'::public.account_type
     and NEW.account_type = 'business'::public.account_type
  then
    select exists(select 1 from public.business_profiles where user_id = NEW.id)
      into v_has_business;
    if v_has_business then return NEW; end if;
  end if;
  -- otherwise REVERT
  if NEW.account_type is distinct from OLD.account_type then
    NEW.account_type := OLD.account_type;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_user_profile_account_type on public.user_profiles;
create trigger trg_guard_user_profile_account_type
  before update of account_type on public.user_profiles
  for each row execute function public.guard_user_profile_account_type();

create or replace function public.guard_users_account_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role         text    := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_internal     boolean := coalesce(current_setting('app.bp_internal_sync', true), 'false') = 'true';
  v_is_admin     boolean := false;
  v_has_business boolean := false;
begin
  if v_role = 'service_role' then return NEW; end if;
  if v_internal              then return NEW; end if;
  begin v_is_admin := public.is_borderpay_admin();
  exception when others then v_is_admin := false;
  end;
  if v_is_admin then return NEW; end if;
  if NEW.account_type is distinct from OLD.account_type
     and OLD.account_type = 'individual'::public.account_type
     and NEW.account_type = 'business'::public.account_type
  then
    select exists(select 1 from public.business_profiles where user_id = NEW.id)
      into v_has_business;
    if v_has_business then return NEW; end if;
  end if;
  if NEW.account_type is distinct from OLD.account_type then
    NEW.account_type := OLD.account_type;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_users_account_type on public.users;
create trigger trg_guard_users_account_type
  before update of account_type on public.users
  for each row execute function public.guard_users_account_type();

-- ─── 7. mirror_user_profile_to_users (kept for IaC discoverability) ─────────
create or replace function public.mirror_user_profile_to_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, phone, country, account_type,
                            kyc_status, maplerad_customer_id, created_at, updated_at)
  values (NEW.id, NEW.email, NEW.full_name, NEW.phone, NEW.country,
          coalesce(NEW.account_type, 'individual'::public.account_type),
          coalesce(NEW.kyc_status,   'unverified'::public.kyc_status),
          NEW.maplerad_customer_id, coalesce(NEW.created_at, now()), now())
  on conflict (id) do update
    set email                = excluded.email,
        full_name            = coalesce(excluded.full_name,            public.users.full_name),
        phone                = coalesce(excluded.phone,                public.users.phone),
        country              = coalesce(excluded.country,              public.users.country),
        kyc_status           = coalesce(excluded.kyc_status,           public.users.kyc_status),
        account_type         = coalesce(excluded.account_type,         public.users.account_type),
        maplerad_customer_id = coalesce(excluded.maplerad_customer_id, public.users.maplerad_customer_id),
        updated_at           = now();
  return NEW;
end;
$$;

drop trigger if exists trg_mirror_user_profile_to_users on public.user_profiles;
create trigger trg_mirror_user_profile_to_users
after insert or update on public.user_profiles
for each row execute function public.mirror_user_profile_to_users();
