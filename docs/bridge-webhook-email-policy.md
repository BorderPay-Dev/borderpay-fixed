# Bridge webhook → email policy (design only)

Status: **source-only policy doc. No code, no deploy, no Resend calls, no DB
writes.** Locks the allowlist, recipient rules, idempotency, and in-app-only
exclusions BEFORE any implementation. Implementation is a later, separate,
deploy-gated backend PR.

## 0. Principle

**"Important webhooks" does NOT mean "email on every webhook."** Emailing every
Bridge event would be noisy, duplicative, and a deliverability/compliance risk.
Email is reserved for events that are both:

1. **Terminal** — a final state the user can't infer from in-app polling, not an
   intermediate/lifecycle tick, AND
2. **Customer-visible & actionable** — the user needs to know or act.

Everything else stays **in-app only** (notifications), or is ignored.

## 1. Routing & guardrails (non-negotiable)

- All webhook email goes through the **logged `send-email`** edge function
  (`Authorization: Bearer SEND_EMAIL_INTERNAL_TOKEN`), which renders a template,
  writes `public.email_log` via `log_email_attempt`, and calls Resend with retry.
  **Never call Resend directly from the worker.**
- Sender stays the proven apex: `BorderPay <noreply@borderpayafrica.com>`
  (`BORDERPAY_FROM_EMAIL`).
- **Recipient = `user_profiles.email` for the mapped customer only.** Never an
  address taken from the webhook payload. Internal/test accounts are excluded by
  the explicit suppression predicate in §5.
- Email sending is **best-effort and must NOT fail webhook processing.** The
  worker's authoritative job is status sync; a `send-email` failure is logged
  (`email_log` + a worker log line) and the `pending_events` row still completes.
- Deploy-gated: touches the deployed `process-pending-events`; ships byte-verbatim
  with redeploy, never as a no-deploy comment edit (repo↔deployed drift rule).

## 2. Idempotency (built-in, must be used)

`send-email` already dedupes: `log_email_attempt(p_idem_key)` returns the existing
row and `send-email` bails with `deduped: true` if a matching key already reached
`status='sent'`. The worker MUST pass a stable key:

```
idempotency_key = `wh:${bridge_event_id}:${template}`
```

- `bridge_event_id` = the Bridge `event_id` (e.g. `wh_…`), stable across retries.
- Bridge re-delivery, worker retries (`attempts` up to 6), and replays therefore
  **cannot double-send**.
- Per-recipient safety: also include `user_id` in the key if one Bridge event can
  fan out to multiple users (not currently the case for customer-scoped events).

## 3. Allowlist — events that DO send email

| Bridge event (worker handler) | Email when | Template | Recipient |
|---|---|---|---|
| `customer.kyc*` / `kyc_link.*` → **approved** (individual) | terminal approve | **NEW** `individual.kyc_decision` | the customer |
| `customer.kyc*` / `kyc_link.*` → **rejected** (individual) | terminal reject | **NEW** `individual.kyc_decision` | the customer |
| `customer.kyb*` / `kyc_link.*` → approved/rejected (business) | terminal decision | `business.kyb_decision` (exists) | business owner |
| `transfer.*` / `payout.* ` → **completed** | terminal, **only when `TRANSFERS_LIVE`** | `*.transaction_notification` (exists) | sender |
| `transfer.*` / `payout.*` → **failed/returned** | terminal, **only when `TRANSFERS_LIVE`** | `*.transaction_notification` (exists) | sender |
| `virtual_account.*` → **provisioned (activated)** | first activation | **NEW** `*.account_ready` (or reuse `business.account_activated` for business) | account owner |
| `virtual_account.*` → **failed/rejected** | terminal failure | **NEW** `*.account_ready` | account owner |
| `wallet.*` → **provisioned** | first activation | **NEW** `*.account_ready` | wallet owner |
| `wallet.*` → **failed** | terminal failure | **NEW** `*.account_ready` | wallet owner |

