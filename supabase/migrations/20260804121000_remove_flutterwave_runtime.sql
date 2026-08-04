-- Permanently remove Flutterwave execution from BorderPay.
-- The three remaining runtime rows were confirmed by the operator as fake
-- tests on 2026-08-04; no production Flutterwave transaction is retained.

delete from public.provider_corridor_policy
where provider = 'flutterwave';

delete from public.provider_settings
where key like 'flutterwave%';

drop table if exists public.flutterwave_webhook_events;
drop table if exists public.flutterwave_transfers;

alter table public.provider_corridor_policy
  drop constraint if exists provider_corridor_policy_provider_check;

alter table public.provider_corridor_policy
  add constraint provider_corridor_policy_provider_check
  check (provider in ('bridge', 'yellow_card'));
