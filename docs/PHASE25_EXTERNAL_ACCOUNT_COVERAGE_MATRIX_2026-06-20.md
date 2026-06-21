# Phase 2.5 – External Account Coverage Matrix (Bridge)

Date (UTC): 2026-06-20
Scope: Bridge external account webhook lifecycle coverage.
Constraints honored: no schema changes, no production writes, no deployments.

## Bridge Taxonomy (validated)
- Webhook category includes external account events.
- Current Bridge changelog indicates support for created/updated in external account webhooks.

## Runtime Mapping

| Event pattern | Status | Behavior |
|---|---|---|
| `external_account.created` | PASS | Resolve owner by `bridge_customer_id`, upsert `bridge_external_accounts`, complete event |
| `external_account.updated` | PASS | Same as above, updates status/active/metadata |
| `external_account.deleted` | PASS (defensive) | Marks projection `status` and `active` based on payload/event type |
| malformed (missing external account id) | PASS | Safe-complete with `skipped=missing_external_account_id` |
| malformed (missing customer id) | PASS | Safe-complete with `skipped=missing_customer_id` |
| unknown external_account subtypes | PASS | Completes with observability summary; does not block queue |

## PASS/FAIL Findings

### E1 Router coverage
- Status: **PASS**
- Evidence: `processBridgeEvent` routes `external_account.*` to `handleBridgeExternalAccount`.
- Business impact: lifecycle changes reflected in BorderPay projection.
- Technical impact: prevents silent drop of valid provider events.
- Deployment risk: Low.
- Rollback: remove router branch.

### E2 Projection updates
- Status: **PASS**
- Evidence: upsert into `public.bridge_external_accounts` on handler path.
- Business impact: payout destination state remains consistent with provider.
- Technical impact: idempotent upsert by `bridge_external_account_id`.
- Deployment risk: Low.
- Rollback: revert handler writes.

### E3 Ownership resolution
- Status: **PASS**
- Evidence: uses `resolveOwnerFromBridgeCustomer` and fails closed if mapping ambiguous/missing.
- Business impact: prevents cross-customer contamination.
- Technical impact: retains identity invariant.
- Deployment risk: Medium (depends on identity data hygiene).
- Rollback: none recommended.

### E4 Unknown/malformed safety
- Status: **PASS**
- Evidence: malformed events are completed safely with explicit skip reason.
- Business impact: unrelated queue throughput unaffected.
- Technical impact: no poison-pill behavior.
- Deployment risk: Low.
- Rollback: none.

## Evidence
- Audit: `tests/audit/external_account_webhook_coverage_audit.py` -> PASS (4/4)
- Envelope audit updated for six handlers: PASS (10/10)

## Residual Risk
- Bridge may add new external-account subtypes; current behavior is safe-complete + observable, but not fully semantic for unknown subtypes.

## Decision
External account webhook coverage is now production-safe at runtime semantics level, pending deployment.
