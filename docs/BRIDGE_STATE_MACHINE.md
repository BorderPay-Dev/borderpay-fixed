# Bridge State Machine (BorderPay Canonical)

Date: 2026-06-20
Purpose: Separate Bridge external lifecycle from BorderPay internal processing lifecycle.

## 1) Customer/KYC/KYB Sequence

1. BorderPay requests onboarding (`/customers` or `/kyc_links`).
2. Bridge returns `customer_id` (must be persisted as `bridge_customer_id` immediately).
3. Bridge KYC/KYB progresses (`not_started`, `incomplete`, `under_review`, `approved`, `rejected`, etc.).
4. Bridge emits webhook updates (`kyc_link.*`, `customer.*`).
5. BorderPay updates internal identity projection.
6. On approved status, BorderPay triggers idempotent wallet provisioning workflow (product rule).

Invariant: approved state without `bridge_customer_id` is invalid.

## 2) Wallet Provisioning Sequence

1. Trigger condition: approved KYC/KYB + valid `bridge_customer_id`.
2. BorderPay calls `POST /customers/{customerID}/wallets` with `Idempotency-Key`.
3. Bridge returns wallet (`id`, `chain`, `address`).
4. BorderPay upserts internal projection (`bridge_wallets`) keyed by Bridge wallet id.
5. Retries reuse same idempotency key for exact request.

Invariant: duplicate webhook/retry must not create duplicate wallet projection.

## 3) Virtual Account Sequence

1. BorderPay checks internal eligibility policy.
2. Bridge precondition: customer is onboarded + KYC/KYB approved.
3. BorderPay calls `POST /customers/{customerID}/virtual_accounts` with idempotency key.
4. Bridge returns `status=activated` and deposit instructions.
5. BorderPay stores internal VA projection keyed by Bridge VA id.
6. Bridge emits `virtual_account.activity.*` events; BorderPay updates projection.

Invariant: VA creation must be idempotent and customer-linked.

## 4) Transfer Sequence (Bridge external states)

Core progression:

1. `awaiting_funds`
2. `funds_received`
3. `payment_submitted`
4. `payment_processed` (success terminal)

Exception states:

- `in_review`
- `undeliverable`
- `returned`
- `missing_return_policy`
- `refund_in_flight`
- `refund_failed`
- `refunded`
- `canceled`
- `error`

Invariant: raw Bridge state is always persisted; internal UI/ledger states are a derived projection, never a replacement of provider truth.

## 5) Webhook Processing State Separation

Ingress lifecycle (webhook ingestion domain):

- `received`
- `duplicate`
- `rejected`
- `queued`

Queue lifecycle (internal worker domain):

- `queued`
- `processing`
- `completed`
- `failed`

Invariant: Do not merge ingress and queue states.

