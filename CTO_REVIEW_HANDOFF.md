# CTO review handoff — Bridge core, security pillars, KYC link

This document is the single hand-off for CTO review. It covers what
changed, what is live, what is deferred and why, and a runbook to verify
the system end-to-end.

Last updated: 2026-05-18.
Production: `https://app.borderpayafrica.com`
Supabase: `orwrcpwsffjlvzuraxjc.supabase.co`

---

## 1. Headline state

| Surface | Status |
|---|---|
| Signup | **Live**, end-to-end (auth-signup v98 → user_profiles + users + business_profiles → starter subscription seeded → verification email via Resend). |
| Bridge KYC link | **Live**, smoke-tested both code paths (fresh user + user with orphan `bridge_customer_id`) returning a real `bridge.withpersona.com/verify?...` URL. |
| Bridge KYB link | **Live**, same dual-mode pattern. |
| Wallet-debit subscriptions | **Live** (`subscription-current`, `subscription-upgrade` atomic VA debit). |
| Business team management | **Live** (`business-team-list`, `business-team-invite`, `business-team-remove`). |
| PIN | **Live**, server-backed PBKDF2-SHA256 100k iterations + 32-byte salt, 5-attempt lockout (15 min). |
| TOTP | **Live**, server-side secret + AES-256-GCM encryption at rest (env `TOTP_ENCRYPTION_KEY` provisioned). |
| WebAuthn biometric | **Live**, server-verified via 4 edge functions + `@simplewebauthn/server`. |
| FX widget on Home | **Live** with 1.5% markup constant (`utils/fx/markup.ts`). |
| Database | **Clean** — zero Maplerad / Stripe references remain (tables, columns, functions, triggers all swept). |
| Verified-state policy | **All 53 users at `bridge_kyc_status = null`.** Bridge webhook is the only source of truth that flips a user to verified. |

## 2. Re-verification policy (CRITICAL)

The product policy implemented this week:

- **No legacy verification carries forward.** All 4 users previously marked
  `kyc_status = 'verified'` (under the prior provider) were downgraded to
  `pending` by the `downgrade_legacy_verified_force_partner_reverify`
  migration. They must re-verify via Bridge.
- The frontend `useVerification` hook reads `bridge_kyc_status` (or
  `bridge_kyb_status` for business), not the legacy `kyc_status` column.
- A `BEFORE UPDATE` trigger on `user_profiles.bridge_kyc_status` mirrors
  transitions into the legacy `kyc_status` column. Same for
  `business_profiles.bridge_kyb_status`. This keeps any code path that
  still reads `kyc_status` consistent with Bridge.
- Bridge webhook (`bridge-webhook` v1) is the only thing that writes
  `bridge_kyc_status = 'approved'`. No frontend path can bypass.

**So yes: all 53 users must complete Bridge KYC to become verified.**
The single user with `bridge_customer_id` (orphan from a prior attempt)
will still go through Bridge — the function attaches the existing
customer rather than creating a new one.

## 3. Backend — deployed edge functions

All deployed via Supabase MCP. Counts and versions on `2026-05-18`:

```
auth-signup                 v98   verify_jwt:false
auth-resend-verification    v1    verify_jwt:false
verify-email-token          v1    verify_jwt:false
get-user-profile            v95   verify_jwt:true
kyc-status                  v25   verify_jwt:true
get-kyc-jobs                v1    verify_jwt:true
bridge-ping                 v2    verify_jwt:false
bridge-customer             v1    verify_jwt:false
bridge-kyc-link             v6    verify_jwt:false   ← Persona link, dual-mode
bridge-kyb-link             v5    verify_jwt:false
bridge-virtual-account      v1    verify_jwt:true
bridge-wallet               v1    verify_jwt:true
bridge-transfer             v1    verify_jwt:true
bridge-webhook              v1    verify_jwt:false   ← RSASSA-PKCS1-v1.5 SHA-256 verify
process-pending-events      v1    verify_jwt:false
subscription-current        v1    verify_jwt:false
subscription-upgrade        v1    verify_jwt:false
business-team-list          v1    verify_jwt:true
business-team-invite        v1    verify_jwt:true
business-team-remove        v1    verify_jwt:true
setup-pin                   v83   verify_jwt:true    ← PBKDF2 + attempt counter
verify-pin                  v83   verify_jwt:true    ← Lockout
setup-2fa                   v83   verify_jwt:true    ← AES-256-GCM encrypt
verify-2fa                  v85   verify_jwt:true    ← Decrypt + RFC-6238
webauthn-register-options   v1    verify_jwt:true
webauthn-register-verify    v1    verify_jwt:true
webauthn-auth-options       v1    verify_jwt:true
webauthn-auth-verify        v1    verify_jwt:true
```

