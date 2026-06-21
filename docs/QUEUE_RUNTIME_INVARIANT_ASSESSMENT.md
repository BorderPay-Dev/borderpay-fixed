# Queue Runtime Invariant Assessment

- Scope: queue contract validation for `claim_pending_events()`, `complete_pending_event()`, `fail_pending_event()`, `reap_stuck_processing()`
- Mode: read-only evidence

## Runtime Contract Verification

Verified in production function definitions:

1. `claim_pending_events(p_worker_id, p_batch_size)`
- Claims only rows where:
  - `status in ('queued','failed')`
  - `next_attempt_at <= now()`
  - `attempts < max_attempts`
- On claim:
  - sets `status='processing'`
  - increments `attempts = attempts + 1`

2. `complete_pending_event(p_event_id, p_summary)`
- Sets:
  - `pending_events.status='completed'`
  - `webhook_logs.status='completed'`
  - `bridge_webhook_events.processing_status='completed'` (for bridge-prefixed IDs)

3. `fail_pending_event(p_event_id, p_error, p_backoff_seconds)`
- Computes terminal condition as:
  - `v_terminal := v_current.attempts >= v_current.max_attempts`
- Sets status:
  - terminal -> `failed`
  - non-terminal -> `queued` (with exponential backoff)
- Mirrors status/attempts/error to `webhook_logs` and `bridge_webhook_events`.

4. `reap_stuck_processing(p_lock_timeout_seconds)`
- Requeues stale `processing` rows by setting:
  - `status='queued'`
  - `locked_by=NULL`, `locked_at=NULL`, `next_attempt_at=now()`
- No explicit guard on `attempts`/`max_attempts`.

## Can Current Runtime Create This Condition?

Target condition: `status='queued' AND attempts > max_attempts`.

Assessment:

- Under current `claim_pending_events` + `fail_pending_event` logic, normal queue progression does **not** produce `attempts > max_attempts` with `status='queued'`.
- The observed anomaly (`attempts=2`, `max_attempts=1`, `status='queued'`) is inconsistent with the current terminal check in `fail_pending_event`.
- `reap_stuck_processing` can requeue stale rows without checking attempts, so it can produce/retain `queued` rows with `attempts >= max_attempts` in some crash/reap sequences, but this alone does not explain `attempts > max_attempts` for this event without prior non-standard state progression.

## Isolation vs Systemic Check

- `queued` rows with `attempts >= max_attempts`: `1`
- All such rows: only
  - `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- `pending_events` rows with `attempts > max_attempts`: `1` (same row)

Conclusion for scope:

- This is an isolated production record, not a widespread class in current data.
- Evidence indicates synthetic ops event lineage (non-Bridge webhook ID shape `ops-sync-*`, not `wh_*`), with state drift outside normal webhook-runtime contract behavior.

