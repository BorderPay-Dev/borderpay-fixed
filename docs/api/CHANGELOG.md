# BorderPay API Changelog

## v1.0.2 - 2026-08-17

- Added durable tenant-scoped outbound partner webhook events and deliveries.
- Added AES-GCM custody and rotation for per-endpoint signing secrets.
- Added HMAC-SHA256 `v1` signatures, timestamps, leased delivery, timeout, and bounded retry behavior.
- Legacy hash-only endpoints remain delivery-disabled until an authorized secret rotation.
- Corrected virtual-account, transfer, and payout contracts to owned provider-resource references.

## v1.0.1 - 2026-07-06

- Synced OpenAPI to gateway-enforced v1 routes.
- Standardized error-code surface:
  - `idempotency_key_required`
  - `idempotency_replay_mismatch`
  - `provider_unavailable`
  - `provider_error`
- Added partner artifacts:
  - Postman collection
  - curl cookbook
  - TypeScript SDK starter + webhook verifier helper
- Added CI contract gate for API pack consistency.

## v1.0.0 - 2026-07-06

- Initial frozen v1 contract established.
- Idempotency policy baseline documented.
