# API Step 2K: Closed-Beta Promotion Runbook (2026-07-06)

This runbook is the operational path to move a tenant from blocked production access to allowlisted beta access with explicit caps.

## Artifacts

- Promotion script: `scripts/api/promote_tenant_closed_beta.sh`
- Runtime guardrails source: `supabase/functions/public-api-gateway/index.ts`
- Admin control surface: `supabase/functions/api-gateway-admin/index.ts`

## Mandatory preconditions

1. Tenant exists in `api_tenants`.
2. API key already issued for tenant (`api_keys`).
3. Closed-beta gate is enabled (`API_V1_CLOSED_BETA=true`, default behavior).
4. Approved rollout ticket exists (ops + compliance signoff).

## Promotion sequence

### 1) Preflight (must fail-closed)

Probe `/v1/health` in `production` mode with tenant API key.

Expected result before allowlist:
- `error.code = forbidden`
- Message indicates tenant is not allowlisted for production beta.

### 2) Enable allowlist + caps

Use `upsert_tenant` via `api-gateway-admin` to set:
- `default_mode = production`
- `beta_access_enabled = true`
- `max_single_transfer_usd = <approved cap>`
- `rate_limit_per_minute = <approved throttle>`

### 3) Postflight

Probe `/v1/health` again in `production` mode.

Expected result:
- `success = true`
- `data.mode = production`

### 4) Record evidence

Capture and store:
- Preflight blocked response
- Promotion payload/response
- Postflight success response
- Operator + timestamp + change request ID

## Script usage

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<service-role>"
export TENANT_ID="<api_tenants.id>"
export TENANT_NAME="Acme Payroll API"
export GATEWAY_API_KEY="bpk_live_xxx"
export DEFAULT_MODE="production"
export RATE_LIMIT_PER_MINUTE="120"
export MAX_SINGLE_TRANSFER_USD="5000"
export BETA_ACCESS_ENABLED="true"
export PREFLIGHT_EXPECT_FORBIDDEN="true"

./scripts/api/promote_tenant_closed_beta.sh
```

## Rollback

Immediate rollback path:
- Set `beta_access_enabled=false` via `upsert_tenant`.
- Optionally set `is_active=false` and revoke active API keys.
- Re-run health probe; production access must be blocked again.
