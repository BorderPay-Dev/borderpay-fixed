# Transfer Integrity Report

- Audited at (UTC): `2026-06-21 06:15:31.109092+00`
- Scope: production, read-only verification
- Data source: `public.bridge_transfers`, `public.transactions`, `public.pending_events`, `public.webhook_logs`

## Result

`PASS` (no blocker found in transfer projection integrity)

## Evidence

- `bridge_transfers` rows: `0`
- `transactions` rows where `provider='bridge'`: `0`
- `bridge_transfers_duplicate_provider_id`: `0`
- `transactions_bridge_duplicate_provider_id`: `0`
- `bridge_transfers_missing_transaction_projection`: `0`
- `transactions_bridge_missing_bridge_transfers_row`: `0`
- `bridge_transfer_projection_cardinality_not_one`: `0`
- `bridge_transfers_raw_missing`: `0`
- `bridge_transfers_state_missing`: `0`
- `bridge_transfers_unknown_state_count`: `0`
- `bridge_tx_missing_provider_state_metadata`: `0`
- `bridge_tx_status_mapping_mismatch`: `0`
- `bridge_tx_idempotency_duplicate_keys`: `0`

## Notes

- Transfer reconciliation invariants are currently clean for the existing production dataset.
- Coverage caveat: transfer population is currently zero in both Bridge-native and mirrored transaction tables, so this confirms absence of current data anomalies rather than high-volume transfer behavior.

