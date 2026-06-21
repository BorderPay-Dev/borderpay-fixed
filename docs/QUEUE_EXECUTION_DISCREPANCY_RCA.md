# Queue Execution Discrepancy RCA

- Scope: why `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e` still exists after reported incident SQL execution
- Mode: read-only investigation only

## 1) Exact SQL Executed

Executed command:

```bash
supabase db query --linked --file scripts/incident/sql/remove_historical_ops_queue_record.sql
```

Executed file:

- [remove_historical_ops_queue_record.sql](/Users/a/Downloads/borderpay-fixed/scripts/incident/sql/remove_historical_ops_queue_record.sql)

Important transaction-control lines in that file:

- `begin;` at line 20
- `commit;` is commented out (line 150)
- `rollback;` is commented out (line 151)

## 2) Row Counts Affected by Each DELETE Statement

DELETE predicates in the executed script:

1. `delete from public.pending_events where event_id='bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e'`
2. `delete from public.webhook_logs where event_id='bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e'`
3. `delete from public.bridge_webhook_events where event_id='ops-sync-fail-716f27a047824edd9e2af32bdc46672e'`

Read-only counts currently matching those exact predicates:

- `delete_pending_events_match = 1`
- `delete_webhook_logs_match = 1`
- `delete_bridge_webhook_events_match = 1`

Execution-context evidence (from script output):

- In-script post-delete verification returned:
  - `pending_events_remaining = 0`
  - `webhook_logs_remaining = 0`
  - `bridge_webhook_events_remaining = 0`
  - `queued_unclaimable_total_after = 0`

Interpretation:

- DELETEs did execute in-session (rows were absent within the transaction scope).
- Final persisted affected row count in production is `0` because the transaction did not commit.

## 3) Transaction Status (Committed vs Rolled Back)

`ROLLED BACK / NOT COMMITTED`

Evidence chain:

1. Script explicitly starts a transaction (`begin;`).
2. Script has no executable `commit;` (commented out).
3. Post-run state still contains all three target rows unchanged.
4. Same queue invariant still present (`queued AND attempts >= max_attempts = 1`).

This combination is only consistent with non-persisted transaction outcome (session-end rollback).

## 4) Current Row Contents (All Affected Tables)

`pending_events`

- `id = ab6e41b2-f835-4129-a385-94dda422e120`
- `event_id = bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- `status = queued`
- `attempts = 2`
- `max_attempts = 1`
- `last_error = bridge transfer event missing id`
- `completed_at = NULL`

`webhook_logs`

- `event_id = bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- `status = queued`
- `attempts = 2`
- `pending_event_id = ab6e41b2-f835-4129-a385-94dda422e120`
- `last_error = bridge transfer event missing id`

`bridge_webhook_events`

- `event_id = ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- `processing_status = queued`
- `attempts = 2`
- `pending_event_id = ab6e41b2-f835-4129-a385-94dda422e120`
- `last_error = bridge transfer event missing id`

## 5) Timeline

Before execution:

- Target row present in all three tables.
- Queue invariant failure present.

Execution:

- Script ran and returned in-transaction verification showing zero remaining rows.
- No explicit commit executed in script.

After verification:

- Target row still present in all three tables.
- Invariant still failing (`queued AND attempts >= max_attempts = 1`).
- Reconciliation sweep still reports same single blocker.

## 6) Root Cause of Discrepancy

Root cause:

- The incident script executed inside an explicit transaction that was never committed.
- The script’s own “remaining=0” checks were true only within that uncommitted transaction scope.
- On session end, PostgreSQL discarded uncommitted changes, leaving production unchanged.

## 7) Recommended Corrective Action

- Re-run the same incident script under explicit manual transaction control with a deliberate `COMMIT` after verifying in-script post-delete checks.
- Keep scope to this single record only, unchanged SQL predicates, and post-commit read-only verification.

