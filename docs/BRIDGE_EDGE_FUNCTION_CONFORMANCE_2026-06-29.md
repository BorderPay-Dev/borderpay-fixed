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

### 2026-06-29 — Batch R (completed)
- Hardened `bridge-sync-customers` customer/status persistence:
  - individual rows now initialize `bridge_kyc_status=not_started`; business rows initialize `bridge_kyb_status=not_started`
  - added explicit DB update error checks for `user_profiles` and `business_profiles` writes
  - replaced raw exception leakage in sync results with deterministic operator-safe error codes/messages

### 2026-06-29 — Batch S (completed)
- Hardened `bridge-customer` customer initialization path:
  - account-type aware initial status persistence (`bridge_kyc_status` for individual, `bridge_kyb_status` for business)
  - explicit profile update error handling after provider customer creation
  - replaced raw provider exception passthrough with deterministic product-safe error mapping

### 2026-06-29 — Batch T (completed)
- Hardened shared provider customer creation error contract:
  - `BridgeProvider.createCustomer` now throws `BridgeProviderError` with structured metadata (`status`, `request_id`, provider code/message)
  - response validation now fails with structured provider error when customer id is missing
  - removes generic error throw path and aligns create-customer behavior with other provider helpers

### 2026-06-29 — Batch U (completed)
- Hardened `bridge-kyb-link` operational parity with KYC flow:
  - added staged trace writes (correlation id, status, request id, elapsed ms) into `bridge_kyc_traces`
  - added structured trace coverage for request/response/db-update/success stages
  - replaced raw `business_profiles` update error leakage with product-safe `profile_sync_failed` response

### 2026-06-29 — Batch V (completed)
- Hardened `bridge-external-account` provider failure surface:
  - replaced raw Bridge error passthrough on create/list/delete/capabilities with deterministic product-safe mapping
  - preserved `request_id` in failure responses for support traceability
  - added explicit local mirror upsert error handling (`external_account_sync_failed`)

### 2026-06-29 — Batch W (completed)
- Hardened `bridge-wallet` persistence failure response:
  - removed raw database error text leakage from `persistence_failed` response
  - kept deterministic user-safe message while preserving `bridge_wallet_id` for operator reconciliation

### 2026-06-29 — Batch X (completed)
- Hardened `bridge-transfer` persistence-failure response:
  - removed raw RPC/database error leakage from `persistence_failed` client response
  - retained `bridge_transfer_id` so status can be reconciled after provider acceptance

### 2026-06-29 — Batch Y (completed)
- Hardened `bridge-sync-customers` query failure response:
  - removed raw Supabase query error leakage from sync endpoint
  - replaced with deterministic operator-safe error contract (`sync_query_failed`)

### 2026-06-29 — Batch Z (completed)
- Hardened `bridge-test-webhook` ingest failure response:
  - removed raw RPC error leakage from synthetic webhook endpoint
  - replaced with deterministic failure contract (`synthetic_ingest_failed`, `ingest_failed`)

### 2026-06-29 — Batch AA (completed)
- Hardened `bridge-kyc-link` profile bootstrap failure response:
  - removed raw `user_profiles` bootstrap database error leakage from client response
  - replaced with deterministic product-safe contract (`profile_bootstrap_failed`)

### 2026-06-29 — Batch AB (completed)
- Hardened `bridge-kyb-link` missing-link failure contract:
  - replaced generic missing-link failure text with deterministic coded response (`missing_verification_link`)
  - kept request/correlation ids for operator traceability

### 2026-06-29 — Batch AC (completed)
- Hardened `bridge-kyc-link` missing-link failure contract:
  - replaced generic missing-link failure text with deterministic coded response (`missing_verification_link`)
  - kept Bridge request id for operator traceability

### 2026-06-29 — Batch AD (completed)
- Hardened `bridge-identity-cleanup` failure surface:
  - removed raw provider/database exception text from per-candidate API responses
  - added top-level deterministic internal failure contract (`cleanup_internal_error`)
  - preserved detailed failure context only in internal cleanup audit records

### 2026-06-29 — Batch AE (completed)
- Hardened `bridge-bulk-payout` per-item failure surface:
  - removed raw DB/provider exception text leakage from item-level results
  - added deterministic per-item error mapping (`tos_required`, `kyc_not_approved`, `insufficient_funds`, etc.)
  - kept payout processing behavior (partial-success batch) unchanged

