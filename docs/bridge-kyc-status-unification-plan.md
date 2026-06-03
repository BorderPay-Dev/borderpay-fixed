# Bridge KYC — status unification plan (design only)

Status: **source-only planning doc. No DB write, no replay, no deploy, no manual
mirror patch.** Follows a read-only reconciliation of a real rejected customer
whose app surfaces still showed a "pending / started" state. Per-user identifiers
(email / Bridge customer ids / user ids) are intentionally **kept out of this
public repo**; they live in the private operator record.

## 1. The defect (confirmed, read-only)

Bridge can reject a customer while the app keeps showing "verification in
progress / started". Confirmed end-to-end for one live customer:

- **Bridge truth:** canonical customer `status = rejected` (reason carried in
  **endorsement issues**, not top-level `rejection_reasons` —
  `detected_nexus_with_unsupported_region` /
  `endorsement_not_available_in_customers_region`).
- **DB Bridge-specific fields:** correctly synced — `bridge_kyc_status = rejected`,
  `bridge_account_status = rejected`.
- **DB canonical / legacy fields:** **NOT** updated — `kyc_status = pending`,
  `account_status = active`.
- **Result:** every surface that reads canonical `kyc_status` (or a cached
  `borderpay_user` profile) still renders "pending / started", contradicting the
  Bridge-aware cards that read `bridge_kyc_status` and correctly show "rejected".

This is a **status-derivation + cache** problem, not a webhook/worker outage. The
webhooks were received and processed (3× `customer.updated`, `signature_ok=true`,
all `pending_events` completed, attempts=1).

### Why canonical fields were never set (root cause in source)
`supabase/functions/process-pending-events/index.ts`:
- `kyc_link.*` / `customer.kyc*` / `customer.kyb*` → the KYC handler writes
  **both** `bridge_kyc_status` and canonical `kyc_status` (≈ line 160:
  `approved→verified`, `rejected→rejected`, else `pending`).
- plain **`customer.updated`** → `handleBridgeCustomerStatus` (≈ line 185) writes
  **only `bridge_account_status`** — it never touches `kyc_status` /
  `account_status`.

The rejected customer received **only `customer.updated`** events, so canonical
`kyc_status` was never in scope. (`bridge_kyc_status` was later stamped `rejected`
by a *different* path — most likely the authenticated `kyc-status` poll during the
user's own session — which **also** writes only the Bridge-specific field. That
path's exact behaviour is to be confirmed as part of item 4 below, not assumed.)

### Secondary finding — stale legacy mirror (not a duplicate)
- `user_profiles.bridge_customer_id` (canonical) → **real, rejected**.
- `users.bridge_customer_id` (legacy mirror) → **`not_found` on Bridge**.
- So there is **no real duplicate Bridge customer**; the `users` mirror holds
  stale/bad data. Tracked under item 5; **do not** hand-patch it.

## 2. Fix plan (each item its own reviewed PR; this doc deploys nothing)

### Item 1 — Shared status-derivation helper (frontend, source-only)
Add one helper next to `isFullEnrollment` in `utils/config/environment.ts`
(e.g. `deriveKycStatus(profile)`), with **Bridge-first precedence**:

1. `bridge_kyc_status` (individual) / `bridge_kyb_status` (business) if terminal,
2. then `bridge_account_status`,
3. then legacy `kyc_status`.

Contract: **if Bridge says `rejected`, the derived status is `rejected` even when
`kyc_status = pending`.** `isFullEnrollment` (or a new `isVerified(profile)`)
should derive from this helper so a Bridge-rejected customer is never treated as
verified, and never as merely "pending/started". Ships **with its own audit**
asserting the precedence + the rejected-overrides-pending rule.

### Item 2 — Route display/gating surfaces through the helper
Replace direct `kyc_status` reads that drive **display or gating** with the
helper. Known surfaces (from a read-only scan — confirm exact lines in the PR):

| Surface | File | Note |
|---|---|---|
| Profile status row | `components/profile/ProfileScreen.tsx` (~53, 75, 114, 206) | display |
| Dashboard enrollment gate | `components/app/Dashboard.tsx` (~108 cached, ~190) | gating |
| Add Money gate | `components/deposit/AddMoneyScreen.tsx` (~49) | gating |
| USD Account gate | `components/accounts/USDAccountScreen.tsx` (~124) | gating |
| Wallet gate | `components/wallet/WalletScreen.tsx` (~55) | gating |
| Provisioning modal | `components/wallet/RequestProvisioningModal.tsx` (~68, 78) | gating |
| Send gate | `components/send/SendMoneyFlow.tsx` (~117) | gating |
| Card design gate | `components/cards/CardDesignSelector.tsx` (~129) | gating |
| Login verified check | `components/auth/LoginScreen.tsx` (~116, 135, 236) | gating |

Already Bridge-aware (reference implementations, leave as-is or refactor onto the
helper): `components/dashboard/bridge/BridgeKycStatusCard.tsx`,
`components/kyc/KYCVerification.tsx`.

> Scope guard: only touch reads that affect **display/gating**. Do not rewrite
> unrelated profile-hydration logic.

### Item 3 — Cache refresh / canonical derivation for `borderpay_user`
Cached `borderpay_user` (read in ~40 places, incl. `utils/supabase/client.ts`
~196, `components/auth/LoginScreen.tsx` ~116) must not keep showing `pending`
after Bridge rejects. Options (decide in the PR):
- refresh the profile from `user_profiles` on app open / focus, **or**
- derive status from fresh Bridge-specific fields rather than the cached
  `kyc_status`, **or**
- bump the cache key / TTL so a stale rejected→pending value cannot persist.

### Item 4 — Backend terminal-status propagation (deploy-gated, LATER)
In `handleBridgeCustomerStatus` (`process-pending-events`), propagate **terminal**
Bridge customer status to canonical fields — **only after confirming Bridge's
customer `status` semantics** (what values are terminal, and how `customer.updated`
`status` relates to KYC vs account standing):
- `rejected` → set `kyc_status = 'rejected'` and `account_status` **not** `active`.
- `approved`/`active` → set `kyc_status = 'verified'` consistently with the KYC
  handler (≈ line 160).
- Also reconcile the `kyc-status` poll path so it propagates canonical status, not
  just `bridge_kyc_status`.

This is a **deploy-gated backend PR**, byte-verbatim deploy + verification, with
its own audit. **Not now.** No replay of historical events.

### Item 5 — Stale `users.bridge_customer_id` mirror (separate hygiene)
Record the stale/`not_found` legacy mirror value as a **separate** cleanup —
migration or admin-sync — to reconcile or retire `users.bridge_customer_id`
against canonical `user_profiles`. **Do not** hand-patch the row. No write here.

## 3. Sequencing
1. **Items 1–3 (frontend, source-only first):** helper + audit, route surfaces,
   cache refresh. Lowest risk, fixes the user-facing contradiction immediately on
   next deploy of the SPA.
2. **Item 4 (backend, deploy-gated):** terminal-status propagation, only after
   Bridge `status` semantics are confirmed.
3. **Item 5 (hygiene):** legacy-mirror reconciliation, scheduled separately.

## 4. Guardrails (standing)
No DB write · no replay · no deploy · no manual mirror patch · no flag flips ·
no money movement. The specific rejected customer is **not** patched by hand; the
fix is systemic (derive Bridge-first + propagate terminal status + refresh cache).
