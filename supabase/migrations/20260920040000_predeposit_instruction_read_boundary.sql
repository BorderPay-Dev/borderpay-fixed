begin;
create function public.predeposit_requires_invoice_for_owner(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.predeposit_policy%rowtype;v_type text;
begin
 select * into p from public.predeposit_policy where singleton;
 if not found then return true;end if;
 if p.mode<>'enforce' then return false;end if;
 if p.scope='all_accounts' then return true;end if;
 select account_type::text into v_type from public.user_profiles where id=p_user_id limit 1;
 return coalesce(v_type='business',true);
end;$$;
create function public.predeposit_instruction_policy()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 return jsonb_build_object('required',public.predeposit_requires_invoice_for_owner(auth.uid()),
 'hub_enabled',coalesce((select (config->>'hub_enabled')::boolean from public.predeposit_policy where singleton),false));
end;$$;
revoke all on function public.predeposit_requires_invoice_for_owner(uuid),public.predeposit_instruction_policy() from public,anon;
grant execute on function public.predeposit_requires_invoice_for_owner(uuid),public.predeposit_instruction_policy() to authenticated,service_role;
-- Restrictive policies intersect existing owner/admin policies; no write privileges are added.
create policy predeposit_va_instruction_boundary on public.bridge_virtual_accounts as restrictive for select to authenticated
using(public.is_borderpay_admin() or not public.predeposit_requires_invoice_for_owner(coalesce(business_user_id,user_id)));
create policy predeposit_fiat_wallet_instruction_boundary on public.wallets as restrictive for select to authenticated
using(public.is_borderpay_admin() or not (
 upper(coalesce(currency::text,'')) in ('USD','EUR','GBP')
 and (bridge_virtual_account_id is not null or virtual_account_number is not null or asset_type='fiat_virtual_account')
 and public.predeposit_requires_invoice_for_owner(user_id)));
commit;
