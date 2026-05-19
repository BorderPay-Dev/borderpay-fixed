# CTO review handoff — round 4

**Status: NOT signed off. No live cutover.** Round 3 review accepted the
transfer gate (P0.3) and RPC upsert (P0.4) fixes but surfaced two
remaining blockers:
  • P0.1 — schema.sql base CREATE TABLE blocks still declared Maplerad
    columns even though sweep migrations dropped them live.
  • P0.2 — the 2FA migration's reset condition required BOTH plaintext
    and encrypted secrets to be null, leaving plaintext-only users
    stranded after verify-2fa was switched to decrypt-only.
Both are now fixed. Evidence captured below in §14.

Round-1 through round-3 history preserved so the audit trail is intact.

Last updated: 2026-05-18.
Production frontend: `https://app.borderpayafrica.com`
Supabase project:    `orwrcpwsffjlvzuraxjc.supabase.co`

---

## 0. Response to round-1 CTO findings

| # | CTO finding | Status now | Evidence |
|---|---|---|---|
| 1 | KYC/KYB source files contradict the handoff; still call `bridgeProvider.createCustomer()` with partial payload. | **Fixed.** Both source files now match deployed v6 / v5 (embedded `/v0/kyc_links`, never call `/v0/customers`). | [supabase/functions/bridge-kyc-link/index.ts](supabase/functions/bridge-kyc-link/index.ts), [supabase/functions/bridge-kyb-link/index.ts](supabase/functions/bridge-kyb-link/index.ts) |
| 2 | TOTP "encrypted at rest" claim false in source; setup/verify wrote/read plaintext. | **Fixed + hardened.** Source synced to AES-256-GCM. **Fails closed** with HTTP 500 `server_misconfigured` if `TOTP_ENCRYPTION_KEY` is missing — no silent plaintext fallback. | [supabase/functions/setup-2fa/index.ts](supabase/functions/setup-2fa/index.ts), [supabase/functions/verify-2fa/index.ts](supabase/functions/verify-2fa/index.ts). Deployed: setup-2fa v85, verify-2fa v87. |
| 3 | "Zero Maplerad / Stripe references" not true in repo. | **Partially fixed; honest now.** `grep -rln "maplerad\|Maplerad\|MAPLERAD" src utils components` returns **0** results. `Stripe` mentions are down to **2 defensive "NOT Stripe" comments** (intentional — they document our wallet-debit choice and prevent re-introduction). Listed below. | [§4](#4-provider-reference-audit) |
| 4 | `bridge-transfer` random idempotency key per request. | **Fixed.** v3 now **requires** a client-provided `idempotency_key` in the request body (8-128 printable ASCII chars). Missing key → 400 `idempotency_key_required`. Server canonicalises to `borderpay:transfer:<user.id>:<client_key>`, forwards as the Bridge `Idempotency-Key` header, AND pre-checks `transactions.metadata->>'idempotency_key'` to replay locally if Bridge accepted on the first call but we crashed before our DB write. | [supabase/functions/bridge-transfer/index.ts](supabase/functions/bridge-transfer/index.ts:76), deployed v3 |
| 5 | Stablecoin send enabled before evidence package. | **Disabled in UI.** The card now renders with `aria-disabled="true"` + "Pending evidence" amber badge. The `sendTransfer` call site in `SendMoneyFlow.tsx` is unreachable from the UI. Backend stays deployed and ready (v3 with strict idempotency) so re-enablement is a one-line UI change after evidence is attached. | [components/send/SendMoneyFlow.tsx:519-545](components/send/SendMoneyFlow.tsx) |

## 1. What evidence is and is NOT available

**No live sandbox transfer evidence package exists yet.** I have not run a
real Bridge sandbox transfer end-to-end. The only Bridge sandbox call
that returned a real response in this session is `/v0/kyc_links`, which
returned a `bridge.withpersona.com/verify?...` URL for a smoke-test
user (now deleted). That is documented under §5 but is not a substitute
for transfer evidence.

Until the operator runs the smoke runbook in §6 against an actual
verified user with a USDC balance, and the response payloads + DB rows
+ webhook ingest are captured into a follow-up `EVIDENCE_PACKAGE.md`,
the stablecoin send remains UI-disabled.

## 2. Deployed edge function versions (source-aligned)

These versions reflect the deployed runtime AND have matching source
files in the repo. Versions where source previously diverged from
runtime are flagged.

```
Function                     Ver   verify_jwt  Source matches runtime?
─────────────────────────────────────────────────────────────────────
auth-signup                  v98   false       yes  (inlined send-confirmation-email path)
auth-resend-verification     v1    false       yes
verify-email-token           v1    false       yes
get-user-profile             v95   true        yes
bridge-ping                  v2    false       yes
bridge-customer              v1    false       yes (unchanged this round)
bridge-kyc-link              v6    false       YES — synced in this commit
bridge-kyb-link              v5    false       YES — synced in this commit
bridge-virtual-account       v1    true        yes (unchanged)
bridge-wallet                v1    true        yes (unchanged)
bridge-transfer              v3    true        YES — strict idempotency, redeployed
bridge-webhook               v1    false       yes
process-pending-events       v1    false       yes
subscription-current         v1    false       yes
subscription-upgrade         v1    false       yes
business-team-list           v1    true        yes
business-team-invite         v1    true        yes
business-team-remove         v1    true        yes
setup-pin                    v83   true        yes
verify-pin                   v83   true        yes
setup-2fa                    v85   true        YES — AES-GCM fail-closed, redeployed
verify-2fa                   v87   true        YES — decrypt-only, fail-closed, redeployed
webauthn-register-options    v1    true        yes
webauthn-register-verify     v1    true        yes
webauthn-auth-options        v1    true        yes
webauthn-auth-verify         v1    true        yes
```

## 3. KYC link contract (now matches source)

`bridge-kyc-link` and `bridge-kyb-link` **never** call `POST /v0/customers`.
They POST `/v0/kyc_links` with the following body shape:

```json
{
  "type":         "individual",                    // or "business"
  "email":        "<profile.email>",               // ALWAYS — Bridge rejects without it
  "full_name":    "<profile.full_name || 'User'>", // or business_legal_name for KYB
  "endorsements": ["base"],
  "redirect_uri": "<APP_URL>/onboarding/kyc-complete",
  "customer_id":  "<profile.bridge_customer_id>"   // only if non-null
}
```

The previous handoff said "skip /v0/customers pre-create" but the source
still called it. That has been corrected. The source files are now
byte-for-byte aligned with the deployed v6 logic (verified by reading
both back).

Response handling: `extractLink()` probes the response body in three
shapes — 200 success root, 200 success `.data` wrapper, and **400 with
`existing_kyc_link`** (treated as success, returns `reused: true`).

## 4. Provider reference audit

### Maplerad

```
$ grep -rln "maplerad\|Maplerad\|MAPLERAD" src utils components
(zero results)
```

`MAPLERAD_REMOVAL_CHECKLIST.md` still exists as a historical log at the
repo root; it is not imported anywhere.

### Stripe

```
$ grep -rn "stripe\|Stripe" src utils components --include='*.ts*'
utils/subscriptions/plans.ts:7: * Billing model: WALLET-DEBIT (not Stripe). The upgrade flow charges a
utils/api/backendAPI.ts:1119:// SUBSCRIPTIONS — wallet-debit billing (NOT Stripe)
```

Both are **defensive "NOT Stripe" clarifiers** — they prevent a future
engineer from re-introducing the Stripe pattern. There are no Stripe
function calls, no Stripe SDK import, no `stripe_*` column writes
anywhere in source.

The `user_subscriptions` table previously had `stripe_customer_id`,
`stripe_price_id`, `stripe_subscription_id` — all dropped in migration
`maplerad_stripe_full_column_sweep`. Verified with information_schema:
zero `stripe_*` columns remain.

### DB sweep (informational, separate from source audit)

Last DB scan ran during the previous round (see Round-1 commit
`94707f7`): zero `maplerad_*` / `stripe_*` columns, zero functions, zero
triggers referencing either. That migration is already applied and is
not affected by this round's source-file cleanup.

## 5. KYC link smoke evidence (Bridge sandbox, kept)

The only attached evidence is the `/v0/kyc_links` curl smoke. Reproducible
by anyone with sandbox `BRIDGE_API_KEY` — anon key + a confirmed user JWT:

```
$ curl -sS -X POST .../functions/v1/bridge-kyc-link \
    -H "Authorization: Bearer <jwt>" -d "{}"
{
  "success": true,
  "data": {
    "link_id":  "1ebdacdc-5253-4359-afa6-48c07bdd5f85",
    "link_url": "https://bridge.withpersona.com/verify?..."
  }
}
```

Smoke-test user was deleted after capture.

## 6. Smoke-test runbook (for CTO to run before sign-off)

Each step has a pass/fail predicate the operator can verify. **Stablecoin
send (D) is gated on attaching an evidence package to this doc.**

### A. Signup → email verify

1. Fresh browser → `app.borderpayafrica.com` → Sign Up.
2. Random email, password, full name, phone, country (any except CD).
3. Submit. Expected: `auth-signup` returns 200, `email_sent:true`.
4. Verification email arrives via Resend. Click → redirects to
   `/auth/verified`.
5. SQL: `select email_confirmed_at from auth.users where email = '<your>';`
   → non-null. PASS.

### B. Bridge KYC start

1. Signed in → drawer → "Identity & KYC" → "Start verification".
2. POST `bridge-kyc-link` → 200 with `data.link_url` matching
   `https://bridge.withpersona.com/verify?...`. PASS.
3. New tab opens the Persona URL. (Persona itself forbids iframing via
   X-Frame-Options DENY; new-tab is the only safe way today.)
4. Complete the hosted flow in sandbox (TOS + selfie + ID).
5. Within ~30s of completion, Bridge webhook fires →
   `process-pending-events` worker → `user_profiles.bridge_kyc_status`
   flips to `approved`. PASS predicate: SQL row updates.

### C. Wallet-debit subscription upgrade

(Requires a verified user + USD VA balance — assume USD VA was funded
via Bridge sandbox ACH simulator.)

1. Open Plans & pricing → Premium.
2. UpgradeModal lists USD VAs with balance.
3. Confirm "Pay $9.99 from USD VA".
4. `subscription-upgrade` runs `pay_subscription_invoice_from_va` RPC
   atomically. PASS predicate: invoice row + ledger row + transaction
   row + plan flips to Premium for 30 days.

### D. Stablecoin send (**BLOCKED pending evidence**)

The UI tile is `aria-disabled="true"` with an amber "Pending evidence"
badge. To unblock:

1. Operator runs a manual Bridge sandbox transfer using a verified user's
   stablecoin wallet → external sandbox address.
2. Capture: full Bridge response (including `transfer_id` + `state`),
   our DB `transactions` row, and the webhook event ID + ingest log.
3. Add to a new `EVIDENCE_PACKAGE.md` in the repo root.
4. Then change the UI block in `SendMoneyFlow.tsx` lines 519–545: replace
   the `<div aria-disabled>` with the original `<button onClick={() =>
   { setMethod('stablecoin'); setSelectedCurrency('USD'); setStep('details'); }}>`.

### E. Security gates

1. Bad PIN 5x → 6th returns 423 `code:'locked'` with `locked_until` ~15
   min ahead. SQL: `pin_failed_attempts` resets to 0, `pin_locked_until`
   set.
2. **2FA setup with TOTP_ENCRYPTION_KEY present:** scan QR → enter code
   → `setup-2fa` returns `{success:true, data:{secret, otpauth_url,
   encrypted:true}}`. SQL: `user_security.two_factor_secret IS NULL`
   AND `two_factor_secret_encrypted IS NOT NULL`.
3. **2FA setup with TOTP_ENCRYPTION_KEY MISSING:** function returns
   500 `server_misconfigured`. No row inserted. PASS.
4. WebAuthn enroll on a modern browser → `webauthn_credentials` row
   inserted; logout/login via biometric works.

### F. DRC country block

1. Signup with `country_code: 'CD'`. Signup succeeds.
2. Bridge KYC → 403 `country_not_supported`.

### G. Plan-gated EUR/GBP VA

1. Verified user on Starter → request EUR account → server returns 402
   `plan_required` with `upgrade_to: 'individual_premium'`.
2. UpgradeModal opens automatically (global apiCall interceptor +
   `borderpay:plan_required` DOM event).

## 7. Known security debt (honest)

These are **NOT shipped fixed**, only documented:

1. **PIN hash is single-round SHA-256** with `user.id` as salt at the
   server (setup-pin v83). PBKDF2 100k was planned but the deployed
   function still uses fast SHA-256. Need to rewrite + lazy-upgrade
   existing hashes on next verify. The frontend wrapper is ready (it
   round-trips to the server, no client-side hashing) — only the server
   crypto needs the upgrade.

   *Disposition: separate hardening turn after CTO sign-off on the
   current Bridge surface.*

2. **TOTP_ENCRYPTION_KEY rotation invalidates secrets.** Documented in
   `setup-2fa` source comments. Rotating the key forces re-enrollment
   for every TOTP user. Today: 0 enrolled users (the prior client-side
   secrets were never persisted server-side, per Round-1 SQL audit), so
   this is a no-op. Will become a real ops concern post-launch.

3. **Bridge webhook signature verification.** Deployed (`bridge-webhook`
   v1) and matches Bridge's documented RSASSA-PKCS1-v1.5 SHA-256 with
   10-minute replay window. NOT smoke-tested against a real Bridge
   webhook in this session — only unit-tested via local signed payloads
   during the original Day-2 build. Worth re-running against the live
   Bridge sandbox webhook the next time KYC completes.

4. **WebAuthn `webauthn_credentials` table has no operator-rotate flow.**
   If a user loses their device, today they need support-driven row
   deletion. No self-serve "remove biometric" UI exists yet.

## 8. Frontend bundle

The current frontend at `app.borderpayafrica.com` is the prior bundle
`index-DyQ4a4mp.js`. The changes in this round are unbuilt-and-unpushed
until the CTO re-reviews. Local `npm run build` passes:

```
$ npx tsc --noEmit
(no output)

$ npx vite build
... ✓ built in 10.36s
dist/assets/index-BXPxkTmJ.js  948.89 kB │ gzip: 261.94 kB
```

## 9. Files changed in this round (for CTO diff review)

```
M supabase/functions/bridge-kyc-link/index.ts      ← matches deployed v6
M supabase/functions/bridge-kyb-link/index.ts      ← matches deployed v5
M supabase/functions/setup-2fa/index.ts            ← AES-GCM, fail-closed
M supabase/functions/verify-2fa/index.ts           ← decrypt-only, fail-closed
M supabase/functions/bridge-transfer/index.ts      ← strict idempotency
M components/send/SendMoneyFlow.tsx                ← stablecoin disabled + idem key
M utils/api/backendAPI.ts                          ← sendTransfer signature requires idem
M utils/subscriptions/plans.ts                     ← removed stripe_price_id field
M utils/fees.ts                                    ← removed dropped-column fallback
M src/lib/countries.ts                             ← renamed maplerad* fields
M components/app/Dashboard.tsx                     ← removed Stripe aesthetic mention
M components/pricing/PricingScreen.tsx             ← removed Stripe aesthetic mention
M CTO_REVIEW_HANDOFF.md                            ← this document
```

## 10. Hold cutover

Per CTO instruction: **no live cutover**. Changes are committable for
review but will not be pushed to `main` until the CTO explicitly signs
off on this document and the evidence package for stablecoin send is
attached.

---

## 11. Round-3 P0 follow-up (response to round-2 review)

The round-2 review surfaced three additional P0s — all addressed below
with reproducible evidence captured in this session.

### P0.1 — Schema source-of-truth committed

**CTO finding:** `setup-2fa` and `verify-2fa` write/read columns
(`two_factor_secret_encrypted`, `two_factor_enc_version`) and the
WebAuthn flow depends on `webauthn_credentials` / `webauthn_challenges`
tables. None of these were in `supabase/migrations/` or
`utils/supabase/schema.sql`. Schema-vs-source drift = release blocker.

**Fix:** Five migration files committed (matching what was applied to
production via Supabase MCP):

| File | Applied as |
|---|---|
| `supabase/migrations/20260517_downgrade_legacy_verified.sql` | `downgrade_legacy_verified_force_partner_reverify` |
| `supabase/migrations/20260518_maplerad_triggers_sweep.sql` | `maplerad_sweep_drop_triggers_columns_audit_tables` |
| `supabase/migrations/20260518_maplerad_stripe_column_sweep.sql` | `maplerad_stripe_full_column_sweep` |
| `supabase/migrations/20260518_user_security_hardening.sql` | `user_security_encrypt_totp_pin_attempts_reset_flags` |
| `supabase/migrations/20260518_webauthn_credentials.sql` | `webauthn_credentials_and_challenges` |

`utils/supabase/schema.sql` updated with new sections **6a (user_security)**
and **6b (webauthn_credentials / webauthn_challenges)** including the
new columns, indexes, and RLS policies.

**Existing-data migration policy** (documented in
`20260518_user_security_hardening.sql`): the previous client-side flow
**never persisted TOTP secrets or PIN hashes server-side** — the
booleans `pin_set=true` / `two_factor_enabled=true` were the only
leaked state, with NULL hash and NULL secret. The migration resets
those booleans, so users see the correct "not set" state and re-enroll
via the new server-backed flows. No user is locked out.

**Live-DB schema proof** (queried 2026-05-18 after migrations applied):

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'user_security'
   and column_name in ('two_factor_secret_encrypted','two_factor_enc_version',
                       'pin_hash_v2','pin_failed_attempts','pin_locked_until','pin_updated_at');
```

| column | type | nullable | default |
|---|---|---|---|
| `pin_failed_attempts` | smallint | NO | 0 |
| `pin_hash_v2` | text | YES | — |
| `pin_locked_until` | timestamptz | YES | — |
| `pin_updated_at` | timestamptz | NO | now() |
| `two_factor_enc_version` | smallint | YES | 1 |
| `two_factor_secret_encrypted` | bytea | YES | — |

Both `webauthn_credentials` (7 columns) and `webauthn_challenges`
(5 columns) verified present with the same query. Full result captured
in the session log.

### P0.2 — Server-side feature flag for `bridge-transfer`

**CTO finding:** "Stablecoin send is still live at the backend. UI-disabled
is not enough. `bridge-transfer` remains deployed/callable by any
authenticated approved user with a JWT." Correct.

**Fix:** `bridge-transfer` v3 source (deployed as runtime v4) now reads
env `BRIDGE_TRANSFERS_ENABLED` BEFORE any auth/JWT/Bridge call, and
fails closed with HTTP 503 + `code: "transfer_not_enabled"` unless the
flag is literally `"true"`.

```ts
// supabase/functions/bridge-transfer/index.ts  (deployed v4)
function transfersEnabled(): boolean {
  return (Deno.env.get("BRIDGE_TRANSFERS_ENABLED") || "").toLowerCase() === "true";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  // Hard server gate. Fail closed before any auth or Bridge call.
  if (!transfersEnabled()) {
    return json({
      success: false,
      code:    "transfer_not_enabled",
      error:   "Money movement is not enabled in this environment. Awaiting sandbox evidence sign-off.",
    }, 503);
  }
  ...
});
```

**Gate proof** (KYC-approved user, valid idempotency key, real auth JWT):

```
$ curl -sS -X POST .../functions/v1/bridge-transfer \
    -H "Authorization: Bearer <jwt-of-kyc-approved-test-user>" \
    -d '{"source":{"amount":"1","currency":"USDC","chain":"BASE","payment_rail":"stablecoin"},
         "destination":{"payment_rail":"stablecoin","currency":"USDC","chain":"BASE",
                        "address":"0x0000000000000000000000000000000000000000"},
         "idempotency_key":"smoke-gate-test-12345"}'

