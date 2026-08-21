-- Provider corridor policy (Step 2)
--
-- Source-of-truth routing matrix for provider/country/currency/channel.
-- Runtime must fail-closed when no enabled policy exists.

create table if not exists public.provider_corridor_policy (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  provider              text not null check (provider in ('bridge', 'flutterwave')),
  direction             text not null check (direction in ('receive', 'payout', 'fx')),
  country_code          text not null,
  source_currency       text,
  destination_currency  text,
  channel               text check (channel in ('bank', 'mobile_money', 'wallet')),
  enabled               boolean not null default true,
  requires_bridge_kyc   boolean not null default true,
  priority              integer not null default 100,
  notes                 text
);

create unique index if not exists provider_corridor_policy_uq
  on public.provider_corridor_policy (
    provider,
    direction,
    country_code,
    coalesce(source_currency, ''),
    coalesce(destination_currency, ''),
    coalesce(channel, '')
  );

create index if not exists provider_corridor_policy_lookup_idx
  on public.provider_corridor_policy (
    provider,
    direction,
    country_code,
    enabled,
    priority desc
  );

alter table public.provider_corridor_policy enable row level security;

drop policy if exists provider_corridor_policy_service_role on public.provider_corridor_policy;
create policy provider_corridor_policy_service_role on public.provider_corridor_policy
  for all to service_role
  using (true) with check (true);

drop policy if exists provider_corridor_policy_admin_read on public.provider_corridor_policy;
create policy provider_corridor_policy_admin_read on public.provider_corridor_policy
  for select to authenticated
  using (public.is_borderpay_admin());

-- Seed Flutterwave payout policy matrix.
-- Includes local currencies and USD corridors for Bridge-eligible countries.
with countries(code, local_ccy) as (
  values
    ('NG','NGN'),
    ('KE','KES'),
    ('GH','GHS'),
    ('UG','UGX'),
    ('TZ','TZS'),
    ('RW','RWF'),
    ('ZM','ZMW'),
    ('ZA','ZAR')
),
channels(ch) as (
  values ('bank'), ('mobile_money')
),
currencies(ccy) as (
  values ('USD')
)
insert into public.provider_corridor_policy
  (provider, direction, country_code, destination_currency, channel, enabled, requires_bridge_kyc, priority, notes)
select
  'flutterwave',
  'payout',
  c.code,
  c.local_ccy,
  ch.ch,
  true,
  true,
  200,
  'step2_seed_local_and_usd'
from countries c
cross join channels ch
on conflict do nothing;

-- A CTE is scoped to one statement. Repeat the seed relations for the USD
-- insert instead of referring to the preceding statement's CTE names.
with countries(code, local_ccy) as (
  values
    ('NG','NGN'),
    ('KE','KES'),
    ('GH','GHS'),
    ('UG','UGX'),
    ('TZ','TZS'),
    ('RW','RWF'),
    ('ZM','ZMW'),
    ('ZA','ZAR')
),
channels(ch) as (
  values ('bank'), ('mobile_money')
),
currencies(ccy) as (
  values ('USD')
)
insert into public.provider_corridor_policy
  (provider, direction, country_code, destination_currency, channel, enabled, requires_bridge_kyc, priority, notes)
select
  'flutterwave',
  'payout',
  c.code,
  usd.ccy,
  ch.ch,
  true,
  true,
  190,
  'step2_seed_local_and_usd'
from countries c
cross join channels ch
cross join currencies usd
on conflict do nothing;
