# Bridge Core — Architecture Contract & Inventory

Status: **contract of record** (Bridge Core PR1 — documentation + audits only).
This file freezes what Bridge Core *is* today and what is in / out of scope. It
introduces **no behavior change**. The companion audit
`tests/audit/bridge_core_contract_audit.py` asserts the invariants below stay true.

> Bridge Core work proceeds in small, reviewable PRs. This doc is PR1; it does
> not delete/quarantine functions, sweep comments, change behavior, migrate the
> DB, deploy, call Bridge, replay events, or move money.

---

## 1. Eligibility rule (locked)

**Bridge is the primary eligibility layer.** Bridge's country / user-type policy
gates onboarding. **Flutterwave never expands onboarding eligibility** — it is a
subscription-billing + African local-currency *payout* provider that only applies
*after* Bridge eligibility. If Bridge prohibits/restricts a country or user type,
BorderPay does **not** onboard there, even if Flutterwave supports payouts in that
country.

## 2. In-scope Bridge products (Bridge Core)

| Product | State today |
|---|---|
| **KYC / KYB** | Live via Bridge **hosted-link** flow (customer creation deferred to "Start KYC/KYB"). |
| **Virtual accounts** (USD/EUR/GBP) | Live behind KYC gate; provision + display. |
| **Wallets** (stablecoin custody / hold / receive) | Live behind KYC gate; custodial wallet + deposit address. |
| **Orchestration / payments** (transfers) | **GATED OFF** — design-only until explicit CEO/CTO approval. |
| **Stablecoin hold / receive** | Live (via wallets). **Send** is part of gated orchestration. |

## 3. Out of scope (do NOT build/enable without a separate product decision)

- **Card issuing** (virtual or physical) — **Coming Soon** only. No issue/fund/freeze paths.
- **Issuing our own stablecoin.**
- **USDB / yield / earn / interest / APY** product surfaces — never user-facing.
- **Bridge external accounts** are **ACH/SEPA/IBAN** payout destinations (US/EUR) — they are **NOT** African local bank accounts and must never be labeled as such.
- **Flutterwave** as an onboarding-eligibility expander.
- **Transfers / money movement** without explicit CEO/CTO approval (no flag flip).
- **PR #7** — untouched.

## 4. Feature flags (compile-time, lockstep with backend env)

- `TRANSFERS_LIVE = false` — Send routes to `TransfersComingSoonScreen`; no `bridge-transfer` calls.
- `EXTERNAL_ACCOUNTS_LIVE = false` — payout-accounts UI hidden; no `bridge-external-account` calls.

Flipping either is a **gated money-movement decision**, not a Bridge Core PR1+ action.

## 5. Inventory (as discovered, read-only)

**Deployed functions:** bridge-customer v8, bridge-kyc-link v12, bridge-kyb-link v12,
bridge-virtual-account v8 (jwt✓), bridge-wallet v8 (jwt✓), bridge-transfer v10 (jwt✓, gated),
bridge-external-account v3 (jwt✓, gated), bridge-webhook v8 (public, signed),
process-pending-events v12 (cron worker), bridge-ping v8; kyc-submit (jwt✓),
kyc-status v31 (jwt✓), get-kyc-jobs v7.

**DB tables:** kyc_submissions, kyc_documents, kyc_verifications, address_verifications,
bridge_virtual_accounts, bridge_virtual_account_balances, bridge_wallets, wallets,
bridge_balance_ledger, stablecoin_transactions, bridge_transfers, transfer_limits,
bridge_external_accounts, bridge_webhook_events, pending_events, accounts.

**UI surfaces:** `components/dashboard/bridge/*` (BridgeKycStatusCard,
BridgeVirtualAccountsCard, BridgeWalletsCard, CardsComingSoonCard, AfricanRailsFutureCard),
`components/kyc/*`, `components/wallet*`, `components/receive/ReceiveMoneyScreen`,
`components/accounts/USDAccountScreen`, `components/payouts/*` (gated),
`components/send/*` (gated → coming-soon), `components/cards/CardsScreen` (Coming Soon).

## 6. Known debts (documented; NOT fixed in PR1)

1. **Two KYC paths — RESOLVED (PR2, 2026-06-03, doc-only).** Confirmed from source:
   **Canonical KYC = Bridge hosted-link.** `components/kyc/KYCVerification.tsx` and
   `components/auth/SignUpFlow.tsx` call `bridgeAPI.kyc.startIndividual` /
   `bridgeAPI.kyb.startBusiness` (`bridge-customer` → `bridge-kyc-link` /
   `bridge-kyb-link`); status polling via `kyc-status`. The legacy doc-upload surface
   is already inert: `kycAPI.submit` / `verifyBVN` are quarantined stubs (return
   `RAILS_FUTURE_STATE`, no network) and **no component references `kyc-submit`**.
   CORRECTION (PR3 investigation, #49): `kyc-submit` is **NOT deployed** at all
   (`get_edge_function` → NotFound; absent from `list_edge_functions`) — the repo
   source is a 410 "Gone" stub. **Decision A:** accept the platform 404 for any stale
   caller; do NOT deploy the stub absent evidence of a real one. Evidence +
   verdict: `docs/bridge-pr3-kyc-submit-retirement.md`. Canonical wiring locked by
   `tests/audit/kyc_path_canonical_audit.py`.
2. **Stale Maplerad comments/dead code** — references in `sync-users-to-maplerad` (not
   deployed), `bridge-virtual-account`, `process-pending-events`, `auth-signup`,
   `_shared/providers/registry.ts`, `schema.sql`, READMEs, `config.toml`. Cleanup is a
   later, one-at-a-time PR — **not** a broad sweep.
3. **COO EUR virtual account** — granted dashboard-side, never webhook-synced; parked,
   no manual DB row.
4. **Webhook/sync reliability** — ~14 failed `pending_events` (old "bridge customer event
   missing id" batch), ~37 signature-rejected webhook events, `processing_status`
   back-prop gap (cosmetic). **No replay without approval.**

## 7. Planned PR sequence (after this doc/audit merges)

- **PR2** — one specific cleanup (e.g. the two-KYC-paths clarification **or** stale
  Maplerad comments), investigated and fixed in isolation.
- **PR3** — virtual account sync/display gaps.
- **PR4** — wallet sync/display gaps.
- **PR5** — webhook/account-sync reliability (diagnose; replay only after approval).
- **PR6** — orchestration **design only**.
- **PR7+** — money movement, only after explicit CEO/CTO approval.

## 8. Hard guardrails (standing)

No destructive DB cleanup · no flag flips · no transfer execution · no Bridge API calls
without approval · no manual status patches · no Flutterwave country expansion ·
no own-stablecoin · no USDB/yield surfaces · cards stay Coming Soon · PR #7 untouched.
