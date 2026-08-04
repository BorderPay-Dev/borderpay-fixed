-- Keep internal provider costs separate from the customer-facing transaction
-- fee. The values below come from the authorized internal commercial fee map.
alter table public.provider_corridor_policy
  add column if not exists customer_fee_percent numeric,
  add column if not exists customer_fee_usd numeric,
  add column if not exists customer_fee_local numeric;

update public.provider_corridor_policy
set customer_fee_percent = case
      when channel = 'mobile_money' then 2.50
      when channel = 'bank' then 2.75
      else customer_fee_percent
    end,
    customer_fee_usd = null,
    customer_fee_local = null,
    updated_at = now()
where provider = 'yellow_card'
  and direction = 'receive'
  and country_code = 'KE'
  and destination_currency = 'KES'
  and channel in ('mobile_money', 'bank');
