# Queue Retry Invariant Root Cause Report

- Scope: single-event RCA for `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- Mode: read-only only
- Constraints honored: no writes, no migrations, no deployments, no runtime code changes

## Summary

One queue invariant violation exists:

- `status='queued'` while `attempts=2` and `max_attempts=1` (unclaimable under current claim predicate).

This record is tied to synthetic ops event family `ops-sync-*` and not to normal Bridge webhook IDs (`bridge:wh_*`).

## Required Questions Answered

## 1) Original webhook ingestion

- Ingested at `2026-06-19T22:55:13.632406+00:00` into:
  - `bridge_webhook_events` (`event_id='ops-sync-fail-...'`, `processing_status='queued'`)
  - `webhook_logs` (`event_id='bridge:ops-sync-fail-...'`, `status='queued'`)
  - `pending_events` (`event_id='bridge:ops-sync-fail-...'`, `status='queued'`)

## 2) Queue creation

- Queue row exists with:
  - `id=ab6e41b2-f835-4129-a385-94dda422e120`
  - `source='bridge'`
  - `event_type='transfer.processed'`
  - creation timestamp equal to ingress timestamp.

## 3) Every claim attempt

Persisted history does not store per-claim rows. Final attempt counters indicate:

- `attempts=2` -> at least two claims occurred.

## 4) Every retry

- Current row has `next_attempt_at=2026-06-19T22:56:34.308307+00:00`.
- Row remained non-terminal (`queued`) after retries, then stopped progressing.

## 5) Every fail transition

- Final error across all mirrors:
  - `bridge transfer event missing id`
- Payload confirms missing transfer ID fields:
  - no `event_object_id`
  - no `event_object.id`

## 6) Current row values

- `status='queued'`
- `attempts=2`
- `max_attempts=1`
- `locked_by=NULL`, `locked_at=NULL`, `completed_at=NULL`
- `updated_at=2026-06-19T22:56:34.308307+00:00`

## 7) Why attempts exceeded max_attempts while status remained queued

Deterministic evidence:

- Current runtime contract would not leave this final state through normal flow.
- This row belongs to a synthetic ops batch with same suffix and same creation timestamp:
  - `ops-sync-ok` (completed),
  - `ops-sync-retry` (failed),
  - `ops-sync-fail` (anomalous queued with attempts>max).
- The anomalous record is therefore historical ops/simulation drift, not representative of regular Bridge webhook ingestion.

## 8) Which function/code path allowed this state

Current functions:

- `claim_pending_events` enforces `attempts < max_attempts`.
- `fail_pending_event` terminalizes at `attempts >= max_attempts`.

Given those contracts, the target final state cannot be produced by normal current queue progression alone.

Most probable allowing path class (supported by event lineage and state shape):

- synthetic/manual ops event injection plus historical state drift during ops simulation sequence, outside normal Bridge webhook path assumptions.

## 9) Cause classification

- Cause type: `manual intervention` (synthetic ops event family) resulting in `historical data drift`.

## Runtime Contract Validation (requested set)

- `claim_pending_events()` present and enforces `attempts < max_attempts`.
- `complete_pending_event()` present; synchronizes completion across queue/log mirrors.
- `fail_pending_event()` present; terminal decision uses `attempts >= max_attempts`.
- `reap_stuck_processing()` present and active in cron (`reap-stuck-processing` every 5 minutes).

## Current-runtime reproducibility assessment

- For normal Bridge webhook events under current contracts: no evidence that this exact `attempts > max_attempts AND queued` terminal shape is currently produced.
- Additional note: `reap_stuck_processing()` requeues stale `processing` rows without attempt guard; this can create `queued AND attempts >= max_attempts` in some stale-processing cases, but the audited record is `attempts > max_attempts` and remains isolated.

## Scope check: isolated vs class vs systemic

- `queued_unclaimable_total (attempts>=max_attempts) = 1`
- The only affected row is:
  - `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- No additional queued-and-unclaimable financial rows found.

## Explicit Conclusion

Historical data only.

