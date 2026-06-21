# Unified Pre-Deployment Gate Report

- Generated (UTC): 2026-06-20T19:28:48Z
- Overall: **FAIL**
- Fail-fast stop stage: **Stage 1 - Repository Integrity**

## Stage 1 - Repository Integrity

- Result: **FAIL**
- Started: `2026-06-20T19:28:48Z`
- Ended: `2026-06-20T19:28:48Z`

### Evidence

- `FAIL` Clean repository state (or explicit CI mode): dirty files detected (68)
- `PASS` Required gate/audit files exist: all required files present
- `PASS` No Maplerad runtime references: none
- `PASS` No unsupported provider runtime dependency: none
- `PASS` Incident SQL remains quarantined: [safety-boundary] OK

### Blocking Issues

- Severity: **HIGH**
  Issue: Clean repository state (or explicit CI mode)
  Remediation: Commit/stash local changes before deployment, or run gate with --ci in CI context only.
