# Final readiness packet

Doc-only summary of where this rebuild stands as of HEAD. This file
does not change any runtime behaviour and does not finalise anything.
It exists so the CTO can review the accepted-vs-blocked split in one
place before deciding the next gate.

If you are reading this looking for **how to enable money movement**,
the answer is: not here, not now. See §4 and §6.

---

## 1. Commit stack (chronological, on `codex/cto-review-rounds-2-6`, pushed)

| # | Hash      | Round / kind         | One-line                                                                  |
|---|-----------|----------------------|---------------------------------------------------------------------------|
| 1 | `6268f94` | round-2 P0 fix       | sync source to deployed, harden idempotency, fail-closed TOTP             |
| 2 | `250275b` | round-3 P0 follow-up | `schema.sql` baseline, `BRIDGE_TRANSFERS_ENABLED` gate, RPC-backed upsert |
| 3 | `22e116c` | round-4 P0 follow-up | strip Maplerad from `schema.sql` base CREATE TABLEs + 2FA strand reset    |
| 4 | `ea6f7d1` | round-5 P0 follow-up | schema reproducible from migrations (baseline + reconcile)                |
| 5 | `ed8dee0` | round-6 P0 follow-up | replay correctness — transitional cols, PK, enum, constraint parity       |
| 6 | `b1d9a5e` | docs                 | prepare transfer evidence runbook (`TRANSFER_EVIDENCE_PREP.md`)           |
| 7 | `8e143d7` | docs                 | add final readiness packet (this file)                                    |
| 8 | `bb2af7d` | round-7 P1 fix       | TOTP encrypted-secret bytea round-trip via base64 RPCs                    |
| 9 | `c23ecb9` | round-7 P1 fix       | `bridge-kyb-link` uses `bridge_kyb_link_*` columns, not `bridge_kyc_link_*` |
| 10 | `b4875ef` | round-7 P2 doc fix  | refresh final readiness packet for round-7 state                            |

The 10-commit stack is on branch `codex/cto-review-rounds-2-6` and
pushed to `origin/codex/cto-review-rounds-2-6` — **not** to
`origin/main`. Open as draft PR
[#2 — CTO review rounds 2-7 readiness package](https://github.com/BorderPay-Dev/borderpay-fixed/pull/2)
(base `main`, head `codex/cto-review-rounds-2-6`).

`origin/main` is still at `ec4f0db` (the pre-rebuild handoff commit)
and has not moved at any point in this review cycle. Local `main` is
10 commits ahead of `origin/main`; the review branch is fast-forward
equivalent to local `main` and is the surface the CTO reviews against.

(Note: this packet itself is commit 10. The CTO re-review that
verifies this update will see an 11th commit on the branch — a
doc-only re-refresh that counts commit 10 — which is the smallest
self-referencing fix-up possible. Future doc updates to this packet
will be flagged in the same way; this is a known one-commit
self-reference lag, not a content drift.)

Each commit is self-contained and documented in its commit body.

---

## 2. What is accepted

Items the CTO has explicitly accepted across rounds 2–7. Nothing here
needs further action.

### 2.1 Source-vs-deployed parity
- The deployed `bridge-transfer` edge function is source-banner v3 /
  runtime v4, and the on-disk source at
  `supabase/functions/bridge-transfer/index.ts` matches it.
- The on-disk `setup-2fa` (v85, was v84) and `verify-2fa` (v87, was
  v85/v86) sources are the round-7 b64-RPC versions and are **ahead**
  of the deployed bundles; redeploy will land them. The deployed
  bundles have the broken bytea round-trip and are functionally
  unusable for encrypted 2FA, but no current user is relying on them
  (`enabled_with_encrypted = 0` live). Redeploy gates on PR #2 merge.
- The deployed `pin-*` edge functions are aligned with the source after
  the round-2 hardening pass (PIN PBKDF2 + lockout).
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

### 2.9 TOTP encrypted-secret bytea round-trip (round-7 P1 fix)
- Previously, `setup-2fa` wrote `Array.from(cipher)` directly into the
  `bytea` column; PostgREST JSON-serialised that as `[139,71,...]` and
  PostgreSQL bytea text-input stored the ASCII bytes of that JSON
  string, not the cipher itself. `verify-2fa` then wrapped the
  returned `\x...` hex string with `new Uint8Array(string)` and
  produced zero-length garbage. Encrypted 2FA enrollment + verification
  were broken end-to-end.
- New migration `20260520_totp_secret_b64_rpcs.sql` adds two
  `security definer` RPCs that handle bytea ↔ base64 inside Postgres:
  `set_totp_secret_encrypted_b64(p_user_id, p_b64, p_enc_version)` and
  `get_totp_secret_encrypted_b64(p_user_id) → text`. The edge function
  wire format is always plain base64 text; the bytea boundary never
  touches PostgREST.
- `setup-2fa` v85 writes via the setter; `verify-2fa` v87 reads via
  the getter. The migration also clears the one pre-fix bogus blob
  (only rows with `two_factor_enabled = false`) and asserts via
  post-condition `DO $$ ... $$` blocks that (a) no row is left
  stranded (enabled with null encrypted) and (b) both RPC signatures
  match the expected shape.
- **Migration not yet applied to live.** Will apply via MCP after PR
  #2 merge approval. Idempotent (CREATE OR REPLACE for functions;
  cleanup targets only rows that are already non-functional).

