-- GTM affiliate program configuration.
-- The full tier ladder must live in the backend so admin, affiliate portal,
-- and VA fee logic all read the same source of truth.

alter table public.referral_config
  add column if not exists program_name text not null default 'BorderPay Affiliate Program',
  add column if not exists tier_rules jsonb not null default '[]'::jsonb;

create table if not exists public.affiliate_tier_config (
  tier_key text primary key,
  tier_name text not null,
  min_verified_referrals integer not null,
  max_verified_referrals integer,
  developer_fee_percent numeric not null,
  reward_per_transaction_referral numeric not null default 0,
  monthly_bonus numeric not null default 0,
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_tier_config_active_sort_idx
  on public.affiliate_tier_config (active, sort_order);

alter table public.affiliate_tier_config enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'affiliate_tier_config'
      and policyname = 'affiliate_tier_config_read_authenticated'
  ) then
    create policy affiliate_tier_config_read_authenticated
      on public.affiliate_tier_config
      for select
      to authenticated
      using (active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'affiliate_tier_config'
      and policyname = 'affiliate_tier_config_service_role_all'
  ) then
    create policy affiliate_tier_config_service_role_all
      on public.affiliate_tier_config
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

insert into public.affiliate_tier_config (
  tier_key,
  tier_name,
  min_verified_referrals,
  max_verified_referrals,
  developer_fee_percent,
  reward_per_transaction_referral,
  monthly_bonus,
  sort_order,
  active,
  updated_at
)
values
  ('applicant', 'Applicant', 0, 4, 2.50, 0.00, 0.00, 10, true, now()),
  ('starter', 'Starter', 5, 19, 2.50, 5.00, 0.00, 20, true, now()),
  ('level_1', 'Level 1', 20, 49, 2.00, 5.00, 0.00, 30, true, now()),
  ('level_2', 'Level 2', 50, 99, 1.50, 5.00, 0.00, 40, true, now()),
  ('scale_100', 'Scale 100', 100, 499, 1.00, 10.00, 0.00, 50, true, now()),
  ('partner_500', 'Partner 500', 500, 999, 0.50, 10.00, 300.00, 60, true, now()),
  ('master_1000', 'Master 1000', 1000, null, 0.00, 10.00, 500.00, 70, true, now())
on conflict (tier_key) do update set
  tier_name = excluded.tier_name,
  min_verified_referrals = excluded.min_verified_referrals,
  max_verified_referrals = excluded.max_verified_referrals,
  developer_fee_percent = excluded.developer_fee_percent,
  reward_per_transaction_referral = excluded.reward_per_transaction_referral,
  monthly_bonus = excluded.monthly_bonus,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

insert into public.referral_config (
  commission_per_referral,
  min_payout_threshold,
  payout_destination,
  link_expiry_days,
  program_status,
  max_referrals_per_day,
  flag_threshold,
  updated_by,
  program_name,
  tier_rules
)
select
  5.00,
  100.00,
  'borderpay_wallet',
  365,
  'active',
  1000,
  50,
  'gtm_tier_config_seed',
  'BorderPay Affiliate Program',
  '[]'::jsonb
where not exists (select 1 from public.referral_config);

update public.referral_config
   set program_name = 'BorderPay Affiliate Program',
       commission_per_referral = 5.00,
       min_payout_threshold = 100.00,
       payout_destination = 'borderpay_wallet',
       link_expiry_days = greatest(link_expiry_days, 365),
       program_status = 'active',
       max_referrals_per_day = greatest(max_referrals_per_day, 1000),
       tier_rules = (
         select jsonb_agg(
           jsonb_build_object(
             'tier_key', tier_key,
             'tier_name', tier_name,
             'min_verified_referrals', min_verified_referrals,
             'max_verified_referrals', max_verified_referrals,
             'developer_fee_percent', developer_fee_percent,
             'reward_per_transaction_referral', reward_per_transaction_referral,
             'monthly_bonus', monthly_bonus
           )
           order by sort_order
         )
         from public.affiliate_tier_config
         where active = true
       ),
       updated_by = 'gtm_tier_config_seed',
       updated_at = now()
 where coalesce(program_status, 'active') = 'active';

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
  v_tier public.affiliate_tier_config%rowtype;
  v_next public.affiliate_tier_config%rowtype;
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

  select *
    into v_tier
    from public.affiliate_tier_config atc
   where atc.active = true
     and v_verified >= atc.min_verified_referrals
     and (atc.max_verified_referrals is null or v_verified <= atc.max_verified_referrals)
   order by atc.min_verified_referrals desc
   limit 1;

  if not found then
    select *
      into v_tier
      from public.affiliate_tier_config atc
     where atc.active = true
     order by atc.min_verified_referrals asc
     limit 1;
  end if;

  select *
    into v_next
    from public.affiliate_tier_config atc
   where atc.active = true
     and atc.min_verified_referrals > v_verified
   order by atc.min_verified_referrals asc
   limit 1;

  select *
    into v_override
    from public.affiliate_tier_overrides ato
   where ato.user_id = p_user_id
     and ato.active = true
   limit 1;

  if found then
    return query select
      v_verified,
      v_override.developer_fee_percent::numeric,
      v_override.tier_name::text,
      v_override.next_threshold::integer,
      v_override.next_developer_fee_percent::numeric,
      v_override.developer_fee_percent = 0,
      v_total,
      v_verified,
      v_unverified,
      v_transaction_referrals,
      v_override.reward_per_transaction_referral::numeric,
      v_override.monthly_bonus::numeric;
    return;
  end if;

  return query select
    v_verified,
    coalesce(v_tier.developer_fee_percent, 2.5),
    coalesce(v_tier.tier_name, 'Applicant'),
    v_next.min_verified_referrals,
    v_next.developer_fee_percent,
    coalesce(v_tier.developer_fee_percent, 2.5) = 0,
    v_total,
    v_verified,
    v_unverified,
    v_transaction_referrals,
    coalesce(v_tier.reward_per_transaction_referral, 0),
    coalesce(v_tier.monthly_bonus, 0);
end;
$$;

revoke all on function public.get_affiliate_onramp_fee_tier(uuid) from public;
grant execute on function public.get_affiliate_onramp_fee_tier(uuid) to authenticated, service_role;
