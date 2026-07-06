# BorderPay API Final Operator Quickstart (Freeze/Handoff)

Use this when executing API closed-beta cutover for real tenants.

## 1) Preconditions

- `api-gateway-admin` and `public-api-gateway` functions deployed.
- Migrations up to Step `2M` applied.
- Tenant drill matrix prepared:
  - `docs/api/onboarding/TENANT_DRILL_MATRIX_TEMPLATE.json` (copied and filled).
- Required secrets are set (see `SECRETS_CHECKLIST.md`).

## 2) Run Release Candidate Gate (no promotion)

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<service-role>"
export DRILL_MATRIX_JSON="docs/api/onboarding/tenant_drill_matrix.live.json"
export TENANT_IDS="<tenant-uuid-1>,<tenant-uuid-2>"
export OPERATOR="ops-oncall"
export CHANGE_REQUEST_ID="CR-<id>"

./scripts/api/run_release_candidate_gate.sh
```

Expected:
- `RC gate passed`
- `RC_GATE_REPORT.md` generated in output directory.

## 3) Controlled Promotion Window

```bash
EXECUTE_PROMOTION=true \
PROMOTION_DRY_RUN=false \
./scripts/api/run_release_candidate_gate.sh
```

Expected:
- Promotion phase completes without failures.
- Postflight watchdog stays clear.

## 4) If Alert Triggered

- Stop cutover immediately.
- Run emergency rollback for affected tenant(s):

```bash
export TENANT_ID="<tenant-uuid>"
./scripts/api/emergency_rollback_tenant.sh
```

- Re-run watchdog in monitor mode before reopening cutover.

## 5) Final Signoff

- Fill `SIGNOFF_RUBRIC.md`.
- Attach RC report + evidence bundle to change request.
- Compliance + Engineering + Ops signoff required.
