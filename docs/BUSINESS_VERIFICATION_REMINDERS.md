# Business verification reminders — 25 September 2026

Use the service-authenticated `bridge-missing-customer-migration` endpoint with `action: "remind_business_verification"`, explicit `user_ids` (maximum 25), and `dry_run:true` before dispatch. To send the checked cohort, set `dry_run:false`.

The reminder action only reads Bridge customers and current hosted links; it does not create customers or change account/KYB status. It verifies the confirmed recipient, both customer mappings, company identity, country eligibility, and local restrictions. Bridge must currently report not_started, incomplete, awaiting_ubo/needs_ubos, or an actionable questionnaire/RFI state. Under-review, approved, restricted, missing, and mismatched records are excluded.

Terms-of-Service acceptance links are used first when required. Otherwise the current customer KYB link is retrieved with GET /v0/customers/{id}/kyc_link. Only HTTPS links under bridge.xyz or bridge.withpersona.com are accepted. Hosted links are passed directly to the existing business.verification_reminder renderer, never returned in operator summaries or logged in console output.

Messages describe the current requirement: starting KYB, completing information, or adding UBOs/control persons. No migration or approval promise is included. The 25 September campaign uses durable per-user/stage email idempotency and suppresses onboarding messages sent in the preceding two hours. Failed or queued sends must be inspected in email_log before a retry. The endpoint requires the existing onboarding gate to be enabled.
