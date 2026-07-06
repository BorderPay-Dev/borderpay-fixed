# API Step 2P: RC Gate Command Pack (2026-07-06)

This step packages release gating into one deterministic command path for ops.

## Delivered

1. Single-command RC gate runner
- `scripts/api/run_release_candidate_gate.sh`

2. Gate phases executed in order
- Phase 1: tenant drill (`run_tenant_golive_drill.sh`, dry-run)
- Phase 2: preflight watchdog (`run_rollout_watchdog.sh`, monitor-only)
- Phase 3: controlled promotion (optional)
- Phase 4: postflight watchdog (`run_rollout_watchdog.sh`, monitor-only)

3. Consolidated output
- `RC_GATE_REPORT.md` with pass/fail, phase logs, and evidence pointers.

## Required env

- `SUPABASE_URL`
- `SERVICE_ROLE_KEY`
- `DRILL_MATRIX_JSON`
- `TENANT_IDS`

## Key options

- `EXECUTE_PROMOTION=true|false` (default `false`)
- `PROMOTION_DRY_RUN=true|false` (default `true`)
- Threshold inputs reused from watchdog scripts.

## Example

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<service-role>"
export DRILL_MATRIX_JSON="docs/api/onboarding/TENANT_DRILL_MATRIX_TEMPLATE.json"
export TENANT_IDS="<tenant-uuid-1>,<tenant-uuid-2>"
export OPERATOR="ops-oncall"
export CHANGE_REQUEST_ID="CR-12345"

# gate only (no promotion)
./scripts/api/run_release_candidate_gate.sh

# controlled promotion execution
EXECUTE_PROMOTION=true PROMOTION_DRY_RUN=false \
./scripts/api/run_release_candidate_gate.sh
```

## Why this matters

Without a single RC gate command, operators run partial checks inconsistently and release signoff becomes non-deterministic.

## Next (2Q)

- Publish final freeze/handoff operator pack: quickstart, secrets checklist, cutover command sheet, and signoff rubric.
