-- Auditable affiliate tier overrides.
-- Use this for commercial exceptions without falsifying referral counts,
-- verification state, or first-transaction rewards.

create table if not exists public.affiliate_tier_overrides (
  user_id uuid primary key,
  tier_name text not null,
  developer_fee_percent numeric not null,
  reward_per_transaction_referral numeric not null default 0,
  monthly_bonus numeric not null default 0,
  next_threshold integer,
  next_developer_fee_percent numeric,
  active boolean not null default true,
  reason text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_tier_overrides_active_idx
  on public.affiliate_tier_overrides (active, user_id);

alter table public.affiliate_tier_overrides enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'affiliate_tier_overrides'
      and policyname = 'affiliate_tier_overrides_service_role_all'
  ) then
    create policy affiliate_tier_overrides_service_role_all
      on public.affiliate_tier_overrides
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

create or replace function public.get_affiliate_onramp_fee_tier(p_user_id uuid)
returns table (
  active_referrals integer,
  developer_fee_percent numeric,
  tier_name text,
  next_threshold integer,
  next_developer_fee_percent numeric,
  dashboard_action_required boolean,
  total_referrals integer,
  verified_referrals integer,
  unverified_referrals integer,
  transaction_referrals integer,
  reward_per_transaction_referral numeric,
  monthly_bonus numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_verified int := 0;
  v_unverified int := 0;
  v_transaction_referrals int := 0;
  v_fee numeric := 2.5;
  v_name text := 'Applicant';
  v_next_threshold int := 5;
  v_next_fee numeric := 2.5;
  v_reward numeric := 0;
  v_monthly numeric := 0;
  v_override record;
begin
  with referred as (
    select
      r.id,
      r.referred_id,
      r.status,
      up.kyc_status::text as kyc_status,
      up.bridge_kyc_status::text as bridge_kyc_status,
      exists (
        select 1
          from public.transactions t
         where t.user_id = r.referred_id
           and lower(coalesce(t.status::text, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled')
      ) or exists (
        select 1
          from public.bridge_transfers bt
         where (bt.user_id = r.referred_id or bt.business_user_id = r.referred_id)
           and lower(coalesce(bt.state, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled')
      ) or exists (
        select 1
          from public.stablecoin_transactions st
         where st.user_id = r.referred_id
           and lower(coalesce(st.status::text, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled')
      ) as has_transaction
    from public.referrals r
    left join public.user_profiles up on up.id = r.referred_id
    where r.referrer_id = p_user_id
  )
  select
    count(*)::int,
    count(*) filter (
      where lower(coalesce(status, '')) in ('qualified', 'paid', 'converted', 'completed')
         or lower(coalesce(kyc_status, '')) in ('verified', 'approved')
         or lower(coalesce(bridge_kyc_status, '')) = 'approved'
    )::int,
    count(*) filter (where has_transaction or lower(coalesce(status, '')) in ('qualified', 'paid', 'converted', 'completed'))::int
    into v_total, v_verified, v_transaction_referrals
    from referred;

  v_unverified := greatest(v_total - v_verified, 0);

  if v_verified >= 1000 then
    v_fee := 0;
    v_name := 'Master 1000';
    v_next_threshold := null;
    v_next_fee := null;
    v_reward := 10;
    v_monthly := 500;
  elsif v_verified >= 500 then
    v_fee := 0.5;
    v_name := 'Partner 500';
    v_next_threshold := 1000;
    v_next_fee := 0;
    v_reward := 10;
    v_monthly := 300;
  elsif v_verified >= 100 then
    v_fee := 1.0;
    v_name := 'Scale 100';
    v_next_threshold := 500;
    v_next_fee := 0.5;
    v_reward := 10;
  elsif v_verified >= 50 then
    v_fee := 1.5;
    v_name := 'Level 2';
    v_next_threshold := 100;
    v_next_fee := 1.0;
    v_reward := 5;
  elsif v_verified >= 20 then
    v_fee := 2.0;
    v_name := 'Level 1';
    v_next_threshold := 50;
    v_next_fee := 1.5;
    v_reward := 5;
  elsif v_verified >= 5 then
    v_fee := 2.5;
    v_name := 'Starter';
    v_next_threshold := 20;
    v_next_fee := 2.0;
    v_reward := 5;
  end if;

  select *
    into v_override
    from public.affiliate_tier_overrides ato
   where ato.user_id = p_user_id
     and ato.active = true
   limit 1;

  if found then
    v_fee := v_override.developer_fee_percent;
    v_name := v_override.tier_name;
    v_reward := v_override.reward_per_transaction_referral;
    v_monthly := v_override.monthly_bonus;
    v_next_threshold := v_override.next_threshold;
    v_next_fee := v_override.next_developer_fee_percent;
  end if;

  return query select
    v_verified,
    v_fee,
    v_name,
    v_next_threshold,
    v_next_fee,
    v_fee = 0,
    v_total,
    v_verified,
    v_unverified,
    v_transaction_referrals,
    v_reward,
    v_monthly;
end;
$$;

revoke all on function public.get_affiliate_onramp_fee_tier(uuid) from public;
grant execute on function public.get_affiliate_onramp_fee_tier(uuid) to authenticated, service_role;
