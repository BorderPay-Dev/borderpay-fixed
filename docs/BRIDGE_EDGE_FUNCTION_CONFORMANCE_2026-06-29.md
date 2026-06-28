# Bridge Edge Function Conformance (Server-Side)
Date: 2026-06-29  
Scope: `supabase/functions/bridge-*` + shared Bridge provider client

## Status legend
- **Conformant**: endpoint path aligns to current official Bridge docs.
- **Needs clarification**: endpoint may be valid, but payload/field behavior needs deeper doc-level verification.
- **Mismatch**: path or contract diverges from official docs.

## Inventory
| Edge Function / Module | Bridge Endpoint(s) Used | Official Source | Status | Notes | Action |
|---|---|---|---|---|---|
| `bridge-customer` via `bridgeProvider.createCustomer` | `POST /v0/customers` | Bridge API reference customers/create | Conformant | Core customer creation path is correct. | Verify request body optional-field behavior vs latest docs. |
| `bridge-kyc-link` | `POST /v0/kyc_links` | Bridge API reference kyc-links/generate | Conformant | Uses hosted KYC link flow. | Add parity check for response variants (`data`, top-level, existing link). |
| `bridge-kyb-link` | `POST /v0/kyc_links` (`type=business`) | Bridge API reference kyc-links/generate | Conformant | KYB link flow through kyc_links endpoint. | Add trace parity with kyc-link function (correlation/timing) for ops consistency. |
| `bridge-wallet` via `bridgeProvider.createWallet` | `POST /v0/customers/{id}/wallets` | Bridge API reference bridge-wallets/create-a-bridge-wallet | Conformant | Stablecoin wallet provisioning path. | Validate supported chain/symbol matrix against current Bridge rail docs. |
| `bridge-virtual-account` via `bridgeProvider.createVirtualAccount` | `POST /v0/customers/{id}/virtual_accounts` | Bridge API reference virtual-accounts/create-a-virtual-account | Conformant | VA provisioning with destination + developer fee percent. | Re-verify payload field names against latest examples. |
| `bridge-external-account` | `POST/GET/DELETE /v0/customers/{id}/external_accounts` | Bridge API reference external-accounts/* | Conformant | Create/list/delete external accounts. | Verify any newly added account_type variants in 2026 docs. |
| `bridge-transfer` via `bridgeProvider.createTransfer` | `POST /v0/transfers` | Bridge API reference transfers/create-a-transfer | Conformant | Orchestration transfer route; idempotency and retry semantics are handled. | Re-check response-state mapping against transfer-states doc. |
| `bridge-exchange-rates` | `GET /v0/exchange_rates` | Bridge API reference exchange-rates/get-current-exchange-rate-between-two-currencies | Conformant | Used for FX rate display/pair gating. | Keep pair list synced to docs and avoid unsupported UI pairs. |
| `bridge-sync-accounts` via provider list calls | `GET /v0/customers/{id}/wallets`, `GET /v0/customers/{id}/virtual_accounts` | Bridge API reference bridge-wallets/get-all-bridge-wallets-for-a-customer, virtual-accounts/list-virtual-accounts-by-customer | Conformant | Mirror sync path. | Validate pagination handling for large account sets. |
| `bridge-sync-customers` | Customer list/read endpoints (indirect) | Bridge customers list/get docs | Needs clarification | Function-level payload/field mapping not fully re-audited in this pass. | Run dedicated payload audit on sync fields and status mapping. |
| `bridge-webhook` / `process-pending-events` | Bridge webhook event ingestion (configured endpoint + signed events) | Bridge webhooks overview/signature/structure docs | Conformant | Signature + structured event processing in place. | Reconfirm replay-window enforcement behavior end-to-end. |
| `bridge-bulk-payout` | Multiple `POST /v0/transfers` | Bridge transfers/create + states/errors docs | Conformant | Batch wrapper over documented transfer orchestration. | Verify batch retry semantics + per-row idempotency coverage. |
| `_shared/providers/bridge-client.ts` | Generic transport for Bridge API | Bridge introduction/idempotence | Conformant | Adds API key, idempotency, retry semantics. | Keep retry policy aligned with docs as they evolve. |
| `_shared/providers/bridge.ts` | Customers, KYC links, VA, wallets, transfers | Bridge API reference set | Needs clarification | Core paths conformant; comment history indicates prior payload disagreements with Bridge responses. | Perform request/response schema diff against latest docs examples before refactor. |

## Mismatch Summary (Server-Side)
- No hard path mismatches were found in this pass for active `bridge-*` functions.
- Remaining risk is **payload schema drift**, not endpoint path drift.
- Known scope gaps against latest Bridge docs (intentionally not enabled in this patch set):
  - Virtual Accounts docs include additional rails/currencies (e.g. MXN/BRL/COP) while `bridge-virtual-account` currently hard-gates to USD/EUR/GBP.
  - External Accounts docs include regional variants (e.g. GBP FPS / COP rails in beta docs) while current create-path enforces `us|iban|clabe|pix`.
  - These are kept fail-closed until corridor policy, compliance, and fee configuration are explicitly approved.

## Next Server-Side Patch Order (Bridge)
1. `bridge-kyc-link` / `bridge-kyb-link`: response normalization + trace parity.
2. `bridge-transfer`: transfer-state mapping and error-code normalization against latest transfer docs.
3. `bridge-virtual-account` + `bridge-external-account`: payload-field alignment audit vs latest request examples.
4. `bridge-sync-customers`: status-field and pagination audit.

## Patch Log
### 2026-06-29 — Batch B (completed)
- `bridge-transfer` now consumes structured Bridge error metadata (`status`, `code`, `request_id`) from provider transport.
- `bridge-transfer` now maps documented transfer error classes into stable product-safe API responses:
  - `has_not_accepted_tos` → `tos_required` (409)
  - `requires_active_kyc_status` → `kyc_not_approved` (409)
  - endorsement/limits/idempotency/invalid-params/resource-conflict classes mapped to deterministic status+code.
- Raw provider error text is no longer leaked to clients from this path; provider code and Bridge request id remain exposed for support/debug.

### 2026-06-29 — Batch C (completed)
- Expanded `mapBridgeTransferState` coverage for documented webhook/exception states to avoid unknown-state drift:
  - Pending: `funds_scheduled`
  - Failed terminal: `kyc_required`, `developer_kyb_required`, `underfunded`, `deactivated`

### 2026-06-29 — Batch D (completed)
- Hardened `bridge-sync-customers` onboarding-driven behavior:
  - skips invalid `account_type` rows instead of attempting provider creation
  - skips businesses when `include_business=false`
  - skips business rows with incomplete profile (`company_name` missing) instead of sending malformed create payloads

### 2026-06-29 — Batch E (completed)
- Hardened `bridge-virtual-account` conformance and safety:
  - removed legacy `settle_into` request shape from handler contract
  - added `action=capabilities` to return country-eligible VA currencies (`USD/EUR/GBP`) from policy gate
  - mapped key Bridge provider errors (`has_not_accepted_tos`, `requires_active_kyc_status`, endorsement errors) to deterministic product-safe responses
  - replaced raw provider error passthrough with sanitized fallback error

### 2026-06-29 — Batch F (completed)
- Hardened `bridge-wallet` error surface:
  - mapped key provider error classes to deterministic product-safe responses (`tos_required`, `kyc_not_approved`, `endorsement_required`)
  - removed raw provider message leakage from wallet provisioning path
- Hardened `bridge-sync-accounts` account mirroring:
  - no longer defaults unknown wallet currency to `USDC` (prevents silent misclassification)
  - now skips malformed provider rows with empty currency for wallets/virtual-accounts and logs explicit warning

### 2026-06-29 — Batch G (completed)
- Hardened `bridge-kyc-link` failure handling:
  - standardized provider error extraction (`message` or `error`)
  - mapped Bridge failure classes to deterministic product-safe responses (`tos_required`, `endorsement_required`, `rate_limited`, `provider_unavailable`, etc.)
  - removed raw Bridge failure string leakage from client responses while preserving `bridge_request_id` + `bridge_status` + `correlation_id` for support tracing

### 2026-06-29 — Batch H (completed)
- Hardened `bridge-kyb-link` failure handling to parity with KYC:
  - standardized provider error extraction (`message` or `error`)
  - mapped Bridge failure classes to deterministic product-safe responses (`tos_required`, `endorsement_required`, `rate_limited`, `provider_unavailable`, etc.)
  - removed raw Bridge failure string leakage from client responses while preserving `bridge_request_id` + `bridge_status` + `correlation_id` for support tracing

### 2026-06-29 — Batch I (completed)
- Hardened `kyc-status` normalization for both individual and business:
  - canonical mapping of raw provider statuses/aliases to `not_started|pending|under_review|approved|rejected`
  - deterministic UI status derivation (`none|draft|under_review|approved|rejected`)
  - business account path now normalizes from `bridge_kyb_status`; individual path supports `bridge_kyc_status` and compatibility fallback
- Replaced raw internal error passthrough with product-safe failure response (`verification_status_unavailable`).

### 2026-06-29 — Batch J (completed)
- Hardened `bridge-webhook` ingress safety:
  - replay check now rejects future-dated timestamps beyond skew allowance (prevents accidental acceptance from `abs(now-ts)` logic)
  - removed internal RPC error message leakage from webhook HTTP responses
  - retained structured internal logs (`webhookLog`) for operator debugging

### 2026-06-29 — Batch K (completed)
- Hardened `process-pending-events` transfer projection semantics:
  - removed hardcoded transfer transaction classification (`fx_conversion` / `stablecoin_sandwich`) for all transfer events
  - now classifies transfer metadata deterministically from source/destination rails and currencies (FX only for wallet→wallet cross-currency)
  - added explicit warning log when provider transfer state is unrecognized while preserving fail-closed pending mapping

### 2026-06-29 — Batch L (completed)
- Hardened Bridge list-sync pagination in provider adapter:
  - `listWallets` and `listVirtualAccounts` now use bounded paginated retrieval (`limit`, `starting_after`) with max-page guard
  - added loop-break safeguards for repeated first-page payloads when provider ignores pagination params
  - prevents silent truncation for multi-page customers while avoiding infinite pagination loops

### 2026-06-29 — Batch M (completed)
- Hardened FX pair policy enforcement in `bridge-transfer`:
  - wallet→wallet cross-currency validation now reads `provider_settings.key='bridge.fx.supported_pairs'` when configured
  - supports config shape `["USD_EUR", ...]` or `{ supported_pairs: [...] }`
  - malformed configured policy fails closed (empty allow-list), while absent policy falls back to static documented pair set

### 2026-06-29 — Batch N (completed)
- Added `bridge-fx-supported-pairs` endpoint for policy parity:
  - returns backend-effective FX pair allow-list from the same source used by `bridge-transfer`
  - policy source precedence: `provider_settings.bridge.fx.supported_pairs` -> static fallback default
  - enables UI/backend consistency without duplicating pair assumptions in frontend code

### 2026-06-29 — Batch O (completed)
- Wired client FX policy checks to backend policy source:
  - `backendAPI.fx` now refreshes supported pairs from `bridge-fx-supported-pairs` with in-memory cache + safe fallback
  - `ExchangeScreen` now refreshes pair policy on mount and re-evaluates pair-rate path after policy load
  - replaced static hardcoded unsupported-pair copy with policy-neutral message

### 2026-06-29 — Batch P (completed)
- De-duplicated FX pair policy parsing/loading into shared provider helper:
  - added `_shared/providers/bridge-fx-policy.ts`
  - `bridge-transfer` and `bridge-fx-supported-pairs` now import the same parser + provider-settings loader
  - single policy source eliminates parser drift between transfer execution and supported-pairs API output

### 2026-06-29 — Batch Q (completed)
- Hardened `bridge-exchange-rates` provider error handling:
  - removed raw provider error string passthrough from client responses
  - added deterministic product-safe error mapping (`unsupported_pair`, `rate_limited`, `provider_unavailable`, etc.)
  - preserved `request_id` passthrough for support tracing
