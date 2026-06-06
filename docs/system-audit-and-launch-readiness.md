# BorderPay — System Audit & Launch Readiness

_Generated 2026-06-06. Scope: full-stack progress toward a money-movement launch on Bridge infrastructure._

> **How to read the %:** these are reasoned estimates weighted by importance to a
> **money-movement launch**, grounded in the actual code/edge-function surface.
> They are not a line-count metric. "Built" ≠ "live": several subsystems are
> code-complete but intentionally **gated off** behind fail-closed flags.

---

## 1. Headline numbers

| Metric | % |
|---|---|
| **Overall application build** (all surfaces) | **~72%** |
| **Money-movement-critical path** (what's needed to actually move funds) | **~55%** |
| **Compliance/billing gating reorder** (KYC/KYB after paid plan + manual review) | **~15%** |

The app *shell, identity, accounts, and Bridge provisioning* are largely done.
The gap to launch is the **money path**: enabling KYC/KYB safely, turning on
transfers with evidence, integrating an **African payout partner** (the single
biggest missing piece), and wiring the **paid-plan + manual-review** gate.

---

## 2. Domain-by-domain breakdown

| # | Domain | Status | % | Notes |
|---|---|---|---|---|
| 1 | Auth / security (signup, login, 2FA, PIN, WebAuthn/biometric, password reset) | ✅ Complete | 100 | Deployed, audited |
| 2 | App shell, nav, dashboards (individual + business), profile, settings, notifications | ✅ Complete | 95 | Floating header/tab bar live; FX widget now on both dashboards |
| 3 | KYC/KYB integration (Bridge hosted-link code) | 🟡 Built, **gated off** | 90 | `BRIDGE_ONBOARDING_ENABLED` fails closed → no Bridge invoices today |
| 4 | Virtual accounts (Bridge VA) | 🟡 Built, gated | 85 | Provisioning + cards/UI done; firing gated by onboarding |
| 5 | Stablecoin wallets (Bridge) | 🟡 Built, gated | 85 | Receive/hold done; send gated |
| 6 | Subscriptions / billing | 🟡 Built | 80 | Plan catalogue + wallet-debit `pay_subscription_invoice_from_va`; **not yet wired to KYC/KYB firing** (see #5) |
| 7 | FX rate display | ✅ Complete | 100 | **Live mid-market rates** (open.er-api.com), markup suspended |
| 8 | FX convert **execution** | 🔴 Future | 0 | `getQuote`/`convert` are `RAILS_FUTURE_STATE` |
| 9 | Transfers / money movement execution (`bridge-transfer`) | 🟡 Built, **OFF** | 60 | Hard-gated `BRIDGE_TRANSFERS_ENABLED`; needs sandbox-evidence sign-off; fee enforcement added (dormant) |
| 10 | **African local payout rails** (NGN/KES/GHS/…) | 🔴 Not integrated | 5 | Types/contracts only; `bridge-transfer` returns `no_partner`. **Needs a partner integration (Flutterwave/Yativo).** |
| 11 | Cards (issuing/funding) | 🔴 Locked | 0 | Intentionally "locked", future-state |
| 12 | Webhooks / email / reconciliation | ✅ Complete | 95 | `bridge-webhook` + `process-pending-events` + KYC/KYB email v1 live |
| 13 | Fees (developer fee + payout markup) | 🟡 Source-only | 90 | Server-side enforcement added; **dormant** until transfers enabled |

---

## 3. What is concretely DONE

- Full auth + account security stack (incl. biometric "Lock app").
- Individual **and** business dashboards, floating Instagram-style header, live FX widget.
- Bridge customer / KYC-link / KYB-link / virtual-account / wallet edge functions (code-complete).
- Webhook ingestion, terminal status propagation, KYC/KYB decision emails (live, proven).
- Subscription catalogue + wallet-debit upgrade RPC.
- Fee schedule (2.5% fiat / 0.999% stablecoin dev fee; tiered African payout markup) — enforced server-side, dormant.
- Product-truth cleanup (cards locked, no fake flows, no hidden FX markup).

## 4. What must be BUILT before money-movement launch

Ordered by criticality:

1. **Compliance/billing gate reorder (#4 + #5)** — KYC/KYB must fire only after a
   paid plan (and, for KYB, manual admin authorization). _Design below._ **~15% done.**
2. **Enable Bridge onboarding** (`BRIDGE_ONBOARDING_ENABLED=true`) behind the new
   gate, so verification only bills Bridge for paying/approved users.
3. **Turn on transfers** (`BRIDGE_TRANSFERS_ENABLED=true` + frontend `TRANSFERS_LIVE`)
   — requires sandbox evidence sign-off (per `bridge-transfer` contract).
4. **African payout partner integration** — the biggest remaining build. Without it,
   local-currency payout is impossible (`no_partner`). Needs: partner API client,
   corridor/limit config (partly in `fee_config`/`utils/fees`), quote+execute path,
   webhook reconciliation, and the tiered markup (already defined) wired in.
5. **FX convert execution** — depends on (4) + transfers.
6. **Cards** — separate future track.

---

## Appendix A — #4 Stepped KYB screening (DESIGN, not yet built)

**Goal:** never auto-fire the Bridge KYB API; gate it behind a manual admin
authorization, then prompt the user (by email) to finish document uploads.

**Proposed state machine** (business onboarding):
```
NOT_STARTED → PENDING_MANUAL_REVIEW → ADMIN_AUTHORIZED → (email prompt) →
  DOCS_REQUESTED → [Bridge KYB link issued] → SUBMITTED → APPROVED | REJECTED
```
- New canonical state: **`PENDING_MANUAL_REVIEW`** on `business_profiles`
  (and/or a `kyb_review` table) — set at signup instead of calling Bridge.
- **`bridge-kyb-link`** stays fail-closed unless the row is `ADMIN_AUTHORIZED`.
- **Admin authorization event** = an explicit admin action (admin UI / RPC /
  privileged endpoint) flipping `PENDING_MANUAL_REVIEW → ADMIN_AUTHORIZED`.
- **Email hook**: on the authorization event, send a "finish your document
  uploads" email via the existing logged `send-email` path (idempotent), reusing
  the webhook-email policy (recipient from DB, never payload; suppression list).

**Open decisions (need your call):** where does the admin review happen (existing
admin tool vs. new screen)? Who are the admins (a flag on `user_profiles.is_admin`
exists)? Same stepped flow for **individual KYC**, or KYB-only?

---

## Appendix B — #5 Premium paywall gate (DESIGN, not yet built)

**Goal:** Free plan = no live money movement; KYC ($2) / KYB ($10) Bridge calls
fire **only after** a successful paid checkout.

**Proposed:**
- A `requiresPaidPlan()` / `canMoveMoney(plan)` helper + a layout gate on
  money-movement entry points (Send/Convert/Add-money) that, for Free plans,
  disables the flow and shows the existing `UpgradeModal`.
- **KYC/KYB firing tied to checkout success**: the success path of
  `subscription-upgrade` (after `pay_subscription_invoice_from_va` commits) is the
  trigger that flips onboarding to allowed and lets the Bridge link issue. No
  payment → no Bridge call → no $2/$10 invoice.

**Open decisions (need your call):**
1. **Does the Free plan get _any_ KYC?** (Both current free tiers include a USD
   VA, which Bridge requires KYC for — so "no KYC until paid" changes the product.
   Option A: Free = no KYC, no VA, view-only until upgrade. Option B: Free keeps
   basic KYC but no transfers.)
2. **Ordering:** signup → pay → KYC, vs. signup → KYC → pay-to-activate?
3. **Existing users** already provisioned under the old model — grandfather or migrate?

---

## Appendix C — #2 "Remove all loading screens" (RECOMMENDATION)

The app **already** uses `Suspense` + `<ScreenSkeleton/>` for screen transitions
(`MainApp.tsx`), so navigation is not blocked by full-screen spinners. ~46 files
use a local `loading` state for their own async fetches.

**A blanket removal is not advisable** — many of those states guard against
rendering before data exists (empty flashes, crashes, Suspense fallbacks). The
safe path is a **targeted pass**: convert any remaining full-screen blocking
spinner to a skeleton, and adopt cached-first (optimistic) paint where we already
have a `borderpay_user` cache. This should be scoped per-screen, not done as a
global find-and-delete. _Recommend treating as its own reviewed task._
