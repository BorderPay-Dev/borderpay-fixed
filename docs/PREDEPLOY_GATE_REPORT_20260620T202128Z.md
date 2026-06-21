# Unified Pre-Deployment Gate Report

- Generated (UTC): 2026-06-20T20:22:03Z
- Overall: **FAIL**
- Fail-fast stop stage: **Stage 2 - Runtime Contract**

## Stage 1 - Repository Integrity

- Result: **PASS**
- Started: `2026-06-20T20:21:28Z`
- Ended: `2026-06-20T20:21:29Z`

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
- Started: `2026-06-20T20:21:29Z`
- Ended: `2026-06-20T20:22:03Z`

### Evidence

- `FAIL` verify_runtime_contract.py: /Users/a/.zprofile:1: no such file or directory: /opt/homebrew/bin/brew

### Blocking Issues

- Severity: **CRITICAL**
  Issue: verify_runtime_contract.py
  Remediation: Reconcile live runtime contract failures (tables/columns/indexes/constraints/RPCs/functions/cron/queue settings).
