-- Verified existing customers earn 30 days of reduced incoming fees per approved Business referral.
begin;
create or replace function public.affiliate_member_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.user_profiles up left join public.business_profiles bp on bp.user_id=up.id
 where up.id=p_user_id and up.account_frozen_at is null
 and lower(coalesce(up.account_status::text,'')) not in ('frozen','paused','suspended','blocked','deactivated','closed','offboarded','terminated','rejected')
 and lower(coalesce(up.bridge_account_status::text,'')) in ('active','approved')
 and case when up.account_type='business' then lower(coalesce(bp.bridge_kyb_status::text,''))='approved'
   and lower(coalesce(bp.status::text,'')) not in ('frozen','paused','suspended','blocked','deactivated','closed','offboarded','terminated','rejected')
   and nullif(btrim(coalesce(bp.bridge_customer_id,up.bridge_customer_id)), '') is not null
 else up.account_type='individual' and lower(coalesce(up.bridge_kyc_status::text,''))='approved'
   and nullif(btrim(up.bridge_customer_id),'') is not null end);
$$;
revoke all on function public.affiliate_member_eligible(uuid) from public,anon,authenticated;
grant execute on function public.affiliate_member_eligible(uuid) to service_role;

create or replace function public.join_verified_business_affiliate(p_user_id uuid)
returns table(joined boolean,company_name text,joined_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare joined_time timestamptz; r record;
begin
 if not public.affiliate_member_eligible(p_user_id) then raise exception 'verified_account_required'; end if;
 insert into public.affiliate_accounts(user_id,status,source) values(p_user_id,'active','borderpay_credentials')
 on conflict(user_id) do update set last_accessed_at=now(),updated_at=now() where affiliate_accounts.status='active'
 returning affiliate_accounts.joined_at into joined_time;
 if joined_time is null then raise exception 'affiliate_access_disabled'; end if;
 for r in select referred_id from public.referrals where referrer_id=p_user_id and not coalesce(suspicious,false)
 loop perform public.qualify_b2b_affiliate_referral(r.referred_id); end loop;
 return query select true,coalesce(bp.company_name,up.full_name),joined_time
 from public.user_profiles up left join public.business_profiles bp on bp.user_id=up.id where up.id=p_user_id;
end $$;
revoke all on function public.join_verified_business_affiliate(uuid) from public,anon,authenticated;
grant execute on function public.join_verified_business_affiliate(uuid) to service_role;

create or replace function public.resolve_borderpay_referrer_id(p_referral_code text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[];
begin
 if upper(trim(coalesce(p_referral_code,''))) !~ '^BP[0-9A-F]{6}$' then return null; end if;
 select array_agg(aa.user_id) into ids from public.affiliate_accounts aa
 where aa.status='active' and public.affiliate_member_eligible(aa.user_id)
 and upper('BP'||substring(replace(aa.user_id::text,'-','') from 1 for 6))=upper(trim(p_referral_code));
 -- Never attribute a collision to an arbitrary customer.
 if cardinality(ids)=1 then return ids[1]; end if;
 return null;
end $$;
revoke all on function public.resolve_borderpay_referrer_id(text) from public,anon,authenticated;
grant execute on function public.resolve_borderpay_referrer_id(text) to service_role;

create or replace function public.qualify_b2b_affiliate_referral(p_referred_business_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.referrals%rowtype;
begin
 if not public.affiliate_member_eligible(p_referred_business_id) or not exists(
 select 1 from public.user_profiles where id=p_referred_business_id and account_type='business') then return false; end if;
 select * into r from public.referrals where referred_id=p_referred_business_id and not coalesce(suspicious,false)
 and referrer_id<>referred_id order by referred_at limit 1;
 if not found or not public.affiliate_member_eligible(r.referrer_id) or not exists(
 select 1 from public.affiliate_accounts where user_id=r.referrer_id and status='active') then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.referrer_id::text,0));
 insert into public.affiliate_fee_discounts(referrer_user_id,referral_id,referred_business_id,fee_percent,status)
 values(r.referrer_id,r.id,p_referred_business_id,2.5,'pending_provider') on conflict(referral_id) do nothing;
 update public.referrals set status='qualified',qualified_at=coalesce(qualified_at,now()) where id=r.id;
 return true;
end $$;
revoke all on function public.qualify_b2b_affiliate_referral(uuid) from public,anon,authenticated;
grant execute on function public.qualify_b2b_affiliate_referral(uuid) to service_role;

-- Customer-specific provider state is captured BEFORE an update so expiry restores the original fee.
create table if not exists public.affiliate_va_fee_overrides(
 user_id uuid not null references auth.users(id), virtual_account_id text not null,
 customer_id text not null, currency text not null check(currency in ('USD','EUR','GBP')),
 original_fee numeric(8,4) not null check(original_fee between 0 and 100),
 reward_fee numeric(8,4) not null check(reward_fee between 0 and 2.5),
 status text not null check(status in ('apply_pending','applied','restore_pending','restored','conflict')),
 provider_request_id text, updated_at timestamptz not null default now(),
 primary key(user_id,virtual_account_id)
);
alter table public.affiliate_va_fee_overrides enable row level security;
revoke all on public.affiliate_va_fee_overrides from anon,authenticated;
grant all on public.affiliate_va_fee_overrides to service_role;
create policy affiliate_va_service on public.affiliate_va_fee_overrides to service_role using(true) with check(true);

create table if not exists public.affiliate_reward_sync(
 user_id uuid primary key references auth.users(id), lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), attempt_count integer not null default 0,
 last_error text, updated_at timestamptz not null default now()
);
alter table public.affiliate_reward_sync enable row level security;
revoke all on public.affiliate_reward_sync from anon,authenticated;
grant all on public.affiliate_reward_sync to service_role;
create policy affiliate_sync_service on public.affiliate_reward_sync to service_role using(true) with check(true);

