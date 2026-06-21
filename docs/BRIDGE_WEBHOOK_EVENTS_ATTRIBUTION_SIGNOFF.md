# Bridge Webhook Events Attribution Signoff

- Scope: manual release-gate review of remaining runtime writes to `public.bridge_webhook_events`
- Source file: `supabase/functions/process-pending-events/index.ts`
- Objective: confirm remaining writes are attribution/observability only, not lifecycle/financial mutations
- Review date: 2026-06-21

## Inventory (9 write sites)

| File:Line | Fields Written | Purpose | Lifecycle Impact | Financial Impact | Verdict |
|---|---|---|---|---|---|
| `process-pending-events/index.ts:542` | `target_entity_type`, `target_entity_id` | Link KYC/KYB event to resolved customer entity for ops traceability | None | None | ✅ Safe |
| `process-pending-events/index.ts:629` | `target_entity_type`, `target_entity_id` | Link customer status event to customer entity | None | None | ✅ Safe |
| `process-pending-events/index.ts:688` | `target_entity_type`, `target_entity_id` | Link VA lifecycle event to VA entity | None | None | ✅ Safe |
| `process-pending-events/index.ts:702` | `target_entity_type`, `target_entity_id` | Link malformed/unsupported VA activity event to VA entity before safe-complete | None | None | ✅ Safe |
| `process-pending-events/index.ts:771` | `target_entity_type`, `target_entity_id` | Link VA activity event after mirror credit branch | None | None | ✅ Safe |
| `process-pending-events/index.ts:777` | `target_entity_type`, `target_entity_id` | Link VA activity event after non-mirror branch | None | None | ✅ Safe |
| `process-pending-events/index.ts:808` | `target_entity_type`, `target_entity_id` | Link wallet event to wallet entity | None | None | ✅ Safe |
| `process-pending-events/index.ts:956` | `target_entity_type`, `target_entity_id` | Link transfer event before reconciliation-required failure path | None | None | ✅ Safe |
| `process-pending-events/index.ts:990` | `target_entity_type`, `target_entity_id` | Link transfer event on normal completion path | None | None | ✅ Safe |

## Explicit Gate Questions

For each of the 9 write sites above:

1. Does it change a lifecycle state?
- **No.** None writes `processing_status`, `attempts`, `queued_at`, `processed_at`, `last_error`, or queue status fields.

2. Does it change queue ownership?
- **No.** None writes `pending_event_id`, queue lock fields, or queue status.

3. Does it change financial projections?
- **No.** None touches `bridge_transfers.state`, `transactions`, `wallets`, `bridge_virtual_account_balances`, or ledger balances.

4. Does it change reconciliation?
- **No (state).** Reconciliation state/decision is not mutated; these writes only attach entity attribution metadata for operator traceability.

5. Does it affect idempotency?
- **No.** Writes are deterministic idempotent overwrites of attribution fields; they do not alter dedupe keys or retry counters.

6. Can removing this write break replay?
- **Yes (observability only).** Replay processing would still be functionally correct, but operator/entity traceability in `bridge_webhook_events` would degrade.

7. Should it remain after DB lifecycle lock?
- **Yes, with strict column-scoped grant only** (`target_entity_type`, `target_entity_id`) and no lifecycle columns.

## Acceptance Criteria Check

- Lifecycle mutations: `0` ✅
- Queue ownership mutations: `0` ✅
- Financial projection mutations: `0` ✅
- Reconciliation mutations: `0` ✅
- Writes limited to attribution/observability metadata: ✅
- No lifecycle write bypass of approved RPC boundary: ✅

## GO / NO-GO

**GO** for DB lifecycle lock rollout, contingent on grant scoping:
- direct update permission on `bridge_webhook_events` must be limited to attribution columns only,
- lifecycle columns remain RPC-only.

## Automated Regression Guard (Added)

- Guard location: `scripts/ci/verify_lifecycle_write_path_exhaustiveness.py` (Phase C runtime check)
- Enforced by:
  - `scripts/ci/enforce-safety-boundaries.sh`
  - `scripts/predeploy/run_predeploy_gate.py` (Stage 3)
- Rule:
  - direct runtime writes to `bridge_webhook_events` must be column-allowlisted.
  - forbidden lifecycle/idempotency/reconciliation columns hard-fail CI.
- Matrix config:
  - allowlist: `scripts/ci/lifecycle_write_matrix.json` → `bridge_webhook_events_runtime_direct_allowed_columns`
  - denylist: `scripts/ci/lifecycle_write_matrix.json` → `bridge_webhook_events_runtime_forbidden_columns`
