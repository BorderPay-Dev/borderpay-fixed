# Transfer evidence — preparation document (non-mutating)

This document prepares the ground for the future Bridge sandbox transfer
evidence package. It is doc-only. **No runtime code is changed by this
chunk, no env flag is flipped, no DB row is created, no Bridge call is
made.**

The actual smoke run + evidence collection happens in a separate chunk
that begins only on an explicit `go transfer evidence package` signal
from the CTO.

---

## 1. Hard guardrails (apply to every step until the evidence package is signed off)

| # | Guardrail                                              |
|---|--------------------------------------------------------|
| 1 | **No `git push`** to any remote.                       |
| 2 | **No deploy** — Supabase Edge Functions, Vercel, anything else. |
| 3 | **Do not flip `BRIDGE_TRANSFERS_ENABLED`** outside the explicit smoke window described in §4. |
| 4 | **Do not call Bridge** (no `bridgeProvider.*`, no `curl`, no Postman) until step §4.3 of the smoke window. |
| 5 | **Do not create or mutate DB rows** in `public.transactions`, `public.user_profiles`, or any other money-movement table outside the smoke window. |
| 6 | **Do not edit `CTO_REVIEW_HANDOFF.md`.** Evidence lands in `EVIDENCE_PACKAGE.md` (a new, separate file). |

If any of these guardrails would have to break to make progress, stop
and ask the CTO before doing it.

---

## 2. Pre-flight checks (run 2026-05-19, all green)

Verifies the source matches the round-6 accepted hold state. Repeat
these before the smoke window opens so we know nothing drifted.

### 2.1 `bridge-transfer` fails closed unless `BRIDGE_TRANSFERS_ENABLED === "true"`

```
supabase/functions/bridge-transfer/index.ts
  L86–92  /** Server-side gate: BRIDGE_TRANSFERS_ENABLED must be the literal string
           *  "true" to allow any transfer. ... */
          function transfersEnabled(): boolean {
            return (Deno.env.get("BRIDGE_TRANSFERS_ENABLED") || "").toLowerCase() === "true";
          }
  L98–106 // Hard server gate. Fail closed BEFORE any auth or Bridge call.
          if (!transfersEnabled()) {
            return json({ success: false, code: "transfer_not_enabled", ... }, 503);
          }
```

Gate fires **before** JWT validation, profile fetch, or Bridge call.
This is the only thing that keeps disabled-state safe; the UI disable
in `components/send/SendMoneyFlow.tsx` is decorative.

### 2.2 `bridge-transfer` requires `idempotency_key`

```
supabase/functions/bridge-transfer/index.ts
  L78–84  /** Strict idempotency-key validation: non-empty string, ≤128 chars,
           *  printable ASCII only ... */
          function isValidIdempotencyKey(v: unknown): v is string {
            if (typeof v !== "string") return false;
            if (v.length < 8 || v.length > 128) return false;
            return /^[\x21-\x7E]+$/.test(v);
          }
  L120–126 if (!isValidIdempotencyKey(body?.idempotency_key)) {
             return json({ success: false, code: "idempotency_key_required", ... }, 400);
           }
  L152–154 // Canonicalise: include user.id so two users can't collide on the same key.
           const clientKey = body.idempotency_key as string;
           const idem      = `borderpay:transfer:${user.id}:${clientKey}`;
```

The raw client key is **not** what gets stored. The stored key is the
canonical form. The evidence package must capture **both** (see §3).

### 2.3 Persistence uses `upsert_bridge_transaction`, not PostgREST `.upsert`

```
supabase/functions/bridge-transfer/index.ts
  L197–213 // Persist via the upsert_bridge_transaction RPC. PostgREST upsert
           // cannot infer the partial unique index ...
           const dbStatus =
             result.state === "succeeded" ? "completed"
           : result.state === "failed"    ? "failed"
           :                                "pending";
           const { error: upsertErr } = await supa.rpc("upsert_bridge_transaction", {
             p_user_id:            user.id,
             p_bridge_transfer_id: result.transfer_id,
             p_amount:             Number(body.source.amount),
             p_currency:           body.source.currency,
             p_status:             dbStatus,
             p_metadata:           { idempotency_key: idem, raw: result.raw },
             p_description:        null,
           });
```

