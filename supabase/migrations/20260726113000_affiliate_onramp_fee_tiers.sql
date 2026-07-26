drop function if exists public.get_affiliate_program_summary(uuid);
drop function if exists public.get_affiliate_referrals(uuid);
drop function if exists public.get_affiliate_onramp_fee_tier(uuid);

-- Affiliate program tiers.
-- Level is based on verified referred users. Per-referral rewards are earned
-- only after the referred user makes a first qualifying transaction.

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

create or replace function public.get_affiliate_program_summary(p_user_id uuid)
returns table (
  total_referrals integer,
  verified_referrals integer,
  unverified_referrals integer,
  transaction_referrals integer,
  level_name text,
  developer_fee_percent numeric,
  reward_per_transaction_referral numeric,
  monthly_bonus numeric,
  next_threshold integer,
  next_developer_fee_percent numeric,
  pending_balance numeric,
  total_earned numeric,
  paid_out numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with tier as (
    select * from public.get_affiliate_onramp_fee_tier(p_user_id)
  ),
  earnings as (
    select
      coalesce(sum(amount) filter (where lower(coalesce(status, '')) not in ('failed', 'cancelled', 'canceled', 'rejected')), 0)::numeric as total_earned,
      coalesce(sum(amount) filter (where lower(coalesce(status, '')) in ('pending', 'earned', 'processing')), 0)::numeric as pending_balance
    from public.referral_earnings
    where user_id = p_user_id
  ),
  payouts as (
    select coalesce(sum(amount) filter (where lower(coalesce(status, '')) in ('paid', 'completed', 'success', 'succeeded')), 0)::numeric as paid_out
    from public.referral_payouts
    where user_id = p_user_id
  )
  select
    tier.total_referrals,
    tier.verified_referrals,
    tier.unverified_referrals,
    tier.transaction_referrals,
    tier.tier_name,
    tier.developer_fee_percent,
    tier.reward_per_transaction_referral,
    tier.monthly_bonus,
    tier.next_threshold,
    tier.next_developer_fee_percent,
    earnings.pending_balance,
    earnings.total_earned,
    payouts.paid_out
  from tier, earnings, payouts;
end;
$$;

revoke all on function public.get_affiliate_program_summary(uuid) from public;
grant execute on function public.get_affiliate_program_summary(uuid) to authenticated, service_role;

create or replace function public.get_affiliate_referrals(p_user_id uuid)
returns table (
  id uuid,
  referred_user_id uuid,
  country text,
  status text,
  commission_amount numeric,
  referred_signup_at timestamptz,
  qualified_at timestamptz,
  paid_at timestamptz,
  verified boolean,
  has_transaction boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    r.id,
    r.referred_id,
    r.country,
    r.status,
    r.commission,
    r.referred_at,
    r.qualified_at,
    r.paid_at,
    (
      lower(coalesce(r.status, '')) in ('qualified', 'paid', 'converted', 'completed')
      or lower(coalesce(up.kyc_status::text, '')) in ('verified', 'approved')
      or lower(coalesce(up.bridge_kyc_status::text, '')) = 'approved'
    ) as verified,
    (
      lower(coalesce(r.status, '')) in ('qualified', 'paid', 'converted', 'completed')
      or exists (
        select 1 from public.transactions t
        where t.user_id = r.referred_id
          and lower(coalesce(t.status::text, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled')
      )
      or exists (
        select 1 from public.bridge_transfers bt
        where (bt.user_id = r.referred_id or bt.business_user_id = r.referred_id)
          and lower(coalesce(bt.state, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled')
      )
      or exists (
        select 1 from public.stablecoin_transactions st
        where st.user_id = r.referred_id
          and lower(coalesce(st.status::text, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled')
      )
    ) as has_transaction
  from public.referrals r
  left join public.user_profiles up on up.id = r.referred_id
  where r.referrer_id = p_user_id
  order by r.created_at desc;
end;
$$;

revoke all on function public.get_affiliate_referrals(uuid) from public;
grant execute on function public.get_affiliate_referrals(uuid) to authenticated, service_role;
