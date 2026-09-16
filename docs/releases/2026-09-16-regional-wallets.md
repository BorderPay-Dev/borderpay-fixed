# Regional wallet and saved-account correction

Affected released clients: iOS 1.0.6 (57), Android 1.0.6 (61), source c671361a.

## Contract

- Verified EEA-30: one Base provider resource, USDC and EURC asset views. No Tron/USDT.
- Verified supported non-EEA countries: USDC/Base and USDT/Tron. No EURC, including withdrawal destinations.
- Provision after KYC/KYB approval; reconcile provider inventory before creation. Existing provider wallets and financial balances are not deleted or reset.
- Business jurisdiction is incorporation country; individual jurisdiction is verified provider residence. Unknown scope permits neither regional asset.
- EUR VAs settle to EURC/Base for EEA; all other regional/currency combinations settle to USDC/Base.

## Confirmed incident

An approved Kenya individual had a provider-country observation expiring on September 13. Production wallet and ledger RLS correctly required a fresh observation, but the read path did not refresh it before the wallet queries. Refresh now precedes wallet reads, and the legacy sca-scope request also refreshes the observation for installed clients.

The old UI inferred EEA from an initially false USDT flag, exposed a manual creation action, and could replace saved rows with empty results on failed reads. Region is now explicit, activation is automatic, and failed reads preserve cached rows.

External-account list reconciliation now paginates Bridge even when the local projection is nonempty, normalizes the response, and retains descriptors on failure. The native forms load account capabilities directly. EUR/USD beneficiary names take priority over the GBP provider-name field.

## Production source reconciliation

Read-only downloads showed bridge-wallet, bridge-provision-stablecoins, sca-scope and process-pending-events entrypoints matching the baseline repository. Live bridge-external-account had additional country normalization, response normalization, mirror diagnostics and beneficiary SCA guards; these have been preserved in source. The authorization endpoint and native forms now support that existing beneficiary-change contract with PIN/TOTP and request-bound evidence.

Live bridge-virtual-account already implements regional Base settlement and includes unrelated fee/reactivation/enrollment behavior absent from the repository entrypoint. Do not overwrite that live function with the baseline entrypoint as part of this deployment. The shared destination resolver in this change aligns repository routing for subsequent reviewed deployment; existing live VA routing must be verified separately. No existing VA is rerouted by this migration.

## Validation and rollout

Behavioral tests cover all 249 country-code pairs, EEA-30 scope, fresh/failed country-cache writes, provider wallet reuse, missing non-EEA Tron creation, repeat activation, preserved balances, paginated saved bank accounts, EUR/GBP holder instructions, native hosted-verification resume, and payment/beneficiary SCA evidence. SQL tests exercise EEA/non-EEA ownership reads, expiry and unchanged USDT write restrictions, including applying the migration twice.

Apply only `20260916090000_regional_wallet_asset_reads.sql` after validating live policies. Deploy the changed sca-scope, sca-authorize, bridge-wallet, bridge-provision-stablecoins, bridge-transfer, external-wallet, bridge-external-account and process-pending-events bundles. Preserve currently deployed bridge-virtual-account. Publish the tested frontend to borderpay-recovery and build subsequent TestFlight/Google Play internal releases from the reviewed commit.

Release completion requires deployment receipts, migration confirmation and store-upload results. Local tests do not certify production execution or actual device behavior.
