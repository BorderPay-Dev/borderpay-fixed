# API Step 2 Gateway Foundation (2026-07-06)

This patch starts Step 2 by introducing a provider-neutral runtime control layer for BorderPay API v1.

## Delivered in this patch

1. **Gateway runtime schema** (`supabase/migrations/20260706093000_api_gateway_runtime_controls.sql`)
   - `api_tenants`
   - `api_keys`
   - `api_ip_allowlist`
   - `api_webhook_endpoints`
   - `api_request_log`
   - `api_rate_limit_counters`

2. **Gateway RPC guards**
   - `api_gateway_resolve_api_key(p_key_hash text)`
   - `api_gateway_check_ip_allowlist(p_tenant_id uuid, p_client_ip inet)`
   - `api_gateway_consume_rate_limit(p_tenant_id uuid, p_api_key_id uuid, p_limit int, p_window_seconds int)`
   - `api_gateway_trim_rate_limit_counters(p_keep_hours int)`

3. **Shared gateway middleware module**
   - `supabase/functions/_shared/api-gateway.ts`
   - API key bearer extraction + SHA-256 hashing
   - tenant context resolution
   - allowlist enforcement
   - fixed-window rate-limit consumption
   - structured request logging helper

4. **New Edge Function**
   - `supabase/functions/public-api-gateway/index.ts`
   - Auth model: API key bearer (not user JWT)
   - Enforced controls per request:
     - API key validity
     - tenant active state
     - IP allowlist
     - rate limit
     - scope check
   - `GET /v1/health` returns ready status
   - other frozen routes are currently reserved and return `501 not_implemented` until route wiring patch

5. **Supabase function auth pin**
   - `supabase/config.toml`:
     - `[functions.public-api-gateway] verify_jwt = false`

## Why this is the correct sequence

Step 2 must land runtime controls before wiring money routes. This prevents exposing routes without tenant auth/rate/IP protections.

## Next patch (Step 2B)

- Wire frozen OpenAPI paths behind `public-api-gateway` dispatch:
  - `POST /v1/customers`
  - `POST /v1/wallets`
  - `POST /v1/virtual-accounts`
  - `POST /v1/transfers`
  - `POST /v1/payouts`
  - `POST /v1/webhooks`
- Add deterministic idempotency replay store at gateway level for all mutating routes.
- Add admin dashboard endpoints for key issuance, revocation, and webhook secret rotation.
