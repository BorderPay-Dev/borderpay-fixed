# Reconciliation Correctness Report

- Rerun timestamp (UTC): `2026-06-21 08:16:32.166672+00`
- Scope: production read-only verification after incident cleanup commit

## Result

`PASS`

## Blocker Check

- `queue_retry_invariant_broken_attempts_gt_max_not_terminal = 0` (previously `1`)

## Core Reconciliation Evidence (rerun)

- `bridge_transfer_projection_cardinality_not_one = 0`
- `bridge_transfers_duplicate_provider_id = 0`
- `bridge_transfers_missing_transaction_projection = 0`
- `transactions_bridge_missing_bridge_transfers_row = 0`
- `bridge_tx_status_mapping_mismatch = 0`
- `queue_orphan_financial_pending_events_no_webhook_log = 0`
- `queue_completed_financial_events_no_completed_webhook_log = 0`
- `queue_processing_stale_over_30m = 0`
- `queue_pending_due_over_30m = 0`

## Notes

- `queue_failed_financial_events = 20` remains as terminal dead-letter history (no retry invariant breach, no orphan linkage, no new blocker introduced).

