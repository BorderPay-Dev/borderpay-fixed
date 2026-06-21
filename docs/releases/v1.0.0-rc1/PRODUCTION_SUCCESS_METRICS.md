# BorderPay Production Success Metrics — v1.0.0-rc1

## Objective

Define measurable go-live health criteria before deployment.

## Core SLO/SLI Targets

### Webhooks

- Processing success rate: `>= 99%`
- Signature reject rate: expected-only (no unexplained spike)
- Ingestion-to-queue latency: below agreed threshold

### Queue

- `queued AND attempts >= max_attempts`: `0`
- Stuck `processing` rows beyond reap threshold: `0`
- Retry growth trend: no sustained upward anomaly

### Transfers

- Duplicate projection count: `0`
- Missing internal projection for provider transfer: `0`
- Reconciliation mismatches: `0` blocker-level mismatches

### Wallets / Funding

- Stablecoin provisioning success for approved users: `100%` expected path
- Funding gate fail-closed on provider outage: enforced
- No VA-balance substitution for stablecoin threshold: `0` violations

### Virtual Accounts

- Eligibility-to-provisioning path consistency: no blocker mismatches
- Duplicate active VA for same customer/currency (disallowed cases): `0`

### Financial Integrity

- Orphan projections (transfer/wallet/VA): `0`
- Negative balance anomalies (unexpected): `0`
- Duplicate financial effects from replay/retry: `0`

## Alert Priorities

- P0: financial mismatch, duplicate financial effect, queue terminal invariant violation
- P1: sustained webhook/queue degradation, provisioning failures, reconciliation lag
- P2: non-critical observability degradation

## Go/No-Go Rule

- Go-live remains **GO** only while all P0 metrics are green and no P1 metric exceeds the pre-agreed tolerance window.
- Any P0 violation triggers incident mode and rollback decision.
