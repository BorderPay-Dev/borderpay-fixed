# Supabase Edge Functions — deployment source of truth

Bridge is the only live financial provider. Maplerad has been removed from
all active flows. Some Maplerad-era functions remain deployed on the
project but are no longer reachable from the client; they are slated for
deletion (see `MAPLERAD_REMOVAL_CHECKLIST.md`).

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
| `auth-signup/` | v89 — provider-neutral signup; never creates a Bridge/Maplerad customer |
| `auth-resend-verification/`, `verify-email-token/` | email-verification flow |
| `kyc-status/` | read-only KYC status lookup (returns provider-neutral fields) |
| `process-pending-events/` | webhook queue worker — Bridge router only; legacy `source='maplerad'` rows drain to a terminal `provider_removed` summary without side effects |
| `send-email/` | unified transactional email dispatcher |

## Quarantined (vendored, return 410/501)

The following files are kept on disk for git-history but their handlers
respond `410 Gone` (or `501` for cards) with a structured payload. The
deployed copies should be redeployed from these source stubs or deleted.

| Path | Behaviour |
|---|---|
| `fund-card/` | `501 cards_coming_soon` |
| `kyc-submit/` | `410 provider_removed` |
| `sync-users-to-maplerad/` | `410 provider_removed` |
| `borderpay-transfer/` | `410 provider_removed` |
| `get-fx-rates/` | `410 provider_removed` |
| `get-momo-providers/` | `410 provider_removed` |
| `provisioning-request/` | `410 provider_removed` |

`_shared/mapleradFetch.ts` was deleted; no edge function imports it.

## Deployed-only Maplerad functions (no source-tree backing)

These are reachable on Supabase but not vendored. The client no longer
calls any of them. They must be either (a) redeployed as 410 stubs or (b)
deleted via the Supabase dashboard / CLI. See `MAPLERAD_REMOVAL_CHECKLIST.md`
for the exact list and recommended action per slug.

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
