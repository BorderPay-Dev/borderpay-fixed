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
