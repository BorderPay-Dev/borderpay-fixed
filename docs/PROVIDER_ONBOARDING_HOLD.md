# Temporary Bridge onboarding resume — 25 September 2026

The account owner authorized resuming Bridge onboarding for new customers and repairing missing customer IDs until Mural is integrated. This supersedes the 24 September hold. Set `BRIDGE_ONBOARDING_ENABLED=true` only after deploying the authenticated repair endpoint and guarded customer endpoint. The gate remains fail-closed when absent, invalid, or false; use `false` to pause again.

The operator repair requires the exact service credential; unverified JWT role claims are not accepted. Use an explicit email list and `dry_run:true` first. `notify:true` sends existing transactional verification templates to unconfirmed eligible users and continue-onboarding emails after successful provisioning. Repair emails use a durable per-user resume-operation idempotency key; inspect email_log for delivery status.

Never create customers for restricted, demo, operator, ambiguous, or duplicate identities. Respect IDs in both user and business profiles. Prefer the sole confirmed signup over an unconfirmed duplicate only when neither has an existing provider mapping. Multiple confirmed signups or a business already linked elsewhere require operator review. Bridge country restrictions continue to apply. KYB approval is not implied by provisioning or email verification.

Existing paused/frozen accounts remain frozen. This operation does not move funds, approve applications, enable Mural, or require mobile builds.
