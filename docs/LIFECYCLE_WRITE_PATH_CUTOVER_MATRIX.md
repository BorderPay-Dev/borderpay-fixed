# Lifecycle Write Path Cutover Matrix

- Mode: pre-deployment design (no execution)
- Purpose: eliminate dual-write risk during DB lifecycle lock rollout

## Cutover Sequencing Lock (Mandatory Order)

1. **Observability Bridge On (no permission changes yet)**
- Enable temporary monitoring for lifecycle writes and failures.
- Validate baseline direct-write dependency is understood.

2. **Trigger Guard in Observe/Soft-Fail Mode (optional first pass)**
- Deploy trigger logic with logging-only behavior (or guarded activation window) to detect illegal transitions without blocking traffic.

3. **Runtime Cutover to RPC-only Lifecycle Writes**
- Remove remaining direct lifecycle writes from edge/worker paths.
- Verify only canonical lifecycle RPCs mutate status fields.

4. **Zero Direct-Write Verification Gate**
- Run matrix audit + production read-only checks.
- Must show no active runtime dependency on direct lifecycle updates.

5. **Revoke Direct UPDATE Privileges**
- Apply RPC-only lock SQL revokes.
- Keep rollback package ready in same window.

6. **Hard Trigger Enforcement (optional defense-in-depth)**
- Switch trigger guard to hard-block invalid transitions.

7. **Post-Cutover Evidence Window**
- Re-run invariant audits + queue/reconciliation checks.
- Confirm no bypass attempts and no processing regression.

## Observability Bridge Phase (Required Before Revoke)

### Metrics to collect

- Direct lifecycle update attempt count (by table, role, function).
- RPC lifecycle mutation count (`claim/complete/fail/reap`).
- Transition rejection count (trigger guard path, if enabled).
- Queue health invariants (`queued AND attempts>=max_attempts`, stale processing, orphan queue rows).

### Recommended SQL probes (read-only)

- Privilege surface snapshot:
  - `information_schema.role_table_grants` for `pending_events`, `bridge_webhook_events`, `bridge_transfers`
- Function mutation surface:
  - `pg_proc` + `pg_get_functiondef` search for lifecycle status writes
- Runtime behavior snapshots:
  - existing queue/reconciliation audits

### Alert conditions

- Any direct lifecycle write after cutover step 3.
- Any transition-guard reject in production traffic.
- Any queue invariant regression.

## Dependency Matrix

| Writer Path | Table | Operation | Current Path | Target Path (Future RPC) | Classification | Cutover Action |
|---|---|---|---|---|---|---|
| `supabase/functions/bridge-webhook/index.ts` | `bridge_webhook_events`, `webhook_logs`, `pending_events` | insert/update (via DB function) | `rpc(ingest_bridge_event)` | Keep `ingest_bridge_event` (canonical) | Keep | No change |
| `supabase/functions/process-pending-events/index.ts:1130` | `pending_events` | `update status=processing` (fast-path claim) | Direct table update | `claim_specific_pending_event(event_id, worker_id)` (new RPC) or unify with `claim_pending_events` | **Must migrate** | Remove direct update before revoke |
| `supabase/functions/process-pending-events/index.ts` | `pending_events`, `webhook_logs`, `bridge_webhook_events` | lifecycle transitions | `rpc(complete_pending_event)`, `rpc(fail_pending_event)`, `rpc(claim_pending_events)`, `rpc(reap_stuck_processing)` | Keep canonical RPCs | Keep | No change |
| `supabase/functions/process-pending-events/index.ts:911` | `bridge_transfers` | `upsert state/raw` | Direct upsert | `upsert_bridge_transfer_projection(...)` (new RPC) | **Must migrate** | Move transfer state writes to RPC before hard lock |
| `supabase/functions/process-pending-events/index.ts` | `bridge_webhook_events` | update `target_entity_*` backlink | Direct update (non-status) | May remain direct with column-scoped grant | Safe direct (non-lifecycle) | Keep but scope grants to non-status columns |
| `supabase/functions/bridge-test-webhook/index.ts` | `bridge_webhook_events`, `webhook_logs`, `pending_events` | synthetic ingest insert/update | Direct writes | `ingest_bridge_test_event(...)` RPC (optional) or keep disabled in production | Conditional | Either RPC-wrap or keep `SYNTHETIC_EVENTS_ENABLED=false` during lock rollout |
| `public.claim_pending_events` (DB) | `pending_events` | lifecycle update | SECURITY DEFINER function | Canonical | Keep | Ensure execute grant only |
| `public.complete_pending_event` (DB) | `pending_events`, `webhook_logs`, `bridge_webhook_events` | lifecycle update | SECURITY DEFINER function | Canonical | Keep | Ensure execute grant only |
| `public.fail_pending_event` (DB) | `pending_events`, `webhook_logs`, `bridge_webhook_events` | lifecycle update | SECURITY DEFINER function | Canonical | Keep | Ensure execute grant only |
| `public.reap_stuck_processing` (DB) | `pending_events` | lifecycle update | SECURITY DEFINER function | Canonical | Keep | Ensure execute grant only |
| `public.ingest_bridge_event` (DB) | `bridge_webhook_events`, `webhook_logs`, `pending_events` | ingest + queue linkage | SECURITY DEFINER function | Canonical | Keep | Ensure execute grant only |
| `public.requeue_stuck_bridge_events` (DB) | `bridge_webhook_events`, `pending_events` | lifecycle update | SECURITY DEFINER function | Admin recovery path | Restricted | Keep admin-only, review grants |
| `public.admin_replay_pending_event` (DB) | `pending_events`, `webhook_logs` | lifecycle update | SECURITY DEFINER function | Admin recovery path | Restricted | Keep admin-only, audit use |
| `public.admin_dismiss_pending_event` (DB) | `pending_events`, `webhook_logs` | lifecycle update | SECURITY DEFINER function | Admin recovery path | Restricted | Keep admin-only, audit use |
| `public.apply_wallet_transaction_and_complete` (DB) | `pending_events`, `webhook_logs` | completion side-effect | SECURITY DEFINER function | Domain-specific RPC | Restricted | Keep but include in lifecycle mutation allowlist |
| `public.apply_bridge_wallet_credit_and_complete` (DB) | `pending_events` | completion side-effect | SECURITY DEFINER function | Domain-specific RPC | Restricted | Keep but include in lifecycle mutation allowlist |

## Final Pre-Execution Gate

Before applying DB lock SQL, all must be true:

1. `process-pending-events` fast-path direct `pending_events` update removed.
2. `bridge_transfers.state` writes moved behind RPC boundary.
3. Synthetic ingress path either RPC-wrapped or explicitly disabled in production during lock rollout.
4. Direct lifecycle write observability shows zero runtime dependency outside approved RPC/admin paths.
5. Rollback script staged and rehearsed.

## Notes

- This matrix is built from repository and live function-definition evidence (read-only).
- It is the deployment truth layer for lifecycle lock cutover.