Three details to note for the evidence operator: `p_amount` is coerced
to `Number(...)` (Bridge accepts decimal strings, but the
`transactions.amount` column is numeric); `p_status` is the
**db-mapped** status (`succeeded`→`completed`, `failed`→`failed`,
anything else→`pending`), not the raw `result.state`; `p_description`
is `null`. The replay test fixture
(`tests/replay/bridge_transfer_idempotency.sql`) uses string-form
amounts but the RPC accepts both via implicit cast.

The partial unique index is
`WHERE provider='bridge' AND bridge_transfer_id IS NOT NULL`. The RPC
expresses the same predicate in its `ON CONFLICT ... WHERE` clause. Any
attempt to switch to PostgREST `.upsert({ onConflict })` would silently
insert duplicate rows.

### 2.4 Stablecoin send UI remains disabled

```
components/send/SendMoneyFlow.tsx
  L527–536 // Stablecoin send is intentionally non-interactive in this
           // build. The backend (bridge-transfer v3 / runtime v4) is
           // deployed with client-controlled idempotency, fail-closed
           // BRIDGE_TRANSFERS_ENABLED gate, and RPC-backed upsert; but
           // no end-to-end Bridge sandbox evidence package has been
           // collected yet ...
  L538–549 <div ... opacity-60 cursor-not-allowed aria-disabled="true">
             ...
             <span ...>Pending evidence</span>
           </div>
```

Note: the inline source comment in `SendMoneyFlow.tsx` still reads
"bridge-transfer v2" — that comment is stale and pre-dates round-3.
The deployed backend is v3. The UI disable is what matters here; the
version in the source comment is informational and is left untouched
this round to keep this chunk doc-only.

Visible "Pending evidence" badge present. Tap is a no-op. Will be
re-enabled only after the evidence package is signed off — and the
flip happens by replacing the disabled div with the original
`setMethod` handler, not by removing the guard server-side.

### 2.5 Replay test fixture exists

```
$ ls -la tests/replay/bridge_transfer_idempotency.sql
-rw-r--r--@ 1 a  staff  3225 May 18 17:30 tests/replay/bridge_transfer_idempotency.sql
```

3,225 bytes; from round-3. Two `upsert_bridge_transaction` calls with
the same `bridge_transfer_id`, asserts both return the same UUID,
asserts exactly one row in `public.transactions`, cleans up after.

### 2.6 Source has not drifted since round-3

```
$ git log --oneline -5 supabase/functions/bridge-transfer/ tests/replay/ utils/api/backendAPI.ts
250275b fix(round-3): commit P0 follow-ups from CTO round-2 review
6268f94 fix(p0/cto-review): sync source to deployed, harden idempotency, fail-closed TOTP
b4eaa22 sec(p1+p2): TOTP encrypted at rest, PIN PBKDF2 + lockout, server-verified WebAuthn
...
```

Last touch on the transfer path was the round-3 commit. Rounds 4-6 did
not touch any file under §2.

---

## 3. Evidence package template (`EVIDENCE_PACKAGE.md`)

When the smoke window runs, the operator fills out this file at repo
root. **Do not create it during prep.** This is the skeleton the smoke
chunk will populate.

### Redaction rules (apply to every section)

The evidence file is committed and will be reviewed by humans who are
not the operator. **Never** paste any of the following into it:

| Forbidden                                          | What to put instead                                                |
|----------------------------------------------------|--------------------------------------------------------------------|
| Supabase service-role key, anon key, JWT secret    | `<redacted-supabase-key>`                                          |
| User's `Authorization: Bearer <token>` header      | `<redacted-bearer>` — the token itself never goes in the file      |
| Bridge API key (`Api-Key` header value)            | `<redacted-bridge-key>`                                            |
| TOTP secret, recovery codes, PIN, password         | `<redacted>` and an incident note if observed at all               |
| `.env` file contents, raw `supabase secrets list` output with any secret material | Secret names present only; `BRIDGE_TRANSFERS_ENABLED` state must be proven by the probe result (see §1, §2, §9), not by `supabase secrets list` |
| Full PII (real customer name, DOB, ID number, etc) | `<redacted-pii>`; use sandbox test data only — never live customers |
| Webhook signing secret                             | `<redacted-webhook-secret>`                                        |

