# Test Execution Isolation Design

## Decision

Chosen model: **Option B — Synthetic Event Mode (Bridge-test source, non-financial commit path)**.

Reason this is the correct first boundary:
- There is currently no internal canary principal in production (`is_demo=false` and `is_admin=false` for Bridge-linked users).
- Using a real customer for "controlled" tests would mutate canonical financial projections.
- Synthetic mode can prove queue/worker/idempotency/retry behavior without touching customer balances or ledger mirrors.
- It requires no schema-breaking change to start.

## Non-Negotiable Safety Invariants

1. **No writes to financial projection tables** for test events:
- `wallets`
- `bridge_virtual_account_balances`
- `bridge_balance_ledger`
- `transactions`
- `bridge_wallets`
- `bridge_virtual_accounts`
- `bridge_external_accounts`
- `bridge_transfers`

2. **Test events must be tagged and traceable** in queue/log boundaries:
- `pending_events.source = 'bridge_test'`
- `webhook_logs.source = 'bridge_test'`
- `bridge_webhook_events.event_id` prefixed with `test:`
- `pending_events.event_id` prefixed with `bridge_test:`

3. **Idempotency must hold under replay**:
- identical synthetic `event_id` processed repeatedly must produce exactly one queued event identity and zero duplicate effects.

4. **Failure semantics must stay real**:
- retries, backoff, max-attempt terminal failure, and stuck reaping behavior must match production worker logic.

## Runtime Boundary Architecture

### A. Ingest boundary (new synthetic ingress function)

Add dedicated function (design target): `supabase/functions/bridge-test-webhook/index.ts`
- Accepts Bridge-shaped payload + explicit `test_case_id`.
- Validates test auth token (separate from public webhook key).
- Writes into existing ingestion path with synthetic identity:
  - `bridge_webhook_events.event_id = 'test:' || test_case_id || ':' || payload.id`
  - `pending_events.event_id = 'bridge_test:' || payload.id`
  - `pending_events.source = 'bridge_test'`
- Must not call real Bridge APIs.

This avoids polluting true Bridge event namespace while reusing queue machinery.

### B. Worker dispatch boundary (`process-pending-events`)

Extend top-level dispatcher:
- Existing: `source='bridge'`
- New: `source='bridge_test'`

For `bridge_test` events:
- Reuse parse/route logic by event type (`customer.*`, `transfer.*`, `virtual_account.*`, `external_account.*`, etc.).
- Replace mutating handlers with **dry-run evaluators** that compute intended action and emit summary only.
- Persist summary only via `complete_pending_event(... p_summary ... )` and `webhook_logs` status fields.
- On evaluator error, call `fail_pending_event` (same retry behavior as prod).

No financial table writes occur on this path.

### C. Projection-exclusion guarantee

Because synthetic mode writes only queue/log boundaries:
- customer UI queries (wallet/VA/transfer/external-account screens) remain unchanged and unaffected.
- reconciliation totals remain unchanged because canonical financial tables are untouched.

## Tagging Contract

### `pending_events`
- `event_id`: `bridge_test:<bridge_event_id>`
- `source`: `bridge_test`
- `event_type`: original Bridge-like type
- `payload`: includes
  - `test_origin: true`
  - `test_case_id`
  - `replay_group_key`

### `bridge_webhook_events`
- `event_id`: `test:<test_case_id>:<bridge_event_id>`
- `processing_status`: normal lifecycle (`received/queued/completed/failed`)
- `payload`: includes `test_origin=true`

### `transactions`
- Expected: **no synthetic rows ever written**.
- Add an audit assertion: `provider='bridge' AND metadata->>'test_origin'='true'` count must be `0`.

## Idempotency Model

1. Synthetic ingress uses deterministic event IDs.
2. Existing duplicate guards on `bridge_webhook_events.event_id` and `pending_events.event_id` prevent duplicate queue records.
3. Worker dry-run path is side-effect free; replay safety is therefore strict:
- repeat processing cannot create duplicate financial objects because none are written.

## Failure/Retry Behavior Coverage

Synthetic mode must explicitly validate:
- claim path contention (`claim_pending_events`) with parallel workers.
- retry schedule increments (`fail_pending_event`) until `max_attempts`.
- terminal failed state persists and is not silently reprocessed.
- reaper behavior (`reap_stuck_processing`) for synthetic source rows.

## Why Not Internal Canary Principal First

Internal canary is eventually useful, but not the safest first boundary under current constraints:
- Without broad exclusions across dashboards/aggregates/reconciliation, canary writes can leak into operator metrics.
- It introduces customer-like data writes before isolation controls are proven.
- Synthetic mode gives deterministic behavior validation with zero financial mutation risk.

## Acceptance Criteria

- Synthetic runs can execute deposit/transfer/external-account/failure/replay scenarios.
- Zero writes to financial projection tables.
- Queue lifecycle and retry invariants proven with tagged evidence.
- All synthetic artifacts are discoverable by `source='bridge_test'` or `event_id LIKE 'test:%'` filters.

