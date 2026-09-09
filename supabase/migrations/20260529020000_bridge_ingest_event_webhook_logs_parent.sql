-- Fix: ingest_bridge_event must create the webhook_logs parent row before
-- inserting into pending_events.
--
-- Why
-- ---
-- pending_events.event_id has a FK to webhook_logs(event_id) (PK), ON DELETE
-- CASCADE, and the queue worker's complete_pending_event / fail_pending_event
-- both UPDATE public.webhook_logs WHERE event_id = <queue id>. The Bridge
-- ingest path, however, wrote bridge_webhook_events + a 'bridge:'-prefixed
-- pending_events row but NEVER created the webhook_logs parent. So every
-- signature-valid Bridge event hit:
--   insert or update on table "pending_events" violates foreign key
--   constraint "pending_events_event_id_fkey"
-- and the whole ingest transaction rolled back (HTTP 500, no row persisted,
-- KYC status never synced). This was latent until the v6 signature fix made
-- signatures verify, finally exercising the happy path.
--
-- Fix (smallest, Bridge-specific)
-- -------------------------------
-- On the signature-OK path, insert the webhook_logs parent keyed by the SAME
-- queue id ('bridge:' || p_event_id) BEFORE the pending_events insert. This
-- satisfies the FK and aligns the Bridge path with the worker contract
-- (complete/fail_pending_event update webhook_logs by that event_id).
--
-- Deliberately NOT done:
--   * not dropping pending_events_event_id_fkey (webhook_logs is an active
--     parent for the queue worker + apply_wallet_transaction_and_complete);
--   * no change to pending_events / webhook_logs / bridge_webhook_events schema;
--   * no manual user-status update.
--
-- Retry-safe: webhook_logs insert is `on conflict (event_id) do nothing`;
-- bridge_webhook_events keeps its existing duplicate guard. Reviewed-apply
-- gated — do not auto-run.

create or replace function public.ingest_bridge_event(
  p_event_id text, p_event_type text, p_signature_ok boolean,
  p_payload jsonb, p_payload_hash text
)
 returns table(was_duplicate boolean, was_rejected boolean, queued boolean, pending_id uuid)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event_uuid uuid;
  v_pending_id uuid;
  v_now timestamptz := now();
begin
  if not p_signature_ok then
    insert into public.bridge_webhook_events
      (event_id, event_type, signature_ok, payload, payload_hash, processing_status, last_error)
    values
      ('rejected_' || p_event_id || '_' || extract(epoch from v_now)::bigint::text,
       'signature_rejected', false, p_payload, p_payload_hash, 'rejected',
       'RSA-SHA256 signature verification failed')
    on conflict (event_id) do nothing;
    return query select false::boolean, true::boolean, false::boolean, null::uuid;
    return;
  end if;

  insert into public.bridge_webhook_events
    (event_id, event_type, signature_ok, payload, payload_hash, processing_status, received_at)
  values
    (p_event_id, p_event_type, true, p_payload, p_payload_hash, 'received', v_now)
  on conflict (event_id) do nothing
  returning id into v_event_uuid;

  if v_event_uuid is null then
    return query select true::boolean, false::boolean, false::boolean, null::uuid;
    return;
  end if;

  -- Queue parent log. pending_events.event_id FK -> webhook_logs(event_id), and
  -- the worker (complete_pending_event / fail_pending_event) updates
  -- webhook_logs by this same event_id. Create it BEFORE pending_events, keyed
  -- by the SAME queue id ('bridge:' || p_event_id).
  insert into public.webhook_logs
    (event_id, source, event_type, status, signature_ok, payload_hash, received_at, queued_at)
  values
    ('bridge:' || p_event_id, 'bridge', p_event_type, 'queued', true, p_payload_hash, v_now, v_now)
  on conflict (event_id) do nothing;

  insert into public.pending_events
    (event_id, source, event_type, payload, status)
  values
    ('bridge:' || p_event_id, 'bridge', p_event_type, p_payload, 'queued')
  returning id into v_pending_id;

  update public.bridge_webhook_events
     set processing_status = 'queued',
         queued_at         = v_now,
         pending_event_id  = v_pending_id
   where id = v_event_uuid;

  update public.webhook_logs
     set pending_event_id = v_pending_id
   where event_id = 'bridge:' || p_event_id;

  return query select false::boolean, false::boolean, true::boolean, v_pending_id;
end;
$function$;
