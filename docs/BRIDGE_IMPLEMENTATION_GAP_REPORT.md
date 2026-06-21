# Bridge Implementation Gap Report

Date: 2026-06-20
Scope: Phase 3A - Bridge Specification Validation (documentation-only, no production changes)

## Method

- Reviewed latest Bridge docs from `https://apidocs.bridge.xyz/llms.txt`.
- Validated failed audit findings against Bridge API reference and platform guides.
- Compared Bridge-documented behavior with current BorderPay implementation and product rules.

## Finding 1 - Funding Gate (Bridge validation)

### Bridge-documented facts

- Bridge wallet balances are exposed as decimal strings and are asset + chain specific (`balance`, `currency`, `chain`) in wallet balance responses.
- Bridge supports multiple chains and stablecoins (for example USDC, USDT, USDB, EURC, PYUSD depending on chain).
- Bridge precision model is cent-based for processing; API amounts are still represented as decimal strings.
- Virtual account creation requirement in docs is KYC/KYB-approved customer. Bridge does not define a required pre-funding threshold for creating a virtual account.

### Gap vs BorderPay

- BorderPay policy requires stablecoin funding threshold ($20 individual / $100 business) before VA request.
- This threshold is a product/business rule, not a Bridge requirement.
- Current code uses mixed sources (`bridge_virtual_account_balances` + optional `bridge_wallet_balances`) and static 1:1 FX assumptions, which is not aligned with the product rule of stablecoin-wallet-based gating.

### Conclusion

- Bridge does not mandate stablecoin-threshold gating.
- BorderPay may enforce stricter eligibility, but must compute it from Bridge wallet balances (asset + chain aware) and avoid fabricated FX conversions.

## Finding 2 - Wallet Auto Provisioning (Bridge validation)

### Bridge-documented facts

- Bridge wallet creation is explicit via `POST /customers/{customerID}/wallets` (requires `Idempotency-Key`).
- Bridge does not document automatic wallet creation as a side effect of KYC/KYB approval.
- Idempotency on POST is guaranteed for 24 hours for exact request retries.

### Gap vs BorderPay

- BorderPay product requires automatic wallet provisioning after successful KYC/KYB.
- Current webhook KYC handlers update statuses but do not guarantee automatic wallet creation.

### Conclusion

- Auto-provisioning must be implemented by BorderPay runtime orchestration.
- It should be idempotent and retry-safe using stable idempotency keys and dedupe in local projection.

## Finding 3 - Bridge Customer Linkage (Bridge validation)

### Bridge-documented facts

- KYC link creation returns a `customer_id`.
- Customer status and endorsements represent onboarding/transacting readiness.
- KYC lifecycle is managed through kyc link/customer status and webhooks.

### Canonical interpretation for BorderPay

- `bridge_customer_id` should be persisted immediately when Bridge returns it (customer create or kyc_link create).
- KYC/KYB status updates should be tied to that canonical customer identity.
- Downstream flows (wallet provisioning, VA requests, transfers) should never run without a linked `bridge_customer_id`.

### Gap

- Live audit evidence showed approved profiles with null `bridge_customer_id`, which violates sequence integrity.

## Finding 4 - Transfer State Mapping (Bridge validation)

### Bridge-documented facts

Official transfer states include:

- `awaiting_funds`
- `in_review`
- `funds_received`
- `payment_submitted`
- `payment_processed`
- `undeliverable`
- `returned`
- `missing_return_policy`
- `refunded`
- `refund_in_flight`
- `refund_failed`
- `canceled`
- `error`

Bridge docs also state normal progression is forward (`awaiting_funds -> funds_received -> payment_submitted -> payment_processed`) and exception states exist for failures/returns.

### Gap

- Current implementation normalizes a legacy subset and can collapse unknown Bridge states to pending.

### Conclusion

- BorderPay must preserve raw Bridge state and map all documented states explicitly.

## Finding 5 - Webhook Coverage (Bridge validation)

### Bridge-documented facts

Webhook categories include:

- `customer`
- `kyc_link`
- `liquidation_address.drain`
- `static_memo.activity`
- `transfer`
- `virtual_account.activity`
- `bridge_wallet.activity`
- `card_account`
- `card_transaction`
- `posted_card_account_transaction`
- `card_withdrawal`
- `external_account`

Event types are mutation variants like `created`, `updated`, `updated.status_transitioned`, `deleted` (where applicable).

### Gap

- BorderPay router handles `virtual_account.*`, `transfer.*`, `customer.*`, `kyc_link.*`, and `wallet.*`, but not explicit `bridge_wallet.activity.*`.
- Unknown events are completed safely (good), but missing explicit `bridge_wallet.activity` mapping risks dropping intended wallet projection updates.

## Finding 6 - Stablecoin Wallet Model (Bridge validation)

### Bridge-documented facts

- Wallet identity: wallet `id`, `chain`, `address`.
- Balances are returned with `currency`, `chain`, `balance` (decimal string).
- Wallet history includes event-level amounts and post-event `available_balance`.
- Multi-chain and multi-asset are first-class.

### Gap

- BorderPay projection should mirror minimal required subset but must remain chain+asset specific; simplistic single-number wallet assumptions are unsafe.

## Finding 7 - Virtual Account Lifecycle (Bridge validation)

### Bridge-documented facts

- VA creation requires customer to be onboarded/KYC-KYB approved.
- VA creation uses explicit API call with idempotency key.
- VA activity has its own event lifecycle.

### Gap

- BorderPay’s additional funding threshold gate is product-defined (not Bridge-defined) and must be consistently enforced internally.
- Eligibility must remain internal; Bridge only sees valid create request once BorderPay invariants pass.

## Recommended Implementation Order (confirmed)

1. Financial correctness
2. Bridge lifecycle alignment
3. Wallet provisioning
4. Funding gate
5. Transfer state mapping
6. Reconciliation
7. Queue correctness
8. Permission hardening

