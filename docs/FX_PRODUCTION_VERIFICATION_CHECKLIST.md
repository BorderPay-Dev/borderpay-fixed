# FX Production Verification Checklist

Status: OPEN until end-to-end evidence is captured for both Individual and Business.

## Preconditions
- FX route in production resolves to executable Exchange screen (not placeholder copy).
- `backendAPI.fx.convert(...)` is wired to `bridge-transfer`.
- `BRIDGE_TRANSFERS_ENABLED=true` in target environment.
- Test accounts are approved for required rails and have valid source/destination setup.

## Individual Account — Happy Path
1. Login to a real Individual account.
2. Open `Dashboard -> FX`.
3. Select source wallet.
4. Select destination external account.
5. Enter amount > 0.
6. Submit transfer.
7. Verify frontend request path invokes `backendAPI.fx.convert(...)`.
8. Verify backend invokes `bridge-transfer`.
9. Verify response returns `transfer_id` and state.
10. Verify transaction record exists in activity/history.
11. Verify UI shows success state with transfer id/state.

Evidence to capture:
- Browser network request/response for FX submit.
- Edge-function logs showing transfer request + Bridge response.
- Bridge transfer id.
- Transaction record id.
- Screenshot/video of success UI.

## Business Account — Happy Path
1. Login to a real Business account.
2. Open `Business Dashboard -> FX`.
3. Repeat the same execution flow and verification points as Individual.

Evidence to capture:
- Browser network request/response for FX submit.
- Edge-function logs showing transfer request + Bridge response.
- Bridge transfer id.
- Transaction record id.
- Screenshot/video of success UI.

## Failure Paths
1. Missing external account
- Expected: clear product message; no raw payload/errors.

2. Not verified (KYC/KYB not approved)
- Expected: clear verification-required product message; transfer not attempted.

3. Insufficient balance
- Expected: clear balance/funding-required product message.

4. Bridge/provider error
- Expected: safe product message; no raw provider payload.

5. Timeout
- Expected: retry-safe message and stable state; no duplicate submissions.

Evidence to capture for each failure:
- Trigger condition.
- Network request/response.
- UI message text shown.
- Confirmation that no raw backend/provider content is shown.

## User Messaging Contract (Must Pass)
- No raw Supabase errors.
- No raw Bridge payloads.
- No stack traces.
- No variable/runtime internals.
- Messages must be product-safe and user-actionable.

## Deployment Gate Requirement
Pre-promotion gate must fail if FX execution path is not present.

Required gate assertions:
- Exchange screen contains executable submit action.
- Exchange submit calls `backendAPI.fx.convert(...)`.
- FX API convert routes through `bridge-transfer`.
- `bridge-transfer` logs include request -> validation -> bridge request -> bridge response -> transaction recorded.
- Placeholder FX copy is absent from executable FX screen.

## Exit Criteria (Incident Closure)
FX incident can be closed only when:
- Individual happy path evidence is complete.
- Business happy path evidence is complete.
- All failure-path checks pass with product-safe messaging.
- Production build proven to be executable FX build (not placeholder).
