# Phase 1 Data Remediation Plan (Customer Identity Invariant)

Date: 2026-06-20
Owner: BorderPay Engineering (CTO gate)
Status: Prepared only (no execution)

## Objective

Clear the Phase 1 blocker:

- `approved` entities with missing `bridge_customer_id` must be reduced to zero.

Pass criterion:

- `user_profiles.bridge_kyc_status='approved' AND bridge_customer_id IS NULL` => `0`
- `business_profiles.bridge_kyb_status='approved' AND bridge_customer_id IS NULL` => `0`

## Why this is high risk

- This is production data mutation.
- Incorrect linkage can route wallets/transfers to wrong customer.
- In no-PITR mode, every write must be reversible manually.

## Safe strategy

Do not "guess" customer IDs.
Repair only when a deterministic Bridge customer mapping exists.
Everything else must be downgraded from `approved` to a re-verification state and queued for operator review.

## Step 0 - Pre-checks (read-only)

1. Snapshot candidate rows.
2. For each candidate, gather any deterministic mapping signal:
   - existing `bridge_kyc_link_id` / `bridge_kyb_link_id` + corresponding webhook linkage
   - historical pending_events payload customer IDs for same user
   - any existing Bridge projection rows already tied to user (`bridge_wallets`, `bridge_virtual_accounts`) if present
3. Classify candidates:
   - `deterministic_link` (safe to backfill)
   - `non_deterministic` (unsafe to backfill)

## Step 1 - Deterministic backfill only

For `deterministic_link` rows:

- Set `bridge_customer_id` to verified value.
- Keep `approved` status unchanged.
- Write audit trail row to remediation log table/file (user_id, old/new, source evidence).

## Step 2 - Fail-safe downgrade for unresolved rows

For unresolved rows:

- downgrade `approved` -> `pending` (or `under_review`, depending on operational policy)
- set remediation flag for re-onboarding flow
- do not allow downstream operations

Rationale:

- Safer to block than mis-attribute funds.

## Step 3 - Post checks

1. Re-run pass criterion counts.
2. Re-run ownership ambiguity checks.
3. Re-run business/user profile consistency checks.
4. Re-run queue + webhook health spot checks.

## Rollback plan (manual)

Before execution:

- export exact pre-change rows to a local JSON/CSV artifact with timestamp.

If rollback needed:

- replay previous values for mutated rows using captured artifact.
- re-run all post checks.

## Execution guardrails

1. Single transaction per cohort (small batches).
2. Stop on first error.
3. Operator sign-off required before each mutation step.
4. No schema changes in this phase.

## Artifacts prepared

- `scripts/incident/phase1_identity_invariant_precheck.sql` (read-only classification queries)
- `scripts/incident/phase1_identity_invariant_repair_template.sql` (template only; contains placeholders and explicit STOP points)

## Out of scope for this phase

- Wallet provisioning invariant
- Funding gate replacement
- transfer state machine
- provider/maplerad cleanup