### 2026-06-29 — Batch AF (completed)
- Hardened `bridge-transfer` non-provider exception fallback:
  - removed raw exception message leakage from terminal fallback response
  - replaced with deterministic `transfer_internal_error` contract

### 2026-06-29 — Batch AG (completed)
- Hardened `bridge-wallet` input validation contract:
  - replaced dynamic unsupported symbol/chain validation messages with deterministic coded responses
  - added explicit error codes (`invalid_symbol`, `invalid_chain`) for stable client handling

### 2026-06-29 — Batch AH (completed)
- Hardened `bridge-virtual-account` input validation contract:
  - replaced dynamic invalid-currency validation message with deterministic coded response (`invalid_currency`)

### 2026-06-29 — Batch AK (completed)
- Hardened `bridge-virtual-account` denial/error messaging contract:
  - replaced currency-interpolated denial strings with deterministic user-safe messages
  - preserved `currency` and `country` as structured context fields where needed

### 2026-06-29 — Batch AL (completed)
- Hardened `bridge-exchange-rates` input validation contract:
  - replaced generic invalid pair input response with deterministic coded contract (`invalid_pair_input`)
  - returned structured pair context fields (`from`, `to`) for deterministic client handling

### 2026-06-29 — Batch AM (completed)
- Hardened `bridge-bulk-payout` top-level payload validation contract:
  - replaced generic missing payload fields response with deterministic coded contract (`invalid_batch_payload`)

### 2026-06-29 — Batch AN (completed)
- Hardened `bridge-wallet` auth/method/parser edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - aligned wallet endpoint failure shape with other Bridge function contracts

### 2026-06-29 — Batch AO (completed)
- Hardened `bridge-virtual-account` auth/method/parser edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - aligned virtual-account endpoint failure shape with wallet/transfer contracts

### 2026-06-29 — Batch AP (completed)
- Hardened `bridge-external-account` auth/method/parser edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - aligned external-account endpoint edge failures with wallet/virtual-account contracts

### 2026-06-29 — Batch AQ (completed)
- Hardened `bridge-exchange-rates` edge contracts:
  - standardized method/json parser failures with explicit stable error codes
  - aligned exchange-rates endpoint edge failures with broader Bridge function contracts

### 2026-06-29 — Batch AR (completed)
- Hardened `bridge-transfer` auth/method/parser edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - aligned transfer endpoint edge failures with wallet/virtual-account/external-account contracts

### 2026-06-29 — Batch AS (completed)
- Hardened `bridge-bulk-payout` auth/method/parser edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - aligned bulk-payout endpoint edge failures with transfer/wallet contract style

### 2026-06-29 — Batch AT (completed)
- Hardened `bridge-customer` auth/method edge contracts:
  - standardized method/auth failures with explicit stable error codes
  - aligned customer endpoint edge failures with transfer/wallet/virtual-account contract style

### 2026-06-29 — Batch AU (completed)
- Hardened `bridge-kyb-link` edge and profile-contract failures:
  - standardized method/auth failures with explicit stable error codes
  - normalized missing user profile, missing profile email, and incomplete business profile responses
  - removed legacy free-text edge responses to align with deterministic API contracts

### 2026-06-29 — Batch AV (completed)
- Hardened `bridge-kyc-link` edge and profile-contract failures:
  - standardized method/auth failures with explicit stable error codes
  - normalized missing user profile and missing profile email responses
  - removed legacy free-text edge responses to align with deterministic API contracts

### 2026-06-29 — Batch AW (completed)
- Hardened `bridge-sync-accounts` edge contracts:
  - standardized method/auth failures with explicit stable error codes
  - removed legacy free-text edge responses (`POST only`, `Authorization required`)

### 2026-06-29 — Batch AX (completed)
- Hardened `bridge-provision-stablecoins` edge contracts:
  - standardized method/auth failures with explicit stable error codes
  - removed legacy free-text edge responses (`POST only`, `Authorization required`)