The `bridge_transfer_id`, the `bridge_customer_id`, the canonical
idempotency key, and the raw client idempotency key ARE allowed in the
file. Those are scoped identifiers, not credentials. If the raw client
key contains anything PII-looking, treat it as PII and redact.

If anything below requests "full body (sanitized)" — that means: copy
the JSON, then walk each field and apply the table above before
pasting.

```markdown
# BorderPay × Bridge — Sandbox transfer evidence package

## 0. Operator + environment + identifiers

### 0.1 Operator + window
- Operator:               <name>
- Date / time (UTC):      <YYYY-MM-DDTHH:MM:SSZ — window open>
- Date / time (UTC):      <YYYY-MM-DDTHH:MM:SSZ — window close>
- Smoke window duration:  <minutes>

### 0.2 Environment
- Supabase project ref:   orwrcpwsffjlvzuraxjc
- Bridge environment:     sandbox
- Edge function version:  bridge-transfer v<N> (source banner) / runtime v<M>

### 0.3 Identifiers (referenced by later sections)
These are the scoped IDs that §3, §4, §6, §7 refer back to. Fill them
in here once; do not paste them inline elsewhere.

- `auth user id` (uuid):              <00000000-0000-0000-0000-000000000000>
- `user_profiles.bridge_customer_id`: <bridge customer id, sandbox>
- Source wallet id / address:         <wallet id if known; chain + on-chain address if applicable>
- Destination address / rail:         <on-chain address OR bank rail descriptor>
- Currency pair (source → dest):      <e.g. USDC → USDC>
- Test amount:                        <decimal string, recommended 1.00>

The `auth user id` here is what §3 canonical-key, §4 request body
auth, and §7 SQL templates substitute into `<§0 user.id>`.
The `bridge_customer_id` is what §6.2 list query substitutes into
`<§0 bridge_customer_id>`.

## 1. Flag state before

`supabase secrets list` deliberately does not expose secret VALUES, so
the only honest proof of flag state is a probe against the live
endpoint. Use the same probe shape throughout §1, §2, §9.

- BRIDGE_TRANSFERS_ENABLED (expected): <"false" | unset>
- Probe request (sanitized):           `POST /functions/v1/bridge-transfer` with valid `Authorization` + minimal body
- Probe response:                       expected HTTP 503 with body
                                        `{"success":false,"code":"transfer_not_enabled", ...}`
- Actual response (sanitized JSON):    <paste; bearer redacted per §3 rules>
- Conclusion:                          flag is at expected "false" / unset state ✓

## 2. Flag flip to true
- Set BRIDGE_TRANSFERS_ENABLED="true" at <UTC timestamp>
- Set-by:                  <operator>
- Method:                  <supabase dashboard secrets / MCP / CLI>
- Verification probe:      same probe shape as §1 — but now expected
                           to **not** return `transfer_not_enabled`.
                           A non-503 response (200 / 400 / 401 / 409
                           — anything except 503 transfer_not_enabled)
                           is the positive signal. Do NOT use
                           `supabase secrets list` here; it does not
                           print the value.
- Probe response (sanitized): <paste; if 400/401/409, that's fine —
                              the body just must not be
                              transfer_not_enabled>
- Conclusion:                 flag is now allowing transfers ✓

## 3. Idempotency keys
- Raw client key (request body):    <printable-ASCII 8-128 chars; redact if it leaks PII>
- Canonical key (DB):               borderpay:transfer:<user.id>:<raw>
- Source of the raw key:            <client-side UUIDv4 generated in SendMoneyFlow at Confirm tap>

## 4. First sandbox transfer
- Request:
  - URL:                            POST https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/bridge-transfer
  - Body (sanitized):               <full JSON, secrets/PII redacted>
- Response:
  - HTTP status:                    <200 | other>
  - bridge_transfer_id:             <id>
  - Bridge request id (header):     <id; from response headers if Bridge returns one>
  - state:                          <pending | processing | completed>
  - Full body (sanitized):          <JSON>

## 5. Retry with same raw idempotency_key
- Identical request body (same raw idempotency_key)
- Response:
  - HTTP status:                    <200 expected>
  - bridge_transfer_id:             <MUST equal §4>
  - Bridge request id (header):     <may differ; Bridge may de-dupe at their side or at ours>
  - Full body (sanitized):          <JSON>

## 6. Bridge duplicate check (must NOT rely solely on local DB)

The local-DB check (§7) only proves WE persisted one row. It does NOT
prove Bridge only created one transfer. If Bridge ignored our
`Idempotency-Key` and created two transfers but we only persisted the
first result, §7 would still pass and we would have a silent duplicate
at Bridge — exactly the failure mode this evidence package exists to
disprove.

The right duplicate test has two parts:

  (a) **The transfer we got back from §4 is real at Bridge.** Direct
      id lookup confirms it exists. (Bridge transfer ids are unique by
      construction; "two transfers with the same id" is not a possible
      duplicate mode.)
  (b) **The retry in §5 did NOT cause Bridge to create a second
      transfer for the same intent.** Whatever Bridge created for the
      retry, if anything, must either be the same id as §4 (idempotency
      honoured) or there must be no second transfer at all for this
      customer in the smoke window.

Run **both** §6.1 and §6.2 and paste both results.

### 6.1 Direct id lookup (proves §4 transfer exists at Bridge)
- Bridge API:                       `GET /v0/transfers/<§4 bridge_transfer_id>`
- Expected:                         200 with a transfer object whose `id` equals §4.
- Sanitized response body:          <full JSON, redaction rules applied>
- `id` field equals §4:             <yes/no>

### 6.2 No second transfer for the same intent (proves retry didn't create a duplicate)
This is the real duplicate test.

- Preferred (if Bridge supports it): filter by idempotency key or
  client reference. Try in this order:
  - `GET /v0/transfers?idempotency_key=<§3 canonical>` — note the
    canonical form, since that is what `bridge-transfer` sends in the
    `Idempotency-Key` header.
  - `GET /v0/transfers?client_reference_id=<…>` if we ever start using
    a client-reference field.
  - If either filter is supported by Bridge sandbox: expected `data[]`
    contains exactly one entry, equal to §4 id.

- Fallback (if no idempotency / reference filter exists in Bridge):
  list by customer + smoke window and manually classify every entry.
  - Bridge API: `GET /v0/transfers?customer_id=<§0 bridge_customer_id>&created_after=<§0.1 window open ISO>&created_before=<§0.1 window close ISO>&limit=50`
  - Total `data[]` count returned:           <N>
  - Of those, count whose `id` equals §4:    <expected 1>
  - For each remaining entry, classify it:
    - `unrelated` (different intent — pre-existing test traffic, another operator, etc.) — list ids
    - `same-intent` (looks like a sibling of §4: same amount, same source/destination currency, same approximate timestamp) — list ids; **any non-zero count here is a duplicate at Bridge and is a failure**.

- Which path used (preferred vs fallback): <fill>
- Sanitized response body:          <full JSON, redaction rules applied>

### 6.3 Pass / fail
- §6.1 passed (id round-trips):                  <yes/no>
- §6.2 same-intent-other-than-§4 count = 0:      <yes/no>
- Both yes → duplicate-check **passes**.
- Any no → duplicate at Bridge; record in §11 and stop. The smoke
  fails even if §7 looks clean.

## 7. Local DB single-row proof

Two assertions must both hold. Run both queries and paste both results.

### 7.1 Row count must be exactly 1
```sql
select count(*)                                          as row_count,
       bool_and(metadata->>'idempotency_key'
                = 'borderpay:transfer:<§0 user.id>:<§3 raw>') as canonical_key_matches
