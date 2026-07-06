# API Step 2O: Tenant Go-Live Drill + Evidence Automation (2026-07-06)

This step operationalizes partner launch drills so each tenant has deterministic preflight checks and a captured evidence bundle.

## Delivered

1. Matrix template
- `docs/api/onboarding/TENANT_DRILL_MATRIX_TEMPLATE.json`

2. Go-live drill runner
- `scripts/api/run_tenant_golive_drill.sh`
- Features:
  - Reads a tenant matrix JSON.
  - Runs preflight checks per tenant (if API key provided).
  - Supports promotion execution gate:
    - `promote=true` + `DRY_RUN=false` => executes promotion.
    - default `DRY_RUN=true` => promotion never executes.
  - Writes per-tenant evidence files:
    - `<tenant_id>.md`
    - `<tenant_id>.json`
  - Writes summary:
    - `SUMMARY.md`
  - Non-zero exit if any tenant fails.

## Usage

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<service-role>"
export DRILL_MATRIX_JSON="docs/api/onboarding/TENANT_DRILL_MATRIX_TEMPLATE.json"
export DRY_RUN="true"
export OPERATOR="ops-oncall"
export CHANGE_REQUEST_ID="CR-12345"

./scripts/api/run_tenant_golive_drill.sh
```

For controlled promotion execution:

```bash
export DRY_RUN="false"
./scripts/api/run_tenant_golive_drill.sh
```

## Why this matters

Without a matrix-driven drill, go-live checks become ad hoc and evidence quality is inconsistent across tenants. This step makes the launch process reproducible and auditable.

## Next (2P)

- Wrap drill + watchdog + controlled promotion + postflight into one release-candidate gate command pack.
