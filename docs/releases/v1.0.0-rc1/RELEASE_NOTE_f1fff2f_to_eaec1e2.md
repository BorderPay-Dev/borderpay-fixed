# Release Comparison: `f1fff2f` -> `eaec1e2`

## Scope
- Last known good: `f1fff2f2309ff323142f72a7f94cafc689e0b462`
- Candidate: `eaec1e284c362780be72d12b6428630b22820194`
- Candidate preview: `borderpay-fixed-kip621o8y-mark-ikaba-s-projects.vercel.app` (READY)
- Purpose: rollback map and validation targeting before production promotion.

## Deployment/Access State
- Git -> Vercel deploy trust issue resolved by disabling verified-commit requirement.
- Project setting changed:
  - `gitProviderOptions.requireVerifiedCommits: false`
  - `ssoProtection: null` (preview is now publicly testable)
- Production remains on rollback-safe deployment (`f1fff2f...`).

## High-Level Commit Delta
- Perf/parity commits included (route hydration/cache/nav): `6306414` .. `79bb94f`
- Build-unblock commits included: `2de1fa1`, `cd1dee9`, `6cc7df3`, `eaec1e2`
- CI/deploy pipeline commits included: `58a5631`, `529836c`, `64ea79e`

## Functional Areas Requested

### 1) Business Dashboard changes
Files:
- `components/business/BusinessDashboard.tsx`

What changed:
- Removed dedicated business profile blocking fetch from dashboard mount path.
- Switched primary dashboard hydration to shared route snapshot (`backendAPI.financial.getWalletRouteData`).
- Added cache scoping helper usage (`financialCacheKey`) for dashboard wallet/tx caches.
- Moved profile/transaction enrichment to background (`Promise.allSettled`) so first paint is not blocked.
- Added quick-action entries for Payroll/FX/Ramps and Treasury transaction context wiring.
- Added perf cache marker call (`navPerfTrackCache`).

Rollback sensitivity:
- High for first-paint behavior and business dashboard data freshness.
- Medium for quick-action routing and treasury summary consistency.

### 2) Wallet changes
Files:
- `components/wallet/WalletScreen.tsx`

What changed:
- Replaced direct Supabase table reads with shared route data API (`financial.getWalletRouteData`).
- Added user-scoped cache keys for wallets and virtual accounts (`financialCacheKey`).
- Added background Bridge provision/sync follow-up refresh instead of blocking initial render.
- Added cached per-currency wallet balance map and improved currency display rendering.
- Replaced spinner-first loading with skeleton rows.

Rollback sensitivity:
- High for wallet balances rendering and refresh timing.
- High for any discrepancies between route snapshot and wallet UI totals.

### 3) Receive changes
Files:
- `components/receive/ReceiveMoneyScreen.tsx`

What changed:
- Removed `useVerification` dependency and introduced local cached verification status check.
- Changed receive hydration to shared route API (`financial.getReceiveRouteData`).
- VA/stable data now reads from scoped caches + background provision/sync follow-up.
- VA currency list shifted to explicit Bridge-supported set in UI (`USD/EUR/GBP`) with server-side capability gating expected.

Rollback sensitivity:
- High for verification gate behavior and VA visibility.
- Medium for country/currency expectations vs backend capability enforcement.

### 4) Send changes
Files:
- `components/send/SendMoneyFlow.tsx`

What changed:
- Introduced scoped send caches (`borderpay_send_wallets_v1`, `borderpay_send_caps_v1`).
- Hydration switched to `financial.getSendRouteData` with immediate + delayed refresh strategy.
- External bank rail visibility changed from corridor heuristic to Bridge capabilities (`external_account_capabilities`).
- Stablecoin send source now tied to selected token currency instead of fixed USD label.
- Removed stablecoin `funding_source: 'USD'` payload field from transfer call.

Rollback sensitivity:
- Very high for send execution correctness (source currency + rail selection).
- Very high for rail visibility and payout method gating.

### 5) Transactions changes
Files:
- `components/transactions/TransactionsScreen.tsx`
- `utils/api/backendAPI.ts` (transaction read path)
- `utils/presentation/customerBranding.ts`

What changed:
- UI cache moved to scoped key (`financialCacheKey`).
- Filter changes now client-side only; route no longer refetches on every filter toggle.
- Display text sanitized for customer-facing provider branding.
- Backend transaction source path moved from `transactions` table reads to `bridge_balance_ledger` mapping logic.

Rollback sensitivity:
- Very high for transaction history semantics (status/type/amount mapping).
- High for user-visible text transformations.

