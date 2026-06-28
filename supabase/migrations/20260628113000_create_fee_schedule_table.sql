-- P0: ensure Fee Manager backing table exists in production.
-- Idempotent so it is safe to run even if partially created before.

create table if not exists public.fee_schedule (
  id uuid primary key default gen_random_uuid(),
  product text not null,
  currency text not null,
  provider_fee_fixed numeric(20,8) not null default 0,
  provider_fee_percent numeric(12,8) not null default 0,
  borderpay_markup_fixed numeric(20,8) not null default 0,
  borderpay_markup_percent numeric(12,8) not null default 0,
  min_total numeric(20,8) not null default 0,
  max_total numeric(20,8),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_schedule_product_currency_key unique (product, currency)
);

create index if not exists fee_schedule_product_idx on public.fee_schedule(product);
create index if not exists fee_schedule_currency_idx on public.fee_schedule(currency);

create or replace function public.touch_fee_schedule_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_fee_schedule_updated_at on public.fee_schedule;
create trigger trg_fee_schedule_updated_at
before update on public.fee_schedule
for each row
execute function public.touch_fee_schedule_updated_at();

alter table public.fee_schedule enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fee_schedule'
      and policyname = 'fee_schedule_admin_read'
  ) then
    create policy fee_schedule_admin_read
      on public.fee_schedule
      for select
      to authenticated
      using (public.is_borderpay_admin());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fee_schedule'
      and policyname = 'fee_schedule_admin_write'
  ) then
    create policy fee_schedule_admin_write
      on public.fee_schedule
      for all
      to authenticated
      using (public.is_borderpay_admin())
      with check (public.is_borderpay_admin());
  end if;
end $$;

revoke all on public.fee_schedule from anon;
revoke all on public.fee_schedule from authenticated;
grant select, insert, update, delete on public.fee_schedule to authenticated;
grant all on public.fee_schedule to service_role;
