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
  p_new_hash_v2 text default null,
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


