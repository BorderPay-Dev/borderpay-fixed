# Google Play Console Submission Notes

## App Identity

- App name: BorderPay Africa
- Package name: `com.borderpayafrica.app`
- Version name: `2.0.0`
- Version code: `1`
- Category: Finance

## Release Track

Use internal testing first. Do not publish to production until:

- Android App Bundle builds successfully
- Signing key is configured in Play Console
- Internal testers complete login, wallet, VA, send, receive, notification, and business smoke tests
- Data safety form is reviewed

## Store Listing Draft

Short description:

Borderless finance for Africa.

Full description:

BorderPay Africa helps verified individuals and businesses receive, hold, and move money across supported corridors. Users can manage wallets, virtual accounts, transactions, notifications, and payout flows from one mobile-first application.

## Data Safety Draft

Validate with counsel before submission.

Data likely collected:

- Personal info: name, email, phone, address
- Financial info: account balances, transactions, payout recipients
- Photos/files: verification documents if uploaded in-app
- Device or other IDs: user/session/device identifiers
- App activity: app interactions, transaction events, notification events

Data use:

- App functionality
- Fraud prevention, security, and compliance
- Account management
- Customer support

Security:

- Data is transmitted over HTTPS.
- Android cleartext traffic is disabled.
- Android app backup is disabled.

## Screenshots Required

Prepare at minimum:

- Phone screenshots
- 7-inch tablet screenshots if Play Console requests tablet coverage
- 10-inch tablet screenshots if Play Console requests tablet coverage

Recommended screens:

- Dashboard
- Wallets and accounts
- Add wallet / available accounts
- Send money
- Africa payout preview
- Receive money
- Transactions
- Notifications
- Business dashboard

## Native Submission Blockers

- Java runtime is required for Gradle.
- Android SDK / Android Studio is required for final AAB validation.
- Play signing key must be configured before production release.
