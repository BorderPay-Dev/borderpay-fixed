# Unified Pre-Deployment Gate Report

- Generated (UTC): 2026-06-21T12:40:28Z
- Overall: **PASS**

## Stage 1 - Repository Integrity

- Result: **PASS**
- Started: `2026-06-21T12:39:38Z`
- Ended: `2026-06-21T12:39:38Z`

### Evidence

- `PASS` Clean repository state (or explicit CI mode): dirty allowed by mode
- `PASS` Required gate/audit files exist: all required files present
- `PASS` No Maplerad runtime references: none
- `PASS` No unsupported provider runtime dependency: none
- `PASS` Incident SQL remains quarantined: [safety-boundary] OK

### Blocking Issues

- None.

## Stage 2 - Runtime Contract

- Result: **PASS**
- Started: `2026-06-21T12:39:38Z`
- Ended: `2026-06-21T12:40:21Z`

### Evidence

- `PASS` verify_runtime_contract.py:   [OK] C8 queue runtime mode supported -> runtime_mode=Legacy app_config; configuration_source_detected=legacy_app_config; queue_endpoint=https://orwrcpwsffjlvzuraxjc.supabase.co/...; authentication_source=app_config.worker_auth_token; evidence=cron_source:legacy_app_config,fire_source:legacy_app_config,invoke_source:absent; warnings=none

### Blocking Issues

- None.

## Stage 3 - Financial Correctness Audits

- Result: **PASS**
- Started: `2026-06-21T12:40:21Z`
- Ended: `2026-06-21T12:40:28Z`

### Evidence

- `PASS` Audit tests/audit/customer_identity_invariant_phase1_audit.py: All Phase 1 identity invariant checks passed.
- `PASS` Audit tests/audit/bridge_webhook_signature_audit.py: PASS (9/9 invariants)
- `PASS` Audit tests/audit/bridge_ingest_event_audit.py: PASS (8/8 invariants)
- `PASS` Audit tests/audit/webhook_transfer_reconciliation_audit.py: PASS (4/4)
- `PASS` Audit tests/audit/provisioning_lock_resilience_audit.py: PASS (5/5)
- `PASS` Audit tests/audit/funding_gate_outage_policy_audit.py: PASS (5/5)
- `PASS` Audit tests/audit/external_account_webhook_coverage_audit.py: PASS (4/4)
- `PASS` Audit tests/audit/queue_orchestration_config_hardening_audit.py: PASS (3/3)
- `PASS` Audit tests/audit/queue_runtime_prereq_assertions_audit.py: PASS (2/2)
- `PASS` Audit tests/audit/bridge_event_envelope_audit.py: PASS (10/10 invariants)
- `PASS` Audit tests/audit/bridge_core_contract_audit.py: PASS (7/7 invariants)
- `PASS` Audit tests/audit/state_transition_invariant_audit.py: PASS (7/7 checks passed)
- `PASS` Audit tests/audit/bridge_ingress_canonicalization_audit.py:   PASS C8b worker asserts decision boundary
- `PASS` Audit tests/audit/synthetic_event_isolation_audit.py:   PASS SYN7 ingress has no direct lifecycle table writes
- `PASS` Lifecycle write-path exhaustiveness (Phase A): PASS
- `PASS` Lifecycle runtime lock objective (Phase C): PASS

### Blocking Issues

- None.

## Stage 4 - Bridge Integration Verification

- Result: **PASS**
- Started: `2026-06-21T12:40:28Z`
- Ended: `2026-06-21T12:40:28Z`

### Evidence

- `PASS` Customer lifecycle handler: OK
- `PASS` KYC/KYB lifecycle handler: OK
- `PASS` Stablecoin provisioning path: OK
- `PASS` Virtual account lifecycle handler: OK
- `PASS` External account lifecycle handler: OK
- `PASS` Transfer lifecycle handler: OK
- `PASS` Webhook taxonomy routing: OK
- `PASS` Bridge idempotency (wallet create): OK
- `PASS` Bridge idempotency (VA create): OK
- `PASS` Bridge idempotency (transfer create): OK
- `PASS` Funding gate uses Bridge wallet balances only: OK
- `PASS` Canonical transfer state mapper exists: OK

### Blocking Issues

- None.

## Stage 5 - Architecture Policy

- Result: **PASS**
- Started: `2026-06-21T12:40:28Z`
- Ended: `2026-06-21T12:40:28Z`

### Evidence

- `PASS` Bridge remains financial infrastructure path: bridge provider call sites=25
- `PASS` No provider abstraction expansion in runtime: none
- `PASS` BorderPay UI/orchestration layer present: components/src present

### Blocking Issues

- None.

## Stage 6 - Deployment Readiness

- Result: **PASS**
- Started: `2026-06-21T12:40:28Z`
- Ended: `2026-06-21T12:40:28Z`

### Evidence

- `PASS` No known undeployed runtime/schema dependency: none
- `PASS` Environment contract keys documented: all required env keys documented
- `PASS` Queue prerequisites delegated to runtime contract gate: Stage 2 includes queue DB settings + cron checks.

### Blocking Issues

- None.