HTTP 503
{"success":false,"code":"transfer_not_enabled",
 "error":"Money movement is not enabled in this environment. Awaiting sandbox evidence sign-off."}
```

Gate-test user injected with `bridge_kyc_status='approved'` +
`bridge_customer_id='cust_test_gate_proof'`, deleted after capture.

**To enable for smoke**: operator sets `BRIDGE_TRANSFERS_ENABLED=true`
on the Supabase function-secrets page (one-line, no redeploy needed).
To disable again: set it to anything else or unset it.

### P0.3 — RPC-backed upsert (partial unique index honoured)

**CTO finding:** `.upsert(..., { onConflict: "bridge_transfer_id" })` does
not honour the partial unique index
`UNIQUE(bridge_transfer_id) WHERE provider='bridge' AND bridge_transfer_id IS NOT NULL`
because PostgREST cannot infer partial constraints. Retries would
either duplicate the row or raise `unique_violation`. There is already
an `upsert_bridge_transaction(...)` plpgsql RPC that expresses the
partial predicate in its `ON CONFLICT ... WHERE` clause. Use it.

**Fix:** Replaced the PostgREST upsert with the RPC call. Source diff:

```ts
// supabase/functions/bridge-transfer/index.ts
- await supa.from("transactions").upsert(
-   { user_id, type, amount, currency, status,
-     reference, bridge_transfer_id, provider: "bridge",
-     metadata: { idempotency_key: idem, raw: result.raw }, created_at },
-   { onConflict: "bridge_transfer_id" },
- );
+ const { error: rpcErr } = await supa.rpc("upsert_bridge_transaction", {
+   p_user_id:            user.id,
+   p_bridge_transfer_id: transferId,
+   p_amount:             Number(body.source.amount),
+   p_currency:           body.source.currency,
+   p_status:             dbStatus,
+   p_metadata:           { idempotency_key: idem, raw: data },
+   p_description:        null,
+ });
+ if (rpcErr) {
+   return json({
+     success: false, code: "persistence_failed",
+     error: `Bridge accepted transfer ${transferId} but local persistence failed: ${rpcErr.message}`,
+     bridge_transfer_id: transferId,
+   }, 500);
+ }
```

**Replay test** committed at `tests/replay/bridge_transfer_idempotency.sql`
and executed against production database:

```
$ supabase mcp execute_sql @ tests/replay/bridge_transfer_idempotency.sql

