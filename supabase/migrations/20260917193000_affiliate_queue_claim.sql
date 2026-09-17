begin;
create or replace function public.claim_affiliate_reward_sync(p_limit integer default 3)
returns table(user_id uuid,lease_token uuid) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.affiliate_reward_sync(user_id)
 select distinct referrer_user_id from public.affiliate_fee_discounts
 where status in ('pending_provider','active','scheduled')
 union select o.user_id from public.affiliate_va_fee_overrides o where o.status<>'restored'
 on conflict on constraint affiliate_reward_sync_pkey do nothing;
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


commit;
