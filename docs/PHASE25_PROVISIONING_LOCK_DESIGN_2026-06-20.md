# Phase 2.5 – Provisioning Lock Design (Bridge-first)

Date (UTC): 2026-06-20
Scope: Worker-level stablecoin wallet provisioning deduplication.
Constraints honored: no schema changes, no production writes, no deployments.

## Objective
Guarantee **at-most-one provisioning execution** per `(bridge_customer_id, wallet_symbol, wallet_chain)` across:
- duplicate Bridge webhook deliveries
- queue retries
- worker restarts
- horizontal worker scale

without relying only on Bridge idempotency.

## Design

### Lock Key
Deterministic lock id:
- `provlock:wallet:<bridge_customer_id>:<SYMBOL>:<chain>`

### Lock Store (existing primitive)
Uses existing `public.webhook_logs` row uniqueness on `event_id` (no schema changes).

### Acquisition Flow
1. Worker computes deterministic lock id.
2. Worker attempts insert into `webhook_logs` with `status='processing'`.
3. Outcomes:
- insert success -> lock acquired
- unique conflict -> row exists
  - status `completed` -> skip (already provisioned)
  - status `processing` and fresh timestamp -> skip (lock busy)
  - stale processing/failed -> CAS-style takeover update (stale-acquired)

### Completion/Failure
- On successful provisioning/upsert: lock row set `status='completed'`.
- On provisioning exception: lock row set `status='failed'` with reason.

### Why this is safe under scale
- Deterministic lock key partitions by customer+wallet pair.
- Lock contention resolves through DB uniqueness + conditional takeover.
- No in-memory lock reliance.
- Independent workers can process other customers/pairs concurrently.

## PASS/FAIL Findings

### F1 Deterministic lock key
- Status: **PASS**
- Evidence: `provisioningLockEventId()` implemented in worker.
- Business impact: Prevents duplicate wallet-creation attempts and noisy failures.
- Technical impact: Stable idempotency boundary before provider call.
- Deployment risk: Low.
- Rollback: Revert worker lock helpers only.

### F2 Cross-worker durable lock primitive
- Status: **PASS**
- Evidence: `webhook_logs` insert + unique conflict handling in `tryAcquireProvisioningLock()`.
- Business impact: Eliminates race-induced duplicate provider calls.
- Technical impact: Uses existing table/constraints only.
- Deployment risk: Low.
- Rollback: Revert lock acquisition function; old behavior restored.

### F3 Restart/retry resilience (stale takeover)
- Status: **PASS**
- Evidence: `PROVISIONING_LOCK_STALE_SECONDS` + conditional takeover path.
- Business impact: Avoids stuck locks after worker crash.
- Technical impact: Enables safe forward progress after stale failures.
- Deployment risk: Medium (tuning stale timeout).
- Rollback: Increase timeout or disable takeover branch.

### F4 Duplicate webhook handling
- Status: **PASS**
- Evidence: existing lock row with `completed` results in no provider call.
- Business impact: Duplicate event deliveries do not create duplicate provisioning calls.
- Technical impact: idempotent skip path.
- Deployment risk: Low.
- Rollback: none required beyond reverting lock code.

### F5 At-most-one execution per customer+pair
- Status: **PASS (repo runtime evidence)**
- Evidence: lock state gating before `bridgeProvider.createWallet`.
- Business impact: predictable wallet lifecycle and lower provider error exposure.
- Technical impact: bounded execution semantics under concurrency.
- Deployment risk: Low.
- Rollback: revert to previous best-effort path.

## Evidence
- Audit: `tests/audit/provisioning_lock_resilience_audit.py` -> PASS (5/5)
- Runtime location: `supabase/functions/process-pending-events/index.ts`

## Residual Risk
- Uses `webhook_logs` as lock table; operational dashboards must ignore `provlock:*` event ids for webhook analytics.
- Stale timeout may need tuning with real queue latency distribution.

## Decision
Provisioning lock objective is met at code level with no schema change and horizontal scalability preserved.
