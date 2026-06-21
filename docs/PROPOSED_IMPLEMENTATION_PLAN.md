# Proposed Implementation Plan

## Scope

Design-only plan to implement a safe financial test isolation boundary with **no real-customer financial mutation**.

Chosen model: Synthetic Event Mode (`bridge_test` source).

## Guardrails

- No schema-breaking changes required for MVP.
- No production data cleanup in this plan.
- No permission hardening in this plan.
- Bridge remains sole provider.

## Step-by-Step Plan

1. Add synthetic ingress edge function
- File: `supabase/functions/bridge-test-webhook/index.ts` (new)
- Responsibilities:
  - authenticate internal test caller (dedicated env token)
  - accept Bridge-shaped event payload + deterministic `test_case_id`
  - write synthetic event identity into queue/log pipeline with explicit tags
- Output contract:
  - returns queued/duplicate status and synthetic IDs

2. Extend worker dispatcher for `bridge_test`
- File: `supabase/functions/process-pending-events/index.ts`
- Add source branch:
  - `source='bridge_test'` routes to dry-run handlers
- Dry-run handler behavior:
  - parse exactly as production handlers
  - compute intended projection action
  - write only `complete_pending_event` summary (or fail/retry)
  - prohibit financial/projection writes

3. Add hard write guards for synthetic path
- Mechanism:
  - local wrapper helpers in worker for table writes
  - if `source='bridge_test'`, writing to financial tables throws hard error
- Protected tables:
  - `wallets`, `transactions`, `bridge_wallets`, `bridge_virtual_accounts`,
    `bridge_external_accounts`, `bridge_transfers`, `bridge_virtual_account_balances`, `bridge_balance_ledger`

4. Add replay/idempotency test harness
- New tests (audit-style):
  - synthetic webhook replay duplicate ID
  - synthetic transfer replay
  - synthetic wallet provisioning replay
- Assertions:
  - no duplicate queue identities
  - no financial table writes
  - consistent completion summary

5. Add failure-mode test harness
- Simulate deterministic handler failure in synthetic mode (via payload trigger flag)
- Validate:
  - `attempts` increments with backoff
  - terminal status flips to `failed` at max attempts
  - no reprocessing loop after terminal failure

6. Add observability reports for synthetic runs
- Docs generated per run:
  - `LIVE_FLOW_EXECUTION_REPORT.md`
  - `LIVE_TRANSFER_END_TO_END_REPORT.md`
  - `LIVE_WEBHOOK_REPLAY_SAFETY_REPORT.md`
  - `LIVE_FAILURE_MODE_BEHAVIOR_REPORT.md`
- Evidence fields:
  - ingest record
  - queue claim log
  - retry timeline
  - completion/failure summary
  - explicit proof of zero financial writes

## Execution Order

1. Worker/source design tests first (non-mutating).
2. Ingress function implementation.
3. Dispatcher + dry-run handlers.
4. Replay/failure audits.
5. Live flow activation reports (synthetic mode).
6. Gate decision on behavioral correctness.

## Definition of Done

All must pass:
- Synthetic deposit flow validated through queue lifecycle.
- Synthetic transfer flow validated through canonical mapping path.
- Synthetic external-account flow validated through routing and attribution.
- Retry/failure semantics validated to terminal behavior.
- Replay tests show zero duplicates.
- Financial write proof: zero synthetic writes in all canonical financial tables.

## Explicit Non-Goals (this phase)

- No internal canary customer creation.
- No schema migration unless a hard blocker is discovered.
- No RLS/role/permission changes.
- No cleanup tasks.

## If a blocker appears

Only if synthetic mode cannot be implemented safely with current schema:
- propose additive, non-breaking schema extension in a separate RFC,
- do not execute until explicitly approved.

