# Wallet and Virtual Account Integrity Report

- Audited at (UTC): `2026-06-21 06:15:31.109092+00`
- Scope: production, read-only verification
- Data source: `public.bridge_wallets`, `public.bridge_virtual_accounts`, `public.user_profiles`, `public.business_profiles`, `public.wallets`

## Result

`PASS` (no blocker found in wallet/VA ownership and projection integrity)

## Evidence

### Stablecoin Wallets

- `bridge_wallets` rows: `2`
- `bridge_wallets_duplicate_wallet_id`: `0`
- `bridge_wallets_duplicate_active_customer_currency_chain`: `0`
- `bridge_wallets_customer_profile_mismatch`: `0`
- `bridge_wallets_orphan_user_profiles`: `0`
- `bridge_wallets_active_missing_core_fields`: `0`
- `wallets_bridge_wallet_projection_drift`: `0`
- Ownership snapshot: both wallet rows map to one approved customer (`83a6553c-6efe-41e2-adac-f00cde3e08fd`) with unique `(currency, chain)` pairs `USDC/base` and `USDT/tron`.

### Virtual Accounts

- `bridge_virtual_accounts` rows: `1`
- `bridge_virtual_accounts_duplicate_id`: `0`
- `bridge_virtual_accounts_duplicate_active_customer_currency`: `0`
- `bridge_virtual_accounts_customer_profile_mismatch`: `0`
- `bridge_virtual_accounts_orphan_user_profiles`: `0`
- `bridge_virtual_accounts_individual_not_approved`: `0`
- `bridge_virtual_accounts_business_not_approved`: `0`
- `wallets_bridge_va_projection_drift`: `0`
- Ownership snapshot: one active `EUR` VA (`sepa`) mapped to the same approved customer and user as wallet projections.

## Notes

- No ownership ambiguity, no duplicate active projections for same customer/asset key, and no eligibility inconsistency detected in live data.

