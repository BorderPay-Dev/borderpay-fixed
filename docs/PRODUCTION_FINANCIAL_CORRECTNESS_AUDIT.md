# Production Financial Correctness Audit

- Mode: Production read-only
- Timestamp (UTC): 2026-06-21 08:35:22.671414+00
- Data source: linked production Supabase project (`orwrcpwsffjlvzuraxjc`)
- Scope: customer lifecycle, wallets, virtual accounts, deposits/webhooks/queue, transfers, external accounts, reconciliation, invariants

## Executive Result

- Overall blocker status: PASS
- Financial correctness gate decision for this audit: PASS
- Stop condition triggered: NO (no failed financial invariant)

## Findings

1. Customer lifecycle projection integrity: PASS
- Evidence: `user_profiles_with_bridge_customer=5`, `individual_bridge_approved=1`, `business_bridge_approved=0`.
- Severity: Low
- Business impact: Bridge customer linkage and approval projection are consistent for active customer set.
- Recommended action: No immediate action.

2. Stablecoin wallet lifecycle integrity: PASS
- Evidence: `bridge_wallets_total=2`, `wallet_duplicate_bridge_wallet_id=0`, `bridge_wallet_events=0`, `negative_wallet_balances=0`.
- Severity: Low
- Business impact: No duplicate wallet projection or negative-balance anomaly detected.
- Recommended action: Continue periodic read-only drift checks.

3. Virtual account lifecycle integrity and eligibility consistency: PASS
- Evidence: `bridge_virtual_accounts_total=1`, `wallet_duplicate_bridge_virtual_account_id=0`, `va_duplicate_active_customer_currency=0`, `va_individual_not_bridge_approved=0`, `va_business_not_bridge_approved=0`, `bridge_virtual_account_events=2`.
- Severity: Low
- Business impact: VA ownership and eligibility projections are internally consistent.
- Recommended action: No immediate action.

4. Deposit lifecycle (webhook -> queue -> projection) consistency: PASS
- Evidence: `queue_orphan_bridge_events=0`, `queue_stale_processing_over_30m=0`, `queue_overdue_queued_over_30m=0`, `queue_retry_invariant_broken=0`, `bridge_customer_events=28`, `bridge_kyc_events=9`.
- Severity: Low
- Business impact: No queue attribution gaps or active retry invariant breach.
- Recommended action: No immediate action.

5. Transfer lifecycle projection: PASS (with evidence-depth limitation)
- Evidence: `bridge_transfer_events=5`, `bridge_transfers_total=0`, `transactions_provider_bridge_total=0`, `bridge_transfer_missing_projection=0`, `transaction_bridge_missing_transfer_id=0`.
- Severity: Medium
- Business impact: No active inconsistency, but no materialized Bridge transfer objects currently exist in production tables to prove full transfer projection behavior from live object creation.
- Recommended action: Re-run this audit immediately after first non-zero `bridge_transfers` production object.

6. External account lifecycle projection: PASS (with evidence-depth limitation)
- Evidence: `bridge_external_account_events=0`, `bridge_external_accounts_total=0`, `bridge_external_account_orphan_user=0`.
- Severity: Medium
- Business impact: No active inconsistency, but lifecycle path lacks current production volume evidence.
- Recommended action: Re-run after first external account create/update sequence appears.

7. Reconciliation and idempotency invariants: PASS
- Evidence: `duplicate_bridge_event_ids=0`, `queue_retry_invariant_broken=0`, `bridge_transfer_missing_projection=0`, `negative_wallet_balances=0`.
- Severity: Low
- Business impact: No blocker-level evidence of duplicate financial effects, projection drift, or idempotency regression.
- Recommended action: Keep unified predeploy gate mandatory.

## Conclusion

All blocker-level financial invariants validated in this production read-only sweep are passing.

