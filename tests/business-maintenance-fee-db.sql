\set ON_ERROR_STOP on

create schema auth;
create extension if not exists pgcrypto;
create role anon;
create role authenticated;
create role service_role;

create table auth.users (id uuid primary key);
create table public.user_profiles (
  id uuid primary key references auth.users(id),
  email text,
  full_name text,
  account_type text,
  kyc_status text,
  kyc_verified_at timestamptz,
  bridge_kyc_completed_at timestamptz,
  updated_at timestamptz default now()
);
create table public.business_profiles (
  user_id uuid primary key references auth.users(id),
  company_name text,
  bridge_kyb_status text,
  bridge_kyb_completed_at timestamptz,
  updated_at timestamptz default now()
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  account_type text not null,
  monthly_fee numeric(12,2) not null,
  status text not null default 'active',
  next_billing_date date not null,
  verified_at timestamptz not null,
  updated_at timestamptz default now(),
  constraint subscriptions_monthly_fee_check check (monthly_fee in (5.00,15.00))
);
create table public.subscription_email_jobs (
  user_id uuid,
  template text,
  recipient text,
  props jsonb,
  idempotency_key text unique
);
create or replace function public.emit_subscription_event(uuid,uuid,uuid,text,text,jsonb)
returns uuid language sql as $$ select gen_random_uuid() $$;
create or replace function public.subscription_next_month_end(p_date date)
returns date language sql immutable strict as $$
  select (date_trunc('month', p_date::timestamp) + interval '2 months - 1 day')::date
$$;

\ir ../supabase/migrations/20260824170000_business_maintenance_fee_september_2026.sql

do $test$
declare
  v_business uuid := gen_random_uuid();
  v_individual uuid := gen_random_uuid();
  v_fee numeric;
begin
  insert into auth.users(id) values (v_business), (v_individual);
  insert into public.user_profiles(id,email,full_name,account_type,kyc_status)
  values
    (v_business,'business@example.com','Acme Owner','business','verified'),
    (v_individual,'individual@example.com','Alex','individual','verified');
  insert into public.business_profiles(user_id,company_name,bridge_kyb_status)
  values(v_business,'Acme Ltd','approved');

  insert into public.subscriptions(user_id,account_type,monthly_fee,next_billing_date,verified_at)
  values(v_business,'business',29.99,date '2026-08-31',now());
  select monthly_fee into v_fee from public.subscriptions where user_id=v_business;
  if v_fee <> 15.00 then raise exception 'August insert charged %, expected 15.00', v_fee; end if;

  update public.subscriptions set next_billing_date=date '2026-09-30' where user_id=v_business;
  select monthly_fee into v_fee from public.subscriptions where user_id=v_business;
  if v_fee <> 29.99 then raise exception 'September transition charged %, expected 29.99', v_fee; end if;

  perform public.ensure_internal_subscription(v_individual,date '2026-09-30',false);
  select monthly_fee into v_fee from public.subscriptions where user_id=v_individual;
  if v_fee <> 5.00 then raise exception 'Individual charged %, expected 5.00', v_fee; end if;

  update public.subscriptions set next_billing_date=date '2026-08-31' where user_id=v_business;
end;
$test$;

\ir ../supabase/migrations/20260824173000_queue_verified_business_fee_announcement.sql

do $announcement_test$
declare
  v_count integer;
  v_date text;
begin
  select count(*), max(props->>'billing_start_date')
    into v_count, v_date
  from public.subscription_email_jobs
  where idempotency_key like 'subscription:business_fee_change:2026-09-01:%';
  if v_count <> 1 then raise exception 'Expected one verified Business announcement, got %', v_count; end if;
  if v_date <> '2026-09-30' then raise exception 'Expected first new-price billing date 2026-09-30, got %', v_date; end if;
end;
$announcement_test$;

select 'business_maintenance_fee_db: PASS' as result;
