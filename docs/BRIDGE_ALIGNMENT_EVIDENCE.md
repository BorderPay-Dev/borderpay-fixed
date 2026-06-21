# Bridge Alignment Evidence

- Mode: Production read-only + runtime code inspection
- Timestamp (UTC): 2026-06-21

## Alignment Decision

- Bridge-only financial infrastructure alignment: PASS
- Blocker-level misalignment detected: NO

## Evidence Matrix

1. Customer lifecycle alignment: PASS
- Evidence: Bridge-origin customer and KYC/KYB webhook activity is present (`customer.*=28`, `kyc_link.*=9`), with Bridge customer linkage in profiles (`user_profiles_with_bridge_customer=5`).
- Severity: Low
- Business impact: BorderPay customer projection remains tied to Bridge customer identity.
- Recommended action: No immediate action.

2. Wallet lifecycle alignment: PASS
- Evidence: Bridge wallet projection table active (`bridge_wallets_total=2`); no duplicate wallet projection (`wallet_duplicate_bridge_wallet_id=0`); no orphan wallet ownership (`bridge_wallet_orphan_user=0`).
- Severity: Low
- Business impact: Wallet ownership and projection remain consistent with Bridge model.
- Recommended action: No immediate action.

3. Virtual account lifecycle alignment: PASS
- Evidence: Bridge VA projection active (`bridge_virtual_accounts_total=1`), no duplicate active VA by customer/currency (`va_duplicate_active_customer_currency=0`), no non-approved Bridge owner attached to VA (`va_individual_not_bridge_approved=0`, `va_business_not_bridge_approved=0`).
- Severity: Low
- Business impact: VA issuance remains gated by Bridge verification state.
- Recommended action: No immediate action.

4. Funding gate alignment: PASS
- Evidence (runtime): `supabase/functions/_shared/funding-gate.ts` enforces stablecoin-wallet-based checks, fail-closed behavior, and no VA-balance/FX fabrication path.
- Severity: Low
- Business impact: Product eligibility rule remains Bridge-balance anchored.
- Recommended action: No immediate action.

5. Transfer lifecycle alignment: PASS (limited by current production volume)
- Evidence: Transfer webhook traffic exists (`transfer.*=5`) but no materialized transfer rows currently (`bridge_transfers_total=0`, `transactions_provider_bridge_total=0`). Runtime canonical mapper exists in `supabase/functions/_shared/bridge-transfer-state.ts` and ingest wiring in `supabase/functions/process-pending-events/index.ts`.
- Severity: Medium
- Business impact: No observed drift, but live object-level proof is pending first non-zero transfer population.
- Recommended action: Re-run transfer alignment checks at first live transfer object creation.

6. External account lifecycle alignment: PASS (limited by current production volume)
- Evidence: No external account events/objects yet (`external_account.*=0`, `bridge_external_accounts_total=0`) and no orphan records (`bridge_external_account_orphan_user=0`). Runtime handler path exists in `supabase/functions/process-pending-events/index.ts`.
- Severity: Medium
- Business impact: No active misalignment, but lifecycle evidence depth is currently limited by zero production volume.
- Recommended action: Re-run alignment checks after first external account lifecycle event.

7. Queue/runtime contract stability for Bridge processing: PASS
- Evidence: queue function hashes unchanged in production:
  - `claim_pending_events=4764733c0043a9f955ef2d3963973aa7`
  - `complete_pending_event=cbbcbf6e05a03bc8c4b9d6dd08737097`
  - `fail_pending_event=de89d859e2a248290f8cadadc719815d`
  - `reap_stuck_processing=09e7a27d19b7a6f1309c5c0b6b99c04d`
- Severity: Low
- Business impact: Queue behavior remains on validated production contract.
- Recommended action: No immediate action.

## Conclusion

Bridge remains the active financial infrastructure provider in production runtime and projection behavior, with no blocker-level misalignment detected.

