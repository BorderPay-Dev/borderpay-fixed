# Payment SCA, EURC withdrawals and native verification

Implementation based on main `6e777ef0` in branch `fix/sca-eurc-mobile-verification`.
This document records local validation, not a production compliance certification.

## Changes

- Business jurisdiction uses only `business_profiles.country`, never the contact's residence. Invalid/missing codes fail closed. Signup is unchanged.
- EEA payment scope no longer depends on wallet inventory. Disabling the SCA service blocks protected payments instead of exempting them.
- PIN then TOTP authorizes the exact request. Payment TOTP counters and authorization IDs are consumed once. Production already consumed TOTP counters across all flows; that stronger behavior is preserved. A verifier without the counter-consumption contract fails closed during rollout.
- An authorization is returned only after its success audit event is stored. The migration supplies the authorization/audit/RPC contract previously absent from tracked migrations and preserves SCA metadata across transaction webhook updates.
- Bulk, operator treasury and public API transfers cannot bypass SCA: those entrypoints lack a two-factor payment flow and reject EEA/unresolved funds owners. The public API uses its existing tenant-authorized source owner and blocks EEA/unresolved owners pending its own SCA flow. Its v258 production dependency graph is preserved under `_shared/public-api-v258` because it contains protections missing from main.
- EURC/Base address saving now accepts an owned Base wallet whose resource row is labelled USDC. The funding read model exposes EURC with the VA-linked provider wallet ID and reads each asset balance separately. The saved destination uses the Transfers API when a payout is authorized; saving does not create a transfer or liquidation address. Tests cover EEA/non-EEA save/list, source ownership/status and the EURC provider payload.
- Native Terms and identity verification use the Capacitor Browser in fullscreen. A failed browser launch leaves the app intact and shows a retry error. Browser closure/return refreshes verification state; web navigation is preserved.

## Local evidence

- 44 Deno runtime tests: actual authorization and transfer HTTP handlers with mocked persistence/Bridge transport, real TOTP cryptography, payload binding, replay rejection, EEA/non-EEA decisions, alternate entrypoint guards, EURC serialization and verification URL/native launch behavior.
- Frontend type check and affected Edge Function type checks.
- Production web build and 26 mobile source regression gates.
- Unified predeploy gate in CI mode. This mode skips live runtime/schema checks without linked production credentials; its PASS is not proof of live behavior.
- The migration passed an isolated PostgreSQL 16 CI job, including reapplication, replay/expiry, role restrictions, atomic audit failure and webhook evidence retention. The live schema was inspected and the migration applied atomically.

## Required release and verification

1. Inspect the live schema/RPC definitions and current Edge versions. The initial approval-service 404 was resolved by direct command execution. The new checkout also needed the confirmed existing IPv4 pooler configuration. Baseline versions: verify-2fa 394, sca-scope 78, sca-authorize 32, bridge-transfer 443, bulk 312, public API 258, operator 14.
2. Validate/apply `20260915170000_payment_sca_evidence_contract.sql` against the confirmed project. Check existing function differences first. It preserves existing rows and does not backfill historical SCA claims.
3. Deploy `verify-2fa` before `sca-authorize`. Deploy `sca-scope`, `bridge-transfer`, `bridge-bulk-payout`, `bridge-operator-readonly` and `public-api-gateway` from this revision. Verify `BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED=true`; false/missing blocks EEA payouts.
4. Publish the tested frontend and build new iOS/Android binaries from this revision. A web deployment does not update assets bundled in already-installed store apps.
5. With an authorized test account, perform one EEA payout and verify the matching authorization, consumed event, outgoing attestation, Bridge transfer record and persisted metadata after a webhook. Verify a missing/expired/replayed authorization cannot move money. A real payout needs a specified account, destination and amount.
6. On physical iOS/Android builds, test incomplete and awaiting-UBO accounts: open Terms, accept, close/return, continue to identity verification, complete/revisit the flow and confirm refreshed status. Check EURC saved-address selection and withdrawal on both EEA and non-EEA accounts.
7. Compare the resulting evidence with Bridge's actual warning/requirements. The warning text is still needed. Reported installed versions are Android 1.0.3 (51) and iOS 1.0.5 (56). Mobile builds and uploads are paused at the user’s request until the EURC flow is fixed.