NOTICE:  idempotency replay test PASS:
         transfer_id=TEST-REPLAY-<random> single row,
         two upserts returned same id <uuid>

select 'replay test cleanup' as check, count(*) as remaining
  from public.transactions where bridge_transfer_id like 'TEST-REPLAY-%';
→ replay test cleanup | remaining: 0
```

The DO block asserts:
1. Both `upsert_bridge_transaction` calls return non-null ids.
2. Both calls return the **same** id (second call UPDATED, did not INSERT).
3. Exactly **1** row exists in `public.transactions` for the test
   `bridge_transfer_id`.
4. The final `status` is `'completed'` (the second call's value),
   proving the UPDATE branch ran.

If any assertion fails the block raises and the transaction rolls back —
the test cannot leave the DB in a half-state.

## 12. Round-3 file diff (for CTO PR review)

```
A supabase/migrations/20260517_downgrade_legacy_verified.sql
A supabase/migrations/20260518_maplerad_triggers_sweep.sql
A supabase/migrations/20260518_maplerad_stripe_column_sweep.sql
A supabase/migrations/20260518_user_security_hardening.sql
A supabase/migrations/20260518_webauthn_credentials.sql
A tests/replay/bridge_transfer_idempotency.sql
M utils/supabase/schema.sql                      ← §6a user_security, §6b webauthn_*
M supabase/functions/bridge-transfer/index.ts    ← v3 src banner: env gate + RPC upsert
M CTO_REVIEW_HANDOFF.md                          ← this round-3 section
```

## 13. What is NOT done (explicit deferrals)

1. **No live cutover.** Frontend at `app.borderpayafrica.com` is still
   the round-2 bundle. The schema-and-flag changes above are runtime-
   only on the Supabase side; no frontend deploy is required for them.
   When the operator decides to deploy frontend updates, the existing
   git push → Vercel pipeline still applies.

2. **No live Bridge sandbox transfer evidence yet.** With the
   `BRIDGE_TRANSFERS_ENABLED` flag set to `false` at the function-secret
   level (the new default), the gate is now the only place that
   controls whether any user can move money. Sandbox evidence will be
   produced by:
   - Operator flips `BRIDGE_TRANSFERS_ENABLED=true` on the Supabase
     dashboard for a fixed window.
   - Operator (or test user) completes a real Bridge sandbox transfer
     end-to-end with capture of: request body, Bridge response,
     `transactions` row id, retry-with-same-key response, post-retry
     row count (=1).
   - Capture goes into `EVIDENCE_PACKAGE.md`. Operator flips
     `BRIDGE_TRANSFERS_ENABLED=false` again.

3. **`pin_hash` legacy column kept.** The verify-pin lazy-upgrade path
   relies on it. Plan: drop it once a) every active user has
   `pin_hash_v2` set, and b) we've added a "force re-enter PIN" admin
   flow for stragglers.

4. **`two_factor_secret` legacy column kept** for the same reason —
   `verify-2fa` reads it as a fallback if the encrypted column is null
   AND a user enrolled before the encrypted-write path was deployed.
   Drop after audit confirms 0 plaintext rows.

---

## 14. Round-4 P0 follow-up (response to round-3 review)

### P0.1 — `schema.sql` base CREATE TABLE blocks now Maplerad-clean

**CTO finding:** "The new sweep migrations drop Maplerad columns from
`user_profiles` / `users`, but `schema.sql` still declares
`maplerad_customer_id`, `maplerad_status`, `maplerad_tier`, etc. That
contradicts the claim that schema source-of-truth is fixed."

Round-3 only appended new sections (§6a/§6b) and left the original
table declarations untouched. Fixed now.

**Diff (utils/supabase/schema.sql):**
- `public.user_profiles` lost 8 columns: `maplerad_customer_id`,
  `maplerad_status`, `maplerad_sandbox_customer_id`, `maplerad_tier`,
  `maplerad_tier0_enrolled_at`, `maplerad_tier2_enrolled_at`,
  `maplerad_environment` (+ the already-dead `maplerad_kyc_link_*`
  family which was never in this file). Gained the Bridge partner
  columns that actually exist live: `payment_provider`,
  `bridge_customer_id`, `bridge_kyc_status`, `bridge_kyc_link_id`,
  `bridge_kyc_link_url`, `bridge_kyc_completed_at`,
  `bridge_account_status`, `preferred_currencies`. `bridge_environment`
  replaces the old `maplerad_environment` field.
- `public.users` lost `maplerad_customer_id`; gained
  `bridge_customer_id`.

**Verification:**

```
$ grep -nE "maplerad|MAPLERAD" utils/supabase/schema.sql
44:-- Provider columns: bridge_* are the live partner columns. All maplerad_*
45:-- columns were dropped by migration 20260518_maplerad_triggers_sweep.sql
91:-- Reflects the post-sweep shape (migration 20260518_maplerad_triggers_sweep.sql).
92:-- No maplerad_* columns. bridge_customer_id is the only provider id.
```

Only comment references remain. No DDL declares any `maplerad_*` column.

### P0.2 — 2FA stranded-user reset

**CTO finding:** The round-3 hardening migration only reset
`two_factor_enabled=false` when **both** plaintext and encrypted
secrets were null. A user with `two_factor_enabled=true` and a
plaintext-only `two_factor_secret` would stay marked enabled — but
`verify-2fa` was switched to decrypt-only in round 2, so their TOTP
codes are now silently rejected. Result: stranded users with broken 2FA.

**Fix:** Follow-up migration
`supabase/migrations/20260518_2fa_reset_unencrypted_plaintext.sql`
resets `two_factor_enabled=false` for **every** row where
`two_factor_secret_encrypted IS NULL`, regardless of plaintext state.
The user's UI flips to "2FA not enabled"; they enroll cleanly via
setup-2fa which writes the encrypted blob.

The migration includes a post-condition assertion that raises and
rolls back if any stranded row remains.

**Policy rationale (committed in the migration header):**

We deliberately do NOT silently encrypt legacy plaintext secrets
in-place. Either path (transient memory-only encryption pass, or a
temporary plaintext grace window in verify-2fa) is worse than asking
affected users to re-enroll — the first is risky to script, the second
re-opens the vector we just closed.

The plaintext column is left in the schema for audit trail. A future
migration can `set two_factor_secret = null` once we've confirmed zero
readers exist in deployed code (round-2 fail-closed deploy already
removed the only reader from verify-2fa).

**Applied to production via MCP** as `two_fa_reset_unencrypted_plaintext`.

**Verification SQL (run 2026-05-18 after migration applied):**

```sql
select
  count(*) filter (where two_factor_enabled = true
                     and two_factor_secret_encrypted is null)         as stranded,
  count(*) filter (where two_factor_enabled = true
                     and two_factor_secret_encrypted is not null)     as enabled_encrypted,
  count(*) filter (where two_factor_enabled = false)                  as not_enabled,
  count(*) filter (where two_factor_secret is not null
                     and two_factor_secret_encrypted is null)         as legacy_plaintext_no_encrypted,
  count(*)                                                            as total_rows
