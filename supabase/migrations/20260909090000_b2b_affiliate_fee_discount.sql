-- Business-only affiliate program.
-- A verified BorderPay Business earns one sequential 30-day 2.50% virtual-
-- account incoming-fee window for each referred Business whose Bridge KYB is
-- approved. No cash commission is created by this lifecycle.

create table if not exists public.affiliate_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  source text not null default 'borderpay_credentials',
  joined_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.affiliate_accounts enable row level security;
drop policy if exists affiliate_accounts_self_select on public.affiliate_accounts;
create policy affiliate_accounts_self_select on public.affiliate_accounts
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists affiliate_accounts_service_role_all on public.affiliate_accounts;
create policy affiliate_accounts_service_role_all on public.affiliate_accounts
  to service_role using (true) with check (true);
revoke all on table public.affiliate_accounts from anon;
grant select on table public.affiliate_accounts to authenticated;
grant all on table public.affiliate_accounts to service_role;

create table if not exists public.affiliate_fee_discounts (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referral_id uuid not null unique references public.referrals(id) on delete cascade,
  referred_business_id uuid not null references auth.users(id) on delete cascade,
  fee_percent numeric(6,4) not null default 2.5000 check (fee_percent = 2.5000),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'pending_provider' check (status in ('pending_provider', 'scheduled', 'active', 'expired', 'revoked')),
  source text not null default 'bridge_kyb_approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending_provider' and starts_at is null and ends_at is null)
    or (status <> 'pending_provider' and starts_at is not null and ends_at > starts_at)
  )
);

create index if not exists affiliate_fee_discounts_owner_window_idx
  on public.affiliate_fee_discounts (referrer_user_id, starts_at, ends_at);

alter table public.affiliate_fee_discounts enable row level security;
drop policy if exists affiliate_fee_discounts_self_select on public.affiliate_fee_discounts;
create policy affiliate_fee_discounts_self_select on public.affiliate_fee_discounts
  for select to authenticated using (referrer_user_id = (select auth.uid()));
drop policy if exists affiliate_fee_discounts_service_role_all on public.affiliate_fee_discounts;
create policy affiliate_fee_discounts_service_role_all on public.affiliate_fee_discounts
  to service_role using (true) with check (true);
revoke all on table public.affiliate_fee_discounts from anon;
grant select on table public.affiliate_fee_discounts to authenticated;
grant all on table public.affiliate_fee_discounts to service_role;

