# Queue Invariant Report

- Rerun timestamp (UTC): `2026-06-21 08:16:32.166672+00`
- Scope: production read-only queue invariant verification

## Result

`PASS`

## Required Invariants

- Target row absent:
  - `pending_events(event_id='bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e') = 0`
  - `webhook_logs(event_id='bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e') = 0`
  - `bridge_webhook_events(event_id='ops-sync-fail-716f27a047824edd9e2af32bdc46672e') = 0`
- Global queue retry invariant:
  - `queued AND attempts >= max_attempts = 0`

## Queue Runtime Contract Integrity

Function definition hashes unchanged pre/post cleanup:

- `claim_pending_events`: `4764733c0043a9f955ef2d3963973aa7`
- `complete_pending_event`: `cbbcbf6e05a03bc8c4b9d6dd08737097`
- `fail_pending_event`: `de89d859e2a248290f8cadadc719815d`
- `reap_stuck_processing`: `09e7a27d19b7a6f1309c5c0b6b99c04d`

No queue runtime contract drift detected.