from public.user_security;
```

| stranded | enabled_encrypted | not_enabled | legacy_plaintext_no_encrypted | total_rows |
|---|---|---|---|---|
| **0** | 0 | 11 | 0 | 11 |

Key invariants asserted:
- `stranded = 0` — CTO's required post-condition met.
- `legacy_plaintext_no_encrypted = 0` — no row has the dangerous combo
  that would have stranded users.
- `enabled_encrypted = 0` — nobody is yet enrolled under the new
  encrypted path (all 11 users will re-enroll through setup-2fa, which
  writes only encrypted blobs).

### Round-4 files changed

```
A supabase/migrations/20260518_2fa_reset_unencrypted_plaintext.sql
M utils/supabase/schema.sql              ← stripped Maplerad from user_profiles + users
M CTO_REVIEW_HANDOFF.md                  ← this round-4 section
```

Build verification:
```
$ tsc --noEmit                pass
$ vite build                  pass, chunk-size warning only
```

### Still on hold

The transfer-evidence package and live cutover remain blocked. Round-4
only addresses round-3's two follow-up P0s. Nothing in this round
changes runtime behaviour of money movement.

## 15. Round-5 P0 follow-up (response to round-4 review)

Round-4 review verdict: "Not signed off. The two direct fixes are mostly
correct, but the schema source still is not reproducible from
migrations." The CTO's specific instruction:

> Add a small source migration, e.g.
> `20260518_schema_reconcile_bridge_partner_columns.sql`, with
> `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for any live partner
> columns missing from migration history, or remove those columns
> from `schema.sql` if they are not live. Then rerun build/typecheck
> and provide the exact grep proving every non-comment column in
> `schema.sql` is backed by migration history.

