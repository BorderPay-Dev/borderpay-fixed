# Final readiness packet

Doc-only summary of where this rebuild stands as of HEAD. This file
does not change any runtime behaviour and does not finalise anything.
It exists so the CTO can review the accepted-vs-blocked split in one
place before deciding the next gate.

If you are reading this looking for **how to enable money movement**,
the answer is: not here, not now. See §4 and §6.

---

## 1. Commit stack (chronological, on `main`, NOT pushed)

| # | Hash      | Round / kind         | One-line                                                                |
|---|-----------|----------------------|-------------------------------------------------------------------------|
| 1 | `6268f94` | round-2 P0 fix       | sync source to deployed, harden idempotency, fail-closed TOTP           |
| 2 | `250275b` | round-3 P0 follow-up | `schema.sql` baseline, `BRIDGE_TRANSFERS_ENABLED` gate, RPC-backed upsert |
| 3 | `22e116c` | round-4 P0 follow-up | strip Maplerad from `schema.sql` base CREATE TABLEs + 2FA strand reset  |
| 4 | `ea6f7d1` | round-5 P0 follow-up | schema reproducible from migrations (baseline + reconcile)              |
| 5 | `ed8dee0` | round-6 P0 follow-up | replay correctness — transitional cols, PK, enum, constraint parity     |
| 6 | `b1d9a5e` | docs                 | prepare transfer evidence runbook (`TRANSFER_EVIDENCE_PREP.md`)         |

Branch is ahead of `origin/main` by 6 commits. No push has occurred at
any point in this review cycle. Each commit is self-contained and
documented in its commit body.

---

## 2. What is accepted

Items the CTO has explicitly accepted across rounds 2–6. Nothing here
needs further action.

### 2.1 Source-vs-deployed parity
- The deployed `bridge-transfer` edge function is source-banner v3 /
  runtime v4, and the on-disk source at
  `supabase/functions/bridge-transfer/index.ts` matches it.
- The deployed `2fa-*` and `pin-*` edge functions are aligned with the
  source after the round-2 hardening pass (TOTP encrypted at rest,
  PIN PBKDF2 + lockout, fail-closed if `TOTP_ENCRYPTION_KEY` env
  missing).
- The WebAuthn flow is server-verified via `@simplewebauthn/server`.

### 2.2 Idempotency
- `bridge-transfer` requires a client-provided `idempotency_key`
  (8–128 printable ASCII) and refuses with `400 idempotency_key_required`
  otherwise.
- The key is canonicalised to `borderpay:transfer:<user.id>:<client_key>`
  before being stored, so two users cannot collide on the same raw
  key.
- The DB pre-check uses `metadata->>'idempotency_key'` to short-circuit
  retries that race a crash between Bridge accept and our DB write.

### 2.3 RPC-backed persistence
- Persistence goes through the `upsert_bridge_transaction` plpgsql
  RPC. PostgREST `.upsert({onConflict})` cannot infer the partial
  unique index
  `WHERE provider='bridge' AND bridge_transfer_id IS NOT NULL`; the
  RPC expresses that predicate explicitly in its `ON CONFLICT ...
  WHERE` clause.
- Replay test fixture
  `tests/replay/bridge_transfer_idempotency.sql` exercises two
  back-to-back RPC calls with the same `bridge_transfer_id` and
  asserts exactly one row.

### 2.4 Fail-closed feature flag
- `BRIDGE_TRANSFERS_ENABLED` is a per-environment Supabase Edge
  Function secret.
- `bridge-transfer` reads it and returns `503 transfer_not_enabled`
  unless the value is the literal string `"true"`. The gate fires
  **before** auth, JWT validation, profile read, or Bridge call — no
  side effects can leak while disabled.
- UI disable in `components/send/SendMoneyFlow.tsx` is decorative
  (`aria-disabled`, "Pending evidence" badge); the server-side gate is
  what actually keeps the path off.

### 2.5 Maplerad cleanup
- `utils/supabase/schema.sql` base CREATE TABLE blocks contain zero
  Maplerad column references. The legacy `maplerad_*` columns are
  retained transitionally in the baseline migration so older mirror
  triggers can replay safely, then dropped by
  `20260518_maplerad_triggers_sweep.sql`.
- The `payment_provider` enum still carries the `maplerad` value — by
  design, for historical row legibility — but no live row has it as a
  current value.

### 2.6 2FA stranded-user reset
- `20260518_2fa_reset_unencrypted_plaintext.sql` resets
  `two_factor_enabled=false` for any row where the only credential
  was the legacy plaintext column (post-condition `stranded = 0`
  verified live).

### 2.7 Schema reproducibility from migrations
- `20260101_base_schema_user_profiles_users_user_security.sql`
  (baseline) + `20260519_schema_reconcile_bridge_partner_columns.sql`
  (reconcile) together produce the live shape from a clean replay.