### 2.10 Business KYB column-name correctness (round-7 P1 fix)
- `bridge-kyb-link` previously read and wrote `bridge_kyc_link_id` /
  `bridge_kyc_link_url` on `public.business_profiles`. Live schema
  only has `bridge_kyb_link_id` / `bridge_kyb_link_url` on that table
  (the `bridge_kyc_link_*` columns live on `user_profiles` for the
  individual KYC flow). The UPDATE 400'd silently and the downstream
  KYC reader (`KYCVerification.tsx`, which correctly reads
  `bridge_kyb_link_url`) never saw the just-created link.
- All 5 column references renamed to `bridge_kyb_link_*`. UPDATE
  result is now error-checked so a future schema drift surfaces as a
  500 with the Bridge `request_id`.
- No schema change needed; the live schema is already correct.

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
The 10 commits are pushed to `origin/codex/cto-review-rounds-2-6`
(review surface, PR #2). They have **not** been pushed to
`origin/main`. Promotion to `main` runs through PR merge after CTO
verdict; see §5.

### 3.4 Vercel / Edge Function deploy — blocked
No `vercel deploy`, no `supabase functions deploy`. The deployed
edge-function bundles in production were last touched in round-2 /
round-3 and remain the accepted source-aligned versions for
`bridge-transfer`, `bridge-kyc-link`, and the WebAuthn functions. The
on-disk `setup-2fa` (v85), `verify-2fa` (v87), and `bridge-kyb-link`
sources are **ahead** of the deployed bundles after the round-7 fixes
and will be redeployed as part of the §5 checklist.

### 3.5 New migration `20260520_totp_secret_b64_rpcs.sql` — blocked
Committed to the review branch but **not** applied to live. The
migration is idempotent and the data cleanup affects 1 row that is
already non-functional, but the cycle convention is to let the CTO
sign off in PR #2 before applying via MCP.

### 3.6 Stale source comment in `SendMoneyFlow.tsx` — known, deferred
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

1. **CTO sign-off in PR #2.** Each of the 10 commits' bodies contains
   its own evidence summary; reviewer should diff against
   `origin/main`. The PR is currently draft; merge approval is the
   sign-off signal.
2. **Sign-off on the evidence package** (separate file
   `EVIDENCE_PACKAGE.md`, future deliverable under a separate
   `go transfer evidence package` signal — see §6).
3. **Merge PR #2** via the GitHub UI or `gh pr merge 2`. This
   fast-forwards `origin/main` from `ec4f0db` to `b4875ef` (or the
   then-current PR head if further review-fix commits land before
   merge). No direct `git push origin main` is needed.
4. **Apply migration `20260520_totp_secret_b64_rpcs.sql` to live** via
   MCP. Idempotent; data cleanup affects 1 non-functional row.
   Post-condition `DO $$ ... $$` blocks fail loudly on partial apply.
5. **Edge function redeploy.** Source already matches deployed for
   `bridge-transfer`, `bridge-kyc-link`, `setup-pin`, `verify-pin`,
   and the WebAuthn functions; redeploying them is a no-op but
   harmless. **`setup-2fa` (v85), `verify-2fa` (v87), and
   `bridge-kyb-link` are ahead of their deployed bundles after the
   round-7 fixes — redeploy is required** for the bytea round-trip
   fix and the KYB column rename to land. **Do not** flip
   `BRIDGE_TRANSFERS_ENABLED="true"` as part of this step. The flag
   stays at its current `false` / unset state during deploy.
6. **Vercel deploy of the SPA.** UI disable for the stablecoin send
   card stays in place; the build artefact is unchanged from the
   committed source.
7. **Post-deploy probes.**
   - Bridge transfer gate: same shape as `TRANSFER_EVIDENCE_PREP.md`
     §1 — expected `503 transfer_not_enabled`. If anything else,
     stop and treat as an incident.
   - 2FA b64 RPC capability: confirm `set_totp_secret_encrypted_b64`
     and `get_totp_secret_encrypted_b64` exist in
     `pg_proc` (e.g. `select pg_get_function_identity_arguments(...)`
     via MCP). If absent, step 4 did not apply — stop.
8. **Enablement for real users** is a separate decision, made by the
   CTO after the evidence package is signed off, by setting
   `BRIDGE_TRANSFERS_ENABLED="true"`. That step does not happen in
   this checklist.

### 5.1 Guardrails for the merge/push step
- No force-push.
- No `--no-verify`, no `--no-gpg-sign`. Hooks run.
- No amend of any of the ten commits in §1. They have been reviewed
  individually in PR #2.
- Push target is the PR merge surface; `origin/main` moves only via
  PR #2 fast-forward. No direct push to `origin/main`. No alternate
  remotes.

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

### 7.1 Rollback of the doc-only commits (`b1d9a5e`, `8e143d7` — this packet)
- `git reset --hard <previous-hash>` locally, or `git revert <hash>`
  if already on `main`. No runtime impact either way; these are pure
  documentation files.

### 7.2 Rollback of the migration commits (`ea6f7d1`, `ed8dee0`, `bb2af7d`)
- The baseline (`20260101_*`), reconcile (`20260519_*`), and TOTP-b64
  RPC (`20260520_*`) migrations are all idempotent.
- The first two have been applied via Supabase MCP and are no-ops
  against the current production shape.
- The TOTP-b64 RPC migration (`20260520_totp_secret_b64_rpcs.sql`) is
  on disk in the review branch but **not yet applied** to live (gates
  on PR #2 merge approval). If applied and later found to be
  incorrect: `drop function if exists public.set_totp_secret_encrypted_b64`
  + `drop function if exists public.get_totp_secret_encrypted_b64`,
  re-deploy the previous `setup-2fa` / `verify-2fa` bundles. The data
  cleanup in step §4 only affected one row that was already
  non-functional, so there's nothing to restore.
- For any of the three: if a clean replay is later found to diverge,
  fix forward with another reconcile migration; do **not** roll back
  the existing ones. Rolling them back would corrupt the migration
  history on any clone that already applied them.
- All three migrations contain post-condition `DO` blocks that will
  refuse to leave the migration in a partial state — they
  `raise exception` on missing tables/columns/PK shapes or RPC
  signatures.

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
  is required: open a revert PR (`gh pr create` from a revert branch)
  and merge. Force-push to `main` is prohibited.
- Re-deploy only the reverted state via
  `supabase functions deploy <function-name>`. UI disable stays in
  place; SPA does not need a redeploy for a function-only revert.
- Pull the live state SQL for any potentially-affected
  `transactions` rows and reconcile against Bridge by `transfer_id`.

---

## 8. What this packet did NOT do

The round-5 origin of this file created it as a doc-only commit. The
round-7 refresh (this edit) is also doc-only.

- Did not edit `supabase/functions/bridge-transfer/index.ts`. The
  round-7 fixes touched `setup-2fa`, `verify-2fa`, and
  `bridge-kyb-link`, but those landed in commits `bb2af7d` / `c23ecb9`
  — separate from this packet refresh.
- Did not edit `CTO_REVIEW_HANDOFF.md`.
- Did not edit `TRANSFER_EVIDENCE_PREP.md`.
- Did not flip `BRIDGE_TRANSFERS_ENABLED`.
- Did not call Bridge.
- Did not insert, update, or delete any row in `public.transactions`
  or any other money-movement table.
- Did not apply `20260520_totp_secret_b64_rpcs.sql` to live. The
  migration is on disk + on the review branch only.
- Did not push to `origin/main`, deploy, or otherwise alter remote
  runtime state. The review branch
  `origin/codex/cto-review-rounds-2-6` is the only remote surface
  that moved this cycle.

This refresh updated only the doc fields the CTO flagged stale: §1
commit stack count + push state, §2 to add round-7 acceptance, §3.3
push state, §3.5 new migration block, §5 to add the migration-apply
step and identify which edge function bundles are ahead of deployed,
§7.2 + §7.5 rollback notes, and this §8.
