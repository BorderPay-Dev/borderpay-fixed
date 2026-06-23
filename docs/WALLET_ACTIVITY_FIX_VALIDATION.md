# Wallet Activity Fix Validation

Date: 2026-06-23 (UTC)
Scope: `bridge_wallet.activity.*` compatibility fix for payloads that include `bridge_wallet_id` but omit `customer_id`.

## Summary

- Implemented minimal wallet-ingestion compatibility fix in `process-pending-events`.
- Deployed only `process-pending-events` Edge Function.
- Replayed only the previously failed production event with error `bridge wallet event missing ids`.
- Replay completed successfully; retry-saturation failure cleared for that event.

## Root Cause (from RCA)

BorderPay wallet handler incorrectly required both wallet id and customer id. Bridge `bridge_wallet.activity` payloads (especially `direct_deposit`) may omit `customer_id` while remaining valid.

## Files Changed

- `supabase/functions/process-pending-events/index.ts`
- `tests/audit/bridge_wallet_activity_schema_compat_audit.py`

## Implementation Details

Wallet handler now:

1. Keeps `walletId` mandatory.
2. Keeps existing customer-present path unchanged (`resolveOwnerFromBridgeCustomer(customer)`).
3. Adds customer-missing fallback to canonical local wallet mapping:
   - lookup `bridge_wallets` by `bridge_wallet_id`
   - recover `bridge_customer_id` + owner (`user_id`/`business_user_id`)
4. If mapping cannot be resolved:
   - does not hard-fail/retry-loop,
   - completes with `reconciliation_required: wallet_activity_missing_customer_mapping`.

## Regression Validation

### Existing webhook-related audits

Executed:

- `python3 tests/audit/bridge_webhook_signature_audit.py` -> PASS
- `python3 tests/audit/bridge_ingress_canonicalization_audit.py` -> PASS
- `python3 tests/audit/bridge_event_envelope_audit.py` -> PASS

Note:

- `python3 tests/audit/bridge_ingest_event_audit.py` fails in this workspace due pre-existing migration filename drift (`20260529_bridge_ingest_event_webhook_logs_parent.sql` not present at the legacy path). This is repository-state/migration-lineage hygiene, not a wallet-handler regression.

### New wallet compatibility regression audit

- `python3 tests/audit/bridge_wallet_activity_schema_compat_audit.py` -> PASS

Coverage in this regression audit:

- wallet activity with `customer_id` (existing path preserved)
- wallet activity without `customer_id` (mapping fallback present)
- unknown `wallet_id` (reconciliation-safe completion path)
- duplicate replay guard (wallet upsert remains `onConflict: bridge_wallet_id`)

## Production Replay (only affected failed events)

Affected set before replay:

- `wh_tmLXCnj1c1kA4fFSivtEi1J` (only event)

Actions performed:

1. Deployed function:
   - `supabase functions deploy process-pending-events --project-ref orwrcpwsffjlvzuraxjc --use-api`
2. Re-queued only this failed event metadata.
3. Invoked existing `process-pending-events` endpoint with configured worker token.

Evidence after replay:

- `bridge_webhook_events` for `wh_tmLXCnj1c1kA4fFSivtEi1J`:
  - `processing_status = completed`
  - `attempts = 1`
  - `last_error = NULL`

## Post-Replay Downstream Verification

For `event_id = wh_tmLXCnj1c1kA4fFSivtEi1J`:

- `pending_events completed`: `1`
- `bridge_transfers` rows keyed to this event id: `0`
- `transactions` rows keyed to this event id/reference: `0`
- `email_log` mentions for this event id: `0`

Interpretation:

- Queue replay + wallet-ingestion path is fixed.
- This event is a wallet activity direct-deposit payload; current wallet handler does not project transfer/transaction rows or notification emails for this event family.

## Constraint Confirmation

Confirmed unchanged:

- No transfer ingestion changes.
- No ACH ingestion changes.
- No payout ingestion changes.
- No webhook signature verification changes.
- No event-idempotency framework changes.
- No retry framework changes.
- No schema/migration/backend financial logic modifications.
