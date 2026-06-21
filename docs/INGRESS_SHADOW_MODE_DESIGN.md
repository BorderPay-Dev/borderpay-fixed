# Ingress Shadow Mode Design

## Decision Boundary

Weak point in the raw proposal: replacing normal queue routing for all real Bridge webhooks would halt production financial synchronization.

Therefore, Ingress Shadow Mode must be **explicitly gated** and **non-default**:
- Default: current production path (`verify -> ingest_bridge_event -> queue`).
- Shadow mode: `verify -> parse -> dedupe/routing evaluation -> ingress_shadow_log only`.
- Activation guard: strict env flag + optional sampling/event filter.

## Objectives

Validate real ingress contract behavior without downstream financial mutation:
- signature verification correctness
- payload parsing correctness
- replay detection correctness
- idempotency/dedupe correctness at ingress
- routing decision correctness

## Non-Goals

- No writes to `pending_events` in shadow mode.
- No writes to projection/financial tables.
- No wallet/transfer/customer state mutation.

## Proposed Data Sink

New table (design target): `public.ingress_shadow_log`

Columns (minimum):
- `id` uuid
- `received_at` timestamptz
- `request_id` text
- `mode` text (`shadow_only` | `mirror_observe`)
- `event_id_raw` text
- `event_type_raw` text
- `signature_header` text
- `signature_ok` boolean
- `replay_window_ok` boolean
- `payload_json` jsonb
- `payload_hash` text
- `parse_ok` boolean
- `parse_error` text
- `dedupe_key` text
- `dedupe_decision` text (`new` | `duplicate` | `rejected`)
- `routing_decision` text (`bridge.queue.transfer` etc. or `rejected`)
- `decision_reason` text
- `http_status_returned` int

## Ingress Flow (Shadow)

1. Receive webhook request.
2. Read raw body bytes.
3. Parse `X-Webhook-Signature` header.
4. Enforce replay window check.
5. Verify signature with Bridge public key.
6. Parse JSON payload.
7. Derive `event_id`, `event_type`, `payload_hash`, dedupe key.
8. Evaluate dedupe against event identity.
9. Evaluate routing target (same router rules as worker expectations).
10. Insert one row into `ingress_shadow_log`.
11. Return deterministic HTTP response (same class semantics as production):
- invalid signature -> 401
- replay outside window -> 400
- parse failure -> 400
- duplicate -> 200
- accepted shadow observation -> 200

No queue call in `shadow_only` mode.

## Flow Diagram

`Bridge -> bridge-webhook -> verify+parse -> dedupe/routing eval -> ingress_shadow_log -> HTTP response`

## Signature Verification Behavior

Preserve current behavior exactly:
- signed payload string: `${timestamp_raw}.${rawBody}`
- hash-then-verify compatibility logic
- strict malformed header rejection
- no signature bypass path

## Replay Protection Logic

- Window remains fixed (current implementation: 10 minutes).
- `replay_window_ok=false` events are logged with full reason.
- Return 400 and never enqueue.

## Dedupe / Idempotency Contract

- Dedupe key: canonical event identity (`event_id` + provider namespace).
- Decision classes:
  - `new`: first-seen event id
  - `duplicate`: already-seen id (idempotent)
  - `rejected`: invalid signature/parse
- In shadow mode, dedupe must still be computed to validate ingress determinism.

## Routing Correctness Contract

Map `event_type` to expected internal route bucket (no execution):
- `customer.*` -> `bridge.customer`
- `kyc_link.*` -> `bridge.kyc`
- `virtual_account.*` -> `bridge.virtual_account`
- `wallet.*|bridge_wallet.*` -> `bridge.wallet`
- `external_account.*` -> `bridge.external_account`
- `transfer.*|payout.*|deposit.*` -> `bridge.transfer`
- unknown -> `bridge.unknown`

## Failure Modes

1. Signature header malformed
- Log parse failure + reject 401.

2. Timestamp outside replay window
- Log replay failure + reject 400.

3. JSON parse failure
- Log parse failure + reject 400.

4. Shadow-log insert failure
- Return 500 (ingress observability degraded); do not enqueue in shadow mode.

5. Mode misconfiguration
- If mode flag invalid, fail closed to normal production mode (never implicit shadow switch).

## Activation/Deactivation Safety

Required controls:
- `INGRESS_SHADOW_MODE` enum env (`off|shadow_only|mirror_observe`)
- `INGRESS_SHADOW_EVENT_FILTER` optional regex/prefix list
- emergency disable flag check on every request

Recommended rollout:
1. ship with `off`
2. enable `mirror_observe` for short interval
3. validate reports
4. only then use `shadow_only` for controlled ingress tests

## Pass Criteria

- Signature/replay/parse outcomes in shadow logs match production decisions.
- Dedupe/routing decisions deterministic under retries/replays.
- Zero writes to `pending_events` while in `shadow_only`.
- Zero downstream financial writes from shadow ingress.

