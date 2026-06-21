# Historical Queue Record Dependency Graph

Target queue record:

- `pending_events.event_id = bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- `bridge_webhook_events.event_id = ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- `pending_events.id = ab6e41b2-f835-4129-a385-94dda422e120`

## Graph (observed dependencies only)

```text
bridge_webhook_events (ops-sync-fail-...)
  └─ pending_event_id = ab6e41b2-f835-4129-a385-94dda422e120
     └─ pending_events (bridge:ops-sync-fail-...)
        └─ webhook_logs (bridge:ops-sync-fail-...) [same logical queue event id]
```

No downstream financial objects were found.

## Dependency Evidence

- `target_exists_pending_events = 1`
- `target_exists_webhook_logs = 1`
- `target_exists_bridge_webhook_events = 1`
- `bridge_transfers_by_event_id_or_error_ref = 0`
- `transactions_by_bridge_or_reference_or_metadata = 0`
- `wallets_by_event_reference = 0`
- `bridge_wallets_by_event_reference = 0`
- `bridge_virtual_accounts_by_event_reference = 0`
- `event_ui_surfaces_reference_scan = 0`

## FK/Constraint Dependency Evidence

- `pending_events_fk_dependents = 0`
- `bridge_webhook_events_fk_dependents = 0`
- Trigger-only behavior on `pending_events`:
  - `AFTER INSERT trg_fire_pending_event_webhook`
  - `BEFORE UPDATE trg_pending_events_touch`
- No trigger executes on `DELETE`.

## Active/Blocked Synthetic Ops Records

- `other_ops_records_all = 9`
- `other_ops_records_not_terminal = 1`
- The only non-terminal synthetic ops row is the target:
  - `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e` (`status=queued`, `attempts=2`, `max_attempts=1`)

All other synthetic ops rows in current dataset are terminal (`completed` or `failed`).

