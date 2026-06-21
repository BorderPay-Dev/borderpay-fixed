# Financial Invariants Status

- Mode: Production read-only
- Audit timestamp (UTC): 2026-06-21 08:35:22.671414+00

## Invariant Table

1. Queue retry invariant (`queued AND attempts >= max_attempts` must be zero): PASS
- Evidence: `queue_retry_invariant_broken=0`
- Severity: Critical
- Business impact: No stuck-retry rows currently violating queue contract.
- Recommended action: No immediate action.

2. Queue/webhook attribution invariant (no queue orphan): PASS
- Evidence: `queue_orphan_bridge_events=0`
- Severity: High
- Business impact: Financial event lineage remains attributable.
- Recommended action: No immediate action.

3. Queue freshness invariant (no stale processing): PASS
- Evidence: `queue_stale_processing_over_30m=0`
- Severity: High
- Business impact: No active processing deadlock signal.
- Recommended action: No immediate action.

4. Queue due-time invariant (no overdue queued): PASS
- Evidence: `queue_overdue_queued_over_30m=0`
- Severity: High
- Business impact: No delayed queue drain backlog from due events.
- Recommended action: No immediate action.

5. Idempotency invariant (no duplicate Bridge event IDs in logs): PASS
- Evidence: `duplicate_bridge_event_ids=0`
- Severity: Critical
- Business impact: Replay safety remains intact at webhook identity level.
- Recommended action: No immediate action.

6. Wallet uniqueness invariant (no duplicate bridge wallet projection): PASS
- Evidence: `wallet_duplicate_bridge_wallet_id=0`
- Severity: High
- Business impact: No duplicate customer wallet projection.
- Recommended action: No immediate action.

7. VA uniqueness invariant (no duplicate active VA projection): PASS
- Evidence: `wallet_duplicate_bridge_virtual_account_id=0`, `va_duplicate_active_customer_currency=0`
- Severity: High
- Business impact: No duplicate active account representation risk.
- Recommended action: No immediate action.

8. Eligibility invariant for VA ownership: PASS
- Evidence: `va_individual_not_bridge_approved=0`, `va_business_not_bridge_approved=0`
- Severity: Critical
- Business impact: No VA attached to unapproved Bridge identity.
- Recommended action: No immediate action.

9. Transfer projection invariant (Bridge transfer object must map cleanly): PASS
- Evidence: `bridge_transfer_missing_projection=0`, `transaction_bridge_missing_transfer_id=0`
- Severity: Critical
- Business impact: No observed projection linkage break in current dataset.
- Recommended action: Recheck on first non-zero transfer table population.

10. Balance integrity invariant (no unexpected negative wallet balances): PASS
- Evidence: `negative_wallet_balances=0`
- Severity: Critical
- Business impact: No active negative balance anomaly in wallet projections.
- Recommended action: No immediate action.

## Final Status

- Blocker-level invariant failures: 0
- Financial invariants overall: PASS

