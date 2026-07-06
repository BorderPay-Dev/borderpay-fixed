# API Step 2C: Admin Key Ops + Smoke (2026-07-06)

This patch adds control-plane operations needed to run BorderPay API v1 with tenant isolation.

## Added

1. Admin ops Edge Function
   - `supabase/functions/api-gateway-admin/index.ts`
   - Action-based API (admin only):
     - `list_tenants`
     - `upsert_tenant`
     - `create_api_key`
     - `list_api_keys`
     - `revoke_api_key`
     - `add_ip_allowlist`
     - `list_ip_allowlist`
     - `create_webhook_endpoint`
     - `rotate_webhook_secret`
     - `list_webhook_endpoints`

2. Function auth pin
   - `supabase/config.toml`
   - `[functions.api-gateway-admin] verify_jwt = true`

3. Smoke script
   - `scripts/api/smoke_gateway_v1.sh`
   - Validates health and provides templated mutating route calls.

## Security model

- Access to `api-gateway-admin` requires:
  - service-role bearer token, OR
  - JWT for a user in `admin_users`.
- API keys are stored only as SHA-256 hashes in DB.
- Plain API key is returned only once at issuance.
- Webhook secrets are stored only as SHA-256 hashes.

## Deploy order

1. Apply SQL migrations:
   - `20260706093000_api_gateway_runtime_controls.sql`
   - `20260706095500_api_gateway_idempotency_replay_store.sql`
2. Deploy functions:
   - `public-api-gateway`
   - `api-gateway-admin`
3. Issue first tenant + API key via `api-gateway-admin`.
4. Run `scripts/api/smoke_gateway_v1.sh` in sandbox mode.

## Known risk to address next

- `public-api-gateway` transfer/payout payload validation currently trusts adapter error mapping for some shape issues.
  Add strict route-level schema validation in Step 2D before external partner rollout.
