# Bridge Endpoint Mismatch Inventory (Step 2)
Date: 2026-06-29  
Scope: Runtime inventory for live Bridge paths only (no code changes yet)

## Classification
- **Conformant**: Edge function maps to an official Bridge endpoint and contract direction is aligned.
- **Mismatch**: Live caller/path shape likely drifts from official docs or from current edge function set.
- **Unknown**: Needs deeper payload/response contract verification.

## A) BorderPay Runtime -> Edge Function -> Bridge Endpoint Map
| Runtime Surface | Edge Function | Bridge Endpoint(s) | Status | Notes |
|---|---|---|---|---|
| `bridgeAPI.customer.create` | `bridge-customer` | `POST /v0/customers` | Conformant | Uses Bridge customer creation path. |
| `bridgeAPI.kyc.startIndividual` | `bridge-kyc-link` | `POST /v0/kyc_links` | Conformant | Hosted KYC link flow. |
| `bridgeAPI.kyb.startBusiness` | `bridge-kyb-link` | `POST /v0/kyc_links` (`type=business`) | Conformant | Hosted KYB link flow via KYC links API. |
| `bridgeAPI.wallets.create` / provisioning stablecoin | `bridge-wallet` | `POST /v0/customers/{id}/wallets` | Conformant | Stablecoin wallet creation route. |
| `bridgeAPI.virtualAccounts.create` | `bridge-virtual-account` | `POST /v0/customers/{id}/virtual_accounts` | Conformant | VA creation path. |
| `bridgeAPI.externalAccount.create/list/delete/capabilities` | `bridge-external-account` | `/v0/customers/{id}/external_accounts` (POST/GET/DELETE) | Conformant | Supports `us/iban/clabe/pix` contract in function. |
| `bridgeAPI.transfer.create` / stablecoin send / FX convert | `bridge-transfer` | `POST /v0/transfers` | Conformant | Idempotent transfer orchestration path. |
| `backendAPI.fx.getCurrentRate` | `bridge-exchange-rates` | `GET /v0/exchange_rates` | Conformant | Pair-gated in client policy. |
| webhook ingestion | `bridge-webhook` -> `process-pending-events` | Bridge webhook event envelopes | Conformant | Signature + event processing pipeline exists. |
| account mirror refresh | `bridge-sync-accounts` | `GET /v0/customers/{id}/wallets`, `GET /v0/customers/{id}/virtual_accounts` | Conformant | Pull-based sync to local mirror. |
| customer sync/ops | `bridge-sync-customers` | Bridge customer reads | Unknown | Needs payload-level audit against current Bridge list/get shape. |
| bulk payouts | `bridge-bulk-payout` | multiple `POST /v0/transfers` calls | Conformant | Batch wrapper over transfer orchestration. |

## B) Runtime Drift / Mismatch Candidates (Live Risk)
These were found in `utils/api/backendAPI.ts` as callable endpoints but do not have matching function directories in `supabase/functions`.

Update (2026-06-29):
- All listed endpoints were **quarantined** in client SDK (`backendAPI.ts`) to prevent runtime 404 calls.
- Profile update + account suspend paths were replaced with direct RLS-safe Supabase writes.

| Endpoint reference in client | Status | Risk |
|---|---|---|
| `get-institutions` | Quarantined | Avoids runtime 404; rail remains disabled until official implementation. |
| `resolve-account` | Quarantined | Avoids runtime 404; rail remains disabled until official implementation. |
| `get-transfers` | Quarantined | Avoids runtime 404 on legacy local-payments history path. |
| `verify-transfer` | Quarantined | Avoids runtime 404 on legacy verification path. |
| `verify-transaction` | Quarantined | Avoids runtime 404 on legacy verification endpoint. |
| `get-customer-transactions` | Quarantined | Avoids runtime 404 on legacy customer-transactions endpoint. |
| `fetch-bank-details` | Quarantined | Avoids runtime 404. |
| `get-address` | Quarantined | Avoids runtime 404 on legacy address detail lookup. |
| `get-accounts` | Replaced | Replaced by `financial.getWalletRouteData()` projection read. |
| `check-account-status` | Quarantined | Avoids runtime 404 on legacy account-status endpoint. |
| `suspend-user` | Replaced | Replaced by direct RLS-safe `user_profiles.account_status` update. |
| `update-user-profile` | Replaced | Replaced by direct RLS-safe `user_profiles` update. |
| `update-security-status` | Quarantined (no-op) | Keeps compatibility shape without unresolved network call. |
| `get-fx-history` | Quarantined | Avoids runtime 404 until a canonical FX history endpoint exists. |
| `bridge-list-banks` | Quarantined | Avoids runtime 404 in payout helper shim. |
| `bridge-resolve-account` | Quarantined | Avoids runtime 404 in payout helper shim. |

## C) Bridge 2026 Conformance Priorities (Patch Order)
1. **P0 Identity + Verification**
   - `bridge-customer`, `bridge-kyc-link`, `bridge-kyb-link`, webhook verification state reconciliation.
2. **P0 Money primitives**
   - `bridge-wallet`, `bridge-virtual-account`, `bridge-transfer`, `bridge-external-account`.
3. **P1 Read models**
   - `bridge-sync-accounts`, transaction mirrors, history endpoints.
4. **P1/P2 Legacy caller quarantine**
   - Remove or hard-block unresolved client endpoints listed in section B.

## D) Cutover Rule (Live-safe)
- Do **not** delete legacy paths before:
  1. replacement endpoint is deployed,
  2. runtime-verified in RC,
  3. promoted with monitoring window.
- Sequence: **mirror -> verify -> cutover -> delete**.
