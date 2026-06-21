# State Transition Invariant Layer Plan

## Decision

Chosen enforcement model: **Option C — RPC-only mutation lock** (strongest operational boundary), with a phased path because legacy direct status writes still exist.

Why this over trigger-first:
- Existing queue lifecycle already uses canonical RPCs (`claim_pending_events`, `complete_pending_event`, `fail_pending_event`, `reap_stuck_processing`).
- RPC-only lock provides clearer mutation ownership and easier operational auditability than scattered trigger rules.
- Trigger layer can still be added later as defense-in-depth after full RPC cutover.

## Canonical Transition Contract

Contract source file:
- `supabase/functions/_shared/allowed_state_transitions.ts`

Covered tables:
- `pending_events.status`
- `bridge_webhook_events.processing_status`
- `bridge_transfers.state`

Allowed transitions (summary):

`pending_events`
- `queued -> processing|failed`
- `processing -> completed|failed|queued`
- `failed -> queued`
- `completed -> terminal`

`bridge_webhook_events.processing_status`
- `received -> queued|rejected`
- `queued -> completed|failed`
- `failed -> queued`
- `completed/rejected -> terminal`

`bridge_transfers.state`
- `pending -> succeeded|failed|cancelled|returned|refunded`
- terminal states are terminal

## Phase Plan (No Deploy in this step)

Phase 0 (now)
- Transition contract defined.
- Read-only anomaly audit added.
- CI guard blocks new direct lifecycle updates outside allowed mutation surfaces.

Phase 1
- Remove remaining direct status updates in edge/runtime code.
- Route all lifecycle mutations through canonical RPCs only.
- Add migration-level grants/revokes to restrict direct UPDATE on lifecycle status columns.

Phase 2
- Optional DB trigger guard as additional hard stop:
  - reject illegal `old_status -> new_status` transitions.

## Remaining Legacy Exceptions (must be burned down)

Current legacy paths requiring RPC migration:
- `process-pending-events` direct `pending_events` claim update on webhook fast-path.
- `bridge-test-webhook` direct backlink update for `bridge_webhook_events.processing_status`.

These are tracked exceptions; CI is configured to block **new** direct lifecycle status mutation paths.

## Exit Criteria

1. No direct lifecycle status UPDATEs outside canonical RPC/migration ownership.
2. Transition audit reports zero blocker anomalies.
3. CI rule enforces mutation boundary.
4. Predeploy gate includes transition audit stage.

