# API Step 2F: Partner Pack (Postman + Curl) — 2026-07-06

This patch delivers runnable partner onboarding artifacts aligned to v1.0.1 contract.

## Delivered assets

1. **Postman collection**
   - `docs/api/postman/BorderPay_API_v1.postman_collection.json`
   - Includes:
     - Gateway health
     - Create customer
     - Create wallet
     - Create virtual account
     - Create transfer
     - Create payout
     - Create webhook endpoint
     - Admin tenant upsert
     - Admin API key issuance

2. **Curl cookbook**
   - `docs/api/curl/API_V1_CURL_COOKBOOK.md`
   - End-to-end command set with env bootstrap and idempotency tests.

3. **OpenAPI contract sync**
   - `docs/api/openapi-v1.yaml` now version `1.0.1` and route-aligned with live gateway behavior.

4. **Error/idempotency policy sync**
   - `docs/API_V1_ERROR_AND_IDEMPOTENCY_POLICY_2026-07-06.md` aligned with gateway runtime codes.

## Packaging rule

These artifacts are provider-neutral and safe to share with partners directly.

## Next (Step 2G)

- Generate SDK starter stubs from openapi-v1.yaml:
  - TypeScript SDK skeleton
  - Node webhook verifier helper
  - Example integration app (sandbox)
