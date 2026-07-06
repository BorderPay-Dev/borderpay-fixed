# BorderPay API v1 Error + Idempotency Policy (Frozen)

Freeze date: **2026-07-06**  
OpenAPI source: `docs/api/openapi-v1.yaml` (version `1.0.1`)

## 1) Standard error envelope (mandatory)
All non-2xx responses use:

```json
{
  "success": false,
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Rules:
- `error.code` is machine-stable and enum-controlled.
- `error.message` may evolve; code stability is mandatory.
- `error.details` is optional and used for field-level diagnostics.

## 2) Frozen error codes (v1.0.1)
- `unauthorized`
- `forbidden`
- `invalid_request`
- `idempotency_key_required`
- `idempotency_replay_mismatch`
- `not_found`
- `rate_limited`
- `provider_unavailable`
- `provider_error`
- `internal_error`

## 3) Idempotency policy (strict)
Idempotency is REQUIRED on all mutating routes.

Header:
- `Idempotency-Key` (required)
- Validity: **8-256 chars**

Mutating routes in scope:
- `POST /v1/customers`
- `POST /v1/wallets`
- `POST /v1/virtual-accounts`
- `POST /v1/transfers`
- `POST /v1/payouts`
- `POST /v1/webhooks`

Server behavior:
1. Same tenant + same key + same fingerprint:
   - Returns stored replay response with same status/body.
2. Same tenant + same key + different fingerprint:
   - Rejects with `409`, code `idempotency_replay_mismatch`.
3. Missing/invalid key on mutating route:
   - Rejects with `400`, code `idempotency_key_required`.

Fingerprint basis:
- route key (`METHOD /v1/path`) + normalized request body.

Retention:
- Replay records stored for at least 24h baseline.

## 4) Validation boundary
Gateway performs strict request validation before provider execution.
Malformed payloads are rejected as `400 invalid_request`.

## 5) Provider abstraction rule
- Public responses must not expose provider names beyond `provider: borderpay`.
- Provider-specific diagnostics remain internal logs only.

## 6) Change control
Any change to error enum, idempotency semantics, or required fields requires:
1. OpenAPI version bump,
2. migration note,
3. rollout notice to partner integrators.