from public.transactions
where bridge_transfer_id = '<§4 transfer_id>'
  and provider = 'bridge'::public.payment_provider;
```
- Expected:
  - `row_count = 1`
  - `canonical_key_matches = true`
- Actual: <fill>

### 7.2 Row detail (for audit trail)
```sql
select id, bridge_transfer_id, provider, status,
       metadata->>'idempotency_key' as canonical_key,
       created_at, updated_at
from public.transactions
where bridge_transfer_id = '<§4 transfer_id>'
  and provider = 'bridge'::public.payment_provider;
```
- canonical_key must equal §3 canonical exactly: `borderpay:transfer:<§0 user.id>:<§3 raw>`
- canonical_key match (eyeball check):  <yes/no — must match §7.1 bool_and>

## 8. Webhook / worker state transition
Choice A — webhook fired:
- Webhook request id:               <id, from bridge-webhook logs>
- Transition observed:              pending → <processing | completed>
- DB after webhook:
```sql
select status, updated_at from public.transactions where bridge_transfer_id = '<…>';
```
- Result:                           <new status, new updated_at>

Choice B — sandbox does not fire webhooks:
- Documented blocker:               <link to Bridge docs or support ticket>
- Fallback verification:            <polled `GET /v0/transfers/<id>` showing state advanced>
- DB after manual reconcile:        <if any>

## 9. Flag flip back to false
- Set BRIDGE_TRANSFERS_ENABLED="false" at <UTC timestamp>
- Method:                           <same as §2>
- Verification probe:               same shape as §1 — expected HTTP 503
                                    with `code: "transfer_not_enabled"`.
                                    Do NOT use `supabase secrets list`.
- Probe response (sanitized JSON):  <paste; bearer redacted per §3 rules>
- Conclusion:                       flag is back to disabled ✓ — §4.0
                                    `finally` clause closed.

## 10. Sign-off
- Operator signed:                  <name + UTC timestamp>
- CTO reviewed:                     <pending>

## 11. Deviations / failures (mandatory section, may be empty)

This section MUST exist in every evidence package, even if the smoke
ran exactly as written. An empty §11 is a positive signal; a missing
§11 is a process violation.

For every deviation from the template's normal path, capture one
entry:

### 11.<N>. <one-line title, e.g. "Bridge sandbox returned 502 on retry">

- When (UTC):                       <timestamp>
- During which step:                <e.g. §5 retry, §6.2 list query>
- What happened:                    <objective description, no speculation>
- Impact on the smoke:              <e.g. "had to repeat §5 once; first attempt's bridge_transfer_id is recorded but discarded">
- Did it require triggering the §4.0 emergency cleanup?:  <yes/no>
- If yes, was the flag confirmed back at false?:           <yes — with §9-style probe>
- Resolution:                       <what we did to continue, or "stopped here">
- Follow-up needed:                 <ticket / note / link, or "none">

If no deviations occurred:

> No deviations. Smoke ran end-to-end as written.
```

