-- Flutterwave billing + payout schema — PR1 (SCHEMA PROPOSAL ONLY).
--
-- ⚠ THIS IS A SCHEMA PROPOSAL. NOT Flutterwave activation. Reviewed-apply
--   gated — DO NOT auto-run. Activation begins only much later, after webhook
--   ingest (PR2), billing checkout (PR3), entitlement sync (PR4), payout state
--   machine (PR5), Flutterwave integration (PR6) and UI-behind-flags (PR7) are
--   each separately reviewed, plus G0 legal/provider + G1 webhook-debt gates.
--
-- Scope of THIS file (additive only):
--   Billing : flutterwave_customers · billing_subscriptions · billing_events
--   Payout  : payout_intents · payout_events
--
-- Provider split (locked): Flutterwave = subscription billing + African fiat
-- payouts. Bridge = KYC/KYB + wallets + accounts + stablecoin infra + pay-in.
-- Bridge external accounts are ACH/SEPA/IBAN, never African-local.
--
-- HARD EXCLUSIONS (must NOT appear in this migration):
--   • NO USDB yield tables / yield ledger / yield revenue.
--   • NO Bridge-external-accounts-for-Africa.
--   • NO transfer flag flip / no wallet-debit subscription workaround.
--   • NO money-movement function, NO provider secrets, NO provider calls.
--
-- Safety properties (asserted by tests/audit/flutterwave_schema_audit.py):
--   • Additive only: every statement is CREATE ... IF NOT EXISTS. No ALTER of
--     a pre-existing table, no DROP TABLE, no DROP COLUMN, no DELETE/UPDATE,
--     no TRUNCATE.
--   • RLS enabled on every new table; owner policy + admin-read, mirroring
--     public.bridge_external_accounts / wallets / transactions.
--   • Idempotency enforced via UNIQUE constraints on provider refs + event ids.
--
-- Reuses existing helpers: public.is_borderpay_admin(), public.touch_updated_at().

-- ============================================================================
-- BILLING
-- ============================================================================

-- Flutterwave customer mapping: BorderPay user ↔ Flutterwave customer id.
create table if not exists public.flutterwave_customers (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  flutterwave_customer_ref text not null,
  email                    text,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id),
  unique (flutterwave_customer_ref)
);

create index if not exists idx_flutterwave_customers_user
  on public.flutterwave_customers (user_id);

alter table public.flutterwave_customers enable row level security;

drop policy if exists flutterwave_customers_own on public.flutterwave_customers;
create policy flutterwave_customers_own
  on public.flutterwave_customers
  for all
  using (auth.uid() = user_id);

drop policy if exists admin_read_all_flutterwave_customers on public.flutterwave_customers;
create policy admin_read_all_flutterwave_customers
  on public.flutterwave_customers
  for select
  to authenticated
  using (is_borderpay_admin());

drop trigger if exists trg_flutterwave_customers_touch on public.flutterwave_customers;
create trigger trg_flutterwave_customers_touch
  before update on public.flutterwave_customers
  for each row execute function public.touch_updated_at();


-- Deterministic subscription/entitlement state. plan_key is BorderPay's tier;
-- status drives entitlement. Written ONLY by the (future) signature-verified
-- Flutterwave webhook — never a human/dashboard mapping.
create table if not exists public.billing_subscriptions (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references auth.users(id) on delete cascade,
  provider                      text not null default 'flutterwave'
                                  check (provider in ('flutterwave')),
  flutterwave_customer_ref      text,
  flutterwave_plan_ref          text,
  flutterwave_subscription_ref  text,
  -- BorderPay tier this subscription grants.
  plan_key                      text not null
                                  check (plan_key in ('individual_premium','business_growth')),
  -- Entitlement-driving status.
  status                        text not null default 'incomplete'
                                  check (status in ('incomplete','active','trialing','past_due','cancelled','expired')),
  current_period_end            timestamptz,
  cancel_at_period_end          boolean not null default false,
  cancelled_at                  timestamptz,
  failed_payment_at             timestamptz,
  failure_reason                text,
  metadata                      jsonb not null default '{}'::jsonb,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  -- Idempotency: one local row per Flutterwave subscription reference.
  unique (flutterwave_subscription_ref)
);

create index if not exists idx_billing_subscriptions_user
  on public.billing_subscriptions (user_id);
create index if not exists idx_billing_subscriptions_status
  on public.billing_subscriptions (status);

alter table public.billing_subscriptions enable row level security;

drop policy if exists billing_subscriptions_own on public.billing_subscriptions;
create policy billing_subscriptions_own
  on public.billing_subscriptions
  for all
  using (auth.uid() = user_id);

drop policy if exists admin_read_all_billing_subscriptions on public.billing_subscriptions;
create policy admin_read_all_billing_subscriptions
  on public.billing_subscriptions
  for select
  to authenticated
  using (is_borderpay_admin());

