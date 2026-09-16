begin;
insert into public.user_profiles values
 ('00000000-0000-4000-8000-000000000001','individual','KE','customer-1','approved'),
 ('00000000-0000-4000-8000-000000000002','individual','FR','customer-2','approved'),
 ('00000000-0000-4000-8000-000000000003','business','KE','customer-3','approved'),
 ('00000000-0000-4000-8000-000000000004','individual','KE','customer-4','incomplete');
insert into public.sca_customer_scopes values
 ('00000000-0000-4000-8000-000000000002','customer-2','FR','bridge_customer_api',now()+interval '1 hour');
do $$ declare n integer; begin
 select count(*) into n from public.claim_wallet_scope_refresh_batch(20);
 if n<>1 then raise exception 'Must claim only approved individual with stale/missing scope: %',n; end if;
 select count(*) into n from public.claim_wallet_scope_refresh_batch(20);
 if n<>0 then raise exception 'Live lease claimed twice'; end if;
end $$;
update public.wallet_scope_refresh_jobs set next_attempt_at=now()-interval '1 second';
do $$ declare n integer; begin
 select count(*) into n from public.claim_wallet_scope_refresh_batch(20);
 if n<>1 then raise exception 'Expired lease not retried'; end if;
end $$;
insert into public.sca_customer_scopes values
 ('00000000-0000-4000-8000-000000000001','customer-1','KE','bridge_customer_api',now()+interval '1 hour');
update public.wallet_scope_refresh_jobs set next_attempt_at=now()-interval '1 second';
do $$ declare n integer; begin
 select count(*) into n from public.claim_wallet_scope_refresh_batch(20);
 if n<>0 then raise exception 'Fresh scope needlessly refreshed'; end if;
 if has_function_privilege('authenticated','public.claim_wallet_scope_refresh_batch(integer)','execute')
 or has_function_privilege('anon','public.claim_wallet_scope_refresh_batch(integer)','execute') then
 raise exception 'Background claim exposed to client'; end if;
end $$;
update public.sca_customer_scopes set bridge_customer_id='previous-customer' where provider_country='KE';
do $$ declare n integer; begin
 select count(*) into n from public.claim_wallet_scope_refresh_batch(20);
 if n<>1 then raise exception 'Changed customer mapping not refreshed'; end if;
end $$;
rollback;
select 'Wallet scope refresh queue: PASS' as result;