### 2026-06-29 — Batch AY (completed)
- Hardened `bridge-sync-customers` edge contracts:
  - standardized method/auth failures with explicit stable error codes
  - removed legacy free-text edge responses (`POST only`, `Unauthorized`)

### 2026-06-29 — Batch AZ (completed)
- Hardened `bridge-webhook` edge validation contracts:
  - standardized method failure with explicit stable error code
  - normalized malformed signature-header, replay-window, and invalid-JSON responses with stable error codes

### 2026-06-29 — Batch BA (completed)
- Hardened `bridge-fx-supported-pairs` edge contracts:
  - standardized method/auth failures with explicit stable error codes
  - removed legacy free-text edge responses (`GET only`, `Authorization required`)

### 2026-06-29 — Batch BB (completed)
- Hardened `bridge-test-webhook` edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - normalized synthetic payload validation failure with a deterministic code

### 2026-06-29 — Batch BC (completed)
- Hardened `bridge-identity-cleanup` edge contracts:
  - standardized method failure with explicit stable error code
  - normalized cleanup secret auth failure with a deterministic code

### 2026-06-29 — Batch BD (completed)
- Hardened `bridge-ping` edge contracts:
  - standardized method/auth failures with explicit stable error codes
  - normalized admin-gate denial with deterministic `admin_only` code

### 2026-06-29 — Batch BE (completed)
- Hardened `bridge-external-account` edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - normalized edge error wording to deterministic contract shape

### 2026-06-29 — Batch BF (completed)
- Hardened `bridge-transfer` edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - normalized edge error wording to deterministic contract shape

### 2026-06-29 — Batch BG (completed)
- Hardened `bridge-wallet` edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - normalized edge error wording to deterministic contract shape

### 2026-06-29 — Batch BH (completed)
- Hardened `bridge-virtual-account` edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - normalized edge error wording to deterministic contract shape

### 2026-06-29 — Batch BI (completed)
- Hardened `bridge-customer` edge contracts:
  - standardized method/auth failures with explicit stable error codes
  - normalized edge error wording to deterministic contract shape

### 2026-06-29 — Batch BJ (completed)
- Hardened `bridge-bulk-payout` edge contracts:
  - standardized method/auth/json failures with explicit stable error codes
  - normalized edge error wording to deterministic contract shape

### 2026-06-29 — Batch BK (completed)
- Hardened `bridge-exchange-rates` edge contracts:
  - standardized method/json failures with explicit stable error codes
  - normalized edge error wording to deterministic contract shape

### 2026-06-29 — Batch BL (completed)
- Hardened `bridge-customer` profile-contract failure:
  - normalized missing user profile response with explicit `profile_not_found` code

### 2026-06-29 — Batch BM (completed)
- Hardened `bridge-transfer` payload validation contracts:
  - normalized missing required transfer fields with explicit `invalid_transfer_payload` code
  - normalized invalid amount format with explicit `invalid_amount_format` code

### 2026-06-29 — Batch BN (completed)
- Hardened `bridge-external-account` delete-path validation contracts:
  - normalized missing external account id with explicit `external_account_id_required` code
  - normalized local ownership miss to deterministic `external_account_not_found` contract

### 2026-06-29 — Batch BO (completed)
- Hardened `bridge-external-account` create-path validation contracts:
  - normalized account-type/owner-field/address validation failures with explicit deterministic error codes
  - normalized provider-missing-id failure with explicit `provider_external_account_id_missing` code

### 2026-06-29 — Batch BP (completed)
- Hardened `bridge-kyb-link` account-type guard contract:
  - normalized wrong-account-type response with deterministic messaging
  - exposed explicit `expected_account_type=business` context field

### 2026-06-29 — Batch BQ (completed)
- Hardened `bridge-kyc-link` account-type guard contract:
  - normalized wrong-account-type response with deterministic messaging
  - exposed explicit `expected_account_type=individual` context field

### 2026-06-29 — Batch BR (completed)
- Hardened `bridge-webhook` downstream-ingest rejection contracts:
  - normalized invalid-signature responses with explicit `invalid_signature` code
  - normalized missing queue confirmation with explicit `queue_confirmation_missing` code

