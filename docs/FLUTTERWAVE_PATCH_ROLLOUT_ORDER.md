# Flutterwave Backend Rollout Order (Isolated Patch Train)

Purpose: deterministic merge/deploy sequence for Flutterwave backend-only hardening.

## Base PR
- PR: https://github.com/BorderPay-Dev/borderpay-fixed/pull/88
- Branch: `feat/flutterwave-step2-policy`

## Patch Order
1. `1dfb54d` — DB-backed provider corridor policy + transfer-create gate
2. `cb3663f` — Corridor policy on transfer-rates + account-resolve
3. `2b028de` — Capabilities/momo directory policy gating
4. `34d68d3` — Webhook signature hardening + deterministic event fallback
5. `663acb3` — Channel-aware policy gating in transfer-rates
6. `2ebec03` — Static egress guard for money movement
7. `ce7c611` — Env contract codification for Flutterwave/static-egress
8. `ffd929d` — Quarantine hardcoded Flutterwave corridor helper
9. `887109d` — User-scoped reference uniqueness/idempotency
10. `e6befd1` — Auth required on flutterwave-capabilities endpoint
11. `8a2be95` — Upstream IP allowlist error mapping
12. `3ebc835` — Transfer traceability fields (provider request/status)
13. `114d442` — Retire deprecated fee-quote alias + legacy cleanup audit fix
14. `231badb` — Reference format/length validation
15. `abe08bd` — Propagate static_ip_not_ready on rates/account-resolve
16. `02e23c2` — Propagate static_ip_not_ready on transfer-status

## Required Secrets/Flags Before Enabling Live Money Movement
- `FLW_SECRET_KEY`
- `FLW_BASE_URL`
- `FLW_PAYOUT_ENABLED=true`
- `FLW_RECEIVE_ENABLED=true` (if receive rails enabled)
- `FLW_STATIC_IP_REQUIRED=true`
- `FLW_STATIC_IP_READY=true` only after provider allowlisting is confirmed
- `FLW_WEBHOOK_SECRET_HASH` (or `FLW_WEBHOOK_SECRET`)

## Gate Checks
Run and require pass:
- `tests/audit/flutterwave_*_audit.py` (full suite)

## Rollback Strategy
- Fail closed on static egress:
  - set `FLW_STATIC_IP_READY=false`
  - keep adapter/config present, block only money movement endpoints.
- If deeper rollback needed:
  - revert PR #88 commit range in reverse order.

