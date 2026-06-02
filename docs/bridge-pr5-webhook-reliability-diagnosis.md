# Bridge PR5 — Webhook reliability diagnosis (read-only)

Status: **read-only diagnosis snapshot (2026-06-03). No code, no replay, no DB
writes, no schema cleanup, no deploy.** This records the actual state of Bridge
webhook ingestion + queue processing so remediation isn't started on a wrong
premise.

## Verdict

**No current live webhook failure is proven.** All failures/rejections are from a
late-May setup window. The queue is drained, there have been **0 events and 0
failures in the last 24h**, and **no webhooks have been received since
2026-06-01**. The remaining real issue is a **cosmetic back-prop gap**, not a
processing outage.

> This is NOT "webhooks are currently broken." It is "old setup-window failures +
> no recent traffic + a cosmetic status back-prop gap."

## Evidence (read-only, snapshot 2026-06-03)

### Stage 1 — Ingestion (`public.bridge_webhook_events`)
| signature_ok | processing_status | n | window | last 24h |
|---|---|---|---|---|
| false | rejected | **37** | 2026-05-29 10:31 → 17:08 | 0 |
| true | queued | **30** | 2026-05-29 18:38 → 2026-06-01 07:39 | 0 |

- The 37 rejects are all `event_type='signature_rejected'` (rejected before parse;
  never queued) — a single 2026-05-29 morning window, none since. Consistent with a
  signing-secret mismatch during setup or unauthenticated probes to the public
  endpoint. Security behaved correctly (rejected, not processed).
- The 30 valid events were all queued. Their ingestion-log rows remain
  `processing_status='queued'` (see Stage 3).

### Stage 2 — Queue processing (`public.pending_events`, source=`bridge`)
| status | n | attempts | window |
|---|---|---|---|
| completed | **16** | 1 | 2026-05-29 → 2026-06-01 |
| failed | **14** | 6 (exhausted) | 2026-05-29 18:48 → 18:52 |

The 14 failures are one tight ~4-minute batch, one root-cause class —
the worker could not extract the Bridge id / customer-id from these event payload
shapes:

| event_type | n | last_error |
|---|---|---|
| customer.updated | 9 | `bridge customer event missing id` |
| customer.created | 2 | `bridge customer event missing id` |
| kyc_link.created | 2 | `bridge kyc/kyb event missing customer id` |
| kyc_link.updated | 1 | `bridge kyc/kyb event missing customer id` |

### Stage 3 — App sync / back-prop
All 30 ingestion rows are stuck at `processing_status='queued'` regardless of the
terminal queue outcome (16 completed + 14 failed):

| bridge_webhook_events.processing_status | pending_events.status | n |
|---|---|---|
| queued | completed | 16 |
| queued | failed | 14 |

→ **Cosmetic back-prop gap:** `bridge_webhook_events.processing_status` is never
updated from `queued` to a terminal value. `pending_events.status` is authoritative.

## Failure-stage classification (the question asked)
1. **Ingestion** — 37 signature rejects; isolated old window (05-29 AM), 0 recent, security-correct. Not failing now.
2. **Queue processing** — 14 failed; worker payload-extraction bug for `customer.*` / `kyc_link.*` shapes; old (05-29 PM), retries exhausted, quarantined.
3. **App sync** — back-prop gap; cosmetic only.

## Old/quarantined vs current-live
**100% old/quarantined** (2026-05-29 → 2026-06-01). `last_24h = 0` across all
stages; no `pending`/`processing` rows (queue drained); no webhooks since 06-01.

## Recommended next steps (separate, gated; NOT done here)
- **(b) Targeted read (next):** check whether the 14 failed `customer.*` / `kyc_link.*`
  events correspond to **real customers that never synced** (vs. obsolete 05-29 test
  data) — read-only, before any replay decision. Replay remains approval-gated.
- **Back-prop gap fix:** writing terminal `processing_status` to
  `bridge_webhook_events` touches the deployed `bridge-webhook` / `process-pending-events`
  functions → **its own reviewed backend PR + deploy**, not a doc/no-deploy change.
- **Signature rejects:** confirm the Bridge signing secret is correctly configured
  now (no rejects since 05-29 implies it is); optional.

No replay, no DB writes, no schema cleanup, no deploy were performed for this diagnosis.
