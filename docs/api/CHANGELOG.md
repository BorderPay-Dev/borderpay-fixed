# BorderPay API Changelog

## v1.0.2 - 2026-07-11

- Replaced legacy `stablecoin` transfer examples with Bridge-compatible rails:
  - source: `bridge_wallet`
  - destinations: `base`, `tron`, or another supported Bridge rail
- Required `on_behalf_of` for transfer and payout create requests.
- Aligned virtual-account destination payloads to `payment_rail` plus `bridge_wallet_id` or address.
- Enforced HTTPS-only webhook endpoint registration.

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