- Replay correctness covers: transitional `maplerad_customer_id` for
  the round-5 mirror-trigger window, `user_security` PK on `id` with
  UNIQUE on `user_id` (matches live, not the previous aspirational
  `user_id` PK), six-label `kyc_status` enum (matches live `pg_enum`),
  and dashboard-DDL columns (`backup_codes`, `failed_pin_attempts`,
  `failed_2fa_attempts`, `two_factor_locked_until`) now backed by
  migrations.
- Verified via in-process `BEGIN; ... ROLLBACK;` replay against a
  temp schema in live + a negative control that reproduces the
  pre-fix `42703` failure exactly as round-5 CTO described.

### 2.8 Build & typecheck
- `tsc --noEmit`: pass at HEAD.
- `vite build`: pass at HEAD (existing CSS/import/chunk warnings only).

---

## 3. What is still blocked

### 3.1 Live cutover — blocked
Money movement cannot go live until the Bridge sandbox transfer
evidence package exists and the CTO signs it off. See §6.

### 3.2 `BRIDGE_TRANSFERS_ENABLED` flip to `"true"` — blocked
The only legitimate flip is during the explicit smoke window described
in `TRANSFER_EVIDENCE_PREP.md` §4. Even that flip is gated on a fresh
`go transfer evidence package` signal from the CTO. Until then the
flag stays at `"false"` / unset.

### 3.3 Push to `origin/main` — blocked
6 commits are queued locally. No push has been attempted at any point
in this cycle. The push gate is part of the deployment checklist in §5.

### 3.4 Vercel / Edge Function deploy — blocked
No `vercel deploy`, no `supabase functions deploy`. The deployed
edge-function bundles in production were last touched in round-2 /
round-3 and remain the accepted source-aligned versions.

### 3.5 Stale source comment in `SendMoneyFlow.tsx` — known, deferred
The inline comment block in `components/send/SendMoneyFlow.tsx`
(around L527–536) still reads "bridge-transfer v2". The deployed
backend is v3 / runtime v4. The comment is informational; the UI
disable + server-side gate are what matter. Flagged in
`TRANSFER_EVIDENCE_PREP.md` §2.4 for a future doc-only cleanup
chunk — not blocking and not touched in this packet.

---

## 4. Exact reason `BRIDGE_TRANSFERS_ENABLED` remains `false`

There is no remaining engineering blocker. The flag remains `false`
because:

> No end-to-end Bridge sandbox transfer evidence package exists and
> has been signed off. Until that package documents (a) an actual
> sandbox transfer round-trip, (b) a retry with the same raw
> `idempotency_key` that does NOT create a duplicate at Bridge,
> (c) exactly one row in `public.transactions` with the canonical
> key in `metadata->>'idempotency_key'`, and (d) a webhook/worker
> state transition or a documented sandbox blocker, we cannot prove
> the path is safe enough to enable for real users.

The code path itself is ready. The evidence is what is missing. The
flag is the last lever the CTO holds; it stays down until the
evidence package is reviewed.

A successful smoke run does NOT leave the flag at `"true"` either —
the smoke window ends with a mandatory flag-down (see
`TRANSFER_EVIDENCE_PREP.md` §4.0 `finally` clause). Enablement for
real users is a separate decision the CTO makes after the evidence is
reviewed, not an automatic consequence of a passing smoke.

---

## 5. Deployment / push checklist

Order matters. None of these steps execute as part of this packet —
this is the future runbook.

1. **CTO sign-off on every commit in §1.** Each commit's body
   contains its own evidence summary; reviewer should diff against
   `origin/main`.
2. **Sign-off on the evidence package** (separate file
   `EVIDENCE_PACKAGE.md`, future deliverable — see §6).
3. **`git push origin main`** — only after both sign-offs.
4. **Edge function redeploy.** Source already matches deployed for
   `bridge-transfer`, `setup-2fa`, `verify-2fa`, `setup-pin`,
   `verify-pin`, and the WebAuthn functions; redeploying them is a
   no-op but harmless. **Do not** flip
   `BRIDGE_TRANSFERS_ENABLED="true"` as part of this step. The flag
   stays at its current `false` / unset state during deploy.
5. **Vercel deploy of the SPA.** UI disable for the stablecoin send
   card stays in place; the build artefact is unchanged from the
   committed source.
6. **Post-deploy probe.** Same probe shape as
   `TRANSFER_EVIDENCE_PREP.md` §1 — expected
   `503 transfer_not_enabled`. If the probe returns anything else,
   stop and treat as an incident.
7. **Enablement for real users** is a separate decision, made by the
   CTO after the evidence package is signed off, by setting
   `BRIDGE_TRANSFERS_ENABLED="true"`. That step does not happen in
   this checklist.

