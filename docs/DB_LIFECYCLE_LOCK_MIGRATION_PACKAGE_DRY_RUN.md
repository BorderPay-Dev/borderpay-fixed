# DB Lifecycle Lock Migration Package (Dry Run)

- Mode: design/draft only
- Execution: **not executed**
- Deployment: **none**

## Package Contents

- [20260621_db_lifecycle_lock_rpc_only.sql](/Users/a/Downloads/borderpay-fixed/scripts/dryrun/sql/20260621_db_lifecycle_lock_rpc_only.sql)
- [20260621_db_lifecycle_transition_trigger_guard.sql](/Users/a/Downloads/borderpay-fixed/scripts/dryrun/sql/20260621_db_lifecycle_transition_trigger_guard.sql)
- [20260621_db_lifecycle_lock_rollback.sql](/Users/a/Downloads/borderpay-fixed/scripts/dryrun/sql/20260621_db_lifecycle_lock_rollback.sql)

All files are intentionally guard-blocked with `DRY_RUN_ONLY` exceptions to prevent accidental execution.

## Chosen Enforcement Model

Primary: **RPC-only lifecycle mutation lock**

- Revoke direct `UPDATE` on lifecycle tables:
  - `public.pending_events`
  - `public.bridge_webhook_events`
  - `public.bridge_transfers`
- Keep mutation through canonical RPCs only:
  - `claim_pending_events(...)`
  - `complete_pending_event(...)`
  - `fail_pending_event(...)`
  - `reap_stuck_processing(...)`

Optional defense-in-depth:
- SQL trigger guard to reject illegal state transitions even if write privileges are bypassed.

## Service Role Isolation Review

Current reality (from code inspection):
- Service-role edge paths still perform some direct lifecycle writes (legacy exceptions), notably:
  - `process-pending-events` INSERT-webhook fast-path direct claim update on `pending_events`
  - `bridge-test-webhook` direct updates in `bridge_webhook_events` backlink path

Implication:
- Strict RPC-only lock would currently break these paths unless they are migrated first.

Mitigation in this package:
- CI currently blocks **new** direct lifecycle updates outside the temporary allowlist.
- Existing legacy exceptions are explicitly documented for planned cutover.

## Blast Radius Analysis

### `pending_events`

Risk if lock applied before cutover:
- Worker fast-path claim update may fail.
- Queue insert triggers remain unaffected.

Expected safe state after cutover:
- Claims/retries/completion only via queue RPCs.
- Reduced chance of illegal status mutation.

### `bridge_webhook_events`

Risk if lock applied before cutover:
- Entity backlink/status updates from runtime code may fail.
- Observability fields may stop updating.

Expected safe state after cutover:
- Webhook status transitions driven only by controlled RPC paths.

### `bridge_transfers`

Risk if lock applied before cutover:
- Any direct future status updates would fail (currently most writes are upsert state assignments during ingest).

Expected safe state after cutover:
- Transfer lifecycle transitions constrained to explicit transition model.

## Rollback Plan

Rollback script restores:
- update permissions to `service_role`
- drops transition triggers/functions (if enabled)

Rollback script:
- [20260621_db_lifecycle_lock_rollback.sql](/Users/a/Downloads/borderpay-fixed/scripts/dryrun/sql/20260621_db_lifecycle_lock_rollback.sql)

## Recommended Activation Order (when approved)

1. Remove legacy direct lifecycle writes from runtime code paths.
2. Run read-only transition audits + predeploy gate.
3. Apply RPC-only lock SQL.
4. Verify queue lifecycle, webhook status lifecycle, transfer lifecycle.
5. Optionally enable trigger guard.
6. Keep rollback prepared in same release window.

## Current Status

- Package readiness: **DRAFT READY**
- Safe to execute now: **NO** (guard-blocked by design)
- Next required step before execution: runtime cutover of legacy direct writes.