Plus the existing notification/2FA/PIN/profile/security/upload helpers
that were already in place.

### Bridge KYC link — the deep dive

`bridge-kyc-link` is the most-iterated function this week. Final v6
behavior:

1. Auth: extract user from `Authorization: Bearer <jwt>` via Supabase
   admin client.
2. Profile load: `user_profiles` row including
   `bridge_customer_id, bridge_kyc_link_id, bridge_kyc_link_url, bridge_kyc_status`.
3. Account-type guard: returns 403 `wrong_account_type` for business users
   (they use `bridge-kyb-link`).
4. Country guard: DRC (CD) returns 403 `country_not_supported` with a
   friendly partner-coming-soon message.
5. Email-presence guard.
6. Short-circuits:
   - `bridge_kyc_status = 'approved'` → returns `already_approved: true`.
   - `bridge_kyc_link_url` already set → returns `reused: true`.
7. Calls `POST /v0/kyc_links` with:
   - `type: 'individual'`
   - `email: profile.email` (**unconditional**)
   - `full_name: profile.full_name || 'User'` (**unconditional**)
   - `endorsements: ['base']`
   - `redirect_uri: ${APP_URL}/onboarding/kyc-complete`
   - `customer_id: profile.bridge_customer_id` (only if present)
8. **Idempotency key**: `borderpay:kyc:individual:<customer_id || user_id>`.
9. Response handling via `extractLink()`:
   - 200 success body — extract from `data` or root.
   - 400 with `existing_kyc_link` — treat as success and extract from
     the nested object. Returns `reused: true`.
   - Any other 4xx/5xx → 502 with `bridge_request_id`, `bridge_status`,
     and the first 800 bytes of Bridge's raw response in the body.
10. Persists `bridge_kyc_link_id`, `bridge_kyc_link_url`,
    `bridge_kyc_status = 'pending'`, and `bridge_customer_id` (if Bridge
    returned one) back into `user_profiles`.

