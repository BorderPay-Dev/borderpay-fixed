# Lifecycle Cutover Validation Layer

- Mode: pre-deployment validation design + evidence
- Execution changes: none
- DB mutations: none

## What was added

1. Machine-readable write-path matrix
- [lifecycle_write_matrix.json](/Users/a/Downloads/borderpay-fixed/scripts/ci/lifecycle_write_matrix.json)

2. Deterministic exhaustiveness + phase validator
- [verify_lifecycle_write_path_exhaustiveness.py](/Users/a/Downloads/borderpay-fixed/scripts/ci/verify_lifecycle_write_path_exhaustiveness.py)

3. CI enforcement hook
- [enforce-safety-boundaries.sh](/Users/a/Downloads/borderpay-fixed/scripts/ci/enforce-safety-boundaries.sh) now calls exhaustiveness check (`--phase A`).

4. Predeploy integration
- [run_predeploy_gate.py](/Users/a/Downloads/borderpay-fixed/scripts/predeploy/run_predeploy_gate.py) now includes lifecycle write-path exhaustiveness (`Phase A`).

## Validation State Machine

- `Phase A` (Observation):
  - Every lifecycle write path must be classified in matrix.
  - Unmatched path => fail.

- `Phase B` (Dual-run):
  - Same as Phase A, plus operator-driven comparison evidence (tracked separately).

- `Phase C` (Enforcement-ready):
  - Phase A must pass.
  - Direct runtime writes to `pending_events`, `bridge_webhook_events`, `bridge_transfers` must be zero.

## Evidence

### Phase A

Command:
- `python3 scripts/ci/verify_lifecycle_write_path_exhaustiveness.py --phase A`

Result:
- `PASS`
- `scanned_hits=36 matched=36 unmatched=0`

### Phase C (runtime-only readiness probe)

Command:
- `python3 scripts/ci/verify_lifecycle_write_path_exhaustiveness.py --phase C --runtime-only`

Result:
- `FAIL` (expected at current stage)
- Remaining direct runtime lifecycle writes detected in:
  - `supabase/functions/process-pending-events/index.ts`
    - direct `pending_events` update fast-path claim
    - direct `bridge_transfers` upsert
    - direct `bridge_webhook_events` updates (status-coupled/backlink path)
  - `supabase/functions/bridge-test-webhook/index.ts`
    - direct `pending_events` / `bridge_webhook_events` writes

## Interpretation

- The matrix now guarantees write-path discovery completeness for lifecycle tables.
- Enforcement cutover is not yet safe until Phase C passes.
- This closes the rollout blind spot: hidden write paths can no longer slip through unclassified.

## Next mandatory step before DB lock execution

1. Migrate remaining direct runtime lifecycle writes to RPC boundary.
2. Re-run Phase C until zero violations.
3. Only then execute lifecycle lock migration package.

