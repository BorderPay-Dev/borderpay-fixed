begin;
-- Every EEA jurisdiction gets owned USDT rows, which must remain unreadable.
insert into public.user_profiles
select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'business', 'GB', 'customer-'||n, 'approved'
from generate_series(1,35) n;
insert into public.business_profiles
select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, country, 'customer-'||n, 'approved'
from unnest(array['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','GB','KE','ZZ',null,'US']) with ordinality as c(country,n);
update public.user_profiles set country='FR' where id::text like '%000031';
update public.business_profiles set bridge_kyb_status='incomplete' where user_id::text like '%000035';
insert into public.bridge_wallets(user_id,currency,chain) select id,'USDT','tron' from public.user_profiles;
insert into public.bridge_wallets(user_id,currency,chain) select id,'USDT','base' from public.user_profiles;
insert into public.bridge_wallets(user_id,currency,chain) select id,'USDC','base' from public.user_profiles;
insert into public.bridge_balance_ledger(user_id,currency) select id,'USDT' from public.user_profiles;
insert into public.wallets(user_id,currency,balance) select id,'USDT',10 from public.user_profiles;
-- Business ownership column remains accepted.
update public.bridge_wallets set business_user_id=user_id,user_id=null where user_id::text like '%000032';
update public.bridge_balance_ledger set business_user_id=user_id,user_id=null where user_id::text like '%000032';
set local role authenticated;
do $$
declare n int; uid uuid; count_rows int;
begin
 for n in 1..35 loop
  uid := ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  if public.can_read_borderpay_usdt(uid) is distinct from (n in (31,32)) then
    raise exception 'Wrong regional decision for fixture %', n;
  end if;
  select count(*) into count_rows from public.bridge_wallets where currency='USDT';
  if count_rows <> (case when n in (31,32) then 1 else 0 end) then raise exception 'Wrong wallet visibility %: %',n,count_rows; end if;
  select count(*) into count_rows from public.bridge_balance_ledger where currency='USDT';
  if count_rows <> (case when n in (31,32) then 1 else 0 end) then raise exception 'Wrong ledger visibility %',n; end if;
  select count(*) into count_rows from public.wallets where currency='USDT';
  if count_rows <> (case when n in (31,32) then 1 else 0 end) then raise exception 'Wrong legacy visibility %',n; end if;
  select count(*) into count_rows from public.bridge_wallets where currency='USDC';
  if count_rows <> 1 then raise exception 'Base wallet regression %',n; end if;
 end loop;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000031',true);
 if public.can_read_borderpay_usdt('00000000-0000-4000-8000-000000000032') then raise exception 'Cross-owner scope leak'; end if;
 update public.wallets set balance=999 where currency='USDT';
 get diagnostics count_rows=row_count;
 if count_rows <> 0 then raise exception 'SELECT policy expanded legacy balance-write authority'; end if;
 begin
  insert into public.wallets(user_id,currency,balance) values(auth.uid(),'USDT',999);
  raise exception 'USDT insert unexpectedly permitted';
 exception when insufficient_privilege then null;
 end;
 perform set_config('test.financial_read_blocked','true',true);
 if exists(select 1 from public.bridge_wallets) or exists(select 1 from public.bridge_balance_ledger where currency='USDT') then raise exception 'Financial access guard bypassed'; end if;
end $$;
reset role;
-- Individuals use fresh provider residence, never the contact country.
update public.user_profiles set account_type='individual' where id::text like '%000031';
insert into public.sca_customer_scopes values('00000000-0000-4000-8000-000000000031','customer-31','GB','bridge_customer_api',now()+interval '1 hour');
set local role authenticated;
select set_config('test.financial_read_blocked','false',true);
do $$ begin
 if not public.can_read_borderpay_usdt(auth.uid()) then raise exception 'Fresh non-EEA individual scope rejected'; end if;
end $$;
reset role;
update public.sca_customer_scopes set provider_country='FR';
set local role authenticated;
do $$ begin
 if public.can_read_borderpay_usdt(auth.uid()) then raise exception 'EEA provider residence bypassed'; end if;
end $$;
reset role;
update public.sca_customer_scopes set provider_country='GB',expires_at=now()-interval '1 second';
set local role authenticated;
do $$ begin
 if public.can_read_borderpay_usdt(auth.uid()) then raise exception 'Expired individual scope trusted'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.can_read_borderpay_usdt(uuid)','execute') then raise exception 'Anonymous scope access'; end if;
end $$;
rollback;
select 'USDT regional owner-read contract: PASS' as result;