### P0.1 — schema source is now reproducible from migrations alone

**Problem found.** A column-by-column audit of `utils/supabase/schema.sql`
against `supabase/migrations/*.sql` surfaced three artefacts that the
schema declared but no migration created. They exist live (Supabase
dashboard DDL pre-dated migration version control) but a fresh project
replaying migrations in lexicographic order would land in a different
schema:

| Object | Type | Status in live DB |
|---|---|---|
| `public.user_profiles.bridge_environment` | column (text) | exists |
| `public.users.bridge_customer_id` | column (text) | exists |
| `public.user_security` | table | exists |

Worse: the entire base shapes of `public.users` and `public.user_profiles`
had no `CREATE TABLE` in any migration file. The earliest migration
(`20260320`) starts with `ALTER TABLE public.user_profiles ...`, which
would fail on a fresh replay because the table does not yet exist.

**Fix — two migrations, both idempotent so they are no-ops against
live, but make a fresh replay produce the same schema as production.**

`supabase/migrations/20260101_base_schema_user_profiles_users_user_security.sql`

- Dated 20260101 deliberately so it lexicographically precedes every
  other migration in the directory (earliest existing was 20260320).
- Creates the `account_type` + `kyc_status` enums via `do $$ if not
  exists ... $$`.
- `CREATE TABLE IF NOT EXISTS public.users (...)` — full live shape
  captured from production `information_schema` on 2026-05-19.
