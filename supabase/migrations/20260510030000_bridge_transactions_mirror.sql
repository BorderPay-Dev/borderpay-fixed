-- ============================================================================
-- 20260510_bridge_transactions_mirror.sql
-- ----------------------------------------------------------------------------
-- Mirrors Bridge transfer state into public.transactions so existing reader
-- surfaces (TransactionsScreen, exports, admin views) work unchanged.
--
-- Adds:
--   • Partial unique index on transactions(bridge_transfer_id) WHERE
--     provider='bridge' — guarantees one transactions row per Bridge transfer.
--     Maplerad rows have NULL bridge_transfer_id and are unaffected.
--   • upsert_bridge_transaction(...) — SECURITY DEFINER plpgsql function the
--     worker calls. Performs a single ON CONFLICT upsert keyed on the partial
--     unique index. Returns the transactions.id of the upserted row.
--
-- Field mapping (defined here so it lives next to the index):
--   transactions.user_id            ← <auth.uid of owner>
--   transactions.type               ← 'transfer'::transaction_type
--   transactions.amount             ← bridge transfer amount (>= 0)
--   transactions.currency           ← bridge transfer currency (uppercased)
--   transactions.status             ← mapped from Bridge state by caller:
--                                       succeeded               → 'completed'
--                                       failed|cancelled|returned → 'failed'
--                                       else                    → 'pending'
--   transactions.reference          ← 'bridge:' || bridge_transfer_id
--                                     (prefix avoids collision with Maplerad
--                                      references; transactions.reference is
--                                      globally unique today)
--   transactions.metadata           ← jsonb { source:'bridge', account_type,
--                                              source_type, destination_type,
--                                              raw }
--   transactions.provider           ← 'bridge'::payment_provider
--   transactions.bridge_transfer_id ← Bridge transfer id
-- ============================================================================

set search_path = public, pg_temp;

-- ── 1. Partial unique index for Bridge mirror idempotency ──────────────────
create unique index if not exists transactions_bridge_transfer_uniq
  on public.transactions (bridge_transfer_id)
  where provider = 'bridge'::public.payment_provider
    and bridge_transfer_id is not null;

-- The non-unique idx_… index from phase 0 stays — it covers the broader
-- (provider IS NULL OR provider != 'bridge') case if we ever need it. The
-- unique partial index above is what ON CONFLICT targets.

-- ── 2. Upsert RPC ──────────────────────────────────────────────────────────
create or replace function public.upsert_bridge_transaction(
  p_user_id            uuid,
  p_bridge_transfer_id text,
  p_amount             numeric,
  p_currency           text,
  p_status             text,                -- 'pending'|'processing'|'completed'|'failed'|'cancelled'
  p_metadata           jsonb,
  p_description        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_bridge_transfer_id is null or length(p_bridge_transfer_id) = 0 then
    raise exception 'upsert_bridge_transaction: p_bridge_transfer_id is required';
  end if;
  if p_user_id is null then
    raise exception 'upsert_bridge_transaction: p_user_id is required';
  end if;

  insert into public.transactions (
    user_id, type, amount, currency, status, reference,
    description, metadata, provider, bridge_transfer_id
  ) values (
    p_user_id,
    'transfer'::public.transaction_type,
    p_amount,
    upper(p_currency),
    p_status::public.transaction_status,
    'bridge:' || p_bridge_transfer_id,
    p_description,
    coalesce(p_metadata, '{}'::jsonb),
    'bridge'::public.payment_provider,
    p_bridge_transfer_id
  )
  on conflict (bridge_transfer_id)
    where provider = 'bridge'::public.payment_provider
      and bridge_transfer_id is not null
  do update set
    status     = excluded.status,
    amount     = excluded.amount,
    currency   = excluded.currency,
    metadata   = excluded.metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_bridge_transaction(uuid, text, numeric, text, text, jsonb, text) from public;
grant execute on function public.upsert_bridge_transaction(uuid, text, numeric, text, text, jsonb, text) to service_role;
