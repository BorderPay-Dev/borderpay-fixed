# Supabase Edge Functions — deployment source of truth

BorderPay has one live financial-provider path in source. Removed-provider
functions are not part of the runtime contract.

## Bridge (current, vendored)

| Path | Purpose |
|---|---|
| `bridge-ping/` | non-mutating sanity check against Bridge (admin/service-role only) |
| `bridge-customer/` | create/fetch Bridge customer (idempotent, lazy) |
| `bridge-kyc-link/` | individual hosted KYC link (lazy-creates Bridge customer if missing) |
| `bridge-kyb-link/` | business hosted KYB link (lazy-creates Bridge customer if missing) |
| `bridge-virtual-account/` | USD / EUR / GBP virtual accounts |
| `bridge-wallet/` | custodial stablecoin wallets |
| `bridge-transfer/` | Bridge transfer orchestration |
| `bridge-webhook/` | inbound Bridge webhook receiver (RSA-SHA256 PKCS#1 v1.5 signature) |

## Core / provider-neutral (vendored)

| Path | Purpose |
|---|---|
| `auth-signup/` | provider-neutral signup; never creates a financial-provider customer |
| `auth-resend-verification/`, `verify-email-token/` | email-verification flow |
| `kyc-status/` | read-only KYC status lookup (returns provider-neutral fields) |
| `process-pending-events/` | webhook queue worker — active provider router only; unknown sources complete without side effects |
| `send-email/` | unified transactional email dispatcher |

## Quarantined (vendored, return 410/501)

The following files are kept on disk for git-history but their handlers
respond `410 Gone` (or `501` for cards) with a structured payload. The
deployed copies should be redeployed from these source stubs or deleted.

| Path | Behaviour |
|---|---|
| `fund-card/` | `501 cards_locked` |
| `kyc-submit/` | `410 provider_removed` |
| `borderpay-transfer/` | `410 provider_removed` |
| `get-fx-rates/` | `410 provider_removed` |
| `get-momo-providers/` | `410 provider_removed` |
| `provisioning-request/` | `410 provider_removed` |

Removed-provider fetch helpers were deleted; no edge function imports them.

## Reproducibility

```bash
supabase functions download <slug> --project-ref orwrcpwsffjlvzuraxjc
supabase functions deploy   <slug> --project-ref orwrcpwsffjlvzuraxjc
supabase functions delete   <slug> --project-ref orwrcpwsffjlvzuraxjc
```

## Stability contract

The frontend's `utils/api/backendAPI.ts` calls into many slugs via
`apiCall(slug, …)`. Treat each slug as a stable API surface: changes
to its request/response shape MUST be backwards-compatible until every
caller is migrated.
