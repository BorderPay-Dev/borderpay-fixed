# BorderPay API Local Ops Command Block

Copy/paste this block for local operator execution.

```bash
# 0) Required runtime env
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<service-role>"
export DRILL_MATRIX_JSON="docs/api/onboarding/tenant_drill_matrix.live.json"
export TENANT_IDS="<tenant-uuid-1>,<tenant-uuid-2>"
export OPERATOR="ops-oncall"
export CHANGE_REQUEST_ID="CR-<id>"

# 1) Dry gate (must pass)
./scripts/api/run_release_candidate_gate.sh

# 2) Controlled promotion gate
EXECUTE_PROMOTION=true \
PROMOTION_DRY_RUN=false \
./scripts/api/run_release_candidate_gate.sh

# 3) Post-cutover watchdog
WINDOW_MINUTES=15 \
AUTO_ROLLBACK_ON_ALERT=false \
./scripts/api/run_rollout_watchdog.sh

# 4) Emergency rollback (only if alert/incident)
export TENANT_ID="<affected-tenant-uuid>"
REVOKE_ACTIVE_KEYS=true \
./scripts/api/emergency_rollback_tenant.sh
```

## Output paths to keep

- `RC_GATE_REPORT.md` path printed by RC gate script
- drill and promotion evidence directories
- watchdog summary files
