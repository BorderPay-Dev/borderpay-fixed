-- Live affiliate attribution for main app signups.
-- The current production referral tables use referrer_id/referred_id, while
-- the standalone affiliate portal used an older affiliates/referral_code shape.

create or replace function public.resolve_borderpay_referrer_id(p_referral_code text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code text := upper(trim(coalesce(p_referral_code, '')));
  v_referrer_id uuid;
begin
  if v_code !~ '^BP[0-9A-F]{6}$' then
    return null;
  end if;

  select u.id
    into v_referrer_id
    from public.users u
   where upper('BP' || substring(replace(u.id::text, '-', '') from 1 for 6)) = v_code
   order by u.id asc
   limit 1;

  if v_referrer_id is null then
    select au.id
      into v_referrer_id
      from auth.users au
     where upper('BP' || substring(replace(au.id::text, '-', '') from 1 for 6)) = v_code
     order by au.created_at asc nulls last
     limit 1;
  end if;

  return v_referrer_id;
end;
$$;

revoke all on function public.resolve_borderpay_referrer_id(text) from public;
grant execute on function public.resolve_borderpay_referrer_id(text) to service_role;

create or replace function public.track_borderpay_referral_signup(
  p_referral_code text,
  p_referred_id uuid,
  p_country text default null,
  p_device_hash text default null,
  p_ip_hash text default null
)
returns table (
  tracked boolean,
  reason text,
  referrer_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_referral_code, '')));
  v_referrer_id uuid;
  v_commission numeric := 5.00;
begin
  if p_referred_id is null then
    return query select false, 'missing_referred_user'::text, null::uuid;
    return;
  end if;

  v_referrer_id := public.resolve_borderpay_referrer_id(v_code);
  if v_referrer_id is null then
    return query select false, 'unknown_referral_code'::text, null::uuid;
    return;
  end if;

  if v_referrer_id = p_referred_id then
    return query select false, 'self_referral_blocked'::text, v_referrer_id;
    return;
  end if;

  if exists (select 1 from public.referrals where referred_id = p_referred_id) then
    return query select false, 'already_attributed'::text, v_referrer_id;
    return;
  end if;

  if exists (
    select 1
      from public.referrals
     where referrer_id = p_referred_id
       and referred_id = v_referrer_id
  ) then
    return query select false, 'recursive_referral_blocked'::text, v_referrer_id;
    return;
  end if;

  select coalesce(rc.commission_per_referral, v_commission)
    into v_commission
    from public.referral_config rc
   where coalesce(rc.program_status, 'active') = 'active'
   order by rc.updated_at desc nulls last
   limit 1;

  insert into public.referrals (
    referrer_id,
    referred_id,
    status,
    commission,
    country,
    device_hash,
    ip_hash,
    suspicious
  )
  values (
    v_referrer_id,
    p_referred_id,
    'pending',
    coalesce(v_commission, 5.00),
    nullif(upper(trim(coalesce(p_country, ''))), ''),
    nullif(trim(coalesce(p_device_hash, '')), ''),
    nullif(trim(coalesce(p_ip_hash, '')), ''),
    false
  );

  return query select true, 'tracked'::text, v_referrer_id;
exception
  when unique_violation then
    return query select false, 'already_attributed'::text, v_referrer_id;
end;
$$;

revoke all on function public.track_borderpay_referral_signup(text, uuid, text, text, text) from public;
grant execute on function public.track_borderpay_referral_signup(text, uuid, text, text, text) to service_role;