-- Referral codes resolve only for active, verified Business members. This
-- prevents legacy Individual referral codes from creating new attribution.
create or replace function public.resolve_borderpay_referrer_id(p_referral_code text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_code text := upper(trim(coalesce(p_referral_code, '')));
  v_referrer_id uuid;
begin
  if v_code !~ '^BP[0-9A-F]{6}$' then return null; end if;

  select aa.user_id
    into v_referrer_id
    from public.affiliate_accounts aa
    join public.user_profiles up on up.id = aa.user_id
    join public.business_profiles bp on bp.user_id = aa.user_id
   where upper('BP' || substring(replace(aa.user_id::text, '-', '') from 1 for 6)) = v_code
     and aa.status = 'active'
     and lower(coalesce(up.account_type::text, '')) = 'business'
     and lower(coalesce(up.account_status::text, 'active')) not in ('frozen','suspended','blocked','deactivated','closed','offboarded','terminated')
     and lower(coalesce(bp.bridge_kyb_status::text, '')) = 'approved'
     and lower(coalesce(bp.status::text, 'active')) not in ('frozen','suspended','blocked','deactivated','closed','offboarded','terminated','rejected')
   limit 1;
  return v_referrer_id;
end;
$$;
revoke all on function public.resolve_borderpay_referrer_id(text) from public, anon, authenticated;
grant execute on function public.resolve_borderpay_referrer_id(text) to service_role;

create or replace function public.join_verified_business_affiliate(p_user_id uuid)
returns table (joined boolean, company_name text, joined_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company text;
  v_joined_at timestamptz;
  v_existing_referral record;
begin
  if p_user_id is null then raise exception 'user_required'; end if;
  if not exists (
    select 1
      from public.user_profiles up
      join public.business_profiles bp on bp.user_id = up.id
     where up.id = p_user_id
       and lower(coalesce(up.account_type::text, '')) = 'business'
       and lower(coalesce(up.account_status::text, 'active')) not in ('frozen','suspended','blocked','deactivated','closed','offboarded','terminated')
       and lower(coalesce(bp.bridge_kyb_status::text, '')) = 'approved'
       and lower(coalesce(bp.status::text, 'active')) not in ('frozen','suspended','blocked','deactivated','closed','offboarded','terminated','rejected')
  ) then
    raise exception 'verified_business_required';
  end if;

  select bp.company_name into v_company from public.business_profiles bp where bp.user_id = p_user_id;
  insert into public.affiliate_accounts (user_id, status, source, joined_at, last_accessed_at, created_at, updated_at)
  values (p_user_id, 'active', 'borderpay_credentials', now(), now(), now(), now())
  on conflict (user_id) do update
    set last_accessed_at = excluded.last_accessed_at,
        updated_at = excluded.updated_at
    where affiliate_accounts.status = 'active'
  returning affiliate_accounts.joined_at into v_joined_at;

  if v_joined_at is null then raise exception 'affiliate_access_disabled'; end if;

  -- A Business may join the portal after one of its referrals already passed
  -- KYB. Re-evaluate those rows so the reward is not lost merely because the
  -- approval webhook arrived before the inviter's first portal session.
  for v_existing_referral in
    select r.referred_id
      from public.referrals r
      join public.business_profiles referred_bp on referred_bp.user_id = r.referred_id
     where r.referrer_id = p_user_id
       and coalesce(r.suspicious, false) = false
       and lower(coalesce(referred_bp.bridge_kyb_status::text, '')) = 'approved'
  loop
    perform public.qualify_b2b_affiliate_referral(v_existing_referral.referred_id);
  end loop;

  return query select true, v_company, v_joined_at;
end;
$$;
revoke all on function public.join_verified_business_affiliate(uuid) from public, anon, authenticated;
grant execute on function public.join_verified_business_affiliate(uuid) to service_role;

create or replace function public.consume_affiliate_sso_and_join(p_jti uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consumed boolean := false;
begin
  update public.affiliate_sso_nonces
     set consumed_at = now()
   where jti = p_jti and user_id = p_user_id
     and consumed_at is null and expires_at > now();
  v_consumed := found;
  if not v_consumed then return false; end if;
  perform * from public.join_verified_business_affiliate(p_user_id);
  return true;
end;
$$;
revoke all on function public.consume_affiliate_sso_and_join(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_affiliate_sso_and_join(uuid, uuid) to service_role;

create or replace function public.qualify_b2b_affiliate_referral(p_referred_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referral public.referrals%rowtype;
  v_window_start timestamptz;
  v_requires_provider_update boolean := false;
begin
  if p_referred_business_id is null then return false; end if;
  if not exists (
    select 1 from public.user_profiles up
    join public.business_profiles bp on bp.user_id = up.id
    where up.id = p_referred_business_id
      and lower(coalesce(up.account_type::text, '')) = 'business'
      and lower(coalesce(bp.bridge_kyb_status::text, '')) = 'approved'
  ) then return false; end if;

  select r.* into v_referral
    from public.referrals r
   where r.referred_id = p_referred_business_id
     and coalesce(r.suspicious, false) = false
   order by r.referred_at asc
   limit 1;
  if not found then return false; end if;

  if not exists (
    select 1 from public.affiliate_accounts aa
    join public.user_profiles up on up.id = aa.user_id
    join public.business_profiles bp on bp.user_id = aa.user_id
    where aa.user_id = v_referral.referrer_id
      and aa.status = 'active'
      and lower(coalesce(up.account_type::text, '')) = 'business'
      and lower(coalesce(up.account_status::text, 'active')) not in ('frozen','suspended','blocked','deactivated','closed','offboarded','terminated')
      and lower(coalesce(bp.bridge_kyb_status::text, '')) = 'approved'
      and lower(coalesce(bp.status::text, 'active')) not in ('frozen','suspended','blocked','deactivated','closed','offboarded','terminated','rejected')
  ) then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_referral.referrer_id::text, 0));
  if exists (select 1 from public.affiliate_fee_discounts where referral_id = v_referral.id) then return true; end if;

  select exists (
    select 1 from public.bridge_virtual_accounts va
     where coalesce(va.business_user_id, va.user_id) = v_referral.referrer_id
       and lower(coalesce(va.status::text, '')) = 'active'
       and coalesce(va.developer_fee_percent, 100) > 2.5000
  ) into v_requires_provider_update;

  if not v_requires_provider_update then
    select greatest(now(), coalesce(max(ends_at) filter (where status not in ('revoked','pending_provider')), now()))
      into v_window_start
      from public.affiliate_fee_discounts
     where referrer_user_id = v_referral.referrer_id;
  end if;

  insert into public.affiliate_fee_discounts (
    referrer_user_id, referral_id, referred_business_id, fee_percent,
    starts_at, ends_at, status, source
  ) values (
    v_referral.referrer_id, v_referral.id, p_referred_business_id, 2.5000,
    v_window_start, case when v_window_start is null then null else v_window_start + interval '30 days' end,
    case when v_requires_provider_update then 'pending_provider'
         when v_window_start <= now() then 'active' else 'scheduled' end,
    'bridge_kyb_approved'
  );

  update public.referrals
     set status = 'qualified', qualified_at = coalesce(qualified_at, now())
   where id = v_referral.id;
  return true;
end;
$$;
revoke all on function public.qualify_b2b_affiliate_referral(uuid) from public, anon, authenticated;
grant execute on function public.qualify_b2b_affiliate_referral(uuid) to service_role;

create or replace function public.activate_b2b_affiliate_discount(p_referral_id uuid, p_provider_confirmed boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_discount public.affiliate_fee_discounts%rowtype;
  v_window_start timestamptz;
begin
  if p_provider_confirmed is distinct from true then raise exception 'provider_confirmation_required'; end if;
  select * into v_discount from public.affiliate_fee_discounts where referral_id = p_referral_id for update;
  if not found then raise exception 'discount_not_found'; end if;
  if v_discount.status <> 'pending_provider' then return true; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_discount.referrer_user_id::text, 0));
  select greatest(now(), coalesce(max(ends_at) filter (where status not in ('revoked','pending_provider')), now()))
    into v_window_start from public.affiliate_fee_discounts
   where referrer_user_id = v_discount.referrer_user_id;
  update public.affiliate_fee_discounts
     set starts_at = v_window_start,
         ends_at = v_window_start + interval '30 days',
         status = case when v_window_start <= now() then 'active' else 'scheduled' end,
         updated_at = now()
   where id = v_discount.id;
  return true;
end;
$$;
revoke all on function public.activate_b2b_affiliate_discount(uuid, boolean) from public, anon, authenticated;
grant execute on function public.activate_b2b_affiliate_discount(uuid, boolean) to service_role;

create or replace function public.handle_b2b_affiliate_kyb_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.bridge_kyb_status::text, '')) = 'approved'
     and (tg_op = 'INSERT' or lower(coalesce(old.bridge_kyb_status::text, '')) is distinct from 'approved') then
    perform public.qualify_b2b_affiliate_referral(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_b2b_affiliate_kyb_approval on public.business_profiles;
create trigger trg_b2b_affiliate_kyb_approval
after insert or update of bridge_kyb_status on public.business_profiles
for each row execute function public.handle_b2b_affiliate_kyb_approval();

create or replace function public.get_b2b_affiliate_summary(p_user_id uuid)
returns table (
  company_name text, total_referrals integer, kyb_approved_referrals integer,
  pending_referrals integer, discount_fee_percent numeric, discount_active boolean,
  current_window_starts_at timestamptz, current_window_ends_at timestamptz,
  queued_discount_windows integer, pending_provider_windows integer,
  remaining_discount_days integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is distinct from p_user_id and not public.is_borderpay_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.affiliate_accounts where user_id = p_user_id and status = 'active') then raise exception 'affiliate_access_required'; end if;
  return query
  with business_refs as (
    select r.id, bp.bridge_kyb_status
      from public.referrals r
      join public.user_profiles up on up.id = r.referred_id and lower(coalesce(up.account_type::text,'')) = 'business'
      join public.business_profiles bp on bp.user_id = r.referred_id
     where r.referrer_id = p_user_id and coalesce(r.suspicious,false) = false
  ), current_window as (
    select d.starts_at, d.ends_at
      from public.affiliate_fee_discounts d
     where d.referrer_user_id = p_user_id and d.status <> 'revoked'
       and d.starts_at <= now() and d.ends_at > now()
     order by d.ends_at desc limit 1
  )
  select
    bp.company_name,
    count(br.id)::int,
    count(br.id) filter (where lower(coalesce(br.bridge_kyb_status::text,'')) = 'approved')::int,
    count(br.id) filter (where lower(coalesce(br.bridge_kyb_status::text,'')) <> 'approved')::int,
    2.5000::numeric,
    exists(select 1 from current_window),
    (select starts_at from current_window),
    (select ends_at from current_window),
    (select count(*)::int from public.affiliate_fee_discounts d where d.referrer_user_id = p_user_id and d.status <> 'revoked' and d.starts_at > now()),
    (select count(*)::int from public.affiliate_fee_discounts d where d.referrer_user_id = p_user_id and d.status = 'pending_provider'),
    coalesce(ceil(extract(epoch from ((select ends_at from current_window) - now())) / 86400.0), 0)::int
  from public.business_profiles bp left join business_refs br on true
  where bp.user_id = p_user_id
  group by bp.company_name;
end;
$$;
revoke all on function public.get_b2b_affiliate_summary(uuid) from public, anon;
grant execute on function public.get_b2b_affiliate_summary(uuid) to authenticated, service_role;

create or replace function public.get_b2b_affiliate_referrals(p_user_id uuid)
returns table (
  id uuid, referred_business_id uuid, company_name text, country text, status text,
  referred_signup_at timestamptz, kyb_approved boolean, qualified_at timestamptz,
  discount_starts_at timestamptz, discount_ends_at timestamptz, discount_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is distinct from p_user_id and not public.is_borderpay_admin() then raise exception 'forbidden'; end if;
  return query
  select r.id, r.referred_id, bp.company_name, r.country,
    case when lower(coalesce(bp.bridge_kyb_status::text,'')) = 'approved' then 'kyb_approved' else 'kyb_pending' end,
    r.referred_at, lower(coalesce(bp.bridge_kyb_status::text,'')) = 'approved', r.qualified_at,
    d.starts_at, d.ends_at,
    case when d.status = 'pending_provider' then 'pending_provider'
         when d.status = 'revoked' then 'revoked'
         when d.starts_at > now() then 'scheduled'
         when d.ends_at <= now() then 'expired'
         else 'active' end
  from public.referrals r
  join public.user_profiles up on up.id = r.referred_id and lower(coalesce(up.account_type::text,'')) = 'business'
  join public.business_profiles bp on bp.user_id = r.referred_id
  left join public.affiliate_fee_discounts d on d.referral_id = r.id
  where r.referrer_id = p_user_id and coalesce(r.suspicious,false) = false
  order by r.referred_at desc;
end;
$$;
revoke all on function public.get_b2b_affiliate_referrals(uuid) from public, anon;
grant execute on function public.get_b2b_affiliate_referrals(uuid) to authenticated, service_role;

-- Preserve the existing fee-loader contract. Without a currently active B2B
-- discount, return 100 so the caller's min(base_fee, affiliate_fee) leaves the
-- currency-specific 3.00% USD / 2.98% EUR+GBP policy unchanged.
drop function if exists public.get_affiliate_onramp_fee_tier(uuid);
create function public.get_affiliate_onramp_fee_tier(p_user_id uuid)
returns table (
  active_referrals integer, developer_fee_percent numeric, tier_name text,
  next_threshold integer, next_developer_fee_percent numeric,
  dashboard_action_required boolean, total_referrals integer,
  verified_referrals integer, unverified_referrals integer,
  transaction_referrals integer, reward_per_transaction_referral numeric,
  monthly_bonus numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with refs as (
    select count(*)::int as total,
      count(*) filter (where lower(coalesce(bp.bridge_kyb_status::text,'')) = 'approved')::int as approved
    from public.referrals r
    join public.user_profiles up on up.id = r.referred_id and lower(coalesce(up.account_type::text,'')) = 'business'
    join public.business_profiles bp on bp.user_id = r.referred_id
    where r.referrer_id = p_user_id and coalesce(r.suspicious,false) = false
  ), active_discount as (
    select exists(
      select 1 from public.affiliate_fee_discounts d
      where d.referrer_user_id = p_user_id and d.status <> 'revoked'
        and d.starts_at <= now() and d.ends_at > now()
    ) as active
  )
  select refs.approved, case when active_discount.active then 2.5000 else 100.0000 end,
    case when active_discount.active then 'B2B referral discount' else 'Standard business pricing' end,
    null::integer, null::numeric, false, refs.total, refs.approved,
    greatest(refs.total - refs.approved, 0), refs.approved, 0::numeric, 0::numeric
  from refs cross join active_discount;
$$;
revoke all on function public.get_affiliate_onramp_fee_tier(uuid) from public;
grant execute on function public.get_affiliate_onramp_fee_tier(uuid) to authenticated, service_role;

-- Retire the former consumer cash-reward path. Historical earnings remain
-- intact for audit, but new transactions must never create cash awards or
-- qualify a referral: Business KYB approval is the sole qualification event.
drop trigger if exists trg_affiliate_transactions_first_tx on public.transactions;
drop trigger if exists trg_affiliate_stablecoin_first_tx on public.stablecoin_transactions;
drop trigger if exists trg_affiliate_bridge_transfer_first_tx on public.bridge_transfers;

create or replace function public.award_affiliate_first_transaction(p_referred_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return;
end;
$$;
revoke all on function public.award_affiliate_first_transaction(uuid) from public, anon, authenticated;
grant execute on function public.award_affiliate_first_transaction(uuid) to service_role;
