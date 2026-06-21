# Bridge Data Flow

Date: 2026-06-20
Objective: Define canonical Bridge -> BorderPay flow without schema changes.

## A. Customer and Identity Flow

1. BorderPay initiates customer onboarding via Bridge.
2. Bridge returns `customer_id`.
3. BorderPay persists `bridge_customer_id` in internal profile.
4. Bridge hosted KYC/KYB flow runs.
5. Bridge emits webhook events for status changes.
6. BorderPay projects status to internal profile tables.

Critical boundary:

- Bridge is source-of-truth for compliance status.
- BorderPay is source-of-truth for internal UX eligibility state.

## B. Wallet Flow

1. Trigger: internal rule detects approved KYC/KYB + linked customer.
2. BorderPay calls Bridge wallet create endpoint (idempotent POST).
3. Bridge returns wallet identity (`id`, `chain`, `address`).
4. BorderPay upserts into `bridge_wallets`.
5. Balance/history are refreshed from Bridge wallet APIs and webhooks.

## C. Virtual Account Flow

1. BorderPay evaluates product eligibility gate.
2. If eligible, BorderPay calls Bridge create virtual account (idempotent POST).
3. Bridge returns VA + deposit instructions.
4. BorderPay stores normalized projection for UI.
5. `virtual_account.activity.*` updates projection and related customer-facing balances/notifications.

## D. Transfer Flow

1. BorderPay creates transfer with idempotency key.
2. Bridge transfer enters lifecycle states.
3. Bridge webhook notifies state transitions.
4. BorderPay projects raw state + internal derived status.
5. Reconciliation verifies projection consistency and attribution.

## E. Webhook/Queue Flow

1. Webhook receiver verifies signature + replay window.
2. Atomic ingest stores event and enqueues processing.
3. Queue worker claims event.
4. Handler updates projection tables.
5. Event completes or fails with explicit terminal state.

Observability requirements:

- every event has audit trail
- no silent drops
- retry-safe idempotent handlers

