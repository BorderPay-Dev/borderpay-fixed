# BorderPay API Workflow and Secrets Setup Checklist

Use this before enabling scheduled monitoring in GitHub Actions.

## A) Workflow Files

- [ ] `.github/workflows/api-rollout-watchdog.yml` exists on `main`
- [ ] `.github/workflows/api-contract-pack.yml` exists on `main`

## B) Required Secrets

- [ ] `API_GATEWAY_SUPABASE_URL`
- [ ] `API_GATEWAY_SERVICE_ROLE_KEY`
  - Stores the dedicated API gateway admin bearer token accepted by `api-gateway-admin`.
  - It is intentionally not the general Supabase project service-role key.
- [ ] `API_GATEWAY_TENANT_IDS`

## C) Optional Alert Tuning Secrets

- [ ] `API_GATEWAY_ALERT_ERROR_RATE_PCT`
- [ ] `API_GATEWAY_ALERT_P95_LATENCY_MS`
- [ ] `API_GATEWAY_ALERT_PROVIDER_ERRORS`
- [ ] `API_GATEWAY_ALERT_RATE_LIMITED_REQUESTS`
- [ ] `API_GATEWAY_ALERT_MIN_REQUESTS`

## D) Manual Workflow Smoke

1. Open `API Rollout Watchdog` workflow.
2. Run `workflow_dispatch` with:
   - `auto_rollback_on_alert=false`
   - `window_minutes=15`
3. Confirm:
   - workflow completes successfully for clear state, or fails with explicit alert context
   - job summary contains watchdog output

## E) Safety Constraint

- Keep scheduled mode monitor-only.
- Use auto rollback only during explicit incident handling.
