# App Store Connect Submission Notes

## App Identity

- App name: BorderPay Africa
- Bundle ID: `com.borderpayafrica.app`
- SKU: `borderpay-africa-ios`
- Version: `2.0.0`
- Build: `1`
- Category: Finance
- Age rating: 4+ if no restricted content is introduced

## Review Positioning

BorderPay Africa is a production fintech application for verified individual and business customers. The mobile build bundles the production web app through Capacitor and connects to the same live BorderPay backend, Bridge infrastructure, wallet, virtual account, notification, and transaction systems.

## Required Review Notes

Use a dedicated reviewer account that does not expose real customer data.

Include:

- Demo login email
- Demo password or OTP instructions
- Demo transaction PIN
- KYC/KYB test state explanation
- Note that live money movement requires verified accounts and sufficient wallet balance
- Note that Africa rail provider execution remains locked until provider credentials are enabled

## Screenshots Required

Prepare screenshots for:

- iPhone 6.7-inch
- iPhone 6.5-inch or 5.5-inch if requested by App Store Connect
- iPad only if iPad support is enabled

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
- Payroll or bulk payout, if submitting business screenshots

## Privacy Labels Draft

Validate with counsel before submission.

Data categories likely collected:

- Contact Info: name, email, phone, address
- Financial Info: account balances, transaction history, payout recipients
- Identifiers: user ID, customer ID, device/session identifiers
- Sensitive Info: KYC/KYB identity verification data
- User Content: uploaded identity/business verification documents if handled in-app
- Diagnostics: crash logs, performance, support diagnostics if enabled

Purposes:

- App functionality
- Fraud prevention, security, and compliance
- Customer support
- Analytics only if currently enabled

## Native Submission Blockers

- Full Xcode is required to archive and upload to TestFlight.
- Apple signing team, certificate, and provisioning profile must be selected in Xcode.
- App Store Connect reviewer account must be created before submission.
