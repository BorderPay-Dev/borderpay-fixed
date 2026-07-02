# BorderPay Provider Conformance Matrix (Bridge + Flutterwave)
Date: 2026-06-29
Scope: `borderpay-fixed` (main app + edge functions in this repo)
Mode: **No deploy**

## 1) Source-of-truth contract (locked)
- `Receive` = inbound rails -> wallet balances.
- `FX` = wallet -> wallet conversion only.
- `Send/Payout` = wallet -> external destination.
- UI must only expose rails/pairs that are executable by provider-backed backend policy.

## 2) Bridge conformance (current)
Implemented Bridge-backed edge functions in this repo:
- `bridge-customer`
- `bridge-kyc-link`
- `bridge-kyb-link`
- `bridge-wallet`
- `bridge-virtual-account`
- `bridge-external-account`
- `bridge-transfer`
- `bridge-bulk-payout`
- `bridge-exchange-rates`
- `bridge-webhook`
- `bridge-sync-accounts`
- `bridge-sync-customers`

Bridge provider adapter currently calls documented `/v0` APIs:
- Customers
- KYC links
- Wallets
- Virtual accounts
- Transfers

File reference:
- [bridge.ts](/Users/a/Downloads/borderpay-fixed/supabase/functions/_shared/providers/bridge.ts)

## 3) Flutterwave conformance (current)
Current production-coded Flutterwave surface in this repo:
- `flutterwave-capabilities`
- `flutterwave-account-resolve`
- `flutterwave-transfer-create`
- `flutterwave-transfer-status`
- `flutterwave-transfers-list`
- `flutterwave-transfer-rates`
- `flutterwave-collection-create`
- `flutterwave-collection-status`
- `flutterwave-collections-list`
- `flutterwave-fee-quote`
- `flutterwave-webhook`

Admin/runtime support modules present:
- `admin-flutterwave-webhook-events`
- `admin-flutterwave-webhook-event-detail`
- `admin-flutterwave-webhook-metrics`
- `admin-flutterwave-webhook-replay`
- `admin-flutterwave-webhook-replay-batch`
- `admin-flutterwave-webhook-cleanup`
- `admin-flutterwave-projection-audit`
- `admin-flutterwave-projection-repair`
- `admin-flutterwave-incident-runbook`

Current implication:
- Flutterwave execution and reconciliation paths are implemented in backend.
- Corridor exposure remains fail-closed by capability flags and policy gating.
- UI rollout should remain gated until runtime corridor validation is complete.

## 4) Runtime drift found (P0/P1)
`backendAPI.ts` references edge endpoints not present under `supabase/functions`:
- `check-account-status`
- `fetch-bank-details`
- `get-accounts`
- `get-address`
- `get-customer-transactions`
- `get-fx-history`
- `get-institutions`
- `get-transfers`
- `resolve-account`
- `suspend-user`
- `update-security-status`
- `update-user-profile`
- `verify-transaction`
- `verify-transfer`

Risk:
- These references can cause latent runtime failures when corresponding UI paths are hit.

Primary file:
- [backendAPI.ts](/Users/a/Downloads/borderpay-fixed/utils/api/backendAPI.ts)

## 5) Strict no-assumption patch order
1. Remove or hard-quarantine dead endpoint callers in `backendAPI.ts`.
2. Keep only Bridge-backed execution paths enabled for money movement.
3. Add Flutterwave execution only after endpoint-by-endpoint doc conformance is mapped:
   - collections
   - payouts
   - webhooks
   - idempotency
   - settlement/retries/error model
4. Gate UI choices by backend-supported capabilities/pairs; never hardcode provider assumptions.

## 6) Next deliverables (no deploy)
1. Endpoint-level Bridge matrix: App flow -> Edge function -> Bridge endpoint.
2. Endpoint-level Flutterwave matrix: planned App flow -> Edge function -> Flutterwave endpoint.
3. Drift cleanup patch in `backendAPI.ts` (remove dead calls, keep compatibility shims only where needed).