- `CREATE TABLE IF NOT EXISTS public.user_profiles (...)` — full live
  shape including all 28 columns through `is_admin`. Bridge partner
  columns are deliberately NOT in this baseline; they are layered on by
  `20260507_bridge_integration_phase0.sql` (the migration that already
  exists for that purpose).
- `CREATE TABLE IF NOT EXISTS public.user_security (...)` — base shape
  before the round-3 hardening migration ALTERs it.
- Post-condition `do $$ ... $$` block: counts the three tables + two
  enums and raises if any are missing.

`supabase/migrations/20260519_schema_reconcile_bridge_partner_columns.sql`

- `alter table public.user_profiles add column if not exists
  bridge_environment text;`
- `alter table public.users add column if not exists bridge_customer_id
  text;`
- `create table if not exists public.user_security (...)` — kept here
  belt-and-braces in case a clone landed before the 20260101 baseline
  for some reason. `IF NOT EXISTS` makes both paths converge.
- Enables RLS + owner/service_role policies on `user_security`.
- Post-condition block: queries `information_schema` and raises
  individual `exception`s if either column or the table is missing.

Both migrations applied to production via Supabase MCP — no-op
confirmed (zero rows changed; migration runner records as applied).

### Proof: every non-comment column in schema.sql is backed by migration history

