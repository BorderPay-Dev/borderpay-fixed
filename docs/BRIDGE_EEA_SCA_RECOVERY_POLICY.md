# Bridge EEA SCA enrollment and recovery policy

Owner: BorderPay Security and Compliance

Scope: verified EEA customers using Bridge custodial wallets

## Enrollment

An in-scope customer must enroll both independent factors before account-access, beneficiary-change, funds-out, or protected security-change actions are available:

1. a six-digit transaction PIN (knowledge); and
2. an RFC 6238 authenticator application code (possession).

Email OTP, magic links, device fingerprints, and two knowledge factors are not accepted as the possession factor. Login and fund-in remain available without completing a Bridge SCA event.

## Customer-initiated factor replacement

Removing an active authenticator requires a valid Bridge SCA authorization. After removal, the server starts a 24-hour recovery restriction. Re-enrollment does not shorten that restriction.

During the restriction the customer may:

- sign in;
- access non-financial profile and support functions;
- receive fund-in deposits; and
- enroll a replacement authenticator.

The customer may not:

- view Bridge custodial-wallet balances, transaction history, or wallet details;
- initiate payments or withdrawals;
- add, edit, or delete beneficiaries or external payout destinations;
- change the transaction PIN or password through an authenticated sensitive-action flow; or
- remove or replace another authentication factor.

## Password recovery

A completed password-recovery flow preserves the existing transaction PIN and authenticator enrollment and starts the same 24-hour restriction. A password reset, email recovery link, or support interaction does not create an SCA authorization and cannot unlock financial information.

## Assisted recovery

Support cannot disable SCA or manually mark an authorization successful. If the customer has lost a factor:

1. open a compliance case and freeze SCA-protected actions;
2. verify control of the registered email and perform identity/KYB re-verification appropriate to the account type;
3. compare the request with recent device, beneficiary, and transaction-risk signals;
4. record the reviewer, evidence references, decision, and timestamps without storing credentials in the case;
5. permit factor replacement only after approval by an authorized Compliance operator;
6. retain the 24-hour restriction after replacement; and
7. escalate any suspected compromise or unauthorized transaction under the SCA incident runbook.

No single factor is sufficient to regain protected access. Compliance may extend the restriction or require Bridge intervention; it may not shorten the 24-hour minimum.

## Evidence and retention

Recovery start, blocked authorization attempts, factor replacement, and the final restriction expiry are represented by credential-free SCA audit or compliance events. SCA records must be exported to the independently administered COMPLIANCE-mode object-lock sink for at least 1,827 days.
