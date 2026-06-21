# External Account Webhook Coverage RCA

- Date (UTC): 2026-06-21
- Scope: Stage 3 blocker only (`tests/audit/external_account_webhook_coverage_audit.py`)

## One-Line Verdict

Root cause: **stale audit**  
Affected component: `tests/audit/external_account_webhook_coverage_audit.py`  
Risk: **false negative release block; no runtime financial correctness defect**  
Required fix: update E1 audit assertion to canonical route-bucket routing (`case "bridge.external_account":`) instead of legacy `t.startsWith("external_account.")` worker check.

## Evidence

- Worker routes by canonical evaluator bucket:
  - `supabase/functions/process-pending-events/index.ts` contains `case "bridge.external_account": return await handleBridgeExternalAccount(ev);`
- External account handler exists and is wired:
  - `handleBridgeExternalAccount(...)` present in same file
  - writes `bridge_external_accounts` via upsert
  - safe-complete paths for malformed payloads (`missing_external_account_id`, `missing_customer_id`)
- Audit pre-fix E1 expected legacy pattern:
  - looked for `t.startsWith("external_account.")` in worker, which no longer exists after ingress canonicalization.

## Fix Applied

- Updated only:
  - `tests/audit/external_account_webhook_coverage_audit.py`
- Change:
  - E1 now asserts `case "bridge.external_account":` plus `handleBridgeExternalAccount(`.
- No runtime code changes for this RCA fix.

## Post-Fix Verification

- `python3 tests/audit/external_account_webhook_coverage_audit.py` → `PASS (4/4)`
- `python3 scripts/predeploy/run_predeploy_gate.py --ci` → overall `PASS`
  - report: `docs/PREDEPLOY_GATE_REPORT_20260621T122713Z.md`
