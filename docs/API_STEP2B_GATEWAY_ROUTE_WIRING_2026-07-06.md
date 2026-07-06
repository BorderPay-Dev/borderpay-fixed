# API Step 2B Gateway Route Wiring (2026-07-06)

This patch wires the frozen v1 gateway routes behind runtime controls added in Step 2 foundation.

## Added

1. **Idempotency replay store migration**
   - `supabase/migrations/20260706095500_api_gateway_idempotency_replay_store.sql`
   - Table: `api_idempotency_replays`
   - Unique key: `(tenant_id, api_key_id, route_key, idempotency_key)`
   - Stores deterministic replay response for mutating routes.

2. **Gateway route wiring**
   - `supabase/functions/public-api-gateway/index.ts`
   - Implemented handlers:
     - `POST /v1/customers`
     - `POST /v1/wallets`
     - `POST /v1/virtual-accounts`
     - `POST /v1/transfers`
     - `POST /v1/payouts`
     - `POST /v1/webhooks`

3. **Strict mutating-route idempotency gate**
   - Requires `Idempotency-Key` header (8-256 chars).
   - Reused key + different payload -> `409 idempotency_replay_mismatch`.
   - Reused key + same payload -> exact stored response replay with `X-Idempotent-Replay: true`.

4. **Tenant mode enforcement**
   - Optional request mode via `x-borderpay-mode` or body `mode`.
   - If mismatched with tenant mode, request is rejected fail-closed.

## Notes

- Provider exposure is still hidden from public responses (`provider: borderpay` only).
- Internal execution uses the existing Bridge adapter layer.
- Remaining work for next patch: key issuance/rotation endpoints and full API dashboard wiring.
