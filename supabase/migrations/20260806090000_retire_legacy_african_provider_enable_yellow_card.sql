-- Remove the retired African-rail provider from the active routing matrix.
-- Historical transfer and webhook tables remain immutable for financial audit.

delete from public.provider_corridor_policy
where provider = 'flutterwave';

alter table public.provider_corridor_policy
  drop constraint if exists provider_corridor_policy_provider_check;

alter table public.provider_corridor_policy
  add constraint provider_corridor_policy_provider_check
  check (provider in ('bridge', 'yellow_card'));
