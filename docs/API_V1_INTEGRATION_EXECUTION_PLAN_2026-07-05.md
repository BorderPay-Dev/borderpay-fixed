# BorderPay API v1 Integration Plan (2026-07-05)

## Contract Freeze Reference (2026-07-06)
- OpenAPI v1 frozen contract: `docs/api/openapi-v1.yaml`
- Error + idempotency freeze policy: `docs/API_V1_ERROR_AND_IDEMPOTENCY_POLICY_2026-07-06.md`

## 1) Scope Lock (must freeze before build)

### In-scope (v1)
- Business API authentication (scoped API keys)
- Wallet balance read
- Virtual account read/list (receive rails)
- External account create/list (payout destinations)
- Transfer create/status/list (crypto settlement only)
- Webhook delivery + replay-safe verification docs
- Idempotency for all mutating endpoints

### Out-of-scope (v1)
- Cards API
- Payroll automation API
- Consumer (individual) API keys
- Unsupported rails/corridors
- Any provider-specific raw payload passthrough

## 2) Source-of-truth and routing policy
- Bridge and Yellow Card are the only payment providers in runtime.
- Provider internals must never leak to client contracts.
- All API responses remain provider-neutral.
- Route lock for crypto payout remains strict:
  - `USDC/base`
  - `USDT/tron`

## 3) Compliance/FINTRAC readiness gates
- Current status: FINTRAC approval pending.
- Production API launch mode:
  - Closed beta + explicit customer allowlist only
  - Corridor limits and transaction caps per tenant
  - Full audit logging for key actions
- Mandatory controls before general release:
  - API key issuance/revocation audit log
  - Transfer attempt/result audit log with idempotency keys
  - Webhook signature verification + replay window enforcement
  - Sanctions/restricted-jurisdiction fail-closed responses

## 4) Endpoint inventory (v1)

### Auth/keys
- `POST /api/v1/business/api-keys` (create scoped key)
- `GET /api/v1/business/api-keys` (list)
- `POST /api/v1/business/api-keys/{id}/revoke`

### Wallets
- `GET /api/v1/wallets`
- `GET /api/v1/wallets/{wallet_id}`

### Receive rails / VAs
- `GET /api/v1/virtual-accounts`
- `GET /api/v1/virtual-accounts/{id}`

### External payout destinations
- `POST /api/v1/external-accounts`
- `GET /api/v1/external-accounts`
- `GET /api/v1/external-accounts/{id}`

### Transfers
- `POST /api/v1/transfers`
- `GET /api/v1/transfers`
- `GET /api/v1/transfers/{id}`

### Webhooks
- `POST /api/v1/webhooks` (register)
- `GET /api/v1/webhooks`
- `POST /api/v1/webhooks/{id}/rotate-secret`

## 5) Implementation sequence

### Phase A: Platform controls (P0)
- API key model + scopes + revocation
- Request auth middleware
- Standard error envelope + correlation IDs

### Phase B: Read surfaces
- Wallet/VA read APIs
- External account read/list

### Phase C: Write surfaces (financial critical)
- Transfer create/status/list via existing backend validation
- Mandatory idempotency key checks
- Enforce existing payout validator invariants

### Phase D: Webhooks
- Signature standard
- Retry policy + dead-letter behavior
- Replay protection

### Phase E: Beta launch
- Allowlisted customers only
- Monitoring dashboard (error rate, webhook success, transfer state lag)
- Incident runbook + rollback toggles

## 6) Test and release criteria
- 100% pass on API contract tests
- 0 provider-leak fields in client responses
- 0 duplicate transfer side-effects under retry/replay
- Webhook delivery success >= 99% in beta window
- Incident drill completed before general release

## 7) Ownership
- Product/Scope lock: Founder + CTO
- Compliance gate: Ops + Legal
- Runtime and rollout: Engineering + DevOps
