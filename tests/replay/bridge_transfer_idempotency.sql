-- Replay test for bridge-transfer idempotency (P0.3 evidence).
--
-- Runs entirely inside Postgres against `upsert_bridge_transaction`.
-- Simulates two retries of the same Bridge transfer (same transfer_id,
-- same idempotency_key in metadata, same user) and asserts that only
-- ONE row exists in public.transactions for that bridge_transfer_id.
--
-- Run from the SQL editor or via supabase MCP. Output is asserted by
-- raising an exception on failure.

do $$
declare
  v_user uuid;
  v_xfer text  := 'TEST-REPLAY-' || encode(gen_random_bytes(8), 'hex');
  v_idem text  := 'borderpay:transfer:test:' || gen_random_uuid()::text;
  v_id_a uuid;
  v_id_b uuid;
  v_count int;
begin
  -- 1) Pick any auth user. Tests are read-mostly so this is safe.
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise exception 'replay test needs at least one auth.users row';
  end if;

  -- 2) First call — write the transfer row.
  select public.upsert_bridge_transaction(
    p_user_id            => v_user,
    p_bridge_transfer_id => v_xfer,
    p_amount             => 1.00,
    p_currency           => 'USD',
    p_status             => 'pending',
    p_metadata           => jsonb_build_object('idempotency_key', v_idem, 'replay', 'a'),
    p_description        => 'idempotency replay test row A'
  ) into v_id_a;

  -- 3) Second call — same transfer_id, simulating a retry. Should
  --    UPDATE the existing row, not INSERT a new one. ON CONFLICT
  --    predicate is (provider='bridge' AND bridge_transfer_id IS NOT NULL).
  select public.upsert_bridge_transaction(
    p_user_id            => v_user,
    p_bridge_transfer_id => v_xfer,
    p_amount             => 1.00,
    p_currency           => 'USD',
    p_status             => 'completed',                   -- transition pending → completed on retry
    p_metadata           => jsonb_build_object('idempotency_key', v_idem, 'replay', 'b'),
    p_description        => 'idempotency replay test row B'
  ) into v_id_b;

  -- 4) Assertions
  if v_id_a is null or v_id_b is null then
    raise exception 'one or both upsert calls returned null id (a=%, b=%)', v_id_a, v_id_b;
  end if;
  if v_id_a <> v_id_b then
    raise exception 'second call inserted a NEW row instead of UPDATE — partial unique index not honoured (a=%, b=%)', v_id_a, v_id_b;
  end if;

  -- 5) Row count must be exactly 1 for this bridge_transfer_id.
  select count(*) into v_count
    from public.transactions
   where bridge_transfer_id = v_xfer
     and provider = 'bridge'::public.payment_provider;
  if v_count <> 1 then
    raise exception 'expected exactly 1 row for transfer_id %, got %', v_xfer, v_count;
  end if;

  -- 6) Final status must be the second call's value (UPDATE applied).
  perform 1 from public.transactions
    where bridge_transfer_id = v_xfer
      and status = 'completed'::public.transaction_status;
  if not found then
    raise exception 'second-call status did not overwrite first (expected completed)';
  end if;

  -- 7) Cleanup the test row.
  delete from public.transactions where bridge_transfer_id = v_xfer;

  raise notice 'idempotency replay test PASS: single row %, two upsert calls returned same id', v_xfer;
end $$;
