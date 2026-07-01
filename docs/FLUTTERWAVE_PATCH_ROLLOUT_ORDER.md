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
17. `4975f8a` — Reconcile only transfer-relevant webhook events
18. `90d58a4` — Block retry on terminal completed/reversed transfers
19. `a93fc3b` — Scope webhook reference reconciliation to user identity
20. `cc75d5c` — Centralize Bridge verification helper across endpoints
21. `a598dcb` — Enforce minimum transfer amount guard via env threshold
22. `e97dcab` — Add CI workflow for Flutterwave suite audits
23. LOCAL — Add Flutterwave collections backend scaffold (create/status) with receive corridor policy + static IP guard
24. LOCAL — Reconcile collection webhooks as receive-direction money movement
25. LOCAL — Add authenticated flutterwave-transfers-list endpoint (ownership + bounded filters)
26. LOCAL — Extend Flutterwave backend contract audit to include collections/list endpoints
27. LOCAL — Make flutterwave-capabilities direction-aware (payout/receive)
28. LOCAL — Tighten webhook user-scoped reconcile audit for direction-aware updates
29. LOCAL — Extend static IP guard audit to enforce collection-create protection
30. LOCAL — Centralize Flutterwave status mapping across transfer/collection/webhook paths
31. LOCAL — Add strict config pin audit for all Flutterwave edge functions (verify_jwt contract)
32. LOCAL — Normalize collection-status IP allowlist failures to static_ip_not_ready
33. LOCAL — Add before-cursor pagination for flutterwave-transfers-list
34. LOCAL — Add minimum collection amount guard via FLW_MIN_COLLECTION_AMOUNT
35. LOCAL — Whitelist source filter in flutterwave-transfers-list
36. LOCAL — Enforce FLW_MIN_COLLECTION_AMOUNT presence in env contract audit
37. LOCAL — Add authenticated flutterwave-collections-list endpoint (receive scope)
38. LOCAL — Enforce receive-direction scoping in collection-status DB path
39. LOCAL — Add explicit direction filtering/capability guard in transfer-status
40. LOCAL — Add local_transfer_id lookup support to collection-status
41. LOCAL — Add transfer-status direction gating audit to lock regression
42. LOCAL — Include transfer direction in collections-list response rows
43. LOCAL — Include source in collections-list response rows
44. LOCAL — Persist provider trace fields on successful transfer retry path
45. LOCAL — Lock collections-list source field in backend contract audit
46. LOCAL — Include source in transfers-list response rows + lock audit
47. LOCAL — Add direction capability guards in transfers-list endpoint
48. LOCAL — Lock transfer-status response direction contract in audit
49. LOCAL — Add explicit direction/source response contract for collection-status
50. LOCAL — Add explicit source response contract for transfer-status
51. LOCAL — Add explicit direction/source response contract for transfer-create
52. LOCAL — Add explicit direction/source response contract for collection-create
53. LOCAL — Lock create-response direction/source in central backend contract audit
54. LOCAL — Add explicit direction/source response contract for transfer-retry
55. LOCAL — Add channel filtering to transfers/collections list endpoints
56. LOCAL — Lock list-endpoint channel filters in central backend contract audit
57. LOCAL — Scope transfer/collection status lookups strictly to Flutterwave source rows
58. LOCAL — Enforce Flutterwave source scoping in transfer/collection list endpoints
59. LOCAL — Add explicit channel field to transfer/collection status responses
60. LOCAL — Include capabilities in collection-status success contract
61. LOCAL — Fail-closed transfers-list when rails disabled + auto-scope by enabled direction
62. LOCAL — Include explicit provider_status in transfer/collection status responses

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