---

## 4. Future smoke sequence (executed only on `go transfer evidence package`)

These steps run **in order**, gated on the §1 guardrails. Each step
captures the output that lands in the corresponding `EVIDENCE_PACKAGE.md`
section.

### 4.0 Mandatory emergency cleanup (`finally` clause)

**Before any step in §4.1+ runs, the operator must commit to this
invariant:**

> If anything fails, throws, hangs, is unclear, is interrupted, or the
> operator gets distracted between steps 3 and 9, the flag MUST be
> flipped back to `"false"` and a probe MUST confirm 503 before doing
> anything else — including before writing up what went wrong.

Practically: keep a second terminal/tab open the entire smoke window
with the flag-down command ready to fire. The flag-down is **not**
conditional on the smoke succeeding. It runs no matter what. The only
acceptable end-state once the window opens is `BRIDGE_TRANSFERS_ENABLED
= "false"` plus a 503-confirming probe.

If the operator cannot finish the smoke for any reason, the emergency
cleanup runs immediately and the partial state goes into the
"Deviations / failures" section of `EVIDENCE_PACKAGE.md` (see §3,
section 11). A failed smoke with the flag back to `false` is an
acceptable outcome. A successful smoke with the flag left at `true` is
**not**, and is treated as an incident.

### 4.1 Normal path

1. **Pre-flight (§2 re-run, must be all-green).**
2. **Capture flag state before** (§1 of evidence package).
3. **Flip `BRIDGE_TRANSFERS_ENABLED="true"`** — record the exact UTC
   timestamp and the verification probe. *(From this moment until step
   9, the §4.0 emergency cleanup is armed.)*