**Template gaps to close before implementation** (do NOT email these until the
template exists): `individual.kyc_decision`, and a VA/wallet "account ready /
failed" template (`*.account_ready`). `business.kyb_decision`,
`business.account_activated`, and `*.transaction_notification` already exist.

## 4. In-app-only / never-email (exclusions)

- **Deposits / incoming credits** (`deposit.*`, wallet credit) → in-app
  notification only (high-frequency; email would be spammy). Revisit only if
  product explicitly wants deposit receipts.
- **Lifecycle / intermediate states**: `*.created`, `*.updated`, `under_review`,
  `pending`, `not_started` → in-app at most. No email for non-terminal status.
- **Signature-rejected / unknown / probe events** → never (security/no-op).
- **Internal/test accounts** → excluded by the explicit suppression predicate (§5).
- **Maplerad-source events** → provider removed; never email (already no-op in the
  worker).

> Money-movement emails (`transfer.*`/`payout.*`) are **flag-gated on
> `TRANSFERS_LIVE`** and stay dark until money movement is CEO/CTO-approved.

## 5. Recipient & privacy rules

- Resolve recipient from `user_profiles` by the mapped `bridge_customer_id` /
  `user_id`; send to that row's `email`. Never from payload.
- Skip send when any of these are true:
  - no mapped user;
  - `user_profiles.is_admin = true`;
  - recipient email is listed in a server-side suppress list (for founder/test/
    internal accounts; example secret/config name:
    `WEBHOOK_EMAIL_SUPPRESS_LIST`);
  - recipient domain is listed in a server-side suppress-domain list (default
    candidate: `borderpayafrica.com`, unless explicitly disabled for an operator
    smoke test);
  - email absent; or
  - email unconfirmed.
- Any exception (for example KYC decisions to unconfirmed users) must be approved
  and tested in the implementation PR, not silently enabled by this policy.
- The implementation audit must assert that the worker resolves this predicate
  from DB and config state, and never decides "internal" from webhook payload
  fields.
- No PII in logs beyond what `email_log` already stores; per-user ids stay out of
  the public repo.

## 6. Worker touchpoint (where the send hooks in)

In `process-pending-events`, after the authoritative DB sync in each handler, on a
**terminal transition only**:

- `handleBridgeKycKyb` → KYC/KYB approved/rejected email.
- `handleBridgeTransfer` → transfer completed/failed email (flag-gated).
- `handleBridgeVirtualAccount` → VA provisioned/failed email.
- `handleBridgeWallet` → wallet provisioned/failed email.
- `handleBridgeCustomerStatus` (`customer.updated`) → only if it carries a terminal
  KYC decision; depends on the §7 dependency below.

Each call: resolve recipient → choose template + props → `fetch(send-email,
Bearer SEND_EMAIL_INTERNAL_TOKEN, { to, template, props, user_id,
idempotency_key })` → on failure, log and continue (never throw).

## 7. Dependencies & sequencing

1. **Depends on `#53 item 4`** (backend `handleBridgeCustomerStatus` terminal
   propagation): the worker must reliably know a *terminal* KYC decision before it
   can email one. Build/confirm that first so emails fire on true terminal state,
   not on every `customer.updated`.
2. **Template PR** — add the missing templates (`individual.kyc_decision`,
   `*.account_ready`) under `_shared/email-templates/` (+ render tests). No worker
   change yet.
3. **Worker email PR** — wire the allowlisted terminal transitions to `send-email`
   with the idempotency key; deploy-gated; ships with an audit asserting: only
   allowlisted terminal events email, routing via `send-email` (no direct Resend),
   idempotency key present, recipient from `user_profiles`, send failure is
   non-fatal, transfer emails flag-gated on `TRANSFERS_LIVE`.

## 8. Guardrails (standing)

No direct Resend · no email on non-terminal/lifecycle events · no payload-sourced
recipients · idempotent via `send-email` · best-effort (never fails the webhook) ·
deploy-gated · transfer emails behind `TRANSFERS_LIVE` · internal/test accounts
excluded by the §5 suppression predicate · PII out of the repo. This doc changes
no code and deploys nothing.