### 2026-06-29 — Batch BS (completed)
- Hardened `bridge-wallet` onboarding-state guard contracts:
  - normalized missing-customer response with explicit `required_state=bridge_customer_created`
  - normalized verification guard response with explicit `expected_verification_status=approved`

### 2026-06-29 — Batch BT (completed)
- Hardened `bridge-virtual-account` onboarding-state guard contracts:
  - normalized missing-customer response with explicit `required_state=bridge_customer_created`
  - normalized verification guard response with explicit `expected_verification_status=approved`

### 2026-06-29 — Batch BU (completed)
- Hardened `bridge-transfer` onboarding-state guard contracts:
  - normalized missing-customer response with explicit `required_state=bridge_customer_created`
  - normalized verification guard response with explicit `expected_verification_status=approved`

### 2026-06-29 — Batch BV (completed)
- Hardened `bridge-external-account` onboarding-state guard contracts:
  - normalized missing-customer response with explicit `required_state=bridge_customer_created`
  - normalized verification guard response with explicit `expected_verification_status=approved`

### 2026-06-29 — Batch BW (completed)
- Hardened `bridge-bulk-payout` onboarding-state guard contracts:
  - normalized missing-customer response with explicit `required_state=bridge_customer_created`
  - normalized verification guard response with explicit `expected_verification_status=approved`

### 2026-06-29 — Batch BX (completed)
- Hardened `bridge-wallet` symbol/chain validation contracts:
  - added explicit `supported_symbols` context on `invalid_symbol`
  - added explicit `supported_chains` context on `invalid_chain`

### 2026-06-29 — Batch BY (completed)
- Hardened `bridge-virtual-account` currency validation contract:
  - added explicit `supported_currencies` context on `invalid_currency`

### 2026-06-29 — Batch BZ (completed)
- Hardened `bridge-ping` operational failure contracts:
  - normalized missing Bridge API key response with explicit `bridge_api_key_missing` code
  - normalized network exception response with explicit `bridge_network_unreachable` code

### 2026-06-29 — Batch CA (completed)
- Hardened `bridge-test-webhook` ingest failure contracts:
  - normalized evaluator reject path with explicit `synthetic_event_rejected` code
  - normalized ingest rejection and non-queued branches with explicit deterministic codes

### 2026-06-29 — Batch CB (completed)
- Hardened `bridge-webhook` RPC ingest failure contract:
  - normalized ingest RPC failure response with explicit `ingest_failed` code

### 2026-06-29 — Batch CC (completed)
- Hardened `bridge-ping` Bridge HTTP failure contract:
  - normalized non-2xx provider response with explicit `bridge_http_error` code

### 2026-06-29 — Batch CD (completed)
- Hardened `bridge-test-webhook` RPC ingest error contract:
  - normalized RPC ingest failure to explicit `synthetic_ingest_failed` code

### 2026-06-29 — Batch CE (completed)
- Hardened `bridge-external-account` account-type validation contract:
  - added explicit `supported_account_types` context on `invalid_account_type`

### 2026-06-29 — Batch CF (completed)
- Hardened `bridge-bulk-payout` payload validation contract:
  - added explicit `required_fields` context on `invalid_batch_payload`

### 2026-06-29 — Batch CG (completed)
- Hardened `bridge-transfer` payload validation contract:
  - added explicit `required_fields` context on `invalid_transfer_payload`

### 2026-06-29 — Batch CH (completed)
- Hardened `bridge-transfer` verification guard messaging:
  - normalized `kyc_not_approved` message to account-type aware wording (KYC vs KYB)

### 2026-06-29 — Batch CI (completed)
- Hardened `bridge-external-account` verification guard messaging:
  - normalized `kyc_not_approved` message to account-type aware wording (KYC vs KYB)

### 2026-06-29 — Batch AI (completed)
- Hardened `bridge-bulk-payout` row-validation contract:
  - replaced dynamic per-row validation strings with deterministic error codes and explicit `row` field
  - normalized malformed row failures (`invalid_batch_row_*`, `duplicate_batch_row_idempotency_key`) for stable client handling

### 2026-06-29 — Batch AJ (completed)
- Hardened `bridge-transfer` unsupported-pair rejection contract:
  - replaced interpolated pair string error text with deterministic user-safe message
  - exposed pair context as structured fields (`source_currency`, `destination_currency`)
