# Partner decisions and notifications

Selecting any of the five review decisions fills an editable message in both
operator interfaces. The final notes are explicitly partner-facing and appear
in the decision email. Templates use portal.borderpayafrica.com and include a
saved review reference. Approval does not promise production activation.

record_partner_application_decision saves application/organization status, the
review and audit atomically. It is service-role-only and validates the acting
admin. Retrying the same decision/notes/actor reuses the latest review when its
status is still current. New approvals retain the existing disabled-sandbox setup.

The endpoint then calls send-email with partner-decision:<review UUID>. The
existing dispatcher records provider status in email_log and deduplicates sent,
sending and queued attempts. Failed sends can be retried with Record decision;
the message stays in the form and the saved decision is not reported as lost.
The endpoint also appends delivery status and email_log ID to partner audit.
A saved decision audit with email_notification=pending and no delivery outcome
identifies an interrupted invocation for operator retry. No historical decisions
are automatically emailed.

Verification:
- deno test --no-lock tests/partner-decision-email.test.ts
- PGLITE_MODULE=<installed @electric-sql/pglite/dist/index.js> node tests/partner-decision-record.test.mjs
- Deno checks against the preserved live send-email and partner admin sources
- Production builds for admin and partner portal
- Browser fixtures: all five auto-messages, manual edits in saved payload, and
  retaining edited notes after a simulated email failure

SQL: supabase/migrations/20260918031000_partner_decision_record.sql. This migration
creates only the decision RPC and its grants; it does not approve any application.
