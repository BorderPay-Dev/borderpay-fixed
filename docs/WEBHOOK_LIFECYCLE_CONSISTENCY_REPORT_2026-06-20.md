# BorderPay Webhook + Event Lifecycle Consistency Report
Date: 2026-06-20
Scope: Architecture alignment for Bridge webhook ingestion, queue lifecycle separation, and product-state dependency rules.

## 1) Canonical lifecycle definition (official)
Ingress lifecycle (Bridge webhook intake record):
- `received`
- `queued`
- `rejected`
- `duplicate`

Internal queue lifecycle (BorderPay processing pipeline):
- `queued`
- `processing`
- `completed` (terminal success)
- `failed` (terminal failure)

Notes:
- `completed` is the terminal success state in BorderPay internal lifecycle.
- `processed` is NOT a valid status in current production constraints.

## 2) Separation model
- Bridge is external source of truth for KYC/KYB, VA lifecycle, transfers, and webhook payloads.
- `bridge-webhook` is translation-only (signature verification + atomic enqueue via `ingest_bridge_event`).
- Business logic execution happens in `process-pending-events` against internal tables.
- UI reads internal BorderPay state (`bridge_wallets`, `bridge_virtual_accounts`, `bridge_transfers`, etc.), not raw webhook payload shape.

## 3) Live read-only verification summary
- Constraints:
  - `pending_events.status`: `queued|processing|completed|failed`
  - `bridge_webhook_events.processing_status`: `received|queued|processing|completed|failed|duplicate|rejected`
  - `webhook_logs.status`: `received|queued|processing|completed|failed|duplicate|rejected`
- Cron jobs are queue-worker only (`process-pending-events-drain`, `reap-stuck-processing`).
- Trigger wiring is queue dispatch only (`trg_fire_pending_event_webhook`).

## 4) Misalignment found
- A prior runtime hotfix mirrored queue terminal states into `bridge_webhook_events` in `complete_pending_event` / `fail_pending_event`.
- That couples ingress status tracking with internal queue semantics, violating architecture separation.

## 5) Refactor applied in repository (no schema changes)
- Added decoupling SQL script:
  - `scripts/sql/20260620_queue_lifecycle_decouple_from_bridge_ingress.sql`
  - Keeps queue lifecycle updates in `pending_events` + `webhook_logs` only.
- Updated `scripts/sql/20260620_queue_state_consistency_hotfix.sql` to the same decoupled behavior.
- Updated `supabase/functions/bridge-sync-accounts/index.ts` response contract:
  - No provider response leakage.
  - Returns internal DB state (`bridge_wallets`, `bridge_virtual_accounts`) after sync.

## 6) Hidden/legacy state scan result
No queue lifecycle state literals outside the defined model were found in active queue ingress/processing control paths, except `duplicate` in ingress tables by design.

## 7) Decision
- `completed` is the intentional terminal success status.
- Ingress and internal queue lifecycles are defined as separate but interoperable.
- No schema change required for this alignment.
