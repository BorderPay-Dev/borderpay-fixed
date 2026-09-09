\set ON_ERROR_STOP on

begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_id uuid;
  v_user_id uuid := gen_random_uuid();
  v_count integer;
  v_summary jsonb;
  v_pending_earned uuid;
  v_pending_missing uuid;
begin
  insert into auth.users (id, aud, role, email)
  values (v_user_id, 'authenticated', 'authenticated', 'revenue-ledger-test@example.invalid');

  v_id := public.record_provider_revenue_event(
    'bridge','live','bridge_transfer','revenue-test-transfer','evt-earned',
    'earned','developer_fee','USD',2.50,0,100,'USD','EUR',1,
    'reconciled','{"provider_receipt":"test"}'::jsonb,'2026-08-18T10:00:00Z'
  );
  perform public.record_provider_revenue_event(
    'bridge','live','bridge_transfer','revenue-test-transfer','evt-earned-retry',
    'earned','developer_fee','USD',2.50,0,100,'USD','EUR',1,
    'reconciled','{"provider_receipt":"retry"}'::jsonb,'2026-08-18T10:01:00Z'
  );
  select count(*) into v_count from public.provider_revenue_events
    where source_id = 'revenue-test-transfer' and event_kind = 'earned';
  if v_count <> 1 then raise exception 'revenue idempotency failed'; end if;

  perform public.record_provider_revenue_event(
    'bridge','live','bridge_transfer','revenue-test-transfer','evt-refund',
    'reversal','developer_fee',null,null,null,null,null,null,null,
    'reconciled','{"provider_refund":"test"}'::jsonb,'2026-08-18T11:00:00Z'
  );
  select count(*) into v_count from public.provider_revenue_events
    where source_id = 'revenue-test-transfer';
  if v_count <> 2 then raise exception 'revenue reversal was not appended'; end if;

  begin
    update public.provider_revenue_events set net_revenue = 99 where id = v_id;
    raise exception 'immutable revenue row accepted update';
  exception when raise_exception then
    if sqlerrm not like 'provider_revenue_events is immutable%' then raise; end if;
  end;

  begin
    perform public.record_provider_revenue_event(
      'bridge','live','bridge_transfer','usdt-nonzero','evt-usdt',
      'earned','developer_fee','USDT',1,0,100,'USDT','USDT',1,
      'reconciled','{"route":"same-token"}'::jsonb,now()
    );
    raise exception 'same-token USDT nonzero revenue was accepted';
  exception when raise_exception then
    if sqlerrm <> 'same-token USDC/USDT transfer revenue must be zero' then raise; end if;
  end;

  perform public.record_provider_revenue_event(
    'bridge','live','bridge_transfer','usdt-zero','evt-usdt-zero',
    'earned','developer_fee','USDT',0,0,100,'USDT','USDT',1,
    'reconciled','{"route":"same-token"}'::jsonb,now()
  );

  begin
    perform public.record_provider_revenue_event(
      'bridge','live','bridge_transfer','usdc-nonzero','evt-usdc',
      'earned','developer_fee','USDC',1,0,100,'USDC','USDC',1,
      'reconciled','{"route":"same-token"}'::jsonb,now()
    );
    raise exception 'same-token USDC nonzero revenue was accepted';
  exception when raise_exception then
    if sqlerrm <> 'same-token USDC/USDT transfer revenue must be zero' then raise; end if;
  end;

  -- Completed signature-verified webhooks are the authoritative coverage set.
  insert into public.webhook_logs (event_id, source, event_type, status, signature_ok, payload_hash, completed_at)
  values
    ('bridge:coverage-va-earned', 'bridge', 'bridge.virtual_account.activity.created', 'completed', true, 'coverage-hash-1', now()),
    ('bridge:coverage-va-missing-fee', 'bridge', 'bridge.virtual_account.activity.created', 'completed', true, 'coverage-hash-2', now());
  insert into public.pending_events (event_id, source, event_type, payload, status, completed_at)
  values ('bridge:coverage-va-earned', 'bridge', 'bridge.virtual_account.activity.created', '{}'::jsonb, 'completed', now())
  returning id into v_pending_earned;
  insert into public.pending_events (event_id, source, event_type, payload, status, completed_at)
  values ('bridge:coverage-va-missing-fee', 'bridge', 'bridge.virtual_account.activity.created', '{}'::jsonb, 'completed', now())
  returning id into v_pending_missing;

  insert into public.bridge_webhook_events (
    event_id, event_type, signature_ok, payload, payload_hash,
    processing_status, pending_event_id, received_at, processed_at
  ) values (
    'coverage-va-earned', 'bridge.virtual_account.activity.created', true,
    '{"event_object":{"virtual_account_id":"va-test","deposit_id":"coverage-deposit","type":"funds_received","currency":"USD","receipt":{"initial_amount":"100.00","developer_fee_amount":"2.00","subtotal_amount":"98.00","source_currency":"USD","destination_currency":"USDC"}}}'::jsonb,
    'coverage-hash-1', 'queued', v_pending_earned, now(), now()
  ), (
    'coverage-va-missing-fee', 'bridge.virtual_account.activity.created', true,
    '{"event_object":{"virtual_account_id":"va-test","deposit_id":"coverage-missing","type":"funds_received","currency":"USD","amount":"50.00"}}'::jsonb,
    'coverage-hash-2', 'queued', v_pending_missing, now(), now()
  ), (
    'coverage-unsigned', 'bridge.transfer.updated', false,
    '{"event_object":{"transfer_id":"unsigned-transfer","state":"succeeded","currency":"USD","developer_fee":"9.00","amount":"100.00"}}'::jsonb,
    'coverage-hash-3', 'rejected', null, now(), now()
  );

  v_summary := public.admin_bridge_revenue_webhook_coverage();
  if (v_summary ->> 'source') <> 'signature_verified_bridge_webhook_events' then
    raise exception 'webhook coverage source is not authoritative: %', v_summary;
  end if;
  if (v_summary ->> 'uncaptured_fee_evidence_sources')::integer < 1 then
    raise exception 'uncaptured signed fee evidence was not reported: %', v_summary;
  end if;
  if (v_summary ->> 'missing_fee_evidence_sources')::integer < 1 then
    raise exception 'missing signed fee evidence was not reported: %', v_summary;
  end if;
  if jsonb_array_length(v_summary -> 'weekly_actual_by_currency') < 1 then
    raise exception 'signed webhook cash-flow buckets were not produced: %', v_summary;
  end if;
  if jsonb_array_length(v_summary -> 'recent_terminal_sources') < 2 then
    raise exception 'signed webhook terminal transaction list was not produced: %', v_summary;
  end if;

  perform public.record_provider_revenue_event(
    'bridge','live','bridge_virtual_account','coverage-deposit','bridge:coverage-va-earned',
    'earned','developer_fee','USD',2,0,100,'USD','USDC',1,
    'reconciled','{"source":"bridge_webhook_events","signature_verified":true}'::jsonb,now()
  );
  v_summary := public.admin_bridge_revenue_webhook_coverage();
  if (v_summary ->> 'uncaptured_fee_evidence_sources')::integer <> 0 then
    raise exception 'captured signed fee evidence still reported missing: %', v_summary;
  end if;

  -- Ordinary virtual-account debits are not revenue reversals.
  insert into public.bridge_balance_ledger (
    event_id, entity_type, entity_id, user_id, currency,
    amount_minor, direction, metadata
  ) values (
    'ordinary-debit', 'virtual_account', 'va-test', v_user_id, 'USD',
    100, 'debit', '{"developer_fee_amount":"1.00","status":"completed"}'::jsonb
  );
  if exists (select 1 from public.provider_revenue_events where source_event_id = 'ordinary-debit') then
    raise exception 'ordinary virtual-account debit was misclassified as a revenue reversal';
  end if;

  perform public.record_provider_revenue_event(
    'yellow_card','sandbox','yellow_card_transaction','yc-sandbox','evt-yc',
    'earned','transfer_markup','USD',3,1,100,'USD','KES',1,
    'reconciled','{"sandbox":true}'::jsonb,now()
  );

  v_summary := public.admin_provider_revenue_summary();
  if (v_summary #>> '{totals,net_revenue}')::numeric <> 2 then
    raise exception 'live earned/reversal net total mismatch: %', v_summary;
  end if;
  if v_summary #>> '{providers,yellow_card,capture_status}' <> 'unavailable_live_execution_not_implemented' then
    raise exception 'sandbox Yellow Card revenue leaked into production summary';
  end if;
end $$;

rollback;