**Why we use embedded mode (no pre-create customer):** Bridge's
`POST /v0/customers` requires `signed_agreement_id`, `birth_date`, and
a full address (`street_line_1`, `city`, `state`, `postal_code`,
`country`) at create-time. These are only collected on the Persona
hosted page (which doubles as Bridge's TOS-acceptance surface). Sending
a partial customer payload returned 400 on every signup. The
`/v0/kyc_links` endpoint accepts `email + full_name` and creates the
customer on completion, which is the documented Bridge pattern for
"hosted KYC, no pre-fill".

## 4. Backend — environment / secrets

Required Supabase **function secrets** (already provisioned by CEO):

```
BRIDGE_API_KEY                  live  (sk-live-...)
BRIDGE_API_KEY_SANDBOX          test  (sk-test-...) — currently unused at runtime
BORDERPAY_APP_URL               https://app.borderpayafrica.com
SUPABASE_URL                    (default)
SUPABASE_SERVICE_ROLE_KEY       (default)

# Security pillars
TOTP_ENCRYPTION_KEY             32-byte base64 (rotates only with re-enroll)
WEBAUTHN_RP_ID                  app.borderpayafrica.com
WEBAUTHN_ORIGIN                 https://app.borderpayafrica.com

# Email
RESEND_API_KEY                  re_...
```

If `TOTP_ENCRYPTION_KEY` is removed, `setup-2fa` falls back to plaintext
storage with a warning log (so deploys never block on key provisioning).

## 5. Database — migrations applied this week

```
20260514_bridge_phase1_first_class_tables
20260514_bridge_webhook_atomic_ingest
20260514_bridge_transactions_mirror
20260514_bridge_balance_ledger
20260514_bridge_wallet_credit_rpc
20260515_subscription_plans_and_team
20260515_subscription_invoices_wallet_billing
downgrade_legacy_verified_force_partner_reverify
maplerad_sweep_drop_triggers_columns_audit_tables
maplerad_stripe_full_column_sweep
user_security_encrypt_totp_pin_attempts_reset_flags
webauthn_credentials_and_challenges
```

### Critical RPCs in use

- `ensure_starter_subscription(user_id, account_type)` — auth-signup hook.
- `consume_email_token(token, purpose)` — `verify-email-token`.
- `issue_email_token(user_id, purpose, ttl_minutes, ip, ua)` — signup + resend.
- `ingest_bridge_event(...)` — atomic webhook ingest with replay protection.
- `requeue_stuck_bridge_events()` — failed event reaper.
- `claim_pending_events(...)` — process-pending-events worker drain.
- `apply_bridge_va_credit(...)` — idempotent virtual-account credit + ledger.
- `apply_bridge_wallet_credit_and_complete(...)` — wallet credit + tx mirror.
- `upsert_bridge_transaction(...)` — partial-unique-index mirror.
- `pay_subscription_invoice_from_va(...)` — atomic upgrade debit.
- `switch_subscription_plan(...)` — plan tier flip.
- `create_subscription_invoice(...)` — invoice row issuance.
- `count_active_team_seats(business_user_id)` — seat-cap enforcement.
- `sync_legacy_kyc_status_from_bridge()` — BEFORE-UPDATE trigger on
  user_profiles.bridge_kyc_status; mirrors approved/revoked transitions
  into legacy `kyc_status`. Same shape for `..._kyb()` on business_profiles.
- `reap_expired_webauthn_challenges()` — TTL cleanup.

### Verified clean

```
Maplerad references (tables/columns/functions/triggers): 0
Stripe references (columns):                             0
payment_provider rows still set to 'maplerad':           0   (51 rebacked to 'bridge')
```

The enum VALUE `payment_provider = 'maplerad'` is retained — no code
reads it, and rebuilding the enum would require recreating every
dependent column.

## 6. Frontend — what changed

| Area | File | Change |
|---|---|---|
| Routing shell | `components/shell/AppShell.tsx` | Premium glass header (no wordmark), bottom action bar, slide-in drawer, plan badge, unread bell. Safe-area-inset honoured (iOS notch, Android punch-hole). |
| Dashboard (individual) | `components/app/Dashboard.tsx` | Revolut-style hero card + 4 circular actions + horizontal account chips + folded Bridge cards into a single entry. Plan status card + FX widget below recent activity. |
| Dashboard (business) | `components/business/BusinessDashboard.tsx` | Inline company identity row, 4 quick actions including Team. Plan status card. |
| Wallet | `components/wallet/WalletScreen.tsx` | Total-balance hero + composition of `BridgeVirtualAccountsCard` + `BridgeWalletsCard`. **Removed hardcoded fake USD credentials** (account `9800004567123`, routing `091311229`, "Lead Bank") — those were P0 misleading. |
| Receive | `components/receive/ReceiveMoneyScreen.tsx` | Same composition. Removed hardcoded fake bank names ("BorderPay Nigeria/Kenya/...") + fake routing `021000021`. |
| Send | `components/send/SendMoneyFlow.tsx` | Stablecoin path only; bank / momo / US ACH visibly disabled "Soon". Routes through `bridge-transfer`. Structured server-code error mapping. |
| Exchange | `components/exchange/ExchangeScreen.tsx` | Indicative live rates + Convert-coming-soon hero. `fxAPI.getQuote/.convert` quarantined to `RAILS_FUTURE_STATE`. |
| Geographic restrictions | `components/compliance/CardRestrictionsScreen.tsx` + `utils/compliance/partnerCountryPolicy.ts` | Partner-policy-aware (DRC = coming soon). |
| Plans / pricing | `components/pricing/PricingScreen.tsx` + `UpgradeModal.tsx` | Wallet-debit upgrade (not Stripe). $9.99 individual_premium / $29.99 business_growth. |
| Team management | `components/team/TeamScreen.tsx` | Invite + remove + plan-gated seat cap. |
| Settings | `components/settings/SettingsScreen.tsx` | Removed KYC docs + Proof of Address rows. Plans & billing tile at top. |
| Profile | `components/profile/ProfileScreen.tsx` | Stripped duplicate sticky header. `email_confirmed` derived from `auth.users.email_confirmed_at` truth. |
| Transactions / Preferences / Notifications | various | Stripped duplicate sticky headers (AppShell owns chrome on top-level routes). New `NotificationsScreen.tsx`. |
| Cards | `components/cards/CardsScreen.tsx` | Coming-soon hero with mock virtual card. |
| FX | `utils/fx/markup.ts` | `PARTNER_FX_MARKUP = 0.015` single source of truth. |
| KYC | `components/kyc/KYCVerification.tsx` | Provider-neutral copy. Friendly error mapping (country_not_supported, wrong_account_type). |
| Auth | `apiCall` + `apiCallPublic` in `utils/api/backendAPI.ts` | Preserves structured `code` + `upgrade_to` on errors. Dispatches `borderpay:plan_required` DOM event on 402 → AppShell pops UpgradeModal globally. |
| Security | `utils/security/SecurityManager.ts` | PIN / TOTP / Biometric all rewritten as thin wrappers over server endpoints. Documented security model in code. |
| Affiliate banner | `components/referral/AffiliateBanner.tsx` | Short copy "Earn money referring friends" + "Join now" CTA visible at 320px. |

Frontend bundle: `index-DyQ4a4mp.js` (~943 kB / 261 kB gz) — live on
`app.borderpayafrica.com` via Vercel.

## 7. Provider neutrality (UI strings)

The product name "Bridge" is NOT exposed to end users anywhere. Internal
field names (`bridge_*` columns, `bridgeAPI.*` wrappers, file names) are
kept — they document the source of truth in code. The UI references
"our verification partner", "our regulated banking partner", "our
identity partner" etc.

Audited and clean. KYC disclaimer, KYC rejection copy, send-money error
codes, provisioning modal, KYC admin pill — all neutralised.

## 8. Known gaps / explicitly deferred

These were considered for this batch and intentionally NOT shipped:

1. **Notifications screen — push notifications**. The screen is built and
   wired; in-app notifications surface. Push to FCM/APNs is not.
2. **Local currency rails** (NGN/KES/GHS/UGX/XAF/XOF). Backend returns
   `503 no_partner`. UI shows "Coming soon". Awaiting partner integration.
3. **Cards**. UI marked Coming Soon everywhere. No issuance code path.
4. **TOTP secret encryption key rotation**. The `TOTP_ENCRYPTION_KEY` can
   be rotated, but doing so invalidates existing encrypted secrets
   (forcing re-enroll). Document this in ops runbook before rotation.
5. **Notification preferences per-channel** (email vs in-app vs SMS).
   Preferences screen has on/off toggles only.
6. **Bridge KYC redirect-and-return embedded view**. We currently open
   the Persona link in `_blank`. Persona forbids iframing
   (`X-Frame-Options: DENY`). A same-tab redirect with return handler at
   `/onboarding/kyc-complete` is a cleaner UX for PWA — left as a
   follow-up. Today: new-tab works on all browsers and PWAs.
7. **Team invite emails**. `business-team-invite` writes the seat row but
   does not send an email. Need a `business.team_invite` Resend template.

## 9. Smoke-test runbook for CTO

These steps validate the system end-to-end. Each step should pass
without operator intervention.

### A. Signup → email verify (P0 path)

1. From a clean browser, go to `https://app.borderpayafrica.com` → Sign Up.
2. Fill: random email, password, full name, phone, country (any except CD).
3. Submit. Expect: success, "Check your email" prompt.
4. Open the verification email (Resend → mailbox).
5. Click verification link → app shows verified state and routes to
   Dashboard.
6. **DB check**: `select kyc_status, bridge_kyc_status from user_profiles
   where email = '<your>';` → both null/pending. Verification email
   confirmation does NOT verify identity — Bridge does.

### B. Bridge KYC start (the originally-broken path)

1. While signed in, open drawer → "Identity & KYC" → "Start verification".
2. New tab opens to `bridge.withpersona.com/verify?...`.
3. Complete the hosted flow (TOS + selfie + ID).
4. Tab redirects to `https://app.borderpayafrica.com/onboarding/kyc-complete`.
5. Within ~30 seconds of completion, Bridge fires webhook → our
   `bridge-webhook` v1 → `ingest_bridge_event` RPC → user's
   `bridge_kyc_status` flips to `approved`. Trigger
   `sync_legacy_kyc_status_from_bridge` mirrors to `kyc_status =
   'verified'`.
6. Frontend polls `kyc-status` every few seconds; verified pill appears
   in the AppShell header.

### C. Wallet-debit subscription upgrade

(Requires a verified user with USD virtual account balance.)

1. Click any Plan & pricing entry → choose Premium.
2. Modal lists USD virtual accounts with balance.
3. Confirm "Pay $9.99 from USD VA".
4. Server runs `pay_subscription_invoice_from_va` atomic RPC:
   debits VA, writes ledger row, mirrors `wallets.balance`, inserts
   transaction row, marks invoice paid, activates 30-day Premium.
5. UI badge flips to "Premium" within one refresh tick.

### D. Stablecoin send

(Requires verified user + USDC balance on a custodial wallet.)

1. Bottom nav → Send → "Stablecoin transfer" (the only enabled option).
2. Enter USDC + Base + destination address + amount.
3. Confirm with PIN (now server-verified via PBKDF2).
4. Server calls Bridge `POST /v0/transfers`, mirrors row to
   `transactions`, returns `transfer_id` + `state`.
5. Activity row appears in Recent activity within ~5 seconds.

### E. Security gates

1. **Bad PIN 5 times** → 6th attempt returns 423 `code: 'locked'`,
   `locked_until` 15 minutes ahead. Verify by attempting again; lockout
   message shows remaining minutes.
2. **2FA setup** → QR scan in authenticator app → enter code →
   `two_factor_enabled = true`. Verify
   `user_security.two_factor_secret_encrypted` is NOT null and
   `two_factor_secret` IS null (encryption working).
3. **Biometric enroll** (modern browser only) → platform authenticator
   prompts → success → `webauthn_credentials` row inserted. Logout →
   "Biometric sign-in" button works.

### F. Partner-blocked country (DRC)

1. Sign up with `country_code = 'CD'`. Signup succeeds (auth-signup is
   country-neutral).
2. Open Bridge KYC → returns 403 `country_not_supported` with friendly
   "African local rails partner" message.

### G. Plan-gated EUR/GBP

1. Verified user on Starter plan → Wallet → "Open EUR account" → server
   returns 402 `plan_required` with `upgrade_to: 'individual_premium'`.
2. Frontend automatically pops the UpgradeModal (via `apiCall`
   interceptor + DOM event).

## 10. How to roll back

Each deploy is a numbered version in Supabase MCP. To revert any function
to a known-good version, use `mcp__cd9a0dfb-*__get_edge_function` to
fetch the source of version N-1, then `deploy_edge_function` with that
source. The frontend can be rolled back via Vercel UI to any previous
deployment in seconds.

The DB migrations are forward-only. The Maplerad sweep cannot be
undone (columns are gone). The legacy-verified downgrade also cannot be
auto-undone without webhook re-confirmation.

## 11. Open questions for CTO

1. **Should we make Bridge KYC link open in the same tab** (with return
   handler) instead of `_blank`? Same-tab is cleaner on PWA but loses
   the user's app state for the duration of the flow.
2. **TOTP secret encryption key custody** — is the env-secret pattern
   acceptable long-term, or do we want to move to Supabase Vault / a
   KMS (AWS / GCP) before public launch?
3. **PIN reset flow** — currently `removePIN` is a no-op (deliberately
   not exposed to client). Do you want a "Forgot PIN" flow that requires
   fresh login + email confirm + KYC re-prompt, or is account-recovery
   via support sufficient for v1?
4. **Card issuance roadmap** — currently Coming Soon everywhere. Is
   Bridge-cards on the roadmap or do we wait for our own program?
5. **African rails partner timeline** — affects `bridge-transfer`
   destination support, send-money method picker, geographic
   restrictions screen.

---

*Generated by the rebuild session. Each function version, migration, and
file path above is verifiable via Supabase MCP and `git log`. Smoke-test
this document end-to-end before approving for handover to operations.*
