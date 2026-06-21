# Unified Pre-Deployment Gate Report

- Generated (UTC): 2026-06-21T12:39:23Z
- Overall: **FAIL**
- Fail-fast stop stage: **Stage 2 - Runtime Contract**

## Stage 1 - Repository Integrity

- Result: **PASS**
- Started: `2026-06-21T12:39:14Z`
- Ended: `2026-06-21T12:39:15Z`

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
- Started: `2026-06-21T12:39:15Z`
- Ended: `2026-06-21T12:39:23Z`

### Evidence

- `FAIL` verify_runtime_contract.py: runtime_contract_live_verify: FAIL (error=/Users/a/.zprofile:1: no such file or directory: /opt/homebrew/bin/brew
Initialising login role...
failed to initialise login role: Post "https://api.supabase.com/v1/projects/orwrcpwsffjlvzuraxjc/cli/login-role": failed to dial native: dial tcp: lookup api.supabase.com: no such host
Connect to your database by setting the env var correctly: SUPABASE_DB_PASSWORD)

### Blocking Issues

- Severity: **CRITICAL**
  Issue: verify_runtime_contract.py
  Remediation: Reconcile live runtime contract failures (tables/columns/indexes/constraints/RPCs/functions/cron/queue settings).
