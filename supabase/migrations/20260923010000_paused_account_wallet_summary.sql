begin;
create or replace function public.paused_account_wallet_summary()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.user_profiles; v_wallets jsonb; v_currencies jsonb;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into p from public.user_profiles where id=auth.uid();
 if not found then raise exception 'PROFILE_UNAVAILABLE'; end if;
 if lower(coalesce(p.account_status,'')) not in ('active','approved','pending_kyc')
    or p.account_frozen_at is not null
    or lower(coalesce(p.bridge_account_status,'')) <> 'paused'
    or nullif(btrim(p.bridge_customer_id),'') is null then
   return jsonb_build_object('mode','locked');
 end if;
 if not public.can_read_bridge_financial_data(auth.uid()) then raise exception 'FINANCIAL_AUTH_REQUIRED'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'currency',upper(w.currency::text),'balance',w.balance::text,'updated_at',w.updated_at) order by w.currency::text,w.id),'[]'::jsonb)
 into v_wallets from public.wallets w where w.user_id=auth.uid() and (
 upper(w.currency::text)='USDC'
 or (upper(w.currency::text)='USDT' and public.can_read_borderpay_usdt(auth.uid()))
 or (upper(w.currency::text)='EURC' and public.can_read_borderpay_eurc(auth.uid())));
 select coalesce(jsonb_agg(currency order by currency),'[]'::jsonb) into v_currencies
 from (select distinct upper(currency) as currency from public.bridge_virtual_accounts
 where (user_id=auth.uid() or business_user_id=auth.uid()) and upper(currency) in ('USD','EUR','GBP')) a;
 return jsonb_build_object('mode','receiving_paused','wallets',v_wallets,'receiving_currencies',v_currencies);
end; $$;
revoke all on function public.paused_account_wallet_summary() from public,anon;
grant execute on function public.paused_account_wallet_summary() to authenticated;
commit;
