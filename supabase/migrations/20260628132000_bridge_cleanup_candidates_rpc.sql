set search_path = public, pg_temp;

create or replace function public.get_bridge_cleanup_candidates(
  p_limit integer default 10,
  p_age_days integer default 5
)
returns table (
  user_id uuid,
  email text,
  account_type text,
  bridge_customer_id text,
  created_at timestamptz,
  bridge_kyc_status text,
  bridge_kyb_status text,
  bridge_kyc_link_id text,
  bridge_kyb_link_id text,
  va_count integer,
  wallet_count integer,
  transfer_count integer,
  external_count integer
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      up.id as user_id,
      up.email,
      coalesce(nullif(lower(up.account_type::text), ''), 'individual') as account_type,
      up.bridge_customer_id,
      up.created_at,
      lower(coalesce(up.bridge_kyc_status::text, 'not_started')) as bridge_kyc_status,
      lower(coalesce(up.bridge_kyc_link_id, '')) as bridge_kyc_link_id
    from public.user_profiles up
    where up.bridge_customer_id is not null
      and up.created_at <= (now() - make_interval(days => greatest(p_age_days, 1)))
      and lower(coalesce(up.bridge_kyc_status::text, 'not_started')) = 'not_started'
      and coalesce(up.bridge_kyc_link_id, '') = ''
  ),
  biz as (
    select
      bp.user_id,
      lower(coalesce(bp.bridge_kyb_status::text, 'not_started')) as bridge_kyb_status,
      lower(coalesce(bp.bridge_kyb_link_id, '')) as bridge_kyb_link_id
    from public.business_profiles bp
  ),
  counts as (
    select
      b.user_id,
      (
        select count(*)::integer
        from public.bridge_virtual_accounts va
        where va.user_id = b.user_id or va.business_user_id = b.user_id
      ) as va_count,
      (
        select count(*)::integer
        from public.bridge_wallets w
        where w.user_id = b.user_id or w.business_user_id = b.user_id
      ) as wallet_count,
      (
        select count(*)::integer
        from public.transactions t
        where t.user_id = b.user_id
      ) as transfer_count,
      (
        select count(*)::integer
        from public.bridge_external_accounts ea
        where ea.user_id = b.user_id
      ) as external_count
    from base b
  )
  select
    b.user_id,
    b.email,
    b.account_type,
    b.bridge_customer_id,
    b.created_at,
    b.bridge_kyc_status,
    bz.bridge_kyb_status,
    nullif(b.bridge_kyc_link_id, '') as bridge_kyc_link_id,
    nullif(bz.bridge_kyb_link_id, '') as bridge_kyb_link_id,
    c.va_count,
    c.wallet_count,
    c.transfer_count,
    c.external_count
  from base b
  left join biz bz on bz.user_id = b.user_id
  join counts c on c.user_id = b.user_id
  where coalesce(c.va_count, 0) = 0
    and coalesce(c.wallet_count, 0) = 0
    and coalesce(c.transfer_count, 0) = 0
    and coalesce(c.external_count, 0) = 0
    and (
      b.account_type <> 'business'
      or (
        coalesce(bz.bridge_kyb_status, 'not_started') = 'not_started'
        and coalesce(bz.bridge_kyb_link_id, '') = ''
      )
    )
  order by b.created_at asc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.get_bridge_cleanup_candidates(integer, integer) from public, anon, authenticated;
grant execute on function public.get_bridge_cleanup_candidates(integer, integer) to service_role;