Read-only historical evidence query: `scripts/diagnostics/payment_sca_evidence.sql`.
Historical payouts without records cannot be represented as SCA-authorized retroactively.

## Production comparison

The deployed TOTP verifier already enforced all-flow replay protection, and bulk payouts used the subscription restriction RPC. Both were newer than main and are preserved. The deployed public API included tenant ownership, transfer caps and balance authorization missing from main; its source and dependency graph are retained in isolation. The 30-day local-evidence query returned 18 EEA payout rows without a linked authorization record; this does not prove whether authentication occurred elsewhere or whether prior webhook writes erased metadata. No historical SCA evidence was fabricated.

## Confirmed backend release

The SCA schema migration is applied and recorded. The metadata retention trigger is enabled; client roles cannot consume authorization or TOTP counters. Confirmed active versions: verify-2fa 395, sca-scope 79, sca-authorize 33, bridge-transfer 444, bridge-bulk-payout 313, public-api-gateway 259 and bridge-operator-readonly 15. The enforcement flag is true. Runtime tests check all 30 EEA incorporation codes. No live customer payout has been initiated by this work.


## Regional wallet and resumed verification completion

- Wallet/Receive/Add Wallet show USDC + EURC for EEA and USDC + USDT for non-EEA. External withdrawal selectors display USDC/Base, EURC/Base and USDT/Tron; USDT remains disabled for EEA under Bridge's documented regional restriction.
- Applied and recorded `20260915190000_restore_non_eea_usdt_reads.sql`. The prior bridge_wallets, bridge_balance_ledger and legacy wallets RLS globally hid USDT. The migration restores authenticated owner SELECT for approved non-EEA customers without granting balance writes. Business incorporation is authoritative; individual residence uses a current provider scope record. Actual authenticated reads confirmed one existing Tron wallet visible for an eligible non-EEA owner and none for an EEA owner. Disposable PostgreSQL tests passed for all 30 EEA codes, non-EEA, ownership, expiry, frozen access and unchanged write restrictions.
- Downloaded production process-pending-events and compared it with this branch: entrypoint identical. Approval provisioning uses one chain-only Base wallet and a chain-level lock; Tron is added only for resolved non-EEA scope. USDT remains a supported wallet settlement asset.
- New HTTP payout test executes the transfer handler and provider serializer against mocked transport: non-EEA USDT goes directly to the saved Tron address, records Bridge transfer ID, returns the same transfer on retry, and rejects insufficient funds, unsaved destinations and EEA/unknown jurisdictions. Actual save/list tests also cover non-EEA USDT.
- Existing individual KYC resumes with GET customer/current kyc_link after authoritative accepted ToS, rather than POSTing the new-customer endpoint or retrying creation without customer_id. Current KYB backend already uses the resume endpoint. HTTP tests cover incomplete/awaiting_ubo/needs_ubos, accepted terms, public HTTPS callback normalization, and native fullscreen handoff. A failed provider lookup cannot create a replacement customer or serve a cached link.
- Frontend type check, production build, both verification Edge type checks and unified predeploy gate passed. Physical-device completion and an actual customer-authorized payout remain unverified; mocked tests do not establish live completion.
- Vercel production deployment targets only the linked borderpay-recovery project. Earlier deployment/promote attempts were blocked by the daily deployment quota. No protected preview has been substituted for the public production app. Installed native apps bundle their JavaScript and need replacement store binaries for frontend changes.

The shared Send address validator previously derived allowed addresses from a Base-only form selector, which rejected every Tron destination. It now validates Base/Tron syntax independently of regional eligibility; the backend retains the EEA USDT prohibition. Added valid, wrong-network and malformed address tests. KYC v335 is confirmed ACTIVE.

Withdrawal funding is separate from regional wallet presentation: Send explicitly requests all owned supported assets, retaining the EURC Base wallet ID and asset-specific balance for non-EEA customers. Ordinary Wallet/Receive views continue to hide EURC for non-EEA accounts. A display snapshot cannot hide or strand a withdrawable balance.
