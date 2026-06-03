# Bridge webhook — prevention plan (design only)

Status: **source-only planning doc. No backend fix, no deploy, no replay, no DB
writes.** Follows the PR5 diagnosis (`docs/bridge-pr5-webhook-reliability-diagnosis.md`)
and a read-only provider reconciliation. These are **prevention** items, not urgent
recovery.

## Why this is prevention, not recovery

- All webhook failures/rejections are from a **2026-05-29 → 06-01 setup window**;
  **0 in the last 24h**, queue drained, and **no current live failure is proven
  from available webhook data** (note: no webhook traffic since 2026-06-01 also
  means low signal — absence of failures is not positive proof of health).
- The 14 failed `pending_events` mapped to **2 real users + 1 internal account**.
- The 2 real users were reconciled **directly against Bridge** (read-only
  `GET /v0/customers/{id}`): both are **`not_started` / incomplete**, NOT
  approved/rejected/under_review. The app DB (`bridge_kyc_status=pending`,
  `kyc_status=unverified`) is therefore **not stale in a dangerous direction** —
  only minor wording drift, **no customer-facing stale approval**.
- **CTO decision: do NOT replay the 14 events.** Replaying old setup-window events
  would not unlock any user and adds risk for little value.
- The internal/founder account is deferred (lower impact, not customer-facing).
- Per-user identifiers (emails / Bridge customer ids / user ids) are intentionally
  **kept out of this public repo**; they live in the private operator record.

## Root causes to prevent recurrence

### 1. Worker event-id extraction (the 14 failures)
Bridge event payloads use this shape (top-level keys):
`event_id, event_category, event_type, event_object_id, event_object{…}, event_object_changes, event_object_status, event_sequence, …`

The failing handler looked for the id at `payload.id` / `data.object.id` (both
absent) → `bridge customer event missing id` / `bridge kyc/kyb event missing
customer id`. The id is actually at:
- **`event_object_id`** (and `event_object.id`) — the customer id for `customer.*`.
- **`event_object.customer_id`** — the customer id for `kyc_link.*` (the
  `event_object.id` there is the kyc_link id).

**Fix (future, deploy-gated backend PR):** update the Bridge event handler
(`process-pending-events` worker / shared bridge-event mapper) to read
`event_object_id` / `event_object.id`, and `event_object.customer_id` for
`kyc_link.*`, with a safe fallback chain. No schema change.

### 2. `processing_status` back-prop gap (cosmetic)
`bridge_webhook_events.processing_status` stays `queued` even after the linked
`pending_events` row reaches a terminal state. `pending_events.status` is
authoritative, so this is observability-only.

**Fix (future, deploy-gated backend PR):** when the worker finalizes a
`pending_events` row, write the terminal status back to the linked
`bridge_webhook_events` row (via `pending_event_id`).

### 3. Signature rejects (ops/config)
37 `signature_rejected` in one 05-29 window, none since → consistent with a
signing-secret mismatch during setup (or unauthenticated probes). Security behaved
correctly (rejected, never queued).

**Action (ops):** confirm the Bridge webhook signing secret is correctly
configured (the absence of rejects since 05-29 implies it is); optionally add an
alert if the `signature_ok=false` rate spikes.

## Sequencing (each its own reviewed, deploy-gated PR — NOT this doc)

1. **Worker extraction fix** — code + an audit asserting the new `event_object_id`
   / `event_object.customer_id` paths; deploy `process-pending-events` (and any
   shared mapper) byte-verbatim; verify a sample `customer.*` / `kyc_link.*` event
   processes without "missing id".
2. **Back-prop fix** — write terminal `processing_status`; deploy; verify
   `bridge_webhook_events.processing_status` matches `pending_events.status`.
3. **Replay** — only if a *future* real failure needs recovery, and only with
   explicit approval. The current 14 are explicitly NOT replayed.

> The accompanying audits ship **with** each fix PR (a static audit now would
> assert behavior that doesn't exist yet). This doc changes no code and deploys
> nothing.

## Guardrails
No backend fix · no deploy · no replay · no DB writes · no schema change · no
provider calls. Money movement and flag flips remain out of scope.
