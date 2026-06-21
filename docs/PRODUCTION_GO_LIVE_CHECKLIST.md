# Production Go-Live Checklist (Financial Correctness Gate)

- Scope: Financial correctness only (production read-only evidence)
- Timestamp: 2026-06-21

## Checklist

1. Customer lifecycle linkage to Bridge: PASS
- Evidence: `user_profiles_with_bridge_customer=5`; Bridge customer/kyc webhook traffic present (`customer.*=28`, `kyc_link.*=9`).
- Severity if failed: Critical
- Business impact if failed: customer identity and compliance mismatch.
- Recommended action: none.

2. Stablecoin wallet lifecycle correctness: PASS
- Evidence: `bridge_wallets_total=2`, duplicates `0`, orphan ownership `0`.
- Severity if failed: Critical
- Business impact if failed: wallet ownership ambiguity and funding errors.
- Recommended action: none.

3. Virtual account lifecycle correctness: PASS
- Evidence: `bridge_virtual_accounts_total=1`, duplicate active VA invariants `0`, non-approved owner invariants `0`.
- Severity if failed: Critical
- Business impact if failed: account issuance to ineligible users.
- Recommended action: none.

4. Deposit/webhook/queue consistency: PASS
- Evidence: queue invariants all `0` (`orphan`, `stale`, `overdue`, `retry-broken`).
- Severity if failed: Critical
- Business impact if failed: dropped or duplicated financial event effects.
- Recommended action: none.

5. Transfer lifecycle correctness: PASS (evidence-depth limited)
- Evidence: transfer webhook activity exists (`transfer.*=5`) with no projection drift indicators (`bridge_transfer_missing_projection=0`, `transaction_bridge_missing_transfer_id=0`), but table volume currently zero.
- Severity if failed: Critical
- Business impact if failed: incorrect customer-visible transfer state or reconciliation breaks.
- Recommended action: mandatory re-audit on first non-zero `bridge_transfers` object.

6. External account lifecycle correctness: PASS (evidence-depth limited)
- Evidence: no external account objects/events currently (`0`), no orphan projection.
- Severity if failed: High
- Business impact if failed: payout routing/account ownership risk.
- Recommended action: mandatory re-audit on first external account lifecycle event.

7. Reconciliation and idempotency invariants: PASS
- Evidence: duplicate event IDs `0`, negative balances `0`, queue retry broken `0`.
- Severity if failed: Critical
- Business impact if failed: double-apply or missing-apply financial effects.
- Recommended action: none.

8. Queue runtime contract stability: PASS
- Evidence: production function hashes unchanged for `claim_pending_events`, `complete_pending_event`, `fail_pending_event`, `reap_stuck_processing`.
- Severity if failed: Critical
- Business impact if failed: queue state-machine regressions.
- Recommended action: none.

## Go/No-Go Decision

- Financial correctness blocker detected: NO
- Gate decision: GO for next stage preparation
- Next stage allowed by this checklist: permission hardening and least-privilege enforcement
- Constraint: re-run this checklist immediately after first production transfer/external-account object creation to close evidence-depth gap.

