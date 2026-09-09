-- BorderPay legacy dashboard schema baseline.
--
-- Before migrations were version-controlled, these objects were created from
-- the Supabase dashboard.  Later checked-in migrations ALTER them, attach RLS
-- policies to them, or call their queue functions.  A clean database therefore
-- needs this truthful pre-history before the 20260101 identity baseline runs.
--
-- This migration is intentionally additive and idempotent.  It does not seed
-- customer data and it does not attempt to recreate Supabase-owned auth,
-- storage, gateway, or extension schemas.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Shared timestamp helpers existed before the first checked-in migrations.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'transaction_type') then
    create type public.transaction_type as enum ('deposit','withdrawal','transfer','exchange','card_debit','fee');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'transaction_status') then
    create type public.transaction_status as enum ('pending','processing','completed','failed','cancelled');
  end if;
end $$;

create table if not exists public.admin_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'ADMIN_SUPER',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.wallets (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  currency                   text not null,
  balance                    numeric(18,6) not null default 0,
  symbol                     text,
  color                      text,
  status                     text not null default 'active',
  is_active                  boolean not null default true,
  provider_ref               text,
  maplerad_wallet_id         text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (user_id, currency)
);

create table if not exists public.accounts (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  currency                   text not null,
  account_type               text,
  status                     text not null default 'active',
  provider_ref               text,
  maplerad_account_id        text,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.transactions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  type                       public.transaction_type not null,
  status                     public.transaction_status not null default 'pending',
  amount                     numeric(18,6),
  currency                   text,
  fee                        numeric(18,6) not null default 0,
  description                text,
  reference                  text unique,
  provider_ref               text,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.cards (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  card_name                  text,
  design_id                  text default 'neon-surge',
  brand                      text default 'VISA',
  status                     text not null default 'active',
  balance                    numeric(18,6) not null default 0,
  currency                   text not null default 'USD',
  provider_ref               text,
  maplerad_card_id           text,
  daily_limit                numeric(18,6) default 500,
  monthly_limit              numeric(18,6) default 5000,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.stablecoin_transactions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  type                       text not null,
  status                     text not null default 'pending',
  amount                     numeric(36,18),
  currency                   text,
  network                    text,
  tx_hash                    text,
  from_address               text,
  to_address                 text,
  fee                        numeric(36,18) not null default 0,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.kyc_verifications (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  status                     text not null default 'pending',
  provider_ref               text,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.kyc_submissions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  status                     text not null default 'pending',
  maplerad_customer_id       text,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.notifications (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  title                      text,
  body                       text,
  type                       text,
  is_read                    boolean not null default false,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now()
);

create table if not exists public.fee_config (
  id                         uuid primary key default gen_random_uuid(),
  is_maplerad_readonly       boolean,
  maplerad_fee_cap           numeric,
  maplerad_fee_currency      text,
  maplerad_fee_min           numeric,
  maplerad_fee_type          text,
  maplerad_fee_value         numeric,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.fee_schedule (
  id                         uuid primary key default gen_random_uuid(),
  name                       text,
  maplerad_fee_fixed         numeric,
  maplerad_fee_percent       numeric,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.referrals (
  id                         uuid primary key default gen_random_uuid(),
  referrer_id                uuid not null references auth.users(id) on delete cascade,
  referred_id                uuid not null unique references auth.users(id) on delete cascade,
  status                     text not null default 'pending',
  commission                 numeric(18,6) not null default 0,
  country                    text,
  device_hash                text,
  ip_hash                    text,
  suspicious                 boolean not null default false,
  referred_at                timestamptz not null default now(),
  qualified_at               timestamptz,
  paid_at                    timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (referrer_id <> referred_id)
);

create table if not exists public.referral_earnings (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  referral_id                uuid references public.referrals(id) on delete set null,
  amount                     numeric(18,6) not null default 0,
  status                     text not null default 'pending',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.referral_payouts (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  amount                     numeric(18,6) not null default 0,
  status                     text not null default 'pending',
  maplerad_ref               text,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.referral_config (
  id                         uuid primary key default gen_random_uuid(),
  commission_per_referral    numeric(18,6) not null default 5,
  min_payout_threshold       numeric(18,6) not null default 100,
  payout_destination         text not null default 'borderpay_wallet',
  link_expiry_days           integer not null default 365,
  program_status             text not null default 'active',
  max_referrals_per_day      integer not null default 1000,
  flag_threshold             integer not null default 50,
  updated_by                 text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.app_config (
  key                         text primary key,
  value                       text,
  description                 text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create or replace function public.app_config_get(p_key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select value from public.app_config where key = p_key limit 1
$$;

create table if not exists public.webhook_logs (
  event_id                    text primary key,
  source                      text not null,
  event_type                  text not null,
  status                      text not null default 'received'
    check (status in ('received','queued','processing','completed','failed','duplicate','rejected')),
  signature_ok                boolean,
  payload_hash                text,
  pending_event_id            uuid,
  attempts                    integer not null default 0,
  last_error                  text,
  received_at                 timestamptz not null default now(),
  queued_at                   timestamptz,
  completed_at                timestamptz,
  updated_at                  timestamptz not null default now()
);

create table if not exists public.pending_events (
  id                          uuid primary key default gen_random_uuid(),
  event_id                    text not null unique references public.webhook_logs(event_id) on delete cascade,
  source                      text not null,
  event_type                  text not null,
  payload                     jsonb not null default '{}'::jsonb,
  status                      text not null default 'queued'
    check (status in ('queued','processing','completed','failed')),
  attempts                    integer not null default 0,
  max_attempts                integer not null default 5,
  locked_by                   text,
  locked_at                   timestamptz,
  next_attempt_at             timestamptz not null default now(),
  last_error                  text,
  result_summary              jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  completed_at                timestamptz
);

create index if not exists pending_events_queue_idx
  on public.pending_events (status, next_attempt_at, created_at);
create index if not exists pending_events_locked_idx
  on public.pending_events (locked_at) where status = 'processing';

create or replace function public.claim_pending_events(p_worker_id text, p_batch_size integer default 25)
returns setof public.pending_events
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with candidates as (
    select id from public.pending_events
    where status in ('queued','failed')
      and next_attempt_at <= now()
      and attempts < max_attempts
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_batch_size, 25), 100))
  )
  update public.pending_events p
     set status = 'processing', attempts = p.attempts + 1,
         locked_by = p_worker_id, locked_at = now(), updated_at = now()
    from candidates c where p.id = c.id
  returning p.*;
end;
$$;

create or replace function public.complete_pending_event(p_event_id text, p_summary jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.webhook_logs set status='completed', completed_at=now(), updated_at=now()
   where event_id=p_event_id;
  update public.pending_events
     set status='completed', completed_at=now(), result_summary=coalesce(p_summary,'{}'::jsonb),
         locked_by=null, locked_at=null, last_error=null, updated_at=now()
   where event_id=p_event_id;
end;
$$;

create or replace function public.fail_pending_event(
  p_event_id text, p_error text, p_backoff_seconds integer default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.pending_events%rowtype; v_terminal boolean; v_backoff integer;
begin
  select * into v from public.pending_events where event_id=p_event_id for update;
  if not found then return; end if;
  v_terminal := v.attempts >= v.max_attempts;
  v_backoff := coalesce(p_backoff_seconds, least(900, 30 * (2 ^ greatest(v.attempts - 1, 0))::int));
  update public.pending_events set
    status=case when v_terminal then 'failed' else 'queued' end,
    locked_by=null, locked_at=null, last_error=p_error,
    next_attempt_at=case when v_terminal then now() else now() + make_interval(secs=>v_backoff) end,
    updated_at=now()
  where event_id=p_event_id;
  update public.webhook_logs set
    status=case when v_terminal then 'failed' else 'queued' end,
    attempts=v.attempts, last_error=p_error, updated_at=now()
  where event_id=p_event_id;
end;
$$;

create or replace function public.reap_stuck_processing(p_lock_timeout_seconds integer default 300)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  update public.pending_events
     set status='queued', locked_by=null, locked_at=null, next_attempt_at=now(), updated_at=now()
   where status='processing'
     and locked_at < now() - make_interval(secs=>greatest(1,coalesce(p_lock_timeout_seconds,300)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create table if not exists public.admin_alerts (
  id                          uuid primary key default gen_random_uuid(),
  alert_type                  text not null,
  severity                    text not null default 'medium',
  user_id                     uuid references auth.users(id) on delete set null,
  message                     text not null,
  metadata                    jsonb not null default '{}'::jsonb,
  resolved                    boolean not null default false,
  resolved_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table if not exists public.admin_action_audit (
  id                          uuid primary key default gen_random_uuid(),
  actor_id                    uuid references auth.users(id) on delete set null,
  role                        text,
  action_type                 text not null,
  target_resource             text,
  before_state                jsonb,
  after_state                 jsonb,
  request_id                  text,
  created_at                  timestamptz not null default now()
);

-- These tables are all user/admin/runtime surfaces and were RLS-enabled in
-- the dashboard.  Policies are installed or hardened by later migrations.
do $$
declare t text;
begin
  foreach t in array array[
    'admin_users','wallets','accounts','transactions','cards',
    'stablecoin_transactions','kyc_verifications','kyc_submissions',
    'notifications','fee_config','fee_schedule','referrals',
    'referral_earnings','referral_payouts','referral_config','app_config',
    'webhook_logs','pending_events','admin_alerts','admin_action_audit'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare missing text[];
begin
  select array_agg(x) into missing
  from unnest(array[
    'admin_users','wallets','accounts','transactions','cards',
    'stablecoin_transactions','kyc_verifications','notifications',
    'pending_events','webhook_logs','app_config','referrals',
    'referral_earnings','referral_payouts','referral_config'
  ]) x
  where to_regclass('public.' || x) is null;
  if missing is not null then
    raise exception 'legacy baseline missing required relations: %', missing;
  end if;
end $$;
