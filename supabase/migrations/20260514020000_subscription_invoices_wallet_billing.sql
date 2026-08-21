-- ============================================================================
-- 20260514_subscription_invoices_wallet_billing.sql
-- ----------------------------------------------------------------------------
-- Wallet-debit subscription billing. BorderPay does NOT use Stripe.
--
-- Users pay subscription fees by debiting their own USD virtual account
-- balance. v1 only supports USD VA as the payment source; stablecoin wallets
-- and mobile money will be added once their balance models land.
--
-- Tables added:
--   • subscription_invoices  — per-cycle billable amount + payment metadata
--
-- RPC added:
--   • pay_subscription_invoice_from_va(p_invoice_id, p_owner_user_id,
--                                     p_bridge_va_id)
--     One atomic transaction:
--       1. Lock invoice row, ensure status='pending'.
--       2. Lock bridge_virtual_account_balances row for the VA, verify
--          owner match and balance >= invoice amount.
--       3. Decrement available_balance_minor.
--       4. Insert bridge_balance_ledger row (direction='debit', entity='virtual_account').
--       5. For individual owners, mirror the debit on legacy wallets.balance
--          so the user-app's existing balance widgets stay in sync.
--       6. Insert a transactions row (type='fee', provider='bridge', amount
--          stored as negative for the subscription debit).
--       7. Mark invoice paid; extend user_subscriptions.current_period_end
--          by 30 days from the payment instant.
--   • create_subscription_invoice(p_subscription_id, p_plan_key) — used by
--     the subscription-upgrade edge function to materialise a pending row.
--
-- Concurrency:
--   • Each RPC takes row-level locks. Two parallel debit attempts on the
--     same VA serialise on the balance row.
-- ============================================================================

set search_path = public, pg_temp;

