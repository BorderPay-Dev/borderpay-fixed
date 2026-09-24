# Provider collection release boundaries

Checked against public documentation on 2026-09-20.

The invoice evidence record is provider-neutral, but each receiving account remains bound to an authenticated merchant, provider, customer ID, currency and current active status. Changing a provider/customer binding requires a new review. No automatic retry through another provider is implemented.

## Bridge
The first runtime account reader uses the existing authenticated Bridge adapter. It reads live customer and virtual-account status and preserves the actual beneficiary and mandatory payment reference. It creates no VA and initiates no transfer.

## Borderless
The public virtual-account guide says VAs generally accept first-party deposits, not third-party deposits, and lists US/EU availability. Do not expose a Borderless VA to an invoice buyer merely because the account is active. Require explicit third-party B2B collection permission for the specific product/account and currency. GBP support must be confirmed separately.

Reference: https://docs.borderless.xyz/docs/virtual-accounts

## Enforcement limits
Suppressing bank details does not recall previously shared instructions or stop an inbound payment sent to a known account. Provider-side collection controls and signed deposit-event reconciliation remain required. An invoice approval means the recorded evidence passed the configured BorderPay review; it is not a guarantee against a banking partner hold.
