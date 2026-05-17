-- ============================================================================
-- 20260507_lock_down_business_promotion.sql
-- ----------------------------------------------------------------------------
-- Production lockdown for individual → business promotion.
-- Applied AFTER 20260507_account_type_business_profiles.sql.
--
-- What this migration changes:
--   1. Drops `business_profiles_owner_insert`. Authenticated users can no
--      longer create their own business_profiles row by direct DB write.
--   2. Owner UPDATE on business_profiles is preserved but pinned by a
--      BEFORE-UPDATE trigger that prevents a user from changing user_id
--      or status. (Admins / service_role bypass.)
--   3. Removes the guard's "individual→business AND business_profiles row
--      exists" fallback branch. Promotion now requires one of:
--         a) request.jwt.claim.role = 'service_role'   (auth-signup)
--         b) app.bp_internal_sync = 'true'             (sync trigger)
--         c) public.is_borderpay_admin()               (admin)
--   4. Adds `public.account_type_audit` for every promotion event, with
--      RLS so users see their own and admins see all.
--   5. Adds `public.admin_promote_to_business(...)` RPC — the ONLY path
--      for an existing individual user to become a business after signup.
--      The RPC is SECURITY DEFINER, validates inputs, inserts into
--      business_profiles (which fires the sync trigger), and audits.
--   6. The sync trigger now writes an audit row on every promotion.
-- ============================================================================

