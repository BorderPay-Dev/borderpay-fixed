# API Step 2L: Partner Onboarding Kit (2026-07-06)

This step closes the operational gap between API controls and daily execution by ops/compliance.

## Delivered

1. Partner intake template
- `docs/api/onboarding/PARTNER_INTAKE_TEMPLATE.md`

2. Tenant rollout checklist
- `docs/api/onboarding/TENANT_ROLLOUT_CHECKLIST.md`

3. Rollout evidence template
- `docs/api/onboarding/ROLLOUT_EVIDENCE_TEMPLATE.md`

4. Deterministic preflight script
- `scripts/api/partner_onboarding_preflight.sh`
- Checks:
  - admin function auth path (`list_tenants`)
  - sandbox health success
  - production health behavior (`forbidden` pre-promotion, or success if configured)

## Why this is required

Technical controls are not enough by themselves. Without an operator checklist + evidence format, onboarding drifts and creates compliance/incident risk.

## Execution order for each tenant

1. Complete intake template.
2. Execute checklist sections A→D.
3. Run `partner_onboarding_preflight.sh`.
4. Promote tenant using `promote_tenant_closed_beta.sh`.
5. Capture evidence using `ROLLOUT_EVIDENCE_TEMPLATE.md`.
6. Final signoff by compliance + engineering.
