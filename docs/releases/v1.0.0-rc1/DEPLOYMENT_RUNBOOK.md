# BorderPay Deployment Runbook — v1.0.0-rc1

## Ownership

- Release owner: Engineering lead
- On-call approver: CTO/incident approver
- Abort authority: Release owner or CTO

## Target Window

- Estimated duration: 45-90 minutes
- Change type: Edge Functions + RPCs + DB lifecycle lock package
- Risk level: Medium (permission boundary enforcement cutover)

## Preconditions (hard stop if any fail)

1. `python3 scripts/predeploy/run_predeploy_gate.py --ci` returns PASS.
2. Deployment package matches signed-off commit/tag.
3. Rollback SQL package reviewed and staged (dry-run package already prepared).
4. Monitoring dashboards live for queue/webhook/transfer/wallet/reconciliation health.

## Deployment Order

1. Freeze RC branch/tag.
2. Deploy Edge Functions.
3. Deploy approved RPCs.
4. Verify runtime contract:
   - `python3 scripts/runtime/verify_runtime_contract.py`
5. Apply DB lifecycle lock package (approved sequence only).
6. Verify grants/permissions and lifecycle lock objective:
   - `python3 scripts/ci/verify_lifecycle_write_path_exhaustiveness.py --phase C --runtime-only`
7. Run unified predeploy gate once more in production-linked context:
   - `python3 scripts/predeploy/run_predeploy_gate.py --ci`
8. Run immediate post-deploy operational verification (below).

## Immediate Post-Deploy Verification

1. Webhook ingestion health
2. Queue claim/drain health
3. Stablecoin wallet provisioning
4. Funding gate decisions
5. Transfer projection + reconciliation
6. Virtual account eligibility/projection
7. External account projection coverage

If any blocker-level invariant fails: **stop**, execute rollback criteria.

## Stop Conditions (automatic abort)

- Unified predeploy gate FAIL
- Runtime contract FAIL
- Queue invariant violation (`queued AND attempts >= max_attempts > 0`)
- Reconciliation mismatch appears in critical financial objects
- Unexpected direct lifecycle writes reappear in Phase C checks

## Rollback Criteria

Trigger rollback if any stop condition persists after one controlled retry.

Rollback scope:

1. Revert runtime deployment to prior approved release.
2. Execute approved DB lifecycle lock rollback package if permission lock causes runtime breakage.
3. Re-run runtime contract + queue invariant + reconciliation checks.
4. File incident summary and keep release status at NO-GO.
