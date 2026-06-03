# Transactional Email Architecture

## Files

```
_shared/email-templates/
├── layout.ts                       # shared <html> shell + helpers
├── index.ts                        # template registry
├── individual/
│   ├── email-verification.ts
│   ├── password-reset.ts
│   └── transaction-notification.ts
└── business/
    ├── email-verification.ts
    ├── kyb-submitted.ts
    ├── kyb-decision.ts             # variant via decision: 'approved' | 'rejected'
    ├── transaction-notification.ts
    └── account-activated.ts
```

## How it works

Every template module exports a single `render(props) → { subject, html, text }`
function. The `index.ts` registry maps a `TemplateName` slug to the renderer.

The unified `send-email` edge function:
1. Receives `{ template, to, props, user_id?, idempotency_key? }`.
2. Renders the template via the registry.
3. Pre-writes a `public.email_log` row (status `queued`).
4. Calls Resend with up to 4 attempts, exponential backoff on 5xx/network.
5. Updates the log row to `sent` (with Resend message id) or `failed` (with last error).
6. Returns the log id either way.

## Verification flow

1. `auth-signup` creates the user UNCONFIRMED, then `issue_email_token()` →
   `send-email` with template `*.email_verification`.
2. Token URL → `app.borderpayafrica.com/auth/verify?token=...&purpose=...`.
3. `EmailVerificationLanding` calls `verify-email-token`, which:
   - `consume_email_token()` (single-use, expiry-aware).
   - `auth.admin.updateUserById({ email_confirm: true })`.
4. User clicks "Continue to sign in", normal sign-in mints the session.

## Triggering each template

| Event | Template | Caller |
|---|---|---|
| Individual signup | `individual.email_verification` | `auth-signup` v88 |
| Individual password reset request | `individual.password_reset` | `auth-reset-password` |
| Individual deposit/payout | `individual.transaction_notification` | `process-pending-events` worker |
| Business signup | `business.email_verification` | `auth-signup` v88 |
| Business KYB submitted | `business.kyb_submitted` | `kyc-submit` (business branch) |
| Business KYB approved/rejected | `business.kyb_decision` | `process-pending-events` terminal KYB decision |
| Business transaction | `business.transaction_notification` | `process-pending-events` worker |
| Business account activated | `business.account_activated` | webhook on first wallet/card success |

## Adding a new template

1. Create the file under `individual/` or `business/`.
2. Implement `export function render(props): { subject, html, text }`.
3. Add the import + entry in `index.ts`'s `TEMPLATES` map and `TemplateName` union.
4. Call from a server-side caller via `send-email` with `template: 'foo.bar'`.

## Mobile-responsive design

All templates use the `htmlLayout()` helper from `layout.ts` which renders a
table-based layout with inline styles, a fixed `max-width: 520px` card, and
no `<style>` tags (Gmail/Outlook strip them). Tested in:

- iOS Mail
- Gmail (web + iOS + Android)
- Apple Mail
- Outlook desktop + outlook.com
- ProtonMail
- Yahoo

## Logging

Every send attempt writes to `public.email_log`:
- `status`: `queued | sending | sent | failed | dropped`
- `attempts`, `last_error` for retries
- `resend_id` for Resend dashboard cross-reference
- `idempotency_key` for de-duplication
- RLS: owner reads their own, admin reads all

Query a user's email history:

```sql
select template, subject, status, sent_at, last_error
  from public.email_log
 where user_id = '...'
 order by created_at desc;
```

Failed delivery dashboard:

```sql
select recipient, template, attempts, last_error, created_at
  from public.email_log
 where status = 'failed'
   and created_at > now() - interval '24 hours'
 order by created_at desc;
```

## Security

- **Tokens** — 32 random bytes (`gen_random_bytes`), URL-safe base64.
  Plaintext is delivered ONLY via the email link; the DB stores `sha256(token)`.
- **Single-use** — `used_at` column; re-use raises `already_used`.
- **Expiry** — 24 h for signup, 1 h for password reset.
- **Rate limit** — `issue_email_token()` enforces ≤ 3 unused tokens per
  (user, purpose) per hour, plus a 60 s cooldown between consecutive issues.
- **Resend abuse** — `auth-resend-verification` uses the same RPC, so the
  rate limiter applies per-user even across edge function calls.
- **Email enumeration** — `auth-resend-verification` returns a soft success
  for non-existent users (no leak).

## Required env vars

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Edge function self-call (auth-signup → send-email) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role auth for log + token tables; bearer for send-email |
| `RESEND_API_KEY` | Resend API |
| `BORDERPAY_FROM_EMAIL` | optional, defaults to `BorderPay Africa <noreply@app.borderpayafrica.com>` |
| `BORDERPAY_APP_URL` | optional, defaults to `https://app.borderpayafrica.com` |

## Deploy commands

```bash
supabase functions deploy send-email                 --project-ref orwrcpwsffjlvzuraxjc
supabase functions deploy verify-email-token         --project-ref orwrcpwsffjlvzuraxjc
supabase functions deploy auth-resend-verification   --project-ref orwrcpwsffjlvzuraxjc
supabase functions deploy auth-signup                --project-ref orwrcpwsffjlvzuraxjc  # v88
```

## Runbook — "user reports they didn't get the email"

1. `select * from public.email_log where recipient = '<email>' order by created_at desc limit 5;`
2. If status = `failed`, `last_error` tells you the Resend / network reason.
3. Cross-reference `resend_id` in the Resend dashboard for delivery / bounce / spam-complaint.
4. If status = `sent` but the user didn't receive it, check Resend's
   suppressions + the recipient's spam folder.
5. Trigger a fresh send via `auth-resend-verification` (rate-limited).

## Runbook — "Resend dashboard shows email rejected for invalid from-domain"

The `BORDERPAY_FROM_EMAIL` value's domain must be verified in Resend
(SPF/DKIM/DMARC). Re-verify under Resend → Domains.
