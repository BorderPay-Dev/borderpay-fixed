# Phase 1 Report - Customer Identity Invariant

Date: 2026-06-20
Status: FAIL (runtime hardening complete; live data backfill pending)

## Invariant

Every approved KYC/KYB entity must always have:

- `bridge_customer_id`
- valid ownership mapping to exactly one local owner
- customer projection integrity before any downstream money operation

## Design review summary

Root risks identified:

1. Downstream endpoints independently checked `bridge_customer_id` and status, but did not verify ownership ambiguity/cross-user mapping.
2. Worker owner-resolution could silently choose one row when duplicate mappings existed.
3. Approved-without-customer data anomalies were not surfaced as explicit invariant failures.

Chosen design:

- Add one shared guard (`loadAndAssertBridgeIdentityInvariant`) and reuse it in all downstream Bridge money/provisioning entry points.
- Fail closed with explicit `identity_invariant_violation` when invariant is broken.
- Harden webhook worker owner resolution to throw on ambiguous owner mappings.

## Implementation

### Added

- `supabase/functions/_shared/bridge-identity-invariant.ts`

### Updated endpoints (guarded by shared invariant)

- `supabase/functions/bridge-transfer/index.ts`
- `supabase/functions/bridge-bulk-payout/index.ts`
- `supabase/functions/bridge-wallet/index.ts`
- `supabase/functions/bridge-virtual-account/index.ts`
- `supabase/functions/bridge-external-account/index.ts`
- `supabase/functions/bridge-provision-stablecoins/index.ts`

### Worker hardening

- `supabase/functions/process-pending-events/index.ts`
  - `resolveOwnerFromBridgeCustomer()` now fails on ambiguous mappings instead of silently selecting one owner.

## Tests executed

1. `python3 tests/audit/customer_identity_invariant_phase1_audit.py` - PASS
2. `python3 tests/audit/bridge_ingest_event_audit.py` - PASS
3. `python3 tests/audit/bridge_webhook_signature_audit.py` - PASS
4. `python3 tests/audit/kyc_terminal_propagation_audit.py` - PASS

## Live read-only verification evidence

1. Approved entities missing customer id:

- `user_profiles`: approved_total=3, approved_without_customer=2
- `business_profiles`: approved_total=1, approved_without_customer=1

2. Ambiguous bridge customer ownership:

- `duplicate_bridge_customer_ids`: 0

3. Business profile/customer mismatch:

- `business_profile_customer_mismatch`: 0

## Pass/Fail

- Guarding logic in code: PASS
- Worker ambiguity hardening: PASS
- Production pass criterion (`zero approved entities without bridge_customer_id`): FAIL

Overall Phase 1: FAIL (cannot advance to Phase 2 yet).

## Root cause of fail

Historical data drift in production: approved KYC/KYB rows exist without `bridge_customer_id`.

## Remaining risk

- Existing approved-but-unlinked entities remain blocked for downstream operations.
- Incident handling burden remains until data is repaired.

## Rollback strategy

Low-risk code rollback (if needed):

1. Revert commits touching the seven guarded functions + shared helper.
2. Redeploy reverted edge functions.
3. Re-run the three live read-only identity queries.

No schema changes were introduced in this phase, so rollback is code-only.

## Next required action before Phase 2

Execute a controlled data remediation plan (separate approval) to backfill/repair `bridge_customer_id` for approved entities, then re-run pass-criterion query until both counts are zero.

