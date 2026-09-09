-- Future Bridge product pricing only.
--
-- This migration changes configuration used when BorderPay creates a new
-- virtual account. It deliberately does not update bridge_virtual_accounts,
-- existing Bridge payment routes, transactions, or historical revenue.

insert into public.app_config (key, value, description, updated_at)
values
  (
    'bridge.virtual_account.onramp.individual.developer_fee_percent',
    '3',
    'Developer fee applied when creating future Individual Bridge virtual accounts.',
    now()
  ),
  (
    'bridge.virtual_account.onramp.business.developer_fee_percent',
    '3',
    'Developer fee applied when creating future Business Bridge virtual accounts.',
    now()
  )
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = excluded.updated_at;

-- Webhook reconciliation uses provider_settings as a fallback when a provider
-- event omits the rate. Keep that fallback aligned with the creation policy.
insert into public.provider_settings (key, value, updated_at)
values
  ('bridge.virtual_account.individual.developer_fee_percent', '3'::jsonb, now()),
  ('bridge.virtual_account.business.developer_fee_percent', '3'::jsonb, now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
