# BorderPay Production Remediation Log — 2026-06-20

All times UTC unless noted. This log records every operational action taken during production alignment.

## 00:00-00:20 — Access and Safety Preconditions
- Verified linked Supabase project via CLI (`orwrcpwsffjlvzuraxjc`).
- Verified Supabase backups capability and listed backup status.
- Verified Vercel and GitHub CLI access states.
- Verified Node/Vercel tooling availability in `~/.nvm` path.

## 00:20-00:40 — Live Drift and Risk Evidence Collection
- Confirmed critical hardening RPCs are missing in live DB:
  - `set_user_pin_v2`
  - `verify_user_pin_atomic`
  - `change_user_pin_atomic`
  - `enforce_signup_abuse_protection`
- Confirmed live schema missing:
  - `signup_abuse_events` table
  - `bridge_transfers` reconciliation columns
- Confirmed hardening migrations not recorded in remote migration history (count = 0 for:
  `20260619103000`, `20260619123000`, `20260619124500`).

## 00:40-01:00 — Product-Alignment Audit (Bridge-only direction)
- Scanned repository for Maplerad/provider remnants and Bridge-only drift points.
- Verified funding gate implementation currently uses minimum balances (20/100) but sources include VA balances and an optional `bridge_wallet_balances` table mirror.
- Verified stablecoin provisioning function exists and is idempotent at function-level checks, but auto-provisioning is not wired from KYC/KYB completion path in webhook worker.

## Pending irreversible actions
- Database migration apply to production is pending explicit confirmation.
- No irreversible writes performed yet.

## 2026-06-20T01:26+03:00 — Queue compatibility patch + live preflight (no migrations executed)

### Local change (repo only)
- Patched migration file `supabase/migrations/20260619123000_queue_orchestration_and_signup_lock_hardening.sql`.
- Replaced strict `current_setting(...)` dependency with backward-compatible fallback:
  - `coalesce(nullif(current_setting('app.process_pending_events_url', true), ''), nullif(public.app_config_get('worker_url'), ''))`
  - `coalesce(nullif(current_setting('app.process_pending_events_jwt', true), ''), nullif(public.app_config_get('worker_auth_token'), ''))`
- Applied in both queue paths:
  - `public.fire_pending_event_webhook()`
  - `public.invoke_process_pending_events_drain(int)`

### Live verification evidence (production)
1. Baseline webhook event state:
   - `rejected_events=38`, `queued_events=37`, `processing_events=0`, `processed_events=0` at `2026-06-19 22:14:25+00`.
2. Cron jobs active:
   - `process-pending-events-drain` schedule `*/1 * * * *`, active `true`.
   - `reap-stuck-processing` schedule `*/5 * * * *`, active `true`.
3. Webhook ingestion test:
   - POST to `bridge-webhook` with structurally valid but invalid signature (`x-webhook-signature: t=...,v0=...`).
   - HTTP 401 `{"error":"invalid signature"}`.
   - DB confirmed rejection attribution incremented: `rejected_events` `38 -> 39`, `last_rejected_at=2026-06-19 22:18:27.797462+00`.
4. Queue worker endpoint probe:
   - POST to `process-pending-events` returned HTTP 200 `{"ok":0,"worker":"worker-054b37ba","claimed":0,"failed":0}`.
5. Cron execution evidence (`cron.job_run_details`):
   - Recent runs for job ids 1 and 2 are `succeeded` with current timestamps.
6. Current production queue command wiring:
   - `cron.job.command` for drain still uses legacy `app_config_get('worker_url')` and `app_config_get('worker_auth_token')`.

### Safety status
- No migration executed.
- No destructive operation executed.
- Migration execution remains blocked pending explicit user approval.

## 2026-06-20T01:45+03:00 — Queue consistency audit + E2E simulation (no migrations)

### Queue consistency audit (live production)
- `public.fire_pending_event_webhook()` definition uses:
  - `app_config_get('worker_url')`
  - `app_config_get('worker_auth_token')`
- `cron.job` `process-pending-events-drain` command uses same source keys:
  - `app_config_get('worker_url')`
  - `app_config_get('worker_auth_token')`
- `current_setting('app.process_pending_events_url', true)` and `current_setting('app.process_pending_events_jwt', true)` are both `NULL` in production.
- `app_config_get(...)` values are present and in active use.
- Conclusion: current production queue config is **single-source (`app_config`)**, not split between GUC + app_config.

