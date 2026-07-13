# BorderPay API Runbook Index (Final Publish Pack)

This is the canonical index for API closed-beta rollout operations.

## Core Execution

1. Quickstart
- `docs/api/onboarding/FINAL_OPERATOR_QUICKSTART.md`

2. Cutover commands
- `docs/api/onboarding/CUTOVER_COMMAND_SHEET.md`

3. RC gate command pack
- `docs/API_STEP2P_RC_GATE_COMMAND_PACK_2026-07-06.md`
- Script: `scripts/api/run_release_candidate_gate.sh`

## Onboarding + Governance

1. Partner intake
- `docs/api/onboarding/PARTNER_INTAKE_TEMPLATE.md`

2. Rollout checklist
- `docs/api/onboarding/TENANT_ROLLOUT_CHECKLIST.md`

3. Signoff rubric
- `docs/api/onboarding/SIGNOFF_RUBRIC.md`

## Monitoring + Incident Response

1. Scheduled watchdog
- `.github/workflows/api-rollout-watchdog.yml`
- Script: `scripts/api/run_rollout_watchdog.sh`

2. Rollout metrics monitor
- Script: `scripts/api/monitor_api_rollout.sh`

3. Emergency rollback
- Script: `scripts/api/emergency_rollback_tenant.sh`

## Evidence + Audit Trail

1. Go-live drill evidence
- Script: `scripts/api/run_tenant_golive_drill.sh`
- Runbook: `docs/api/onboarding/API_WHITE_LABEL_OPERATOR_RUNBOOK.md`
- Matrix template: `docs/api/onboarding/TENANT_DRILL_MATRIX_TEMPLATE.json`

2. Rollout evidence template
- `docs/api/onboarding/ROLLOUT_EVIDENCE_TEMPLATE.md`

3. Final freeze statement
- `docs/API_STEP2Q_FREEZE_AND_HANDOFF_PACK_2026-07-06.md`
