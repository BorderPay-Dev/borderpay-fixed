-- ============================================================================
-- 20260619103000_security_abuse_and_reconciliation_hardening.sql
-- ----------------------------------------------------------------------------
-- Hardening bundle:
--   1) Atomic PIN verification/change RPCs with lockout enforcement.
--   2) Signup abuse rate limiting primitive (IP/email window checks).
--   3) Bridge transfer reconciliation state for unmapped webhook attribution.
-- ============================================================================

set search_path = public, extensions, pg_temp;

create extension if not exists pgcrypto with schema extensions;

-- ── 1) Atomic PIN RPCs ─────────────────────────────────────────────────────
create or replace function public.set_user_pin_v2(
  p_user_id uuid,
  p_pin_hash_v2 text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'set_user_pin_v2: p_user_id required';
  end if;
  if p_pin_hash_v2 is null or p_pin_hash_v2 !~ '^v2\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' then
    raise exception 'set_user_pin_v2: invalid v2 hash format';
  end if;

  insert into public.user_security (
    user_id, pin_set, pin_hash_v2, pin_hash,
    pin_failed_attempts, failed_pin_attempts, pin_locked_until, pin_updated_at, updated_at
  ) values (
    p_user_id, true, p_pin_hash_v2, null,
    0, 0, null, now(), now()
  )
  on conflict (user_id) do update set
    pin_set              = true,
    pin_hash_v2          = excluded.pin_hash_v2,
    pin_hash             = null,
    pin_failed_attempts  = 0,
    failed_pin_attempts  = 0,
    pin_locked_until     = null,
    pin_updated_at       = now(),
    updated_at           = now();
end;
$$;

revoke all on function public.set_user_pin_v2(uuid, text) from public;
grant execute on function public.set_user_pin_v2(uuid, text) to service_role;

create or replace function public.verify_user_pin_atomic(
  p_user_id uuid,
  p_candidate_hash_v2 text default null,
  p_candidate_hash_legacy text default null,
  p_upgrade_hash_v2 text default null,
  p_lock_threshold int default 5,
  p_lock_minutes int default 15
)
returns table (
  verified boolean,
  locked boolean,
  pin_set boolean,
  attempts int,
  locked_until timestamptz,
  upgraded boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_security%rowtype;
  v_attempts int;
  v_match boolean := false;
  v_upgraded boolean := false;
  v_now timestamptz := now();
  v_threshold int := greatest(1, coalesce(p_lock_threshold, 5));
  v_lock_minutes int := greatest(1, coalesce(p_lock_minutes, 15));
  v_new_locked_until timestamptz;
begin
  if p_user_id is null then
    raise exception 'verify_user_pin_atomic: p_user_id required';
  end if;

  select * into v_row
    from public.user_security
   where user_id = p_user_id
   for update;

  if not found then
    return query select false, false, false, 0, null::timestamptz, false;
    return;
  end if;

  if coalesce(v_row.pin_hash_v2, '') = '' and coalesce(v_row.pin_hash, '') = '' then
    return query select false, false, false, coalesce(v_row.pin_failed_attempts, 0)::int, v_row.pin_locked_until, false;
    return;
  end if;

  if v_row.pin_locked_until is not null and v_row.pin_locked_until > v_now then
    return query select false, true, true, coalesce(v_row.pin_failed_attempts, 0)::int, v_row.pin_locked_until, false;
    return;
  end if;

  if v_row.pin_hash_v2 is not null and p_candidate_hash_v2 is not null and p_candidate_hash_v2 = v_row.pin_hash_v2 then
    v_match := true;
  elsif v_row.pin_hash_v2 is null and v_row.pin_hash is not null
     and p_candidate_hash_legacy is not null and p_candidate_hash_legacy = v_row.pin_hash then
    v_match := true;
    if p_upgrade_hash_v2 is not null and p_upgrade_hash_v2 ~ '^v2\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' then
      v_upgraded := true;
    end if;
  end if;

  if v_match then
    update public.user_security
       set pin_set             = true,
           pin_hash_v2         = case when v_upgraded then p_upgrade_hash_v2 else pin_hash_v2 end,
           pin_hash            = case when v_upgraded then null else pin_hash end,
           pin_failed_attempts = 0,
           failed_pin_attempts = 0,
           pin_locked_until    = null,
           pin_updated_at      = case when v_upgraded then now() else pin_updated_at end,
           updated_at          = now()
     where user_id = p_user_id;

    return query select true, false, true, 0, null::timestamptz, v_upgraded;
    return;
  end if;

  v_attempts := coalesce(v_row.pin_failed_attempts, 0) + 1;
  v_new_locked_until := case
    when v_attempts >= v_threshold then v_now + make_interval(mins => v_lock_minutes)
    else null::timestamptz
  end;

  update public.user_security
     set pin_failed_attempts = v_attempts,
         failed_pin_attempts = v_attempts,
         pin_locked_until    = v_new_locked_until,
         updated_at          = now()
   where user_id = p_user_id;

  return query select false, v_new_locked_until is not null, true, v_attempts, v_new_locked_until, false;
end;
$$;

revoke all on function public.verify_user_pin_atomic(uuid, text, text, text, int, int) from public;
grant execute on function public.verify_user_pin_atomic(uuid, text, text, text, int, int) to service_role;

create or replace function public.change_user_pin_atomic(
  p_user_id uuid,
  p_candidate_hash_v2 text default null,
  p_candidate_hash_legacy text default null,
  p_new_hash_v2 text,
  p_lock_threshold int default 5,
  p_lock_minutes int default 15
)
returns table (
  changed boolean,
  locked boolean,
  pin_set boolean,
  attempts int,
  locked_until timestamptz,
  upgraded boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_security%rowtype;
  v_attempts int;
  v_match boolean := false;
  v_upgraded boolean := false;
  v_now timestamptz := now();
  v_threshold int := greatest(1, coalesce(p_lock_threshold, 5));
  v_lock_minutes int := greatest(1, coalesce(p_lock_minutes, 15));
  v_new_locked_until timestamptz;
begin
  if p_user_id is null then
    raise exception 'change_user_pin_atomic: p_user_id required';
  end if;
  if p_new_hash_v2 is null or p_new_hash_v2 !~ '^v2\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' then
    raise exception 'change_user_pin_atomic: invalid p_new_hash_v2 format';
  end if;

  select * into v_row
    from public.user_security
   where user_id = p_user_id
   for update;

  if not found then
    return query select false, false, false, 0, null::timestamptz, false;
    return;
  end if;

  if coalesce(v_row.pin_hash_v2, '') = '' and coalesce(v_row.pin_hash, '') = '' then
    return query select false, false, false, coalesce(v_row.pin_failed_attempts, 0)::int, v_row.pin_locked_until, false;
    return;
  end if;

  if v_row.pin_locked_until is not null and v_row.pin_locked_until > v_now then
    return query select false, true, true, coalesce(v_row.pin_failed_attempts, 0)::int, v_row.pin_locked_until, false;
    return;
  end if;

  if v_row.pin_hash_v2 is not null and p_candidate_hash_v2 is not null and p_candidate_hash_v2 = v_row.pin_hash_v2 then
    v_match := true;
  elsif v_row.pin_hash_v2 is null and v_row.pin_hash is not null
     and p_candidate_hash_legacy is not null and p_candidate_hash_legacy = v_row.pin_hash then
    v_match := true;
    v_upgraded := true;
  end if;

  if v_match then
    update public.user_security
       set pin_set             = true,
           pin_hash_v2         = p_new_hash_v2,
           pin_hash            = null,
           pin_failed_attempts = 0,
           failed_pin_attempts = 0,
           pin_locked_until    = null,
           pin_updated_at      = now(),
           updated_at          = now()
     where user_id = p_user_id;

    return query select true, false, true, 0, null::timestamptz, v_upgraded;
    return;
  end if;

  v_attempts := coalesce(v_row.pin_failed_attempts, 0) + 1;
  v_new_locked_until := case
    when v_attempts >= v_threshold then v_now + make_interval(mins => v_lock_minutes)
    else null::timestamptz
  end;

  update public.user_security
     set pin_failed_attempts = v_attempts,
         failed_pin_attempts = v_attempts,
         pin_locked_until    = v_new_locked_until,
         updated_at          = now()
   where user_id = p_user_id;

  return query select false, v_new_locked_until is not null, true, v_attempts, v_new_locked_until, false;
end;
$$;

revoke all on function public.change_user_pin_atomic(uuid, text, text, text, int, int) from public;
grant execute on function public.change_user_pin_atomic(uuid, text, text, text, int, int) to service_role;

-- ── 2) Signup abuse protection ─────────────────────────────────────────────
create table if not exists public.signup_abuse_events (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists signup_abuse_events_created_idx
  on public.signup_abuse_events (created_at desc);
create index if not exists signup_abuse_events_email_idx
  on public.signup_abuse_events (email_hash, created_at desc);
create index if not exists signup_abuse_events_ip_idx
  on public.signup_abuse_events (ip_address, created_at desc)
  where ip_address is not null;

alter table public.signup_abuse_events enable row level security;
drop policy if exists signup_abuse_events_service_role on public.signup_abuse_events;
create policy signup_abuse_events_service_role
  on public.signup_abuse_events for all to service_role
  using (true) with check (true);

create or replace function public.enforce_signup_abuse_protection(
  p_email text,
  p_ip inet default null,
  p_user_agent text default null,
  p_email_limit_per_hour int default 5,
  p_ip_limit_per_hour int default 25,
  p_cooldown_seconds int default 20
)
returns table (
  allowed boolean,
  code text,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_email text;
  v_hash text;
  v_email_count int := 0;
  v_ip_count int := 0;
  v_last_at timestamptz;
  v_retry int := 0;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    return query select false, 'email_required'::text, 0;
    return;
  end if;

  v_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');

  select count(*)::int into v_email_count
    from public.signup_abuse_events
   where email_hash = v_hash
     and created_at > v_now - interval '1 hour';

  if p_ip is not null then
    select count(*)::int into v_ip_count
      from public.signup_abuse_events
     where ip_address = p_ip
       and created_at > v_now - interval '1 hour';
  end if;

  select max(created_at) into v_last_at
    from public.signup_abuse_events
   where email_hash = v_hash
      or (p_ip is not null and ip_address = p_ip);

  if v_last_at is not null and v_last_at > v_now - make_interval(secs => greatest(1, p_cooldown_seconds)) then
    v_retry := greatest(1, ceil(extract(epoch from ((v_last_at + make_interval(secs => greatest(1, p_cooldown_seconds))) - v_now)))::int);
    return query select false, 'cooldown'::text, v_retry;
    return;
  end if;

  if v_email_count >= greatest(1, p_email_limit_per_hour) then
    return query select false, 'email_rate_limited'::text, 3600;
    return;
  end if;

  if p_ip is not null and v_ip_count >= greatest(1, p_ip_limit_per_hour) then
    return query select false, 'ip_rate_limited'::text, 3600;
    return;
  end if;

  insert into public.signup_abuse_events (email_hash, ip_address, user_agent)
  values (v_hash, p_ip, left(coalesce(p_user_agent, ''), 512));

  return query select true, 'ok'::text, 0;
end;
$$;

revoke all on function public.enforce_signup_abuse_protection(text, inet, text, int, int, int) from public;
grant execute on function public.enforce_signup_abuse_protection(text, inet, text, int, int, int) to service_role;

-- ── 3) Transfer reconciliation state ───────────────────────────────────────
alter table public.bridge_transfers
  add column if not exists reconciliation_status text not null default 'resolved'
    check (reconciliation_status in ('resolved', 'needs_reconciliation')),
  add column if not exists reconciliation_reason text,
  add column if not exists reconciliation_required_at timestamptz,
  add column if not exists reconciled_at timestamptz;

update public.bridge_transfers
   set reconciled_at = coalesce(reconciled_at, now())
 where reconciliation_status = 'resolved'
   and reconciled_at is null;

create index if not exists bt_reconciliation_status_idx
  on public.bridge_transfers (reconciliation_status, updated_at desc);
create index if not exists bt_reconciliation_needed_idx
  on public.bridge_transfers (updated_at desc)
  where reconciliation_status = 'needs_reconciliation';