-- ── 1. subscription_invoices ───────────────────────────────────────────────
create table if not exists public.subscription_invoices (
  id                       uuid        primary key default gen_random_uuid(),
  subscription_id          uuid        not null references public.user_subscriptions(id) on delete cascade,
  -- Capture the plan_key on the invoice itself so a later plan change does
  -- not retroactively alter the historical billed plan.
  plan_key                 text        not null,
  amount_usd_cents         integer     not null check (amount_usd_cents > 0),
  currency_charged         text        not null default 'USD',
  status                   text        not null default 'pending'
    check (status in ('pending','paid','failed','cancelled','refunded')),
  -- Period this invoice covers; updated when actually paid (period starts at payment).
  period_start             timestamptz,
  period_end               timestamptz,
  due_at                   timestamptz not null default now(),
  paid_at                  timestamptz,
  -- Payment provenance.
  payment_bridge_va_id     text,
  payment_currency         text,         -- 'USD' for v1
  payment_amount_minor     bigint,       -- minor units in payment_currency
  payment_ledger_id        uuid,         -- bridge_balance_ledger.id of the debit
  payment_tx_id            uuid,         -- transactions.id of the fee row
  failure_reason           text,
  metadata                 jsonb       not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists si_subscription_idx on public.subscription_invoices (subscription_id);
create index if not exists si_status_idx       on public.subscription_invoices (status, due_at);

alter table public.subscription_invoices enable row level security;
drop policy if exists si_owner_read     on public.subscription_invoices;
create policy si_owner_read on public.subscription_invoices for select to authenticated
  using (
    subscription_id in (
      select id from public.user_subscriptions
       where auth.uid() = user_id or auth.uid() = business_user_id
    )
  );
drop policy if exists si_admin_read     on public.subscription_invoices;
create policy si_admin_read on public.subscription_invoices for select to authenticated
  using (public.is_borderpay_admin());
drop policy if exists si_service_role   on public.subscription_invoices;
create policy si_service_role on public.subscription_invoices for all to service_role using (true) with check (true);

drop trigger if exists trg_si_updated on public.subscription_invoices;
create trigger trg_si_updated before update on public.subscription_invoices
  for each row execute function public.set_updated_at();

-- ── 2. create_subscription_invoice() ────────────────────────────────────────
create or replace function public.create_subscription_invoice(
  p_subscription_id uuid,
  p_plan_key        text,
  p_amount_usd_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_subscription_id is null then
    raise exception 'create_subscription_invoice: subscription_id required';
  end if;
  if p_amount_usd_cents is null or p_amount_usd_cents <= 0 then
    raise exception 'create_subscription_invoice: amount must be positive (got %)', p_amount_usd_cents;
  end if;

  insert into public.subscription_invoices (
    subscription_id, plan_key, amount_usd_cents, status
  ) values (
    p_subscription_id, p_plan_key, p_amount_usd_cents, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_subscription_invoice(uuid, text, integer) from public;
grant execute on function public.create_subscription_invoice(uuid, text, integer) to service_role;

-- ── 3. pay_subscription_invoice_from_va() ───────────────────────────────────
create or replace function public.pay_subscription_invoice_from_va(
  p_invoice_id       uuid,
  p_owner_user_id    uuid,
  p_bridge_va_id     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice          public.subscription_invoices%rowtype;
  v_sub              public.user_subscriptions%rowtype;
  v_balance_row      public.bridge_virtual_account_balances%rowtype;
  v_amount_minor     bigint;
  v_new_balance      bigint;
  v_now              timestamptz := now();
  v_period_end       timestamptz;
  v_ledger_id        uuid;
  v_tx_id            uuid;
  v_va_owner_user    uuid;
  v_va_owner_biz     uuid;
begin
  if p_invoice_id is null or p_owner_user_id is null or p_bridge_va_id is null then
    raise exception 'pay_subscription_invoice_from_va: all params required';
  end if;

  -- 1. Lock the invoice.
  select * into v_invoice
    from public.subscription_invoices
   where id = p_invoice_id
   for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND: %', p_invoice_id;
  end if;
  if v_invoice.status <> 'pending' then
    raise exception 'INVOICE_NOT_PENDING: invoice % has status %', p_invoice_id, v_invoice.status
      using errcode = 'P0003';
  end if;

  -- 2. Load + validate the subscription, prove ownership.
  select * into v_sub from public.user_subscriptions where id = v_invoice.subscription_id;
  if not found then
    raise exception 'SUB_NOT_FOUND: subscription % missing', v_invoice.subscription_id;
  end if;
  if v_sub.user_id is not null and v_sub.user_id <> p_owner_user_id then
    raise exception 'OWNERSHIP_MISMATCH: subscription owner != caller';
  end if;
  if v_sub.business_user_id is not null and v_sub.business_user_id <> p_owner_user_id then
    raise exception 'OWNERSHIP_MISMATCH: business owner != caller';
  end if;

  -- 3. Lock the balance row, prove VA ownership matches subscription owner.
  select * into v_balance_row
    from public.bridge_virtual_account_balances
   where bridge_virtual_account_id = p_bridge_va_id
   for update;
  if not found then
    raise exception 'NO_VA_BALANCE: bridge_virtual_account_id % missing', p_bridge_va_id;
  end if;
  v_va_owner_user := v_balance_row.user_id;
  v_va_owner_biz  := v_balance_row.business_user_id;
  if coalesce(v_va_owner_user, v_va_owner_biz) <> p_owner_user_id then
    raise exception 'OWNERSHIP_MISMATCH: VA owner != caller';
  end if;
  if v_balance_row.currency <> v_invoice.currency_charged then
    raise exception 'CURRENCY_MISMATCH: VA currency % != invoice %', v_balance_row.currency, v_invoice.currency_charged;
  end if;

  -- 4. v1: invoice charged in USD, payment_currency = USD VA. 1:1.
  --    Minor unit conversion: USD cents are minor units directly.
  v_amount_minor := v_invoice.amount_usd_cents::bigint;
  if v_balance_row.available_balance_minor < v_amount_minor then
    raise exception 'INSUFFICIENT_FUNDS: balance % < requested %', v_balance_row.available_balance_minor, v_amount_minor
      using errcode = 'P0002';
  end if;

  -- 5. Debit canonical balance.
  v_new_balance := v_balance_row.available_balance_minor - v_amount_minor;
  update public.bridge_virtual_account_balances
     set available_balance_minor = v_new_balance,
         updated_at = v_now
   where id = v_balance_row.id;

  -- 6. Write the ledger row (immutable audit; event_id is the invoice id).
  insert into public.bridge_balance_ledger (
    event_id, provider, entity_type, entity_id, user_id, business_user_id,
    currency, amount_minor, direction, balance_after_minor, metadata
  ) values (
    'subscription_invoice:' || p_invoice_id, 'bridge', 'virtual_account', p_bridge_va_id,
    v_va_owner_user, v_va_owner_biz,
    v_balance_row.currency, v_amount_minor, 'debit', v_new_balance,
    jsonb_build_object(
      'kind',            'subscription_payment',
      'invoice_id',      p_invoice_id,
      'plan_key',        v_invoice.plan_key,
      'subscription_id', v_sub.id
    )
  )
  on conflict (event_id) do nothing
  returning id into v_ledger_id;

  -- 7. For individual owners only, mirror the debit on legacy wallets.balance.
  if v_va_owner_user is not null then
    update public.wallets
       set balance = greatest(0, coalesce(balance, 0) - (v_amount_minor::numeric / 100.0)),
           updated_at = v_now
     where user_id = v_va_owner_user
       and currency = v_balance_row.currency
       and provider = 'bridge';
  end if;

  -- 8. transactions row — type='fee', negative amount.
  insert into public.transactions (
    user_id, type, amount, currency, status, reference,
    description, metadata, provider, created_at
  ) values (
    coalesce(v_va_owner_user, v_va_owner_biz),
    'fee'::public.transaction_type,
    -(v_amount_minor::numeric / 100.0),
    v_balance_row.currency,
    'completed'::public.transaction_status,
    'subscription_invoice:' || p_invoice_id,
    'BorderPay ' || initcap(replace(v_invoice.plan_key, '_', ' ')) || ' subscription',
    jsonb_build_object(
      'kind',            'subscription_payment',
      'invoice_id',      p_invoice_id,
      'plan_key',        v_invoice.plan_key,
      'subscription_id', v_sub.id,
      'source',          'bridge'
    ),
    'bridge'::public.payment_provider,
    v_now
  )
  on conflict (reference) do nothing
  returning id into v_tx_id;

  -- 9. Mark invoice paid; set period to now() .. now()+30d.
  v_period_end := v_now + interval '30 days';
  update public.subscription_invoices
     set status               = 'paid',
         period_start         = v_now,
         period_end           = v_period_end,
         paid_at              = v_now,
         payment_bridge_va_id = p_bridge_va_id,
         payment_currency     = v_balance_row.currency,
         payment_amount_minor = v_amount_minor,
         payment_ledger_id    = v_ledger_id,
         payment_tx_id        = v_tx_id,
         updated_at           = v_now
   where id = p_invoice_id;

  -- 10. Activate the subscription for the paid period. cancel_at_period_end
  --     cleared because the user just renewed/upgraded.
  update public.user_subscriptions
     set status               = 'active',
         current_period_start = v_now,
         current_period_end   = v_period_end,
         cancel_at_period_end = false,
         updated_at           = v_now
   where id = v_sub.id;

  return jsonb_build_object(
    'paid',           true,
    'invoice_id',     p_invoice_id,
    'subscription_id', v_sub.id,
    'period_start',   v_now,
    'period_end',     v_period_end,
    'amount_minor',   v_amount_minor,
    'currency',       v_balance_row.currency,
    'new_balance_minor', v_new_balance,
    'ledger_id',      v_ledger_id,
    'tx_id',          v_tx_id
  );
end;
$$;

revoke all on function public.pay_subscription_invoice_from_va(uuid, uuid, text) from public;
grant execute on function public.pay_subscription_invoice_from_va(uuid, uuid, text) to service_role;

-- ── 4. switch_subscription_plan() ───────────────────────────────────────────
-- After a paid invoice succeeds we may need to flip the user_subscriptions
-- row's plan_key to the upgraded plan. Idempotent.
create or replace function public.switch_subscription_plan(
  p_subscription_id uuid,
  p_new_plan_key    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.user_subscriptions
     set plan_key   = p_new_plan_key,
         status     = 'active',
         updated_at = now()
   where id = p_subscription_id;
end;
$$;

revoke all on function public.switch_subscription_plan(uuid, text) from public;
grant execute on function public.switch_subscription_plan(uuid, text) to service_role;
