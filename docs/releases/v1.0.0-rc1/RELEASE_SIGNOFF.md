# BorderPay Release Signoff — v1.0.0-rc1

- Date (UTC): 2026-06-21
- Candidate commit (current HEAD): `3664bcc`
- Status: **Engineering Complete / Release Candidate**
- Decision: **GO**, subject to controlled deployment runbook execution.

## Scope Locked For RC

- Bridge-only runtime architecture
- Financial correctness invariants
- Unified predeploy gate as mandatory blocker
- Lifecycle write-path governance and Phase C enforcement

## Mandatory Evidence Pack

- [Predeploy Gate PASS](/Users/a/Downloads/borderpay-fixed/docs/PREDEPLOY_GATE_REPORT_20260621T122713Z.md)
- [Financial Correctness Status](/Users/a/Downloads/borderpay-fixed/docs/FINANCIAL_CORRECTNESS_STATUS.md)
- [Bridge Alignment Evidence](/Users/a/Downloads/borderpay-fixed/docs/BRIDGE_ALIGNMENT_EVIDENCE.md)
- [Webhook Attribution Signoff](/Users/a/Downloads/borderpay-fixed/docs/BRIDGE_WEBHOOK_EVENTS_ATTRIBUTION_SIGNOFF.md)
- [Incident Closure Report](/Users/a/Downloads/borderpay-fixed/docs/INCIDENT_CLOSURE_REPORT.md)
- [Lifecycle Cutover Validation Layer](/Users/a/Downloads/borderpay-fixed/docs/LIFECYCLE_CUTOVER_VALIDATION_LAYER.md)
- [External Account Coverage RCA](/Users/a/Downloads/borderpay-fixed/docs/EXTERNAL_ACCOUNT_WEBHOOK_COVERAGE_RCA.md)

## Release Controls

- No feature merges into RC branch/tag.
- No schema drift outside approved lifecycle lock package.
- No permission hardening execution before runbook checkpoints.
- Any post-signoff code change requires rerun of unified predeploy gate and signoff refresh.

## Final Pre-Deploy Commands (must pass in order)

1. `python3 scripts/predeploy/run_predeploy_gate.py --ci`
2. `python3 scripts/ci/verify_lifecycle_write_path_exhaustiveness.py --phase C --runtime-only`
3. `python3 tests/audit/external_account_webhook_coverage_audit.py`

## Tag/Branch Recommendation

- Recommended tag: `v1.0.0-rc1`
- Recommended branch: `release/v1.0.0-rc1`
- Create tag only from the approved, reviewed commit intended for deployment.
