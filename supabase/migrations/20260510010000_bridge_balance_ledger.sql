-- ============================================================================
-- 20260510_bridge_balance_ledger.sql
-- ----------------------------------------------------------------------------
-- First-class Bridge balance model with auditable ledger. Replaces the
-- legacy-wallet-only path for business deposits and adds an immutable
-- record of every Bridge balance change.
--
-- Tables:
--   • bridge_virtual_account_balances — mutable current balance per VA
--   • bridge_balance_ledger           — immutable, event-keyed change log
--
-- RPC:
--   • apply_bridge_va_credit(...) — atomic credit:
--       1. INSERT into bridge_balance_ledger ON CONFLICT (event_id) DO NOTHING
--       2. If insert succeeded, INSERT (if missing) the balance row, then
--          UPDATE balance_minor += amount_minor, write balance_after_minor
--          back into the ledger row.
--       3. Return (applied bool, new_balance_minor bigint).
--     Webhook retries with the same event_id are no-ops.
--
-- All amounts are stored as bigint minor units (cents for USD/EUR/GBP).
-- Conversion lives in the worker — this layer assumes integers.
-- ============================================================================

set search_path = public, pg_temp;

-- ── 1. bridge_virtual_account_balances ────────────────────────────────────
create table if not exists public.bridge_virtual_account_balances (
  id                          uuid        primary key default gen_random_uuid(),
  bridge_virtual_account_id   text        not null unique,
  user_id                     uuid        references auth.users(id) on delete cascade,
  business_user_id            uuid        references public.business_profiles(user_id) on delete cascade,
  currency                    text        not null,
  available_balance_minor     bigint      not null default 0,
  pending_balance_minor       bigint      not null default 0,
  updated_at                  timestamptz not null default now(),
  constraint bvab_owner_xor check ((user_id is not null) or (business_user_id is not null))
);

create index if not exists bvab_user_idx     on public.bridge_virtual_account_balances (user_id) where user_id is not null;
create index if not exists bvab_business_idx on public.bridge_virtual_account_balances (business_user_id) where business_user_id is not null;
create index if not exists bvab_currency_idx on public.bridge_virtual_account_balances (currency);

alter table public.bridge_virtual_account_balances enable row level security;
drop policy if exists bvab_owner_read   on public.bridge_virtual_account_balances;
create policy bvab_owner_read   on public.bridge_virtual_account_balances for select to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);
drop policy if exists bvab_admin_read   on public.bridge_virtual_account_balances;
create policy bvab_admin_read   on public.bridge_virtual_account_balances for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bvab_service_role on public.bridge_virtual_account_balances;
create policy bvab_service_role on public.bridge_virtual_account_balances for all to service_role using (true) with check (true);

drop trigger if exists trg_bvab_updated on public.bridge_virtual_account_balances;
create trigger trg_bvab_updated before update on public.bridge_virtual_account_balances
  for each row execute function public.set_updated_at();

-- ── 2. bridge_balance_ledger ──────────────────────────────────────────────
create table if not exists public.bridge_balance_ledger (
  id                    uuid        primary key default gen_random_uuid(),
  event_id              text        not null unique,         -- idempotency key (the webhook event id)
  provider              text        not null default 'bridge',
  entity_type           text        not null
    check (entity_type in ('virtual_account','wallet','transfer')),
  entity_id             text        not null,
  user_id               uuid        references auth.users(id) on delete set null,
  business_user_id      uuid        references public.business_profiles(user_id) on delete set null,
  currency              text        not null,
  amount_minor          bigint      not null,
  direction             text        not null
    check (direction in ('credit','debit')),
  balance_after_minor   bigint      null,
  metadata              jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists bbl_user_idx     on public.bridge_balance_ledger (user_id, created_at desc) where user_id is not null;
create index if not exists bbl_business_idx on public.bridge_balance_ledger (business_user_id, created_at desc) where business_user_id is not null;
create index if not exists bbl_entity_idx   on public.bridge_balance_ledger (entity_type, entity_id);

alter table public.bridge_balance_ledger enable row level security;
drop policy if exists bbl_owner_read   on public.bridge_balance_ledger;
create policy bbl_owner_read   on public.bridge_balance_ledger for select to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);
drop policy if exists bbl_admin_read   on public.bridge_balance_ledger;
create policy bbl_admin_read   on public.bridge_balance_ledger for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bbl_service_role on public.bridge_balance_ledger;
create policy bbl_service_role on public.bridge_balance_ledger for all to service_role using (true) with check (true);

-- ── 3. apply_bridge_va_credit() ───────────────────────────────────────────
-- Atomic credit applied to a virtual account. Idempotent on event_id.
create or replace function public.apply_bridge_va_credit(
  p_event_id              text,
  p_bridge_va_id          text,
  p_user_id               uuid,                 -- nullable; one of user_id / business_user_id
  p_business_user_id      uuid,                 -- nullable; the other
  p_currency              text,
  p_amount_minor          bigint,               -- positive integer
  p_metadata              jsonb default '{}'::jsonb
)
returns table (
  applied              boolean,
  new_balance_minor    bigint,
  balance_row_id       uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ledger_id   uuid;
  v_balance_id  uuid;
  v_new_balance bigint;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'apply_bridge_va_credit: p_amount_minor must be a positive integer (got %)', p_amount_minor;
  end if;
  if p_user_id is null and p_business_user_id is null then
    raise exception 'apply_bridge_va_credit: one of p_user_id / p_business_user_id is required';
  end if;
  if p_user_id is not null and p_business_user_id is not null then
    raise exception 'apply_bridge_va_credit: only one of p_user_id / p_business_user_id may be set';
  end if;

  -- Idempotent ledger insert. ON CONFLICT keeps the existing row untouched.
  insert into public.bridge_balance_ledger (
    event_id, entity_type, entity_id, user_id, business_user_id,
    currency, amount_minor, direction, metadata
  ) values (
    p_event_id, 'virtual_account', p_bridge_va_id, p_user_id, p_business_user_id,
    upper(p_currency), p_amount_minor, 'credit', coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (event_id) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    -- Duplicate webhook: balance untouched. Return current balance for visibility.
    select id, available_balance_minor
      into v_balance_id, v_new_balance
      from public.bridge_virtual_account_balances
     where bridge_virtual_account_id = p_bridge_va_id;
    return query select false::boolean, v_new_balance, v_balance_id;
    return;
  end if;

  -- Ensure balance row exists.
  insert into public.bridge_virtual_account_balances (
    bridge_virtual_account_id, user_id, business_user_id, currency,
    available_balance_minor, pending_balance_minor
  ) values (
    p_bridge_va_id, p_user_id, p_business_user_id, upper(p_currency), 0, 0
  )
  on conflict (bridge_virtual_account_id) do nothing;

  -- Apply credit.
  update public.bridge_virtual_account_balances
     set available_balance_minor = available_balance_minor + p_amount_minor,
         updated_at              = now()
   where bridge_virtual_account_id = p_bridge_va_id
   returning id, available_balance_minor
     into v_balance_id, v_new_balance;

  -- Stamp balance_after onto the ledger row.
  update public.bridge_balance_ledger
     set balance_after_minor = v_new_balance
   where id = v_ledger_id;

  return query select true::boolean, v_new_balance, v_balance_id;
end;
$$;

revoke all on function public.apply_bridge_va_credit(text, text, uuid, uuid, text, bigint, jsonb) from public;
grant execute on function public.apply_bridge_va_credit(text, text, uuid, uuid, text, bigint, jsonb) to service_role;
