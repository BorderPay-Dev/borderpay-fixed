# BorderPay API Secrets Checklist (Ops Handoff)

Set and verify these before running watchdog or RC gate workflows.

## GitHub Actions Secrets

- [ ] `API_GATEWAY_SUPABASE_URL`
- [ ] `API_GATEWAY_SERVICE_ROLE_KEY`
- [ ] `API_GATEWAY_TENANT_IDS`
- [ ] `API_GATEWAY_ALERT_ERROR_RATE_PCT` (optional)
- [ ] `API_GATEWAY_ALERT_P95_LATENCY_MS` (optional)
- [ ] `API_GATEWAY_ALERT_PROVIDER_ERRORS` (optional)
- [ ] `API_GATEWAY_ALERT_RATE_LIMITED_REQUESTS` (optional)
- [ ] `API_GATEWAY_ALERT_MIN_REQUESTS` (optional)

## Local Shell Variables (manual cutover)

- [ ] `SUPABASE_URL`
- [ ] `SERVICE_ROLE_KEY`
- [ ] `DRILL_MATRIX_JSON`
- [ ] `TENANT_IDS`
- [ ] `OPERATOR`
- [ ] `CHANGE_REQUEST_ID`

## Validation Commands

```bash
test -n "$SUPABASE_URL"
test -n "$SERVICE_ROLE_KEY"
test -n "$DRILL_MATRIX_JSON"
test -n "$TENANT_IDS"
```

```bash
bash -n scripts/api/run_release_candidate_gate.sh
bash -n scripts/api/run_rollout_watchdog.sh
bash -n scripts/api/emergency_rollback_tenant.sh
```

If any check fails, do not start cutover.