-- 1. Compliance audit log
create table if not exists public.account_type_audit (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  from_type    public.account_type,
  to_type      public.account_type not null,
  source       text        not null check (source in ('signup','admin_rpc','admin_dashboard','migration','support')),
  reviewer_id  uuid,
  payload      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists account_type_audit_user_idx on public.account_type_audit (user_id, created_at desc);

alter table public.account_type_audit enable row level security;
drop policy if exists account_type_audit_admin_read   on public.account_type_audit;
create policy account_type_audit_admin_read   on public.account_type_audit for select to authenticated using (public.is_borderpay_admin());
drop policy if exists account_type_audit_owner_read   on public.account_type_audit;
create policy account_type_audit_owner_read   on public.account_type_audit for select to authenticated using (auth.uid() = user_id);
drop policy if exists account_type_audit_service_role on public.account_type_audit;
create policy account_type_audit_service_role on public.account_type_audit for all to service_role using (true) with check (true);

-- 2. Drop owner-INSERT on business_profiles
drop policy if exists business_profiles_owner_insert on public.business_profiles;

-- 3. Tighten owner-UPDATE: block changes to user_id / status from the owner
create or replace function public.business_profiles_owner_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text    := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_internal boolean := coalesce(current_setting('app.bp_internal_sync', true), 'false') = 'true';
  v_is_admin boolean := false;
begin
  if v_role = 'service_role' or v_internal then return NEW; end if;
  begin v_is_admin := public.is_borderpay_admin();
  exception when others then v_is_admin := false; end;
  if v_is_admin then return NEW; end if;
  if NEW.user_id is distinct from OLD.user_id then NEW.user_id := OLD.user_id; end if;
  if NEW.status  is distinct from OLD.status  then NEW.status  := OLD.status;  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_business_profiles_owner_update_guard on public.business_profiles;
create trigger trg_business_profiles_owner_update_guard
  before update on public.business_profiles
  for each row execute function public.business_profiles_owner_update_guard();

-- 4. Remove the permissive "business_profiles row exists" branch from guards
create or replace function public.guard_user_profile_account_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text    := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_internal boolean := coalesce(current_setting('app.bp_internal_sync', true), 'false') = 'true';
  v_is_admin boolean := false;
begin
  if v_role = 'service_role' then return NEW; end if;
  if v_internal              then return NEW; end if;
  begin v_is_admin := public.is_borderpay_admin();
  exception when others then v_is_admin := false; end;
  if v_is_admin then return NEW; end if;
  if NEW.account_type is distinct from OLD.account_type then
    NEW.account_type := OLD.account_type;
  end if;
  return NEW;
end;
$$;

create or replace function public.guard_users_account_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text    := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_internal boolean := coalesce(current_setting('app.bp_internal_sync', true), 'false') = 'true';
  v_is_admin boolean := false;
begin
  if v_role = 'service_role' then return NEW; end if;
  if v_internal              then return NEW; end if;
  begin v_is_admin := public.is_borderpay_admin();
  exception when others then v_is_admin := false; end;
  if v_is_admin then return NEW; end if;
  if NEW.account_type is distinct from OLD.account_type then
    NEW.account_type := OLD.account_type;
  end if;
  return NEW;
end;
$$;

-- 5. The single sanctioned post-signup promotion path
create or replace function public.admin_promote_to_business(
  p_user_id              uuid,
  p_company_name         text,
  p_registration_number  text default null,
  p_country              text default null,
  p_notes                text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid    := auth.uid();
  v_role     text    := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_is_admin boolean := false;
  v_existing uuid;
  v_bp_id    uuid;
  v_old      public.account_type;
begin
  if v_role <> 'service_role' then
    begin v_is_admin := public.is_borderpay_admin();
    exception when others then v_is_admin := false; end;
    if not v_is_admin then
      raise exception 'admin_promote_to_business: admin or service_role required'
        using errcode = '42501';
    end if;
  end if;
  if p_user_id is null then
    raise exception 'admin_promote_to_business: p_user_id required';
  end if;
  if p_company_name is null or length(trim(p_company_name)) = 0 then
    raise exception 'admin_promote_to_business: p_company_name required';
  end if;
  select account_type into v_old from public.user_profiles where id = p_user_id;
  if v_old is null then
    raise exception 'admin_promote_to_business: user % has no user_profiles row', p_user_id;
  end if;
  select id into v_existing from public.business_profiles where user_id = p_user_id;
  if v_existing is not null then return v_existing; end if;
  insert into public.business_profiles (user_id, company_name, registration_number, country, status, metadata)
  values (p_user_id, trim(p_company_name), p_registration_number, p_country, 'active',
          jsonb_build_object('promoted_by', v_caller, 'notes', p_notes))
  returning id into v_bp_id;
  insert into public.account_type_audit (user_id, from_type, to_type, source, reviewer_id, payload)
  values (
    p_user_id, v_old, 'business'::public.account_type,
    case when v_role = 'service_role' then 'admin_rpc' else 'admin_dashboard' end,
    v_caller,
    jsonb_build_object(
      'company_name',        p_company_name,
      'registration_number', p_registration_number,
      'country',             p_country,
      'notes',               p_notes
    )
  );
  return v_bp_id;
end;
$$;

revoke all     on function public.admin_promote_to_business(uuid, text, text, text, text) from public;
grant  execute on function public.admin_promote_to_business(uuid, text, text, text, text) to authenticated;

-- 6. Sync trigger writes an audit row on every promotion
create or replace function public.sync_account_type_to_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.account_type;
begin
  perform set_config('app.bp_internal_sync', 'true', true);

  select account_type into v_old from public.user_profiles where id = NEW.user_id;

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

  insert into public.account_type_audit (user_id, from_type, to_type, source, reviewer_id, payload)
  values (
    NEW.user_id,
    coalesce(v_old, 'individual'::public.account_type),
    'business'::public.account_type,
    case
      when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then 'signup'
      when public.is_borderpay_admin() then 'admin_dashboard'
      else 'migration'
    end,
    auth.uid(),
    jsonb_build_object('business_profile_id', NEW.id, 'company_name', NEW.company_name)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_sync_account_type_to_business on public.business_profiles;
create trigger trg_sync_account_type_to_business
  after insert on public.business_profiles
  for each row execute function public.sync_account_type_to_business();
