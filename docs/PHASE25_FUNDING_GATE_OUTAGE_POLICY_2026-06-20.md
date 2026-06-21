# Phase 2.5 – Funding Gate Outage Policy (Bridge-first)

Date (UTC): 2026-06-20
Scope: Eligibility behavior when Bridge wallet balance verification is unavailable.
Constraints honored: no schema changes, no production writes, no deployments.

## Invariant
Funding eligibility must use **only verified Bridge stablecoin wallet balances**.

Never allowed:
- VA balances for threshold eligibility
- synthetic FX assumptions
- inferred balances

## Options Evaluated

## Option A — Fail Closed
If Bridge balance verification fails:
- return `503 funding_balance_unavailable`
- deny eligibility decision
- instruct retry
- no cached assumptions

### Risk Profile
- Fraud risk: **LOWEST**
- UX impact: **MEDIUM/HIGH** during provider incident
- Operational impact: **MEDIUM** (support load spikes on outage)
- Reconciliation impact: **LOWEST** (no speculative approvals)

## Option B — Grace Window (cached)
Allow cached balance only with strict cache-age/integrity constraints.

### Risk Profile
- Fraud risk: **HIGHER** (stale balance may permit unfunded access)
- UX impact: **LOWER** during outage
- Operational impact: **HIGHER** (cache coherence + invalidation burden)
- Reconciliation impact: **HIGHER** (post-incident drift correction)

## Recommendation (BorderPay)
**Recommend Option A (Fail Closed)** for production safety.

Reason:
- BorderPay’s current runtime has no dedicated, integrity-verified balance cache primitive suitable for financial gating.
- Fail-closed preserves financial correctness under uncertainty.
- Prevents silent risk transfer from availability to reconciliation/fraud domains.

## Implemented Behavior
- `FUNDING_OUTAGE_POLICY` default is `fail_closed`.
- Provider verification failure returns 503 `funding_balance_unavailable`.
- Gate continues to count only Bridge stablecoin wallet balances.

## PASS/FAIL Findings

### G1 Explicit outage policy exists
- Status: **PASS**
- Evidence: `FUNDING_OUTAGE_POLICY` constant in gate.
- Business impact: deterministic behavior during incidents.
- Technical impact: removes ambiguous error handling.
- Deployment risk: Low.
- Rollback: revert policy constant and catch branch.

### G2 Default fail-closed
- Status: **PASS**
- Evidence: default policy set to `fail_closed`.
- Business impact: protects financial correctness.
- Technical impact: no dependency on cache correctness.
- Deployment risk: Low.
- Rollback: switch env policy only (if needed later).

### G3 Outage response contract
- Status: **PASS**
- Evidence: `503` with `funding_balance_unavailable` + retry guidance.
- Business impact: transparent user/system behavior.
- Technical impact: supports explicit retry semantics.
- Deployment risk: Low.
- Rollback: none.

### G4 Disallowed sources excluded
- Status: **PASS**
- Evidence: no VA balance path and no FX conversion map in gate.
- Business impact: threshold integrity preserved.
- Technical impact: reduced logic complexity and drift.
- Deployment risk: Low.
- Rollback: would reintroduce correctness risk.

## Evidence
- Audit: `tests/audit/funding_gate_outage_policy_audit.py` -> PASS (5/5)
- Runtime location: `supabase/functions/_shared/funding-gate.ts`

## Decision
For BorderPay, fail-closed is the safest production policy until a dedicated cryptographically/verifiably fresh balance cache design is introduced.
