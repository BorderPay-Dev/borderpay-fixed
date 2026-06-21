# Phase 2.5 – Updated Bridge Alignment Report

Date (UTC): 2026-06-20
Scope: Bridge-first runtime alignment vs BorderPay product policies.
Constraints honored: no schema changes, no production writes, no deployments.

## Alignment Summary
- Bridge as financial system-of-record: **PASS**
- BorderPay policy separation (UX/product rules vs provider truth): **PASS (with listed residual gaps)**

## Lifecycle Alignment

### Customer lifecycle
- Status: **PASS**
- Evidence: owner resolution by `bridge_customer_id`; strict invariant paths in money endpoints.

### KYC/KYB lifecycle
- Status: **PASS**
- Evidence: webhook status projection and terminal handling in worker.

### Stablecoin wallet lifecycle
- Status: **PASS (repo runtime)**
- Evidence: auto-provision on approved path + deterministic worker lock + Bridge idempotency keying.

### Virtual account lifecycle
- Status: **PASS (repo runtime)**
- Evidence: requires approved identity + funding gate + destination wallet resolution.

### External account lifecycle
- Status: **PASS (repo runtime)**
- Evidence: `external_account.*` handler and projection updates.

### Transfer lifecycle
- Status: **PASS (repo runtime)**
- Evidence: canonical state mapper preserving raw provider state and mapped internal status.

### Webhook taxonomy + retry/idempotency
- Status: **PASS/PARTIAL**
- Evidence: unknown events safe-complete; deterministic locks for provisioning; queue retry model intact.
- Residual: taxonomy changes from provider require periodic remapping audit.

## BorderPay Product Policy Compliance

1. Individual minimum $20 stablecoin deposit before VA request: **PASS**
2. Business minimum $100 stablecoin deposit before VA request: **PASS**
3. Stablecoin wallets auto-created after successful KYC/KYB: **PASS (repo runtime)**
4. Funding eligibility uses only verified Bridge stablecoin wallet balances: **PASS**
5. VA balances never satisfy funding threshold: **PASS**
6. No KYC payment/activation fee: **PASS**
7. KYC/KYB flows free: **PASS**

## PASS/FAIL Findings

### A1 Provider abstraction reintroduction risk
- Status: **PASS**
- Evidence: active runtime paths remain Bridge-specific.
- Business impact: avoids multi-provider drift.
- Technical impact: simpler correctness surface.
- Deployment risk: low.
- Rollback: N/A.

### A2 Financial correctness under provider outage
- Status: **PASS (policy chosen: fail-closed)**
- Evidence: explicit 503 funding-balance-unavailable path.
- Business impact: stronger fraud/reconciliation posture.
- Technical impact: deterministic outage behavior.
- Deployment risk: medium UX during outage.
- Rollback: policy/env-level adjustment (not recommended now).

### A3 Runtime readiness without deployment
- Status: **FAIL**
- Evidence: corrected runtime not yet active in production (no deployment rule).
- Business impact: production still exposed to pre-change behavior.
- Technical impact: code-level fixes pending activation.
- Deployment risk: N/A until deployment window opens.
- Rollback: N/A.

## Decision
Bridge alignment is materially improved and financially safer at code level; production alignment remains incomplete until controlled deployment and post-deploy evidence run.
