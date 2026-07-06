# API Step 2D: Strict Validation + Error Normalization (2026-07-06)

This patch closes the main Step 2 rollout risk: malformed partner payloads now fail at gateway boundary before provider calls.

## Added

1. Route validators module
   - `supabase/functions/_shared/api-gateway-validators.ts`
   - Strong validation for:
     - `POST /v1/customers`
     - `POST /v1/wallets`
     - `POST /v1/virtual-accounts`
     - `POST /v1/transfers`
     - `POST /v1/payouts`
     - `POST /v1/webhooks`
   - Idempotency header validator:
     - `Idempotency-Key` required for mutating routes
     - length 8..256

2. Gateway wiring update
   - `supabase/functions/public-api-gateway/index.ts`
   - All mutating routes now invoke dedicated validators before Bridge adapter call.
   - Validation failures return HTTP 400 with structured `invalid_request` errors.

3. Provider error normalization
   - Bridge provider failures are mapped to normalized public error codes:
     - `rate_limited`
     - `unauthorized`
     - `forbidden`
     - `not_found`
     - `invalid_request`
     - `provider_unavailable`
     - fallback `provider_error`

4. Smoke script enhancement
   - `scripts/api/smoke_gateway_v1.sh`
   - Added replay and mismatch idempotency checks.

## Why this matters

- Prevents undefined provider-side rejects from leaking partner-facing ambiguity.
- Stabilizes contract behavior for SDK/client implementation.
- Enforces deterministic behavior under retries and duplicate client submits.

## Remaining Step 2 gap

- Add typed response examples + OpenAPI sync pass (publish exact request/response JSON schemas from validators).
