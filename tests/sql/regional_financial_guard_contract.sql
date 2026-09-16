begin;
insert into public.user_profiles values
 ('00000000-0000-4000-8000-000000000001','business','FR','business-1','approved');
insert into public.business_profiles values
 ('00000000-0000-4000-8000-000000000001','KE','business-1','approved');
insert into public.bridge_wallets(user_id,currency,chain) values
 ('00000000-0000-4000-8000-000000000001','USDT','tron');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if not public.can_read_bridge_financial_data(auth.uid()) then raise exception 'Non-EEA business still depends on absent provider cache'; end if;
 if (select count(*) from public.bridge_wallets) <> 1 then raise exception 'Non-EEA owned USDT hidden'; end if;
 if public.can_read_bridge_financial_data('00000000-0000-4000-8000-000000000002') then raise exception 'Cross-owner access'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 if public.can_read_bridge_financial_data('00000000-0000-4000-8000-000000000001') then raise exception 'Null auth bypass'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
end $$;
reset role;
update public.business_profiles set country='FR';
set local role authenticated;
do $$ begin
 if public.can_read_bridge_financial_data(auth.uid()) then raise exception 'EEA access granted without fresh SCA'; end if;
 perform set_config('test.fresh_access','true',true);
 if not public.can_read_bridge_financial_data(auth.uid()) then raise exception 'Fresh EEA SCA rejected'; end if;
 if exists(select 1 from public.bridge_wallets) then raise exception 'EEA USDT exposed'; end if;
end $$;
reset role;
update public.business_profiles set country=null;
do $$ begin
 if public.can_read_bridge_financial_data(auth.uid()) then raise exception 'Unknown business region allowed'; end if;
end $$;
update public.user_profiles set account_type='individual';
insert into public.sca_customer_scopes values
 ('00000000-0000-4000-8000-000000000001','business-1','KE','bridge_customer_api',now()+interval '1 hour');
do $$ begin
 if not public.can_read_bridge_financial_data(auth.uid()) then raise exception 'Fresh individual region rejected'; end if;
end $$;
update public.sca_customer_scopes set expires_at=now()-interval '1 second';
do $$ begin
 if public.can_read_bridge_financial_data(auth.uid()) then raise exception 'Expired individual region trusted'; end if;
end $$;
update public.bridge_eea_sca_runtime_control set enforcement_enabled=false;
do $$ begin
 if not public.can_read_bridge_financial_data(auth.uid()) then raise exception 'Release control behavior changed'; end if;
end $$;
rollback;
select 'Regional financial read guard: PASS' as result;
