-- ============================================================================
-- 20260510_bridge_wallet_credit_rpc.sql
-- ----------------------------------------------------------------------------
-- Bridge-specific wallet credit + transactions mirror, used as the legacy
-- mirror for INDIVIDUAL Bridge VA deposits so existing TransactionsScreen
-- and wallet balance reads keep working.
--
-- Why a new function instead of patching apply_wallet_transaction_and_complete?
--   • That function is operationally Maplerad-era; changing its signature
--     risks deployed Maplerad handlers.
--   • Bridge needs provider='bridge' on the inserted transactions row.
--     The Maplerad RPC relies on the column default ('maplerad') and would
--     mis-tag Bridge deposits.
--
-- Idempotency:
--   • Structural: transactions.reference has a global UNIQUE constraint
--     (transactions_reference_key). The worker passes
--     p_tx_reference = 'bridge:' || event_id, so a duplicate call with the
--     same event_id resolves via ON CONFLICT (reference) DO NOTHING with
--     no wallet mutation.
--   • Layered: callers should already be gated on the canonical Bridge
--     ledger (apply_bridge_va_credit returning applied=true) before
--     invoking this mirror — but the structural guard here is the
--     authoritative defense.
--
-- Behaviour:
--   1. Try to INSERT a transactions row with provider='bridge', type='deposit',
--      status='completed', reference=p_tx_reference, metadata merged with
--      {"source":"bridge"}. ON CONFLICT (reference) DO NOTHING.
--   2. If the insert was a no-op (duplicate), return applied=false and do
--      NOT touch the wallet. pending_events is also left alone — caller
--      handles re-completion semantics.
--   3. Otherwise, lock the user's wallet for (user_id, currency) FOR UPDATE.
--      If the wallet doesn't exist, RAISE NO_WALLET (no auto-create).
--   4. Update wallet.balance += p_amount (deposits only — the worker is
--      responsible for sign).
--   5. Mark pending_events.status='completed' for the matching event.
--   6. Return jsonb { applied, wallet_id, old_balance, new_balance,
--      transaction_id }.
--
-- Does NOT touch:
--   • webhook_logs (Maplerad-era audit table)
--   • bridge_webhook_events (worker handles entity backlink separately)
--   • bridge_balance_ledger / bridge_virtual_account_balances (canonical
--     credit happens upstream via apply_bridge_va_credit)
-- ============================================================================

set search_path = public, pg_temp;

create or replace function public.apply_bridge_wallet_credit_and_complete(
  p_event_id     text,
  p_user_id      uuid,
  p_currency     text,
  p_amount       numeric,
  p_tx_reference text,
  p_tx_metadata  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx_id        uuid;
  v_wallet_id    uuid;
  v_old_balance  numeric;
  v_new_balance  numeric;
  v_merged_meta  jsonb;
begin
  if p_event_id is null or length(p_event_id) = 0 then
    raise exception 'apply_bridge_wallet_credit_and_complete: p_event_id is required';
  end if;
  if p_user_id is null then
    raise exception 'apply_bridge_wallet_credit_and_complete: p_user_id is required';
  end if;
  if p_amount is null then
    raise exception 'apply_bridge_wallet_credit_and_complete: p_amount is required';
  end if;
  if p_tx_reference is null or length(p_tx_reference) = 0 then
    raise exception 'apply_bridge_wallet_credit_and_complete: p_tx_reference is required';
  end if;

  v_merged_meta := coalesce(p_tx_metadata, '{}'::jsonb)
                   || jsonb_build_object('source', 'bridge', 'event_id', p_event_id);

  -- 1. Idempotent insert via the global UNIQUE on transactions.reference.
  insert into public.transactions (
    user_id, type, amount, currency, status, reference, metadata,
    provider, created_at
  ) values (
    p_user_id,
    'deposit'::public.transaction_type,
    p_amount,
    upper(p_currency),
    'completed'::public.transaction_status,
    p_tx_reference,
    v_merged_meta,
    'bridge'::public.payment_provider,
    now()
  )
  on conflict (reference) do nothing
  returning id into v_tx_id;

  -- 2. Duplicate path: nothing to do.
  if v_tx_id is null then
    return jsonb_build_object(
      'applied',        false,
      'reason',         'duplicate_reference',
      'reference',      p_tx_reference
    );
  end if;

  -- 3. Lock the wallet for (user_id, currency).
  select id, balance
    into v_wallet_id, v_old_balance
    from public.wallets
   where user_id = p_user_id and currency = upper(p_currency)
   for update;

  if v_wallet_id is null then
    raise exception
      'NO_WALLET: user % has no % wallet — cannot apply event %',
      p_user_id, upper(p_currency), p_event_id
      using errcode = 'P0001';
  end if;

  v_new_balance := coalesce(v_old_balance, 0) + p_amount;

  update public.wallets
     set balance    = v_new_balance,
         updated_at = now()
   where id = v_wallet_id;

  -- 4. Complete pending_events for this event.
  update public.pending_events
     set status       = 'completed',
         completed_at = now(),
         last_error   = null,
         updated_at   = now()
   where event_id = p_event_id;

  return jsonb_build_object(
    'applied',        true,
    'wallet_id',      v_wallet_id,
    'old_balance',    v_old_balance,
    'new_balance',    v_new_balance,
    'transaction_id', v_tx_id
  );
end;
$$;

revoke all on function public.apply_bridge_wallet_credit_and_complete(text, uuid, text, numeric, text, jsonb) from public;
grant execute on function public.apply_bridge_wallet_credit_and_complete(text, uuid, text, numeric, text, jsonb) to service_role;
