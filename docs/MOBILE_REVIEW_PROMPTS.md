# Mobile review prompts

Included in the next native builds through `@capacitor-community/in-app-review` 8 and `@capacitor/app-launcher` 8. Run `npm ci`, `npm run build`, and `npx cap sync` before creating release archives.

## Automatic request

The completed payment receipt's **Done** button can request a native store review when:

- The current profile check confirms verification.
- The transfer has a transaction ID and is completed, rather than submitted/pending.
- The flow is not an African sandbox payout.
- The account has opened the native app on at least three distinct UTC dates.
- The device has not attempted a review request within 90 days.

Usage dates are local and scoped to the account; request pacing is shared across accounts on the device. The timestamp records an attempt only. The app cannot determine whether the OS displayed a prompt or the customer submitted a review. Clearing app data resets local pacing; store quotas still apply.

Review failures, unavailable storage, older binaries without the plugin, and suppressed dialogs do not interrupt payment completion or navigation. There is no sentiment pre-screen or incentive. Asynchronously completed payouts do not trigger a prompt unless the app displays a confirmed completed receipt; simply submitting a payout never does.

## Customer-initiated review

**Help Center → Quick Links → Rate BorderPay** opens the appropriate store using the system launcher. This option is available in native builds with the launcher plugin and is independent of automatic request pacing.

- Apple: https://apps.apple.com/app/id6791659887?action=write-review
- Google: https://play.google.com/store/apps/details?id=com.borderpayafrica.app

## Release validation

- Validate StoreKit in an iOS development build. TestFlight does not display native review requests.
- Validate Android using a Google Play internal-testing installation with an eligible tester. The store may suppress the dialog according to its own quota.
- Test the manual store link on each platform.
- Confirm pending/error receipts do not prompt and that dismissing a prompt does not affect the payment.
- Use new, unused build numbers when archiving; this change does not upload or submit a store release.
