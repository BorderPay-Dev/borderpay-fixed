# Queue Event Timeline: `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`

- Audit mode: read-only
- Audited at (UTC): `2026-06-21 07:14:01.2999+00`
- Event under investigation: `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`

## 1) Original webhook ingestion

`2026-06-19T22:55:13.632406+00:00`

Evidence (all three tables agree on the same receive/queue timestamp):

- `pending_events.created_at = 2026-06-19T22:55:13.632406+00:00`
- `webhook_logs.received_at = 2026-06-19T22:55:13.632406+00:00`
- `bridge_webhook_events.received_at = 2026-06-19T22:55:13.632406+00:00`

Payload shape evidence for this exact event (`bridge_webhook_events.event_id = ops-sync-fail-...`):

- `event_type = transfer.processed`
- `payload` does **not** include `event_object_id`
- `payload.event_object.id` is empty
- `payload_head` begins with:
  - `{"id":"ops-sync-fail-...","type":"transfer.processed","event_object":{"status":"pending"}}`

This matches the runtime error observed: `bridge transfer event missing id`.

## 2) Queue creation

At ingestion time:

- `pending_events.status = queued`
- `webhook_logs.status = queued`
- `bridge_webhook_events.processing_status = queued`
- Initial queue identity mapping exists and is consistent across the three tables.

## 3) Claim attempts and retries (timeline reconstruction)

Exact per-attempt rows are not persisted as separate history records. Reconstruction is from final counters and timestamps:

- Final counters for this event:
  - `attempts = 2`
  - `max_attempts = 1`
  - `status = queued`
  - `updated_at = 2026-06-19T22:56:34.308307+00:00`
  - `next_attempt_at = 2026-06-19T22:56:34.308307+00:00`

Inferred attempt chronology:

1. First claim occurred (attempts reached 1), processing failed with `bridge transfer event missing id`.
2. Second claim occurred (attempts reached 2), processing failed again with the same error.
3. Row ended in `queued` instead of terminal `failed`.

## 4) Every fail transition (what is observable)

Observed final fail state details across mirrors:

- `pending_events.last_error = bridge transfer event missing id`
- `webhook_logs.last_error = bridge transfer event missing id`
- `bridge_webhook_events.last_error = bridge transfer event missing id`
- All three show `attempts = 2`, status/processing_status `queued`, and no completion timestamp.

Intermediate fail transitions are not individually logged as immutable history rows.

## 5) Current row values (authoritative)

- `id`: `ab6e41b2-f835-4129-a385-94dda422e120`
- `event_id`: `bridge:ops-sync-fail-716f27a047824edd9e2af32bdc46672e`
- `event_type`: `transfer.processed`
- `status`: `queued`
- `attempts`: `2`
- `max_attempts`: `1`
- `locked_by`: `NULL`
- `locked_at`: `NULL`
- `completed_at`: `NULL`
- `next_attempt_at`: `2026-06-19T22:56:34.308307+00:00`
- `updated_at`: `2026-06-19T22:56:34.308307+00:00`

## 6) Related event family evidence (same synthetic suffix)

Same suffix (`716f27a047824edd9e2af32bdc46672e`) has three synthetic events:

- `bridge:ops-sync-ok-...` (`customer.updated`) -> `completed`, `attempts=3`, `max_attempts=6`
- `bridge:ops-sync-retry-...` (`transfer.processed`) -> `failed`, `attempts=6`, `max_attempts=6`
- `bridge:ops-sync-fail-...` (`transfer.processed`) -> `queued`, `attempts=2`, `max_attempts=1` (target anomaly)

All three were created at the same timestamp (`2026-06-19T22:55:13.632406+00:00`), indicating a single ops/simulation batch rather than independent Bridge webhook traffic.

