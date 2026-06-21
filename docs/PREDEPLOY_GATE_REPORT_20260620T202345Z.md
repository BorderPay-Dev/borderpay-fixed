# Unified Pre-Deployment Gate Report

- Generated (UTC): 2026-06-20T20:24:16Z
- Overall: **FAIL**
- Fail-fast stop stage: **Stage 2 - Runtime Contract**

## Stage 1 - Repository Integrity

- Result: **PASS**
- Started: `2026-06-20T20:23:45Z`
- Ended: `2026-06-20T20:23:45Z`

### Evidence

- `PASS` Clean repository state (or explicit CI mode): dirty allowed by mode
- `PASS` Required gate/audit files exist: all required files present
- `PASS` No Maplerad runtime references: none
- `PASS` No unsupported provider runtime dependency: none
- `PASS` Incident SQL remains quarantined: [safety-boundary] OK

### Blocking Issues

- None.

## Stage 2 - Runtime Contract

- Result: **FAIL**
- Started: `2026-06-20T20:23:45Z`
- Ended: `2026-06-20T20:24:16Z`

### Evidence

- `FAIL` verify_runtime_contract.py: runtime_contract_live_verify:
  [OK] C1 required tables
  [OK] C2 required columns
  [OK] C3 required indexes
  [OK] C4 required constraints
  [OK] C5 required RPCs
  [OK] C6 required Edge functions
  [OK] C7 required cron jobs active
  [XX] C8 queue DB settings configured -> missing=['process_jwt', 'process_url']
FAIL (7/8)

### Blocking Issues

- Severity: **CRITICAL**
  Issue: verify_runtime_contract.py
  Remediation: Reconcile live runtime contract failures (tables/columns/indexes/constraints/RPCs/functions/cron/queue settings).
