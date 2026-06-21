# scripts/sql (Safe Operational SQL)

This folder is reserved for production-safe operational SQL that does **not** mutate queue/webhook lifecycle state transitions.

Forbidden in this directory:
- `create or replace function public.ingest_bridge_event(...)`
- `create or replace function public.claim_pending_events(...)`
- `create or replace function public.complete_pending_event(...)`
- `create or replace function public.fail_pending_event(...)`
- Direct `UPDATE` of lifecycle status fields in:
  - `public.pending_events`
  - `public.webhook_logs`
  - `public.bridge_webhook_events`

Lifecycle mutation scripts must live in `scripts/incident/sql/` and require explicit incident approval.