create or replace function public.claim_affiliate_reward_sync(p_limit integer default 3)
returns table(user_id uuid,lease_token uuid) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.affiliate_reward_sync(user_id)
 select distinct referrer_user_id from public.affiliate_fee_discounts
 where status in ('pending_provider','active','scheduled')
 union select o.user_id from public.affiliate_va_fee_overrides o where o.status<>'restored'
 on conflict(user_id) do nothing;
 return query with picked as(select s.user_id from public.affiliate_reward_sync s
 where s.next_attempt_at<=now() and (s.lease_until is null or s.lease_until<now())
 and (exists(select 1 from public.affiliate_fee_discounts d where d.referrer_user_id=s.user_id and d.status in ('pending_provider','active','scheduled'))
 or exists(select 1 from public.affiliate_va_fee_overrides o where o.user_id=s.user_id and o.status<>'restored'))
 order by s.next_attempt_at limit least(greatest(p_limit,1),3) for update skip locked)
 update public.affiliate_reward_sync s set lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',updated_at=now()
 from picked where s.user_id=picked.user_id returning s.user_id,s.lease_token;
end $$;
revoke all on function public.claim_affiliate_reward_sync(integer) from public,anon,authenticated;
grant execute on function public.claim_affiliate_reward_sync(integer) to service_role;

create or replace function public.affiliate_incoming_reward_active(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.affiliate_member_eligible(p_user_id) and exists(select 1 from public.affiliate_accounts aa where aa.user_id=p_user_id and aa.status='active')
 and exists(select 1 from public.affiliate_fee_discounts where referrer_user_id=p_user_id
 and status in ('active','scheduled') and starts_at<=now() and ends_at>now());
$$;
revoke all on function public.affiliate_incoming_reward_active(uuid) from public,anon,authenticated;
grant execute on function public.affiliate_incoming_reward_active(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.get_b2b_affiliate_summary(p_user_id uuid)
 RETURNS TABLE(company_name text, total_referrals integer, kyb_approved_referrals integer, pending_referrals integer, discount_fee_percent numeric, discount_active boolean, current_window_starts_at timestamp with time zone, current_window_ends_at timestamp with time zone, queued_discount_windows integer, pending_provider_windows integer, remaining_discount_days integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is distinct from p_user_id and not public.is_borderpay_admin() then raise exception 'forbidden'; end if;
  if not public.affiliate_member_eligible(p_user_id) or not exists (select 1 from public.affiliate_accounts where user_id = p_user_id and status = 'active') then raise exception 'affiliate_access_required'; end if;
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
     where d.referrer_user_id = p_user_id and d.status in ('active','scheduled')
       and d.starts_at <= now() and d.ends_at > now()
     order by d.ends_at desc limit 1
  )
  select
    coalesce(bp.company_name,up.full_name),
    count(br.id)::int,
    count(br.id) filter (where lower(coalesce(br.bridge_kyb_status::text,'')) = 'approved')::int,
    count(br.id) filter (where lower(coalesce(br.bridge_kyb_status::text,'')) <> 'approved')::int,
    2.5000::numeric,
    exists(select 1 from current_window),
    (select starts_at from current_window),
    (select ends_at from current_window),
    (select count(*)::int from public.affiliate_fee_discounts d where d.referrer_user_id = p_user_id and d.status in ('active','scheduled') and d.starts_at > now()),
    (select count(*)::int from public.affiliate_fee_discounts d where d.referrer_user_id = p_user_id and d.status = 'pending_provider'),
    coalesce(ceil(extract(epoch from ((select ends_at from current_window) - now())) / 86400.0), 0)::int
  from public.user_profiles up left join public.business_profiles bp on bp.user_id=up.id left join business_refs br on true
  where up.id = p_user_id
  group by bp.company_name,up.full_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_b2b_affiliate_referrals(p_user_id uuid)
 RETURNS TABLE(id uuid, referred_business_id uuid, company_name text, country text, status text, referred_signup_at timestamp with time zone, kyb_approved boolean, qualified_at timestamp with time zone, discount_starts_at timestamp with time zone, discount_ends_at timestamp with time zone, discount_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is distinct from p_user_id and not public.is_borderpay_admin() then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.affiliate_accounts aa where aa.user_id=p_user_id and aa.status='active') then raise exception 'affiliate_access_required'; end if;
  return query
  select r.id, r.referred_id, bp.company_name, r.country,
    case when lower(coalesce(bp.bridge_kyb_status::text,'')) = 'approved' then 'kyb_approved' else 'kyb_pending' end,
    r.referred_at, lower(coalesce(bp.bridge_kyb_status::text,'')) = 'approved', r.qualified_at,
    d.starts_at, d.ends_at,
    case when d.status = 'pending_provider' then 'pending_provider'
         when d.status = 'revoked' then 'revoked'
         when d.starts_at > now() then 'scheduled'
         when d.ends_at <= now() then 'expired'
         when d.id is null then 'awaiting_qualification'
         else 'active' end
  from public.referrals r
  join public.user_profiles up on up.id = r.referred_id and lower(coalesce(up.account_type::text,'')) = 'business'
  join public.business_profiles bp on bp.user_id = r.referred_id
  left join public.affiliate_fee_discounts d on d.referral_id = r.id
  where r.referrer_id = p_user_id and coalesce(r.suspicious,false) = false
  order by r.referred_at desc;
end;
$function$;

-- Realtime carries owner-filtered changes only; RLS still enforces visibility.
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='referrals') then alter publication supabase_realtime add table public.referrals; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='affiliate_fee_discounts') then alter publication supabase_realtime add table public.affiliate_fee_discounts; end if;
end $$;

