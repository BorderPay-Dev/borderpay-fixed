# Live Bridge Sandbox Validation Report

- Generated (UTC): 2026-06-21T06:02:55+00:00
- Overall: **FAIL**

## Preflight (Step 1)

### P1 required sandbox env present
- Result: **FAIL**
- Evidence: `missing=['LIVE_SUPABASE_URL', 'LIVE_SUPABASE_SERVICE_ROLE_KEY', 'BRIDGE_API_KEY']`
- Business impact: No live validation can run without explicit sandbox credentials.
- Deployment risk: critical

### P2 target Supabase project is non-production
- Result: **FAIL**
- Evidence: `project_ref=unknown; blocked_prod_ref=orwrcpwsffjlvzuraxjc`
- Business impact: Prevents accidental writes/reads against production while running live scenarios.
- Deployment risk: critical

### P3 Bridge key is sandbox key
- Result: **FAIL**
- Evidence: `bridge_key_prefix=UNSET; detected_key_kind=unknown`
- Business impact: Prevents live Bridge account mutations during validation.
- Deployment risk: critical

### P4 bridge-ping function reachable in sandbox
- Result: **FAIL**
- Evidence: `skipped: missing sandbox credentials or target resolved to production`
- Business impact: Cannot confirm runtime wiring without safe sandbox target.
- Deployment risk: high

### P5 Bridge sandbox API reachable
- Result: **FAIL**
- Evidence: `skipped: BRIDGE_API_KEY missing or not sandbox key`
- Business impact: Live sandbox scenarios cannot run without a valid sandbox API key.
- Deployment risk: high

## Blocking Issues

- Sandbox credentials/target are not fully validated yet. Full Phase 3 scenario execution is blocked until preflight is all PASS.

## Rollback Strategy

- Not applicable for Step 1 preflight (no runtime mutation, no deployment, no migration).
