# Payment SCA, EURC withdrawals and native verification

Implementation based on main `6e777ef0` in branch `fix/sca-eurc-mobile-verification`.
This document records local validation, not a production compliance certification.

## Changes

- Business jurisdiction uses only `business_profiles.country`, never the contact's residence. Invalid/missing codes fail closed. Signup is unchanged.
- EEA payment scope no longer depends on wallet inventory. Disabling the SCA service blocks protected payments instead of exempting them.
- PIN then TOTP authorizes the exact request. Payment TOTP counters and authorization IDs are consumed once. A verifier without the counter-consumption contract fails closed during rollout.
- An authorization is returned only after its success audit event is stored. The migration supplies the authorization/audit/RPC contract previously absent from tracked migrations and preserves SCA metadata across transaction webhook updates.
- Bulk, operator treasury and public API transfers cannot bypass SCA: those entrypoints lack a two-factor payment flow and reject EEA/unresolved funds owners. The public API requires a source wallet mapped to a verified non-EEA owner; unmapped API-only customers are blocked pending their own SCA integration.
- EURC on Base already exists in main for both regions. Runtime tests cover its provider payload, and release gates now include the EURC withdrawal regression checks.
- Native Terms and identity verification use the Capacitor Browser in fullscreen. A failed browser launch leaves the app intact and shows a retry error. Browser closure/return refreshes verification state; web navigation is preserved.

## Local evidence

- 39 Deno runtime tests: actual authorization and transfer HTTP handlers with mocked persistence/Bridge transport, real TOTP cryptography, payload binding, replay rejection, EEA/non-EEA decisions, alternate entrypoint guards, EURC serialization and verification URL/native launch behavior.
- Frontend type check and affected Edge Function type checks.
- Production web build and 26 mobile source regression gates.
- Unified predeploy gate in CI mode. This mode skips live runtime/schema checks without linked production credentials; its PASS is not proof of live behavior.
- PostgreSQL migration has not been applied or executed locally. Docker access is unavailable in this sandbox.

## Required release and verification

1. Inspect the live schema/RPC definitions and current Edge versions. The read-only lookup was rejected by the automatic approval service with an infrastructure 404, so no live version claims are made here.
2. Validate/apply `20260915170000_payment_sca_evidence_contract.sql` against the confirmed project. Check existing function differences first. It preserves existing rows and does not backfill historical SCA claims.
3. Deploy `verify-2fa` before `sca-authorize`. Deploy `sca-scope`, `bridge-transfer`, `bridge-bulk-payout`, `bridge-operator-readonly` and `public-api-gateway` from this revision. Verify `BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED=true`; false/missing blocks EEA payouts.
4. Publish the tested frontend and build new iOS/Android binaries from this revision. A web deployment does not update assets bundled in already-installed store apps.
5. With an authorized test account, perform one EEA payout and verify the matching authorization, consumed event, outgoing attestation, Bridge transfer record and persisted metadata after a webhook. Verify a missing/expired/replayed authorization cannot move money. A real payout needs a specified account, destination and amount.
6. On physical iOS/Android builds, test incomplete and awaiting-UBO accounts: open Terms, accept, close/return, continue to identity verification, complete/revisit the flow and confirm refreshed status. Check EURC saved-address selection and withdrawal on both EEA and non-EEA accounts.
7. Compare the resulting evidence with Bridge's actual warning/requirements. The warning text and affected store build numbers have been requested but are not yet available.

Read-only historical evidence query: `scripts/diagnostics/payment_sca_evidence.sql`.
Historical payouts without records cannot be represented as SCA-authorized retroactively.