create or replace function public.handle_b2b_affiliate_kyb_approval()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if lower(coalesce(new.bridge_kyb_status::text,''))='approved' then perform public.qualify_b2b_affiliate_referral(new.user_id); end if;
 return new;
end $$;
drop trigger if exists trg_b2b_affiliate_kyb_approval on public.business_profiles;
create trigger trg_b2b_affiliate_kyb_approval after insert or update of bridge_kyb_status,status on public.business_profiles
for each row execute function public.handle_b2b_affiliate_kyb_approval();
create or replace function public.handle_affiliate_account_activation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.account_type='business' then perform public.qualify_b2b_affiliate_referral(new.id); end if;
 return new;
end $$;
create trigger trg_affiliate_account_activation after update of account_status,bridge_account_status on public.user_profiles
for each row execute function public.handle_affiliate_account_activation();

create or replace function public.invoke_affiliate_reward_sync()
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare token text; request_id bigint;
begin
 token:=public.app_config_get('worker_auth_token');
 if nullif(token,'') is null then raise exception 'worker_auth_token_not_configured'; end if;
 select net.http_post(url:='https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/affiliate-reward-worker',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
 body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function public.invoke_affiliate_reward_sync() from public,anon,authenticated;
grant execute on function public.invoke_affiliate_reward_sync() to service_role;
-- Safe before function deployment: retries cannot change pricing without the worker.
select cron.schedule('affiliate-reward-sync','* * * * *','select public.invoke_affiliate_reward_sync();');

CREATE OR REPLACE FUNCTION public.track_borderpay_referral_signup(p_referral_code text, p_referred_id uuid, p_country text DEFAULT NULL::text, p_device_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS TABLE(tracked boolean, reason text, referrer_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_code text := upper(trim(coalesce(p_referral_code, '')));
  v_referrer_id uuid;
  v_commission numeric := 0;
begin
  if p_referred_id is null then
    return query select false, 'missing_referred_user'::text, null::uuid;
    return;
  end if;

  if not exists(select 1 from public.user_profiles where id=p_referred_id and account_type='business') then
    return query select false,'business_referral_required'::text,null::uuid; return;
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

  if exists (
    select 1
      from public.referrals r
     where r.referred_id = p_referred_id
  ) then
    return query select false, 'already_attributed'::text, v_referrer_id;
    return;
  end if;

  if exists (
    select 1
      from public.referrals r
     where r.referrer_id = p_referred_id
       and r.referred_id = v_referrer_id
  ) then
    return query select false, 'recursive_referral_blocked'::text, v_referrer_id;
    return;
  end if;

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
    0,
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
$function$;

commit;