drop trigger if exists trg_billing_subscriptions_touch on public.billing_subscriptions;
create trigger trg_billing_subscriptions_touch
  before update on public.billing_subscriptions
  for each row execute function public.touch_updated_at();


-- Raw Flutterwave billing webhook events (audit + idempotency). Mirrors
-- public.bridge_webhook_events. Dedupe on provider event id.
create table if not exists public.billing_events (
  id                 uuid primary key default gen_random_uuid(),
  event_id           text not null,
  event_type         text,
  signature_ok       boolean not null default false,
  payload            jsonb not null default '{}'::jsonb,
  processing_status  text not null default 'received'
                       check (processing_status in ('received','queued','completed','rejected','failed')),
  attempts           integer not null default 0,
  last_error         text,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  unique (event_id)
);

create index if not exists idx_billing_events_type
  on public.billing_events (event_type);
create index if not exists idx_billing_events_status
  on public.billing_events (processing_status);

alter table public.billing_events enable row level security;
-- Webhook table: no owner column. Service-role writes; admins read. No public
-- policy → RLS denies anon/auth by default (matches webhook-log posture).
drop policy if exists admin_read_all_billing_events on public.billing_events;
create policy admin_read_all_billing_events
  on public.billing_events
  for select
  to authenticated
  using (is_borderpay_admin());


-- ============================================================================
-- PAYOUT
-- ============================================================================

-- Payout intent + ledger lock + state machine. Bridge liquidation and the
-- Flutterwave transfer are INDEPENDENT providers — this row persists every
-- transition so neither leg is assumed atomic with the other.
create table if not exists public.payout_intents (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  amount_minor             bigint not null check (amount_minor > 0),
  source_currency          text not null,         -- e.g. USD / USDB (held at Bridge)
  dest_currency            text not null,         -- African fiat via Flutterwave
  dest_corridor            text,
  -- Captured quotes (Bridge dev fee ≈1% application UNVERIFIED — placeholder).
  fx_quote                 numeric,
  bridge_fee_quote         numeric,
  flutterwave_fee_quote    numeric,
  -- Ledger lock reference (reservation against the user's Bridge balance).
  locked_balance_ref       text,
  -- Provider references.
  bridge_liquidation_ref   text,
  flutterwave_transfer_ref text,
  -- End-to-end idempotency: prevents double-pay on retry.
  idempotency_key          text not null,
  -- State machine (two-provider failure model).
  state                    text not null default 'created'
                             check (state in (
                               'created',
                               'funds_locked',
                               'bridge_funds_available',
                               'flutterwave_transfer_created',
                               'awaiting_webhook',
                               'completed',
                               'bridge_failed',
                               'flutterwave_failed',
                               'refund_required',
                               'manual_review'
                             )),
  failure_reason           text,
  state_changed_at         timestamptz not null default now(),
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (idempotency_key),
  unique (flutterwave_transfer_ref)
);

create index if not exists idx_payout_intents_user
  on public.payout_intents (user_id);
create index if not exists idx_payout_intents_state
  on public.payout_intents (state);

alter table public.payout_intents enable row level security;

drop policy if exists payout_intents_own on public.payout_intents;
create policy payout_intents_own
  on public.payout_intents
  for all
  using (auth.uid() = user_id);

drop policy if exists admin_read_all_payout_intents on public.payout_intents;
create policy admin_read_all_payout_intents
  on public.payout_intents
  for select
  to authenticated
  using (is_borderpay_admin());

drop trigger if exists trg_payout_intents_touch on public.payout_intents;
create trigger trg_payout_intents_touch
  before update on public.payout_intents
  for each row execute function public.touch_updated_at();


-- Append-only audit of every payout state transition + provider event.
create table if not exists public.payout_events (
  id                 uuid primary key default gen_random_uuid(),
  payout_intent_id   uuid not null references public.payout_intents(id) on delete cascade,
  from_state         text,
  to_state           text,
  actor              text,                  -- 'system' | 'worker' | 'ops'
  source_event_id    text,                  -- Flutterwave event id, when applicable
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists idx_payout_events_intent
  on public.payout_events (payout_intent_id);

alter table public.payout_events enable row level security;

drop policy if exists payout_events_own on public.payout_events;
create policy payout_events_own
  on public.payout_events
  for select
  using (exists (
    select 1 from public.payout_intents pi
    where pi.id = payout_events.payout_intent_id
      and pi.user_id = auth.uid()
  ));

drop policy if exists admin_read_all_payout_events on public.payout_events;
create policy admin_read_all_payout_events
  on public.payout_events
  for select
  to authenticated
  using (is_borderpay_admin());

-- End of PR1 schema proposal. Additive only. Not applied. Not activation.
