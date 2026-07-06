# API Step 2M: Rollout Telemetry + Rollback Hooks (2026-07-06)

This step adds deterministic monitoring and emergency rollback tooling for closed-beta production tenants.

## Delivered

1. Metrics + rollback SQL primitives
- `supabase/migrations/20260706174500_api_gateway_rollout_metrics_and_rollback.sql`
- New functions:
  - `api_gateway_rollout_metrics(p_tenant_id, p_window_minutes)`
  - `api_gateway_emergency_rollback(p_tenant_id, p_revoke_active_keys)`

2. Admin function actions
- `supabase/functions/api-gateway-admin/index.ts`
- New actions:
  - `get_rollout_metrics`
  - `emergency_rollback_tenant`

3. Operator scripts
- `scripts/api/monitor_api_rollout.sh`
  - Evaluates alert thresholds from live `api_request_log` metrics.
  - Exits non-zero when alert conditions are triggered.
- `scripts/api/emergency_rollback_tenant.sh`
  - Forces tenant back to sandbox path and disables beta access.
  - Optionally revokes all active API keys.
  - Optional post-rollback production health verification.

## Default alert thresholds

- Window: `15` minutes
- Minimum request count before evaluating alerts: `20`
- Error rate threshold: `>= 5%`
- p95 latency threshold: `>= 2000ms`
- Provider error threshold: `>= 1`
- Rate-limited request threshold: `>= 20`

## Example usage

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<service-role>"
export TENANT_ID="<tenant-id>"
./scripts/api/monitor_api_rollout.sh
```

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<service-role>"
export TENANT_ID="<tenant-id>"
export REVOKE_ACTIVE_KEYS="true"
./scripts/api/emergency_rollback_tenant.sh
```

## Why this matters

Without automated threshold checks and one-step rollback hooks, incidents rely on manual operator judgment under time pressure, which is where financial API outages escalate.
