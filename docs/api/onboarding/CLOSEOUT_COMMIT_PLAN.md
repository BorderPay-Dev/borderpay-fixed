# BorderPay API Closeout Commit Plan (2I → 2S)

Use this sequence to land the API rollout program as clean, reviewable commits.

## Guardrails Before Commit

1. Run verifiers:
- `python3 scripts/ci/verify_api_contract_pack.py`
- `python3 scripts/ci/verify_api_mock_fixtures.py`
- `python3 scripts/ci/verify_api_ship_readiness.py`

2. Ensure working tree only includes intended API rollout changes.

## Commit Sequence

### Commit A — Contracts + fixtures + CI gate (2I)
- Files:
  - `docs/api/mocks/webhooks/*`
  - `docs/api/sdk/typescript/test/webhook.conformance.mjs`
  - `scripts/ci/verify_api_mock_fixtures.py`
  - `.github/workflows/api-contract-pack.yml`
- Message:
  - `feat(api): add webhook fixture pack and CI conformance gate`

### Commit B — Runtime closed-beta controls (2J)
- Files:
  - `supabase/migrations/20260706171000_api_gateway_closed_beta_controls.sql`
  - `supabase/functions/_shared/api-gateway.ts`
  - `supabase/functions/public-api-gateway/index.ts`
  - `supabase/functions/api-gateway-admin/index.ts`
  - `docs/API_STEP2J_CLOSED_BETA_GUARDRAILS_2026-07-06.md`
- Message:
  - `feat(api): enforce closed-beta tenant allowlist and transfer caps`

### Commit C — Ops rollout runbooks + scripts (2K–2O)
- Files:
  - `scripts/api/promote_tenant_closed_beta.sh`
  - `scripts/api/partner_onboarding_preflight.sh`
  - `scripts/api/monitor_api_rollout.sh`
  - `scripts/api/emergency_rollback_tenant.sh`
  - `scripts/api/run_rollout_watchdog.sh`
  - `scripts/api/run_tenant_golive_drill.sh`
  - `docs/API_STEP2K_BETA_PROMOTION_RUNBOOK_2026-07-06.md`
  - `docs/API_STEP2L_PARTNER_ONBOARDING_KIT_2026-07-06.md`
  - `docs/API_STEP2M_ROLLOUT_TELEMETRY_AND_ROLLBACK_2026-07-06.md`
  - `docs/API_STEP2N_SCHEDULED_WATCHDOG_AND_ESCALATION_2026-07-06.md`
  - `docs/API_STEP2O_TENANT_GOLIVE_DRILL_AND_EVIDENCE_2026-07-06.md`
  - `docs/api/onboarding/PARTNER_INTAKE_TEMPLATE.md`
  - `docs/api/onboarding/TENANT_ROLLOUT_CHECKLIST.md`
  - `docs/api/onboarding/ROLLOUT_EVIDENCE_TEMPLATE.md`
  - `docs/api/onboarding/TENANT_DRILL_MATRIX_TEMPLATE.json`
- Message:
  - `feat(api): ship operational rollout toolkit for tenant onboarding and monitoring`

### Commit D — Workflow automation + RC gate pack (2N–2P)
- Files:
  - `.github/workflows/api-rollout-watchdog.yml`
  - `scripts/api/run_release_candidate_gate.sh`
  - `docs/API_STEP2P_RC_GATE_COMMAND_PACK_2026-07-06.md`
- Message:
  - `feat(api): add scheduled watchdog and release-candidate gate command pack`

### Commit E — Freeze, publish, and go/no-go verifier (2Q–2S)
- Files:
  - `docs/API_STEP2Q_FREEZE_AND_HANDOFF_PACK_2026-07-06.md`
  - `docs/API_STEP2R_FINAL_PUBLISH_PACK_2026-07-06.md`
  - `docs/API_STEP2S_FINAL_GO_NO_GO_VERIFIER_2026-07-06.md`
  - `scripts/ci/verify_api_ship_readiness.py`
  - `docs/api/onboarding/RUNBOOK_INDEX.md`
  - `docs/api/onboarding/LOCAL_OPS_COMMAND_BLOCK.md`
  - `docs/api/onboarding/WORKFLOW_AND_SECRETS_SETUP.md`
  - `docs/api/onboarding/FINAL_OPERATOR_QUICKSTART.md`
  - `docs/api/onboarding/SECRETS_CHECKLIST.md`
  - `docs/api/onboarding/CUTOVER_COMMAND_SHEET.md`
  - `docs/api/onboarding/SIGNOFF_RUBRIC.md`
- Message:
  - `chore(api): finalize freeze handoff pack and go/no-go ship verifier`

## Post-Commit Push Checklist

1. Re-run three verifiers.
2. Push branch.
3. Open PR with sectioned commit map A→E.
4. Attach RC gate sample output and watchdog summary.