4. **Single sandbox transfer** — small amount, low-risk currency pair,
   Bridge sandbox customer. Capture full request + response in §4 of
   evidence.
5. **Immediate retry** — same raw `idempotency_key`, same body. Verify
   the canonical key in `transactions.metadata->>'idempotency_key'`
   matches the §3 canonical form. Capture in §5.
6. **Bridge duplicate check** — query Bridge `GET /v0/transfers` to
   prove only one transfer object exists for the smoke window. Capture
   in §6.
7. **DB single-row proof** — `select count(*)` and the single row body
   from `public.transactions` for that `bridge_transfer_id`. Must
   return exactly 1. Capture in §7.
8. **Webhook / worker transition** — either capture the bridge-webhook
   log entry + DB transition (Choice A) or document the sandbox blocker
   with a documented fallback (Choice B). Capture in §8.
9. **Flip `BRIDGE_TRANSFERS_ENABLED="false"`** *(this is the closing
   half of the §4.0 `finally` clause; it runs whether steps 4-8
   succeeded or not)* — record the exact UTC timestamp + verification
   probe. Capture in §9.
10. **Final probe** — send one more transfer request, expect 503
    `transfer_not_enabled`. Paste the response body into §9 as the
    final-state proof. Until this probe returns 503 the §4.0 cleanup
    is considered incomplete.
11. **Fill out §11 (deviations / failures)** in `EVIDENCE_PACKAGE.md`,
    even if it's a one-line "No deviations" entry.
12. **Commit `EVIDENCE_PACKAGE.md`** locally (no push).
13. **Notify CTO** that the package is ready for review.

The window between steps 3 and 9 is the only time during this entire
project where money movement is enabled. Keep it short — target under
ten minutes. If 10 minutes elapse and the package isn't on step 9 yet,
trigger §4.0 emergency cleanup, then continue evidence capture with
the flag at false.

---

## 5. Open inputs required before execution

The smoke run cannot start until each of these has an answer.

| # | Input                                  | Why it matters                                                                                       | Source                                                                                       |
|---|----------------------------------------|------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| 1 | Sandbox user id                        | Must be a real `auth.users.id` whose `user_profiles` row is wired to a Bridge sandbox customer.      | CTO to nominate, or create a sandbox-only test user during smoke.                            |
| 2 | Confirmed Bridge customer id           | `user_profiles.bridge_customer_id` must be set and `bridge_kyc_status='approved'` or the function 409s. | Either pulled from live (existing sandbox customer) or created via `bridge-kyc-link` flow.   |
| 3 | Source wallet + balance                | Bridge sandbox must have enough mock balance to satisfy the transfer.                                | Bridge sandbox dashboard.                                                                    |
| 4 | Destination address / rail             | Stablecoin chain + on-chain address, or fiat rail + bank account. Must be one the function accepts. | CTO to choose. African-rail currencies are blocked by the function (returns `no_partner`).   |
| 5 | Test amount                            | Small — 1.00 USD-equivalent recommended.                                                             | CTO to confirm.                                                                              |
| 6 | Who is allowed to flip the secret      | `BRIDGE_TRANSFERS_ENABLED` is a Supabase Edge Function secret; flip = Supabase dashboard or MCP.     | CTO to nominate operator. Recommend the same person running the smoke for tight time-boxing. |
| 7 | Webhook expectation (Choice A vs B)    | Need to know up-front whether Bridge sandbox fires webhooks, else the run gets stuck at §8.          | Bridge docs / support ticket / prior internal note.                                          |

---

## 6. What this chunk did **not** do

- Did not change `BRIDGE_TRANSFERS_ENABLED`. Still whatever the prod
  edge function secret currently is (expected: unset / "false").
- Did not call Bridge. No network egress to api.bridge.xyz initiated.
- Did not insert, update, or delete any row in `public.transactions`
  (or anywhere else).
- Did not edit `supabase/functions/bridge-transfer/index.ts` or any
  other file in the transfer path.
- Did not edit `CTO_REVIEW_HANDOFF.md`.
- Did not push to any remote.
- Did not create `EVIDENCE_PACKAGE.md` — that file is the **next**
  chunk's output.

The only file created by this chunk is this document.
