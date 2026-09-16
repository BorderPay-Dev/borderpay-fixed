-- EEA: USDC/EURC on Base. Non-EEA: USDC on Base and USDT on Tron.
-- Only eligibility/read policies change; no balances or provider wallets are deleted.
create or replace function public.borderpay_wallet_region(p_user_id uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  v_account_type text;
  v_country text;
  v_customer_id text;
  v_approved boolean;
begin
  if p_user_id is null or p_user_id is distinct from (select auth.uid()) then return 'unknown'; end if;
  select up.account_type,
         case when up.account_type = 'business' then bp.country else null end,
         case when up.account_type = 'business' then coalesce(bp.bridge_customer_id, up.bridge_customer_id) else up.bridge_customer_id end,
         case when up.account_type = 'business' then lower(coalesce(bp.bridge_kyb_status, '')) = 'approved'
              else lower(coalesce(up.bridge_kyc_status, '')) = 'approved' end
    into v_account_type, v_country, v_customer_id, v_approved
    from public.user_profiles up
    left join public.business_profiles bp on bp.user_id = up.id
   where up.id = p_user_id;
  if not found or not coalesce(v_approved, false) or nullif(btrim(v_customer_id), '') is null then return 'unknown'; end if;
  -- Business incorporation is authoritative. Never substitute contact residence.
  -- Individuals retain the provider-confirmed residence boundary.
  if v_account_type <> 'business' then
    select provider_country into v_country from public.sca_customer_scopes
     where user_id = p_user_id and bridge_customer_id = v_customer_id
       and source = 'bridge_customer_api' and expires_at > now();
    if not found then return 'unknown'; end if;
  end if;
  v_country := upper(btrim(coalesce(v_country, '')));
  v_country := case v_country
    when 'AND' then 'AD'
    when 'ARE' then 'AE'
    when 'AFG' then 'AF'
    when 'ATG' then 'AG'
    when 'AIA' then 'AI'
    when 'ALB' then 'AL'
    when 'ARM' then 'AM'
    when 'AGO' then 'AO'
    when 'ATA' then 'AQ'
    when 'ARG' then 'AR'
    when 'ASM' then 'AS'
    when 'AUT' then 'AT'
    when 'AUS' then 'AU'
    when 'ABW' then 'AW'
    when 'ALA' then 'AX'
    when 'AZE' then 'AZ'
    when 'BIH' then 'BA'
    when 'BRB' then 'BB'
    when 'BGD' then 'BD'
    when 'BEL' then 'BE'
    when 'BFA' then 'BF'
    when 'BGR' then 'BG'
    when 'BHR' then 'BH'
    when 'BDI' then 'BI'
    when 'BEN' then 'BJ'
    when 'BLM' then 'BL'
    when 'BMU' then 'BM'
    when 'BRN' then 'BN'
    when 'BOL' then 'BO'
    when 'BES' then 'BQ'
    when 'BRA' then 'BR'
    when 'BHS' then 'BS'
    when 'BTN' then 'BT'
    when 'BVT' then 'BV'
    when 'BWA' then 'BW'
    when 'BLR' then 'BY'
    when 'BLZ' then 'BZ'
    when 'CAN' then 'CA'
    when 'CCK' then 'CC'
    when 'COD' then 'CD'
    when 'CAF' then 'CF'
    when 'COG' then 'CG'
    when 'CHE' then 'CH'
    when 'CIV' then 'CI'
    when 'COK' then 'CK'
    when 'CHL' then 'CL'
    when 'CMR' then 'CM'
    when 'CHN' then 'CN'
    when 'COL' then 'CO'
    when 'CRI' then 'CR'
    when 'CUB' then 'CU'
    when 'CPV' then 'CV'
    when 'CUW' then 'CW'
    when 'CXR' then 'CX'
    when 'CYP' then 'CY'
    when 'CZE' then 'CZ'
    when 'DEU' then 'DE'
    when 'DJI' then 'DJ'
    when 'DNK' then 'DK'
    when 'DMA' then 'DM'
    when 'DOM' then 'DO'
    when 'DZA' then 'DZ'
    when 'ECU' then 'EC'
    when 'EST' then 'EE'
    when 'EGY' then 'EG'
    when 'ESH' then 'EH'
    when 'ERI' then 'ER'
    when 'ESP' then 'ES'
    when 'ETH' then 'ET'
    when 'FIN' then 'FI'
    when 'FJI' then 'FJ'
    when 'FLK' then 'FK'
    when 'FSM' then 'FM'
    when 'FRO' then 'FO'
    when 'FRA' then 'FR'
    when 'GAB' then 'GA'
    when 'GBR' then 'GB'
    when 'GRD' then 'GD'
    when 'GEO' then 'GE'
    when 'GUF' then 'GF'
    when 'GGY' then 'GG'
    when 'GHA' then 'GH'
    when 'GIB' then 'GI'
    when 'GRL' then 'GL'
    when 'GMB' then 'GM'
    when 'GIN' then 'GN'
    when 'GLP' then 'GP'
    when 'GNQ' then 'GQ'
    when 'GRC' then 'GR'
    when 'SGS' then 'GS'
    when 'GTM' then 'GT'
    when 'GUM' then 'GU'
    when 'GNB' then 'GW'
    when 'GUY' then 'GY'
    when 'HKG' then 'HK'
    when 'HMD' then 'HM'
    when 'HND' then 'HN'
    when 'HRV' then 'HR'
    when 'HTI' then 'HT'
    when 'HUN' then 'HU'
    when 'IDN' then 'ID'
    when 'IRL' then 'IE'
    when 'ISR' then 'IL'
    when 'IMN' then 'IM'
    when 'IND' then 'IN'
    when 'IOT' then 'IO'
    when 'IRQ' then 'IQ'
    when 'IRN' then 'IR'
    when 'ISL' then 'IS'
    when 'ITA' then 'IT'
    when 'JEY' then 'JE'
    when 'JAM' then 'JM'
    when 'JOR' then 'JO'
    when 'JPN' then 'JP'
    when 'KEN' then 'KE'
    when 'KGZ' then 'KG'
    when 'KHM' then 'KH'
    when 'KIR' then 'KI'
    when 'COM' then 'KM'
    when 'KNA' then 'KN'
    when 'PRK' then 'KP'
    when 'KOR' then 'KR'
    when 'KWT' then 'KW'
    when 'CYM' then 'KY'
    when 'KAZ' then 'KZ'
    when 'LAO' then 'LA'
    when 'LBN' then 'LB'
    when 'LCA' then 'LC'
    when 'LIE' then 'LI'
    when 'LKA' then 'LK'
    when 'LBR' then 'LR'
    when 'LSO' then 'LS'
    when 'LTU' then 'LT'
    when 'LUX' then 'LU'
    when 'LVA' then 'LV'
    when 'LBY' then 'LY'
    when 'MAR' then 'MA'
    when 'MCO' then 'MC'
    when 'MDA' then 'MD'
    when 'MNE' then 'ME'
    when 'MAF' then 'MF'
    when 'MDG' then 'MG'
    when 'MHL' then 'MH'
    when 'MKD' then 'MK'
    when 'MLI' then 'ML'
    when 'MMR' then 'MM'
    when 'MNG' then 'MN'
    when 'MAC' then 'MO'
    when 'MNP' then 'MP'
    when 'MTQ' then 'MQ'
    when 'MRT' then 'MR'
    when 'MSR' then 'MS'
    when 'MLT' then 'MT'
    when 'MUS' then 'MU'
    when 'MDV' then 'MV'
    when 'MWI' then 'MW'
    when 'MEX' then 'MX'
    when 'MYS' then 'MY'
    when 'MOZ' then 'MZ'
    when 'NAM' then 'NA'
    when 'NCL' then 'NC'
    when 'NER' then 'NE'
    when 'NFK' then 'NF'
    when 'NGA' then 'NG'
    when 'NIC' then 'NI'
    when 'NLD' then 'NL'
    when 'NOR' then 'NO'
    when 'NPL' then 'NP'
    when 'NRU' then 'NR'
    when 'NIU' then 'NU'
    when 'NZL' then 'NZ'
    when 'OMN' then 'OM'
    when 'PAN' then 'PA'
    when 'PER' then 'PE'
    when 'PYF' then 'PF'
    when 'PNG' then 'PG'
    when 'PHL' then 'PH'
    when 'PAK' then 'PK'
    when 'POL' then 'PL'
    when 'SPM' then 'PM'
    when 'PCN' then 'PN'
    when 'PRI' then 'PR'
    when 'PSE' then 'PS'
    when 'PRT' then 'PT'
    when 'PLW' then 'PW'
    when 'PRY' then 'PY'
    when 'QAT' then 'QA'
    when 'REU' then 'RE'
    when 'ROU' then 'RO'
    when 'SRB' then 'RS'
    when 'RUS' then 'RU'
    when 'RWA' then 'RW'
    when 'SAU' then 'SA'
    when 'SLB' then 'SB'
    when 'SYC' then 'SC'
    when 'SDN' then 'SD'
    when 'SWE' then 'SE'
    when 'SGP' then 'SG'
    when 'SHN' then 'SH'
    when 'SVN' then 'SI'
    when 'SJM' then 'SJ'
    when 'SVK' then 'SK'
    when 'SLE' then 'SL'
    when 'SMR' then 'SM'
    when 'SEN' then 'SN'
    when 'SOM' then 'SO'
    when 'SUR' then 'SR'
    when 'SSD' then 'SS'
    when 'STP' then 'ST'
    when 'SLV' then 'SV'
    when 'SXM' then 'SX'
    when 'SYR' then 'SY'
    when 'SWZ' then 'SZ'
    when 'TCA' then 'TC'
    when 'TCD' then 'TD'
    when 'ATF' then 'TF'
    when 'TGO' then 'TG'
    when 'THA' then 'TH'
    when 'TJK' then 'TJ'
    when 'TKL' then 'TK'
    when 'TLS' then 'TL'
    when 'TKM' then 'TM'
    when 'TUN' then 'TN'
    when 'TON' then 'TO'
    when 'TUR' then 'TR'
    when 'TTO' then 'TT'
    when 'TUV' then 'TV'
    when 'TWN' then 'TW'
    when 'TZA' then 'TZ'
    when 'UKR' then 'UA'
    when 'UGA' then 'UG'
    when 'UMI' then 'UM'
    when 'USA' then 'US'
    when 'URY' then 'UY'
    when 'UZB' then 'UZ'
    when 'VAT' then 'VA'
    when 'VCT' then 'VC'
    when 'VEN' then 'VE'
    when 'VGB' then 'VG'
    when 'VIR' then 'VI'
    when 'VNM' then 'VN'
    when 'VUT' then 'VU'
    when 'WLF' then 'WF'
    when 'WSM' then 'WS'
    when 'YEM' then 'YE'
    when 'MYT' then 'YT'
    when 'ZAF' then 'ZA'
    when 'ZMB' then 'ZM'
    when 'ZWE' then 'ZW'
    else v_country end;
  if not (v_country = any(array['AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW']::text[])) then return 'unknown'; end if;
  return case when v_country = any(array['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE']::text[]) then 'eea' else 'non_eea' end;
end;
$function$;

revoke all on function public.borderpay_wallet_region(uuid) from public, anon;
grant execute on function public.borderpay_wallet_region(uuid) to authenticated, service_role;

create or replace function public.can_read_borderpay_usdt(p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.borderpay_wallet_region(p_user_id) = 'non_eea' $$;
create or replace function public.can_read_borderpay_eurc(p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.borderpay_wallet_region(p_user_id) = 'eea' $$;
revoke all on function public.can_read_borderpay_usdt(uuid), public.can_read_borderpay_eurc(uuid) from public, anon;
grant execute on function public.can_read_borderpay_usdt(uuid), public.can_read_borderpay_eurc(uuid) to authenticated, service_role;

drop policy if exists bw_owner_read on public.bridge_wallets;
create policy bw_owner_read on public.bridge_wallets for select to authenticated
using (
  (auth.uid() = user_id or auth.uid() = business_user_id)
  and public.can_read_bridge_financial_data(auth.uid())
  and (
    (lower(coalesce(chain, '')) = 'base' and upper(coalesce(currency, '')) = 'USDC')
    or (lower(coalesce(chain, '')) = 'base' and upper(coalesce(currency, '')) = 'EURC'
        and public.can_read_borderpay_eurc(auth.uid()))
    or (lower(coalesce(chain, '')) = 'tron' and upper(coalesce(currency, '')) = 'USDT'
        and public.can_read_borderpay_usdt(auth.uid()))
  )
);

drop policy if exists bbl_owner_read on public.bridge_balance_ledger;
create policy bbl_owner_read on public.bridge_balance_ledger for select to authenticated
using (
  (auth.uid() = user_id or auth.uid() = business_user_id)
  and (
    upper(coalesce(currency, '')) not in ('USDT', 'EURC')
    or (upper(coalesce(currency, '')) = 'USDT' and public.can_read_borderpay_usdt(auth.uid()) and public.can_read_bridge_financial_data(auth.uid()))
    or (upper(coalesce(currency, '')) = 'EURC' and public.can_read_borderpay_eurc(auth.uid()) and public.can_read_bridge_financial_data(auth.uid()))
  )
);

-- Preserve the existing write boundary; do not grant USDT writes to clients.
drop policy if exists wallets_own on public.wallets;
create policy wallets_own on public.wallets for all to public
using (auth.uid() = user_id and upper(coalesce(currency::text, '')) <> 'USDT'
  and (upper(coalesce(currency::text, '')) <> 'EURC' or public.can_read_borderpay_eurc(auth.uid())))
with check (auth.uid() = user_id and upper(coalesce(currency::text, '')) <> 'USDT'
  and (upper(coalesce(currency::text, '')) <> 'EURC' or public.can_read_borderpay_eurc(auth.uid())));

drop policy if exists wallets_usdt_owner_read on public.wallets;
create policy wallets_usdt_owner_read on public.wallets for select to authenticated
using (auth.uid() = user_id and upper(coalesce(currency::text, '')) = 'USDT'
  and public.can_read_borderpay_usdt(auth.uid()) and public.can_read_bridge_financial_data(auth.uid()));
