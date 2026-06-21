# Incident Closure Report

- Incident target: `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- Corrected incident script executed: [remove_historical_ops_queue_record.sql](/Users/a/Downloads/borderpay-fixed/scripts/incident/sql/remove_historical_ops_queue_record.sql)
- Execution window (UTC):
  - Baseline captured: `2026-06-21 08:14:20.360617+00`
  - Corrected script execution: `2026-06-21 08:15` (command run in this window)
  - Post-verification captured: `2026-06-21 08:16:32.166672+00`

## Task 1 Outcome (Script Review + Correction)

- Root cause in script: `COMMIT` existed but was commented out.
- Correction applied: uncommented `commit;` (no other logic changed).

## Task 2 Outcome (Single Execution)

- Script executed exactly once after correction.
- In-script verification returned:
  - `pending_events_remaining = 0`
  - `webhook_logs_remaining = 0`
  - `bridge_webhook_events_remaining = 0`
  - `queued_unclaimable_total_after = 0`

## Task 3 Outcome (Read-only Verification)

### Target absence checks

- `pending_events` target row: `0`
- `webhook_logs` target row: `0`
- `bridge_webhook_events` target row: `0`

### Queue invariant

- `queued AND attempts >= max_attempts = 0`

### FK validation

- `pending_events_fk_unvalidated = 0`
- `bridge_webhook_events_fk_unvalidated = 0`

### Queue RPC integrity

Hashes unchanged pre/post execution:

- `claim_pending_events`: `4764733c0043a9f955ef2d3963973aa7`
- `complete_pending_event`: `cbbcbf6e05a03bc8c4b9d6dd08737097`
- `fail_pending_event`: `de89d859e2a248290f8cadadc719815d`
- `reap_stuck_processing`: `09e7a27d19b7a6f1309c5c0b6b99c04d`

### Re-run reports

- Reconciliation rerun: [RECONCILIATION_CORRECTNESS_REPORT.md](/Users/a/Downloads/borderpay-fixed/docs/RECONCILIATION_CORRECTNESS_REPORT.md) -> `PASS`
- Financial projection rerun: [FINANCIAL_PROJECTION_INTEGRITY_REPORT.md](/Users/a/Downloads/borderpay-fixed/docs/FINANCIAL_PROJECTION_INTEGRITY_REPORT.md) -> `PASS`
- Queue invariant rerun: [QUEUE_INVARIANT_REPORT.md](/Users/a/Downloads/borderpay-fixed/docs/QUEUE_INVARIANT_REPORT.md) -> `PASS`
- Unified predeploy gate rerun:
  - [PREDEPLOY_GATE_REPORT_20260621T081703Z.md](/Users/a/Downloads/borderpay-fixed/docs/PREDEPLOY_GATE_REPORT_20260621T081703Z.md) -> `PASS`

## Affected Row Counts

Observed before -> after totals:

- `pending_events_total`: `46 -> 45` (`-1`)
- `webhook_logs_total`: `46 -> 45` (`-1`)
- `bridge_webhook_events_total`: `83 -> 82` (`-1`)

No other targeted financial projection tables showed new anomalies in rerun integrity sweep.

## Transaction Committed Confirmation

Confirmed by persisted post-state change (target rows absent after command completion), unlike prior non-committed run.

## Before/After Evidence Summary

- Before:
  - Target row present in all three tables.
  - Queue invariant violation count = `1`.
- After:
  - Target row absent in all three tables.
  - Queue invariant violation count = `0`.

## Final Queue Invariant Status

`PASS`

## Financial Correctness Gate Status

**Financial Correctness Gate: PASS**

