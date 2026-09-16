begin;
insert into public.user_profiles values
 ('00000000-0000-4000-8000-000000000001','individual','KE','demo_bridge_customer_app_review_individual','approved'),
 ('00000000-0000-4000-8000-000000000002','individual','KE','customer-2','approved'),
 ('00000000-0000-4000-8000-000000000003','individual','KE','customer-3','approved');
insert into auth.users(id) select id from public.user_profiles;
insert into public.bridge_wallets(user_id,currency,chain,bridge_customer_id,status) values
 ('00000000-0000-4000-8000-000000000001','USDT','tron','demo_bridge_customer_app_review_individual','active'),
 ('00000000-0000-4000-8000-000000000003','USDT','tron','customer-3','active');
do $$ declare claimed uuid; remaining integer; begin
 select user_id into claimed from public.claim_wallet_scope_refresh_batch(1);
 if claimed is distinct from '00000000-0000-4000-8000-000000000003'::uuid then raise exception 'Existing wallet not prioritized'; end if;
 select count(*) into remaining from public.claim_wallet_scope_refresh_batch(20);
 if remaining <> 1 then raise exception 'Demo included or approved pending wallet excluded'; end if;
 if exists(select 1 from public.wallet_scope_refresh_jobs where user_id='00000000-0000-4000-8000-000000000001') then raise exception 'Demo sent to live provider'; end if;
end $$;
rollback;
select 'Live wallet scope priority: PASS' as result;