### 5.1 Guardrails for the push step
- No force-push.
- No `--no-verify`, no `--no-gpg-sign`. Hooks run.
- No amend of any of the six commits in §1. They have been reviewed
  individually.
- Push target is `origin/main`. No alternate remotes.

---

## 6. Transfer evidence checklist

Authoritative document: **`TRANSFER_EVIDENCE_PREP.md`** at repo root
(committed as `b1d9a5e`). This packet does not duplicate it; it
points at the section the CTO needs to verify.

Before the smoke window opens:

- [ ] §2 pre-flight re-run (six checks; all-green).
- [ ] §5 open inputs filled: sandbox user id, `bridge_customer_id`,
  source wallet + balance, destination address/rail, test amount,
  flip operator, webhook expectation.
- [ ] Operator commits to §4.0 `finally` clause (flag-down on any
  failure, no exceptions).

Smoke window steps (each lands in the matching section of
`EVIDENCE_PACKAGE.md`):

- [ ] §1 probe proves flag at `false` before flip.
- [ ] §2 flip + probe proves flag at `true`.
- [ ] §4 one sandbox transfer (request + response, sanitized per
  §3 redaction rules).
- [ ] §5 retry with **same raw** `idempotency_key`, response
  `bridge_transfer_id` equals §4.
- [ ] §6.1 direct Bridge id lookup round-trips.
- [ ] §6.2 idempotency / list-by-window check shows zero
  `same-intent` Bridge transfers other than §4.
- [ ] §7.1 SQL returns `row_count = 1` AND
  `canonical_key_matches = true`.
- [ ] §8 webhook fired (Choice A) OR sandbox blocker documented
  with fallback (Choice B).
- [ ] §9 flip + probe proves flag back at `false`.
- [ ] §11 deviations section filled (even if "No deviations").
- [ ] `EVIDENCE_PACKAGE.md` committed locally (not pushed).

The 12-step smoke order is in `TRANSFER_EVIDENCE_PREP.md` §4.1.
Target window between flip-up and flip-down: under ten minutes.

---

## 7. Rollback notes

### 7.1 Rollback of the doc-only commits (`b1d9a5e`, this packet)
- `git reset --hard <previous-hash>` locally, or `git revert b1d9a5e`
  if already pushed. No runtime impact either way; these are pure
  documentation files.

### 7.2 Rollback of the migration commits (`ea6f7d1`, `ed8dee0`)
- The baseline (`20260101_*`) and reconcile (`20260519_*`) migrations
  were applied via Supabase MCP idempotently against live. They are
  no-ops against the current production shape.
- If a clean replay is later found to diverge, fix forward with
  another reconcile migration; do **not** roll back the existing
  ones. Rolling them back would corrupt the migration history on any
  clone that already applied them.
- The migrations contain post-condition `DO` blocks that will refuse
  to leave the migration in a partial state — they `raise exception`
  on missing tables/columns/PK shapes.

### 7.3 Rollback of the bridge-transfer feature flag
- If `BRIDGE_TRANSFERS_ENABLED` is ever set to `"true"` and we need
  to disable the path immediately:
  - Set `BRIDGE_TRANSFERS_ENABLED="false"` via Supabase dashboard
    secrets (or MCP).
  - Confirm with a probe — expect `503 transfer_not_enabled`.
  - The next inbound request fails closed; no redeploy needed; no
    in-flight transfers are stranded (Bridge keeps state on their
    side, our DB row reflects the last status we saw before the gate
    closed).

### 7.4 Rollback of the schema source-of-truth (`utils/supabase/schema.sql`)
- This file is a snapshot, not deployed DDL. Rolling back to a prior
  version of `schema.sql` is doc-only and does not affect production.
- The actual deployed shape is whatever the migration history has
  applied to live. The current snapshot was reconciled to live in
  round-6.

### 7.5 Worst-case incident path
- Stop using the `bridge-transfer` function: confirm flag at
  `"false"` via probe.
- Revert the most recent commit on `main` if a code-level rollback
  is required: `git revert <hash>` and re-push (force-push to main
  is prohibited).
- Re-deploy only the reverted state via `supabase functions deploy
  bridge-transfer`. UI disable stays in place; SPA does not need a
  redeploy for a function-only revert.
- Pull the live state SQL for any potentially-affected
  `transactions` rows and reconcile against Bridge by `transfer_id`.

---

## 8. What this packet did NOT do

- Did not edit `supabase/functions/bridge-transfer/index.ts` or any
  other runtime file.
- Did not edit `CTO_REVIEW_HANDOFF.md`.
- Did not edit `TRANSFER_EVIDENCE_PREP.md`.
- Did not flip `BRIDGE_TRANSFERS_ENABLED`.
- Did not call Bridge.
- Did not insert, update, or delete any row in `public.transactions`
  or any other money-movement table.
- Did not push, deploy, or otherwise alter remote state.
- Created exactly one file: this one.
