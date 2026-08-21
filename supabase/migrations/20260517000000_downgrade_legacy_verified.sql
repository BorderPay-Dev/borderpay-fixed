-- 20260517_downgrade_legacy_verified
--
-- Downgrade legacy 'verified' / 'approved' kyc_status rows whose partner
-- (Bridge) status is not 'approved'. Install BEFORE-UPDATE triggers so the
-- partner webhook is the single source of truth that flips a user to
-- verified — and demotes them again if the partner revokes.
--
-- Applied to production via Supabase MCP on 2026-05-17 as
-- `downgrade_legacy_verified_force_partner_reverify`. This file commits
-- the same statements to the repo so the migration is reproducible from
-- source.

-- 1) Downgrade legacy-verified rows whose partner status is not 'approved'.
update public.user_profiles
   set kyc_status      = 'pending',
       kyc_verified_at = null,
       updated_at      = now()
 where lower(kyc_status::text) in ('verified','approved')
   and lower(coalesce(bridge_kyc_status::text, '')) <> 'approved';

-- 2) Sync trigger — when partner approves/revokes, mirror to legacy column.
create or replace function public.sync_legacy_kyc_status_from_bridge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_bridge text := lower(coalesce(new.bridge_kyc_status::text, ''));
  v_old_bridge text := lower(coalesce(old.bridge_kyc_status::text, ''));
begin
  if v_new_bridge = v_old_bridge then
    return new;
  end if;

  if v_new_bridge = 'approved' and lower(new.kyc_status::text) <> 'verified' then
    new.kyc_status      := 'verified';
    new.kyc_verified_at := coalesce(new.kyc_verified_at, now());
  elsif v_old_bridge = 'approved' and v_new_bridge <> 'approved' then
    new.kyc_status      := case v_new_bridge
                             when 'rejected' then 'rejected'::kyc_status
                             else 'pending'::kyc_status
                           end;
    new.kyc_verified_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_legacy_kyc on public.user_profiles;
create trigger trg_sync_legacy_kyc
before update of bridge_kyc_status on public.user_profiles
for each row execute function public.sync_legacy_kyc_status_from_bridge();

-- 3) KYB → legacy kyc_status sync.
create or replace function public.sync_legacy_kyc_status_from_bridge_kyb()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text := lower(coalesce(new.bridge_kyb_status::text, ''));
  v_old text := lower(coalesce(old.bridge_kyb_status::text, ''));
begin
  if v_new = v_old then return new; end if;

  if v_new = 'approved' then
    update public.user_profiles
       set kyc_status      = 'verified',
           kyc_verified_at = coalesce(kyc_verified_at, now()),
           updated_at      = now()
     where id = new.user_id
       and lower(kyc_status::text) <> 'verified';
  elsif v_old = 'approved' and v_new <> 'approved' then
    update public.user_profiles
       set kyc_status      = case v_new when 'rejected' then 'rejected'::kyc_status else 'pending'::kyc_status end,
           kyc_verified_at = null,
           updated_at      = now()
     where id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_legacy_kyc_kyb on public.business_profiles;
create trigger trg_sync_legacy_kyc_kyb
after update of bridge_kyb_status on public.business_profiles
for each row execute function public.sync_legacy_kyc_status_from_bridge_kyb();
