# BorderPay API Cutover Command Sheet

This is the exact command order for cutover.

## 0) Export Runtime Variables

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<api-gateway-admin-token>"
export DRILL_MATRIX_JSON="docs/api/onboarding/tenant_drill_matrix.live.json"
export TENANT_IDS="<tenant-uuid-1>,<tenant-uuid-2>"
export OPERATOR="ops-oncall"
export CHANGE_REQUEST_ID="CR-<id>"
```

`SERVICE_ROLE_KEY` is the dedicated API gateway admin bearer token for
`api-gateway-admin`. Do not use the general Supabase project service-role key
for routine cutover/watchdog commands.

## 1) Dry RC Gate (must pass)

```bash
./scripts/api/run_release_candidate_gate.sh
```

## 2) Controlled Promotion RC Gate

```bash
EXECUTE_PROMOTION=true \
PROMOTION_DRY_RUN=false \
./scripts/api/run_release_candidate_gate.sh
```

## 3) Monitor Immediately After Cutover

```bash
WINDOW_MINUTES=15 \
AUTO_ROLLBACK_ON_ALERT=false \
./scripts/api/run_rollout_watchdog.sh
```

## 4) Emergency Rollback (if needed)

```bash
export TENANT_ID="<affected-tenant-uuid>"
REVOKE_ACTIVE_KEYS=true \
./scripts/api/emergency_rollback_tenant.sh
```

## 5) Collect Evidence

- RC gate report path from script output (`RC_GATE_REPORT.md`)
- Drill evidence directory (`drill/`, `promotion/`)
- Watchdog summaries (`watchdog_preflight.md`, `watchdog_postflight.md`)
- Fill: `docs/api/onboarding/ROLLOUT_EVIDENCE_TEMPLATE.md`