### End-to-end queue simulation (live production)
1. Webhook ingestion reject path (Edge Function):
   - POST `bridge-webhook` with syntactically valid but invalid signature header returned HTTP 401 `{"error":"invalid signature"}`.
   - `bridge_webhook_events` logged row with prefixed event id `rejected_ops-audit-reject-1781909050_...`, `processing_status='rejected'`, `pending_event_id=NULL`.

2. Event enqueue path (atomic RPC path used by webhook):
   - Called `public.ingest_bridge_event(...)` with `p_signature_ok=true` and synthetic event.
   - Returned `queued=true`, `pending_id=<uuid>`.
   - Queue row created with event id `bridge:ops-audit-ingest-...`.

3. Worker processing success + retry + terminal failure:
   - Inserted 3 isolated audit events into `webhook_logs` + `pending_events`:
     - `ops-audit-success-...` (unknown source) → `pending_events.status='completed'`.
     - `ops-audit-retry-...` (bridge malformed payload, `max_attempts=6`) → remained `queued` with incremented attempts/backoff (`attempts` reached `3`, `next_attempt_at` moved forward).
     - `ops-audit-fail-...` (bridge malformed payload, `max_attempts=1`) → terminal `failed` on first processing attempt.
   - `process-pending-events` endpoint probe returned HTTP 200 and healthy worker response.

4. Cron execution evidence:
   - `cron.job_run_details` for queue jobs shows recent `succeeded` runs.

### Risk observation (important)
- For synthetic ingested row `ops-audit-ingest-...`, `pending_events` reached `completed` but corresponding `bridge_webhook_events.processing_status` remained `queued`.
- This confirms an attribution/state-sync gap still exists in current production (observability/reconciliation blind spot), consistent with pending hardening migrations not yet applied.

### Safety status
- No migration executed.
- No destructive schema changes executed.

## 2026-06-20T02:06+03:00 — Stabilization phase runtime-only queue consistency fix (no migrations)

### Scope guard
- No migrations created.
- No migration executed.
- Only runtime SQL function replacement + data synchronization performed.

### Runtime hotfix applied
- Added file: `scripts/sql/20260620_queue_state_consistency_hotfix.sql`.
- Applied live with `supabase db query --linked --file ...`.
- Replaced:
  - `public.complete_pending_event(text, jsonb)`
  - `public.fail_pending_event(text, text, int)`
- Behavior now:
  - `complete_pending_event` updates `webhook_logs`, `pending_events`, and bridge-linked `bridge_webhook_events` in one function transaction.
  - `fail_pending_event` updates `pending_events`, `webhook_logs`, and bridge-linked `bridge_webhook_events` in one function transaction.

### Important vocabulary constraint discovered
- Production check constraint for `bridge_webhook_events.processing_status` allows:
  - `received, queued, processing, completed, failed, duplicate, rejected`
- `processed` is NOT accepted in current production schema.
- Function had to set terminal success state to `completed` (not `processed`) to remain operational without schema changes.

### Queue lifecycle simulation evidence (runtime)
- Enqueue->process->complete (bridge event):
  - `bridge:ops-life-complete-66ff1fa58bfd4fc391e6e686a295b992`
  - Final: `pending_events.status=completed`, `bridge_webhook_events.processing_status=completed`, timestamps aligned.
- Enqueue->process->fail->retry (bridge event):
  - `bridge:ops-life-retry-66ff1fa58bfd4fc391e6e686a295b992`
  - Retry state: `pending_events.status=queued`, `bridge_webhook_events.processing_status=queued`, attempts/error mirrored.
- Terminal failure mirror check:
  - Same retry event driven to terminal condition (`attempts=max_attempts`) then `fail_pending_event` called.
  - Final: `pending_events.status=failed`, `bridge_webhook_events.processing_status=failed`, attempts/error mirrored.

### Historical consistency repair (runtime data sync)
- Pre-repair mismatch snapshot:
  - `total_bridge_pairs=43`
  - `completed_mismatch=22`, `failed_mismatch=16`, `attempts_mismatch=38`
- Applied one-time synchronization update from `pending_events` -> `bridge_webhook_events` for bridge-linked rows.
- `rows_synchronized=38`.
- Post-repair verification:
  - `completed_mismatch=0`, `failed_mismatch=0`, `queued_mismatch=0`, `processing_mismatch=0`, `attempts_mismatch=0`, `error_mismatch=0`.
