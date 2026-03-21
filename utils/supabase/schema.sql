-- BorderPay Africa – Supabase Schema
-- Run this in your Supabase SQL editor to set up all tables.
-- All tables use RLS (Row Level Security) with user-scoped policies.

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Profiles ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text,
  phone            text,
  country          text,
  date_of_birth    text,
  kyc_status       text default 'pending',
  account_type     text default 'individual',
  is_unlocked      boolean default false,
  two_factor_enabled boolean default false,
  referral_code    text unique,
  session_data     jsonb,
  session_history  jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile"   on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- ── Wallets ───────────────────────────────────────────────────────────────────
create table if not exists public.wallets (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  currency     text not null,
  balance      numeric(18,6) default 0,
  symbol       text,
  color        text,
  is_active    boolean default true,
  provider_ref text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(user_id, currency)
);

alter table public.wallets enable row level security;
create policy "Users can view own wallets"   on public.wallets for select using (auth.uid() = user_id);
create policy "Users can update own wallets" on public.wallets for update using (auth.uid() = user_id);
create policy "Users can insert own wallets" on public.wallets for insert with check (auth.uid() = user_id);

-- ── Transactions ──────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  type            text not null,         -- deposit | withdrawal | transfer | exchange | card_debit
  status          text default 'pending', -- pending | completed | failed
  amount          numeric(18,6),
  currency        text,
  fee             numeric(18,6) default 0,
  description     text,
  reference       text unique,
  provider_ref    text,
  metadata        jsonb,
  created_at      timestamptz default now()
);

alter table public.transactions enable row level security;
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions for insert with check (auth.uid() = user_id);

-- ── Cards ─────────────────────────────────────────────────────────────────────
create table if not exists public.cards (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  card_name        text,
  design_id        text default 'neon-surge',
  brand            text default 'VISA',
  status           text default 'active',  -- active | frozen | terminated
  balance          numeric(18,6) default 0,
  currency         text default 'USD',
  provider_ref     text,
  daily_limit      numeric(18,6) default 500,
  monthly_limit    numeric(18,6) default 5000,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.cards enable row level security;
create policy "Users can view own cards"   on public.cards for select using (auth.uid() = user_id);
create policy "Users can update own cards" on public.cards for update using (auth.uid() = user_id);
create policy "Users can insert own cards" on public.cards for insert with check (auth.uid() = user_id);

-- ── Notifications ─────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text,
  body       text,
  type       text,
  is_read    boolean default false,
  metadata   jsonb,
  created_at timestamptz default now()
);

alter table public.notifications enable row level security;
create policy "Users can view own notifications"   on public.notifications for select using (auth.uid() = user_id);
create policy "Users can update own notifications" on public.notifications for update using (auth.uid() = user_id);
create policy "Users can insert own notifications" on public.notifications for insert with check (auth.uid() = user_id);

-- ── KYC Documents ────────────────────────────────────────────────────────────
create table if not exists public.kyc_documents (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  document_type   text,  -- id_card | passport | drivers_license | utility_bill | bank_statement
  status          text default 'pending',  -- pending | approved | rejected
  storage_path    text,
  provider_ref    text,
  rejection_reason text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.kyc_documents enable row level security;
create policy "Users can view own kyc docs"   on public.kyc_documents for select using (auth.uid() = user_id);
create policy "Users can insert own kyc docs" on public.kyc_documents for insert with check (auth.uid() = user_id);

-- ── Add session columns to profiles (migration) ───────────────────────────────
alter table public.profiles
  add column if not exists session_data    jsonb,
  add column if not exists session_history jsonb;

-- ── Auto-update updated_at ────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create or replace trigger profiles_updated_at    before update on public.profiles    for each row execute function public.set_updated_at();
create or replace trigger wallets_updated_at     before update on public.wallets     for each row execute function public.set_updated_at();
create or replace trigger cards_updated_at       before update on public.cards       for each row execute function public.set_updated_at();
create or replace trigger kyc_docs_updated_at    before update on public.kyc_documents for each row execute function public.set_updated_at();

-- ── Auto-create profile on signup ─────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, phone, country, kyc_status)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'country',
    coalesce(new.raw_user_meta_data->>'kyc_status', 'pending')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
