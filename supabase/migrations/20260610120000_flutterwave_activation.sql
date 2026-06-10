-- Flutterwave activation payments (Phase A).
--
-- Records every activation-fee payment attempt and provides the idempotent
-- "mark paid + activate" RPC the flutterwave-webhook calls. External payment
-- (card / bank / mobile money via Flutterwave) — NOT a virtual-account debit,
-- so this does not touch bridge balances.
--
-- Flow: flutterwave-checkout inserts a 'pending' row keyed on tx_ref; the
-- webhook (signature-verified + amount-verified) calls
-- activate_subscription_external(tx_ref, flw_tx_id, amount, currency) which
-- flips the row to 'paid' AND activates the subscription, idempotently.

create table if not exists public.activation_payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  is_business   boolean not null default false,
  plan_key      text not null,
  tx_ref        text not null unique,          -- our reference, idempotency key
  flw_tx_id     text,                          -- Flutterwave transaction id (set on verify)
  amount_minor  integer not null,              -- expected amount in cents
  currency      text not null default 'USD',
  status        text not null default 'pending', -- pending | paid | failed
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);

alter table public.activation_payments enable row level security;

-- Owner can read their own activation payments (display/history). Writes are
-- service-role only (checkout + webhook), so no INSERT/UPDATE policy for users.
drop policy if exists activation_payments_select_own on public.activation_payments;
create policy activation_payments_select_own on public.activation_payments
  for select using (auth.uid() = user_id);

-- Idempotent external activation. SECURITY DEFINER; intended to be called by the
-- service role from flutterwave-webhook after signature + amount verification.
create or replace function public.activate_subscription_external(
  p_tx_ref      text,
  p_flw_tx_id   text,
  p_amount_minor integer,
  p_currency    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay   public.activation_payments%rowtype;
begin
  select * into v_pay from public.activation_payments where tx_ref = p_tx_ref;
  if not found then
    -- Unknown reference — never activate something we didn't initiate.
    return jsonb_build_object('success', false, 'code', 'unknown_reference');
  end if;

  -- Idempotency: already settled → return success without re-activating.
  if v_pay.status = 'paid' then
    return jsonb_build_object('success', true, 'already', true, 'plan_key', v_pay.plan_key);
  end if;

  -- Amount guard: never activate on an underpayment.
  if p_amount_minor < v_pay.amount_minor then
    update public.activation_payments
      set status = 'failed', flw_tx_id = p_flw_tx_id
      where id = v_pay.id;
    return jsonb_build_object('success', false, 'code', 'amount_mismatch');
  end if;

  update public.activation_payments
    set status = 'paid', flw_tx_id = p_flw_tx_id, paid_at = now()
    where id = v_pay.id;

  -- Activate the subscription for the owner (individual or business).
  if v_pay.is_business then
    update public.user_subscriptions
      set plan_key = v_pay.plan_key, status = 'active', updated_at = now()
      where business_user_id = v_pay.user_id;
  else
    update public.user_subscriptions
      set plan_key = v_pay.plan_key, status = 'active', updated_at = now()
      where user_id = v_pay.user_id;
  end if;

  return jsonb_build_object('success', true, 'user_id', v_pay.user_id,
                            'is_business', v_pay.is_business, 'plan_key', v_pay.plan_key);
end;
$$;

revoke all on function public.activate_subscription_external(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.activate_subscription_external(text, text, integer, text) to service_role;
