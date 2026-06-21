# Financial Projection Integrity Report

- Rerun timestamp (UTC): `2026-06-21 08:16:32.166672+00`
- Scope: production read-only verification after committed incident cleanup

## Result

`PASS`

## Evidence

- Target historical synthetic row removed from all three queue mirrors:
  - `pending_events = 0`
  - `webhook_logs = 0`
  - `bridge_webhook_events = 0`
- Queue invariant:
  - `queued AND attempts >= max_attempts = 0`
- Projection integrity checks (rerun):
  - `wallets_bridge_wallet_projection_drift = 0`
  - `wallets_bridge_va_projection_drift = 0`
  - `wallets_negative_balances = 0`
  - `bridge_wallets_duplicate_wallet_id = 0`
  - `bridge_virtual_accounts_duplicate_id = 0`
  - `bridge_transfers_orphan_user_profiles = 0`

## Delta vs pre-cleanup baseline

- `pending_events_total`: `46 -> 45`
- `webhook_logs_total`: `46 -> 45`
- `bridge_webhook_events_total`: `83 -> 82`

This matches the intended single-record cleanup across the three linked tables.

