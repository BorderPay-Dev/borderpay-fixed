# BorderPay × Bridge migration architecture

> Status: **Phase 1 (additive scaffolding)**. Production still routes to Maplerad
> for existing users. Bridge integration is shipped behind a `payment_provider`
> column so we can flip per-user, then globally, then deprecate Maplerad.

## Why an abstraction layer

Going from one provider to another mid-flight on a payments product is risky.
Existing users are mid-onboarding, mid-KYC, mid-balance. We can't pretend Maplerad
isn't there for the next ~30 days. So we ship:

```
   ┌────────────────────────┐
   │   PaymentProvider      │  TypeScript interface (shared/providers/types.ts)
   │   (kyc, accounts,      │
   │    wallets, transfers) │
   └────────┬───────────────┘
            │
   ┌────────┴───────────────┐
   │                        │
   ▼                        ▼
MapleradProvider      BridgeProvider          (existing prod)   ← (default for old users)
                                                                  ← (default for NEW signups)
                            │
                            └─── future: AfricanOnOffRampProvider routes
                                 KES/NGN/GHS/UGX/TZS/XOF/CDF + mobile money
```

User → `user_profiles.payment_provider` ('maplerad' | 'bridge'). Default for new
rows is `'bridge'` (controlled by an env flag). Existing rows are `'maplerad'`
until manually migrated by ops.

## Bridge primitives we use

| BorderPay concept | Bridge resource | Endpoint (rough) |
|---|---|---|
| User identity | Customer (`type: 'individual' \| 'business'`) | `POST /v0/customers` |
| KYC / KYB | KYC link (hosted) or embedded | `POST /v0/kyc_links` |
| USD / EUR / GBP virtual account | Virtual account | `POST /v0/customers/{id}/virtual_accounts` |
| Stablecoin wallet | Custodial wallet | `POST /v0/customers/{id}/wallets` |
| Stablecoin balance | Wallet balance | `GET /v0/customers/{id}/wallets/{wid}/balances` |
| Stablecoin transfer | Transfer (orchestration) | `POST /v0/transfers` |
| Cross-border payout | Transfer to fiat rail | `POST /v0/transfers` (source=stablecoin, destination=fiat) |
| **Cards** | **n/a in self-serve plan** | Marked **Coming Soon** in UI; no API calls |

## Mapping table — DB columns

```
user_profiles
  maplerad_customer_id              → bridge_customer_id            (additive, both kept)
  maplerad_tier                     → bridge_kyc_status (text enum)
  maplerad_status                   → bridge_account_status
  -                                 → bridge_kyc_link_id
  -                                 → bridge_kyc_link_url
  -                                 → bridge_kyc_completed_at
  payment_provider (NEW)            ('maplerad' | 'bridge')
  preferred_currencies (NEW jsonb)  ['USD','EUR','GBP'] etc.

wallets
  maplerad_wallet_id                → bridge_wallet_id              (additive)
  -                                 → bridge_virtual_account_id
  -                                 → asset_type ('stablecoin'|'fiat_virtual_account')
  -                                 → stablecoin_chain ('ETH'|'SOL'|'BSC'|'POLYGON'|'TRON')

transactions
  -                                 → bridge_transfer_id            (additive)
  -                                 → provider                       ('maplerad'|'bridge')

(NEW) bridge_webhook_events
  id, event_id (uniq), event_type, payload, signature_ok,
  processing_status, attempts, last_error, received_at, processed_at
```

## Authentication & secrets

| Env var | Purpose |
|---|---|
| `BRIDGE_API_KEY` | server-side `Api-Key` header for Bridge REST |
| `BRIDGE_WEBHOOK_PUBLIC_KEY` | Ed25519 public key for webhook signature verification |
| `BRIDGE_BASE_URL` | usually `https://api.bridge.xyz` |
| `BRIDGE_WEBHOOK_SECRET` | optional — HMAC fallback if Ed25519 not configured |

All Bridge calls are server-side (Supabase Edge Functions). Frontend never sees
the API key. KYC links are returned to the client as one-time hosted URLs.

## Webhook security

- Bridge signs every webhook with Ed25519 (header `X-Bridge-Signature` over the
  raw body).
- `bridge-webhook` edge function:
  1. Reads raw body (no JSON parse before signature check).
  2. Verifies signature with `BRIDGE_WEBHOOK_PUBLIC_KEY`.
  3. Inserts row into `public.bridge_webhook_events` (idempotency on `event_id`).
  4. Enqueues into `public.pending_events` for the worker (reuses our existing
     queue + retry infra from `process-pending-events`).
  5. Returns `200 OK` < 500 ms — no business logic in the receiver.

## Cards: "Coming Soon"

- `CardsScreen` retains its UI but every action button is replaced with a
  disabled "Coming Soon" badge tooltip.
- `RequestProvisioningModal` shows the Virtual USD Card tile but disables the
  submit button when `provider === 'bridge'`.
- No Bridge issuing API calls.

## African on/off-ramp (future)

`supabase/functions/_shared/providers/african-onramp.types.ts` defines the
interface a future partner must implement. The orchestration code is written
against the interface today so the integration is a drop-in.

## Migration runbook

1. **Phase 0 (this turn) — additive scaffold**: schema migration + provider
   abstraction + Bridge edge function source vendored. No production behaviour
   change. `payment_provider` defaults to `'maplerad'` for existing rows.
2. **Phase 1 — Bridge in prod for new signups only**:
   - Set Bridge env vars (`BRIDGE_API_KEY`, etc.).
   - Deploy vendored edge functions.
   - Set DB default: `alter table user_profiles alter column payment_provider set default 'bridge';`
   - Run `auth-signup` v89 (this commit) which routes new signups to
     `bridge-customer-create` instead of Maplerad enroll.
3. **Phase 2 — migrate existing users to Bridge**:
   - For each verified user, an admin RPC `migrate_user_to_bridge(user_id)`:
     creates a Bridge customer, generates a KYC-skip link if their KYC is
     already valid in Maplerad, switches `payment_provider`, locks the
     Maplerad customer.
   - Audit row in `account_type_audit` (extended with provider tracking).
4. **Phase 3 — sunset Maplerad**:
   - Delete Maplerad-specific edge functions.
   - Drop `maplerad_*` columns once no row references them.
   - Remove env vars.

## Testing strategy

- **Unit**: provider implementations against mocked Bridge HTTP responses.
- **Integration**: smoke test against Bridge sandbox via `tests/bridge.smoke.ts`
  with `BRIDGE_API_KEY` set.
- **Webhook**: replay-driven test injects a signed sandbox payload and asserts
  the queue processes it without duplicates.
- **End-to-end**: scripted Puppeteer flow (signup → click KYC link → submit →
  webhook → verify dashboard shows verified).

## What's still Maplerad-controlled (intentionally)

- All currently-live users (`payment_provider='maplerad'`).
- The admin panel KYC review queue (works for both providers — it reads
  `kyc_submissions`, not provider-specific tables).
- The webhook receiver (`maplerad-webhook`).

These will be flipped during Phase 2.
