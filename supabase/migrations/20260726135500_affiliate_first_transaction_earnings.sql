-- Affiliate earnings are created only after the referred user makes a first
-- qualifying transaction. Referral rows may store the potential reward, but
-- affiliate balances must be sourced from referral_earnings only.

create unique index if not exists referral_earnings_referral_id_unique
  on public.referral_earnings (referral_id)
  where referral_id is not null;

create or replace function public.award_affiliate_first_transaction(p_referred_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral record;
  v_tier record;
  v_amount numeric := 0;
begin
  if p_referred_id is null then
    return;
  end if;

  select r.*
    into v_referral
    from public.referrals r
   where r.referred_id = p_referred_id
     and not exists (
       select 1
         from public.referral_earnings re
        where re.referral_id = r.id
     )
   order by r.created_at asc
   limit 1;

  if not found then
    return;
  end if;

  select *
    into v_tier
    from public.get_affiliate_onramp_fee_tier(v_referral.referrer_id)
   limit 1;

  v_amount := coalesce(v_tier.reward_per_transaction_referral, 0);
  if v_amount <= 0 then
    return;
  end if;

  insert into public.referral_earnings (
    user_id,
    referral_id,
    amount,
    status
  )
  values (
    v_referral.referrer_id,
    v_referral.id,
    v_amount,
    'pending'
  )
  on conflict (referral_id) where referral_id is not null do nothing;

  update public.referrals r
     set status = case
         when lower(coalesce(r.status, '')) in ('paid', 'completed') then r.status
         else 'qualified'
       end,
       qualified_at = coalesce(r.qualified_at, now())
   where r.id = v_referral.id;
end;
$$;

revoke all on function public.award_affiliate_first_transaction(uuid) from public;
grant execute on function public.award_affiliate_first_transaction(uuid) to service_role;

create or replace function public.handle_affiliate_transaction_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.status::text, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled') then
    perform public.award_affiliate_first_transaction(new.user_id);
  end if;
  return new;
end;
$$;

create or replace function public.handle_affiliate_stablecoin_transaction_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.status::text, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled') then
    perform public.award_affiliate_first_transaction(new.user_id);
  end if;
  return new;
end;
$$;

create or replace function public.handle_affiliate_bridge_transfer_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.state, '')) in ('completed', 'success', 'successful', 'succeeded', 'settled') then
    perform public.award_affiliate_first_transaction(new.user_id);
    perform public.award_affiliate_first_transaction(new.business_user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_affiliate_transactions_first_tx on public.transactions;
create trigger trg_affiliate_transactions_first_tx
after insert or update of status on public.transactions
for each row execute function public.handle_affiliate_transaction_row();

drop trigger if exists trg_affiliate_stablecoin_first_tx on public.stablecoin_transactions;
create trigger trg_affiliate_stablecoin_first_tx
after insert or update of status on public.stablecoin_transactions
for each row execute function public.handle_affiliate_stablecoin_transaction_row();

drop trigger if exists trg_affiliate_bridge_transfer_first_tx on public.bridge_transfers;
create trigger trg_affiliate_bridge_transfer_first_tx
after insert or update of state on public.bridge_transfers
for each row execute function public.handle_affiliate_bridge_transfer_row();

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
  with rows as (
    select
      r.id,
      r.referred_id,
      r.country,
      r.status,
      r.referred_at,
      r.qualified_at,
      r.paid_at,
      up.kyc_status::text as kyc_status,
      up.bridge_kyc_status::text as bridge_kyc_status,
      coalesce(re.amount, 0)::numeric as earned_amount,
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
    left join public.referral_earnings re on re.referral_id = r.id
    where r.referrer_id = p_user_id
  )
  select
    rows.id,
    rows.referred_id,
    rows.country,
    rows.status,
    rows.earned_amount,
    rows.referred_at,
    rows.qualified_at,
    rows.paid_at,
    (
      lower(coalesce(rows.status, '')) in ('qualified', 'paid', 'converted', 'completed')
      or lower(coalesce(rows.kyc_status, '')) in ('verified', 'approved')
      or lower(coalesce(rows.bridge_kyc_status, '')) = 'approved'
    ) as verified,
    rows.has_transaction
  from rows
  order by rows.referred_at desc;
end;
$$;

revoke all on function public.get_affiliate_referrals(uuid) from public;
grant execute on function public.get_affiliate_referrals(uuid) to authenticated, service_role;
