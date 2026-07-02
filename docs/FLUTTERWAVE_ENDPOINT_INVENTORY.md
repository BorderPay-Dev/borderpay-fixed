# Flutterwave Endpoint Inventory (Runtime)
Date: 2026-07-02  
Scope: `borderpay-fixed` backend runtime paths only

## App API -> Edge Function -> Provider Endpoint

| BorderPay API Surface (`backendAPI.ts`) | Edge Function | Provider Endpoint(s) | Mode |
|---|---|---|---|
| `payouts.capabilities(action=health)` | `flutterwave-capabilities` | `GET /v3/payment-methods` (health probe) | Read-only |
| `payouts.capabilities(action=payment_methods)` | `flutterwave-capabilities` | `GET /v3/payment-methods` | Read-only |
| `payouts.listBanks(country)` | `flutterwave-capabilities` | `GET /v3/banks?country={ISO2}` | Read-only |
| `payouts.listMobileNetworks(country)` | `flutterwave-capabilities` | `GET /v3/mobile-networks?country={ISO2}` | Read-only |
| `payouts.resolveAccount(...)` | `flutterwave-account-resolve` | `POST /v3/accounts/resolve` | Read-only validation |
| `payouts.transferRates(...)` | `flutterwave-transfer-rates` | `GET /v3/transfers/rates` | Read-only quote |
| `payouts.createTransfer(...)` | `flutterwave-transfer-create` | `POST /v3/transfers` | Money-out execution |
| `payouts.transferStatus(transfer_id)` | `flutterwave-transfer-status` | `GET /v3/transfers/{id}` | Post-execution status |
| `payouts.transfersList(filters)` | `flutterwave-transfers-list` | `GET /v3/transfers` | Post-execution status/list |
| `payouts.createCollection(...)` | `flutterwave-collection-create` | `POST /v3/charges` (configurable by env) | Money-in execution |
| `payouts.collectionStatus(collection_id)` | `flutterwave-collection-status` | `GET /v3/charges/{id}` (configurable by env) | Post-execution status |
| `payouts.collectionsList(filters)` | `flutterwave-collections-list` | `GET /v3/charges` (configurable by env) | Post-execution status/list |
| Provider webhook ingress | `flutterwave-webhook` | inbound provider webhook | Reconciliation |

## Runtime Guardrails (Enforced)

- Corridor policy (country/currency) enforced server-side.
- Business account context requires `business_profiles` presence.
- Static-IP fail-closed for money movement:
  - `FLW_STATIC_IP_REQUIRED=true`
  - `FLW_STATIC_IP_READY=false` blocks create transfer/collection.
- Webhook replay-window enforcement with keyed override.
- Webhook processing gated by `FLW_WEBHOOK_ENABLED`.

## Notes

- No UI route calls provider endpoints directly.
- Flutterwave execution remains backend-gated and corridor-policy controlled.
- FX remains Bridge-owned and is not routed through Flutterwave execution paths.