The CTO asked for "the exact grep". A flat grep does not handle the
multi-line, multi-table syntax cleanly, so we wrote a paren-depth-aware
parser. Same effect, harder to fool.

`tests/audit/schema_vs_migrations.py` (also reproduced inline in
`/tmp/audit_schema.py` for ad-hoc runs):

1. For each `CREATE TABLE public.<t> (...)` in `schema.sql`, parse
   the body and extract every top-level column name (skipping
   `constraint`/`primary key`/`foreign key`/`unique`/`check` rows).
2. Walk every `supabase/migrations/*.sql` file. Build the set of
   `(table, column)` pairs declared by either a `CREATE TABLE` body
   or an `ADD COLUMN [IF NOT EXISTS]` inside `ALTER TABLE public.<t>`.
3. Diff. Fail if any schema column is missing.

Output (re-run 2026-05-19 immediately before this section was written):

```
Tables audited:  6
Columns audited: 98
Columns backed:  98
Unmatched:       0

PASS: every non-comment column in schema.sql is backed by migration history.

  business_profiles                17 columns
  user_profiles                    38 columns
  user_security                    13 columns
  users                            11 columns
  webauthn_challenges               8 columns
  webauthn_credentials             11 columns
```

A spot-check grep, for the two columns flagged by round-4 review:

```
$ grep -RIn 'bridge_environment' supabase/migrations
supabase/migrations/20260519_schema_reconcile_bridge_partner_columns.sql:25:  add column if not exists bridge_environment text;
supabase/migrations/20260519_schema_reconcile_bridge_partner_columns.sql:73:   where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'bridge_environment';

$ grep -RIn 'add column if not exists bridge_customer_id\|create table if not exists public.users' supabase/migrations
supabase/migrations/20260101_base_schema_user_profiles_users_user_security.sql:48:create table if not exists public.users (
supabase/migrations/20260519_schema_reconcile_bridge_partner_columns.sql:33:  add column if not exists bridge_customer_id text;
```

### Round-5 files changed

```
A supabase/migrations/20260101_base_schema_user_profiles_users_user_security.sql
A supabase/migrations/20260519_schema_reconcile_bridge_partner_columns.sql
M CTO_REVIEW_HANDOFF.md                  ← this round-5 section
```

Build verification:

```
$ tsc --noEmit                pass
$ vite build                  pass, chunk-size warning only
```

### Still on hold (unchanged)

The transfer-evidence package and live cutover remain blocked. Round-5
only addresses the round-4 schema-reproducibility P0. Nothing in this
round changes runtime behaviour of money movement.
