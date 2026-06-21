# Bridge Financial Invariants

Date: 2026-06-20
Goal: Conditions required before BorderPay can safely move real customer money.

## 1. Identity and Customer Linkage

1. Every KYC/KYB-approved internal profile must have non-null `bridge_customer_id`.
2. No wallet/VA/transfer operation may execute without canonical Bridge customer linkage.

## 2. Wallet Invariants

1. Wallet provisioning must be idempotent (same trigger cannot create duplicates).
2. Wallet projection keys must be Bridge wallet IDs.
3. Balance tracking must remain chain + asset specific.

## 3. Funding Gate Invariants

1. BorderPay threshold policy is product-defined, not Bridge-defined.
2. If enforced, threshold must be computed from Bridge wallet balances, not from unrelated projections.
3. No synthetic FX shortcuts for compliance/business gates.

## 4. Virtual Account Invariants

1. Bridge KYC/KYB-approved customer required before VA creation.
2. VA request must be idempotent.
3. One Bridge VA id maps to one internal VA projection row.
4. VA lifecycle updates are driven by Bridge events, not ad hoc local status.

## 5. Transfer Invariants

1. Raw Bridge transfer state is always stored.
2. Internal transaction status must be a deterministic mapping from full Bridge state set.
3. Duplicate transfer webhooks must not duplicate financial effects.
4. Reconciliation exceptions must be explicit and observable.

## 6. Webhook and Queue Invariants

1. Signature verification and replay window checks are mandatory.
2. Ingest and enqueue must be atomic.
3. Unknown events are safely logged and terminally completed without side effects.
4. Queue retries must be bounded and cannot remain queued above max attempts.

## 7. Projection Integrity Invariants

1. `bridge_transfers` and public transaction projection must not diverge silently.
2. Reconciliation status fields must exist wherever runtime writes reconciliation metadata.
3. Schema/runtime contracts must be verified pre-deploy.

## 8. Release Gate Rule

Production money movement is blocked unless all invariants pass with live evidence.

