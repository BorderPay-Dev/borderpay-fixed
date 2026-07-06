# API Step 2N: Scheduled Watchdog + Escalation (2026-07-06)

This step automates rollout monitoring so alerts are detected continuously and can trigger rollback hooks.

## Delivered

1. Multi-tenant watchdog runner
- `scripts/api/run_rollout_watchdog.sh`
- Iterates tenant list (`TENANT_IDS`) and runs rollout metrics checks per tenant.
- Produces markdown summary artifact for CI (`WATCHDOG_SUMMARY_PATH`).
- Optional auto-rollback hook:
  - `AUTO_ROLLBACK_ON_ALERT=true`
  - Calls `emergency_rollback_tenant.sh` per alerted tenant.

2. Scheduled CI workflow
- `.github/workflows/api-rollout-watchdog.yml`
- Trigger:
  - every 15 minutes (`cron`)
  - manual (`workflow_dispatch`)
- Required GitHub secrets:
  - `API_GATEWAY_SUPABASE_URL`
  - `API_GATEWAY_SERVICE_ROLE_KEY`
  - `API_GATEWAY_TENANT_IDS` (comma-separated UUIDs)
- Optional threshold secrets:
  - `API_GATEWAY_ALERT_ERROR_RATE_PCT`
  - `API_GATEWAY_ALERT_P95_LATENCY_MS`
  - `API_GATEWAY_ALERT_PROVIDER_ERRORS`
  - `API_GATEWAY_ALERT_RATE_LIMITED_REQUESTS`
  - `API_GATEWAY_ALERT_MIN_REQUESTS`

3. Escalation behavior
- If any tenant triggers alert threshold, workflow exits non-zero.
- Summary is published to GitHub Actions job summary.
- Manual run can enable `auto_rollback_on_alert=true` for immediate containment.

## Operational recommendation

Keep scheduled runs in monitor-only mode (`auto_rollback_on_alert=false`) and reserve auto rollback for manual incident-triggered execution by on-call.

## Next (2O)

- Execute tenant-by-tenant go-live drills using a matrix and auto-generated evidence bundles.