### 6) Notifications changes
Files:
- `components/notifications/NotificationsScreen.tsx`

What changed:
- Notification list prefers direct `notifications` table read via Supabase with edge fallback.
- Cache key switched to scoped key (`financialCacheKey`).
- Spinner replaced with skeleton rows.
- Customer-facing title/body text sanitized through branding normalizer.

Rollback sensitivity:
- Medium for notifications consistency/read-state behavior.
- Low-medium for branding text substitutions.

### 7) MainApp changes
Files:
- `components/app/MainApp.tsx`
- `App.tsx`
- `components/shell/AppShell.tsx`
- `utils/app/AppContext.tsx`

What changed:
- `AppProvider` wrapper removed from `App.tsx`.
- MainApp imports `BusinessDashboard` directly (no lazy business dashboard loader).
- Removed `useVerification` coupling from MainApp and passed `isVerified={false}` into dashboard path.
- Added shell hydration for unread + external account capabilities via combined async load.
- Added new lazy routes: payroll, ramps, admin broadcasts; updated prefetch registry.
- ErrorBoundary keying changed from per-screen key to stable boundary.
- Drawer prefetch effect removed in `AppShell`; referral entry added.

Rollback sensitivity:
- Very high for global app bootstrap/runtime behavior.
- Very high for business/individual route parity and navigation consistency.

### 8) Cache architecture changes
Files:
- `utils/financial/cacheScope.ts` (new)
- multiple route screens now using scoped keys

What changed:
- Introduced `financialCacheKey(base, scope)` with user-level keying.
- Explicit design: one financial engine cache scope, avoid account-type split cache misses.
- Applied to wallet/receive/send/transactions/notifications/dashboard caches.

Rollback sensitivity:
- High for cross-route data reuse and stale data coupling.
- High for business vs individual perceived performance differences.

### 9) Profile changes
Files:
- `components/profile/ProfileScreen.tsx`
- `utils/financial/walletStatus.ts` (new)

What changed:
- Added derived wallet status model (`deriveWalletStatus`) and verification status surfacing.
- Removed business-only second profile fetch from profile load path.
- Added skeleton-first profile loading state and cache perf marker.
- Added address object fallback composition and wallet access display based on derived status.

Rollback sensitivity:
- High for profile correctness (verification/wallet status display).
- Medium for address rendering and first-paint behavior.

## Additional Build-Unblock Additions Included in Candidate
Files newly added in this range that affect runtime compilation/routing:
- `components/business/PayrollScreen.tsx`
- `components/business/RampsScreen.tsx`
- `components/business/PayrollComingSoonScreen.tsx`
- `components/admin/BusinessBroadcastScreen.tsx`
- `components/admin/IndividualBroadcastScreen.tsx`
- `utils/financial/ownership.ts`
- `utils/financial/walletStatus.ts`
- `utils/presentation/customerBranding.ts`
- `utils/generated/rc1Status.ts`

## Rollback Map (Targeted)
If post-promotion defects appear, rollback targeting priority:
1. `components/app/MainApp.tsx`, `App.tsx`, `components/shell/AppShell.tsx` (global runtime/bootstrap)
2. `utils/api/backendAPI.ts` (canonical read-model and transaction/wallet source mapping)
3. `components/send/SendMoneyFlow.tsx` (money movement rail/currency behavior)
4. `components/wallet/WalletScreen.tsx`, `components/receive/ReceiveMoneyScreen.tsx`
5. `components/transactions/TransactionsScreen.tsx`, `components/notifications/NotificationsScreen.tsx`
6. `components/profile/ProfileScreen.tsx`
7. Cache helper layer (`utils/financial/cacheScope.ts`)

## Freeze Status
- Performance refactors should remain frozen until this candidate is fully exercised.
- Only RC defects, build/deploy blockers, and critical production issues should be patched.

## Post-Promotion Defect Patches

### Patch: quick-actions + ramps removal + external-accounts open path
- Commit: `2f6a07bfd28a386634b7a2f1db90ce778b77b7ec`
- Defects addressed:
  - Quick action taps had 2–3s first-open delay.
  - Ramps quick action/screen needed to be removed (duplicative flow).
  - External accounts route was bouncing back to dashboard when capability preload was empty/delayed.
- Changes:
  - Prewarmed primary quick-action lazy chunks on dashboard idle.
  - Removed `Ramps` route and quick-action button wiring from main navigation paths.
  - Made external accounts route/button gating rely on feature flag availability (not capability prefetch success) so screen opens reliably.
