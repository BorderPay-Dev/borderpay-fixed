-- Restore owner reads for non-EEA USDT/Tron. No payout or balance-write grants.
create or replace function public.can_read_borderpay_usdt(p_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  v_account_type text;
  v_country text;
  v_customer_id text;
  v_approved boolean;
begin
  if p_user_id is null or p_user_id is distinct from (select auth.uid()) then return false; end if;
  select up.account_type,
         case when up.account_type = 'business' then bp.country else null end,
         case when up.account_type = 'business' then coalesce(bp.bridge_customer_id, up.bridge_customer_id) else up.bridge_customer_id end,
         case when up.account_type = 'business' then lower(coalesce(bp.bridge_kyb_status, '')) = 'approved'
              else lower(coalesce(up.bridge_kyc_status, '')) = 'approved' end
    into v_account_type, v_country, v_customer_id, v_approved
    from public.user_profiles up
    left join public.business_profiles bp on bp.user_id = up.id
   where up.id = p_user_id;
  if not found or not coalesce(v_approved, false) or nullif(btrim(v_customer_id), '') is null then return false; end if;
  -- Business incorporation is authoritative. Never substitute contact residence.
  -- Individuals retain the provider-confirmed residence boundary.
  if v_account_type <> 'business' then
    select provider_country into v_country from public.sca_customer_scopes
     where user_id = p_user_id and bridge_customer_id = v_customer_id
       and source = 'bridge_customer_api' and expires_at > now();
    if not found then return false; end if;
  end if;
  v_country := upper(btrim(coalesce(v_country, '')));
  v_country := case v_country
    when 'AUT' then 'AT'
    when 'BEL' then 'BE'
    when 'BGR' then 'BG'
    when 'HRV' then 'HR'
    when 'CYP' then 'CY'
    when 'CZE' then 'CZ'
    when 'DNK' then 'DK'
    when 'EST' then 'EE'
    when 'FIN' then 'FI'
    when 'FRA' then 'FR'
    when 'DEU' then 'DE'
    when 'GRC' then 'GR'
    when 'HUN' then 'HU'
    when 'ISL' then 'IS'
    when 'IRL' then 'IE'
    when 'ITA' then 'IT'
    when 'LVA' then 'LV'
    when 'LIE' then 'LI'
    when 'LTU' then 'LT'
    when 'LUX' then 'LU'
    when 'MLT' then 'MT'
    when 'NLD' then 'NL'
    when 'NOR' then 'NO'
    when 'POL' then 'PL'
    when 'PRT' then 'PT'
    when 'ROU' then 'RO'
    when 'SVK' then 'SK'
    when 'SVN' then 'SI'
    when 'ESP' then 'ES'
    when 'SWE' then 'SE'
    when 'GBR' then 'GB'
    when 'UKR' then 'UA'
    when 'CHE' then 'CH'
    when 'USA' then 'US'
    when 'CAN' then 'CA'
    when 'AUS' then 'AU'
    when 'NZL' then 'NZ'
    when 'KEN' then 'KE'
    when 'ZAF' then 'ZA'
    when 'NGA' then 'NG'
    when 'GHA' then 'GH'
    else v_country end;
  return v_country = any(array['AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW']::text[])
     and not (v_country = any(array['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE']::text[]));
end;
$function$;
revoke all on function public.can_read_borderpay_usdt(uuid) from public, anon;
grant execute on function public.can_read_borderpay_usdt(uuid) to authenticated, service_role;

-- Keep existing ownership and financial-access guards for both wallet rails.
drop policy if exists bw_owner_read on public.bridge_wallets;
create policy bw_owner_read on public.bridge_wallets for select to authenticated
using (
  (auth.uid() = user_id or auth.uid() = business_user_id)
  and public.can_read_bridge_financial_data(auth.uid())
  and (
    (lower(coalesce(chain, '')) = 'base' and upper(coalesce(currency, '')) in ('USDC', 'EURC'))
    or (lower(coalesce(chain, '')) = 'tron' and upper(coalesce(currency, '')) = 'USDT'
        and public.can_read_borderpay_usdt(auth.uid()))
  )
);

drop policy if exists bbl_owner_read on public.bridge_balance_ledger;
create policy bbl_owner_read on public.bridge_balance_ledger for select to authenticated
using (
  (auth.uid() = user_id or auth.uid() = business_user_id)
  and (upper(coalesce(currency, '')) <> 'USDT'
       or (public.can_read_borderpay_usdt(auth.uid()) and public.can_read_bridge_financial_data(auth.uid())))
);

-- The legacy ALL policy still rejects USDT writes. Restore SELECT only.
drop policy if exists wallets_usdt_owner_read on public.wallets;
create policy wallets_usdt_owner_read on public.wallets for select to authenticated
using (
  auth.uid() = user_id and upper(coalesce(currency::text, '')) = 'USDT'
  and public.can_read_borderpay_usdt(auth.uid())
  and public.can_read_bridge_financial_data(auth.uid())
);
