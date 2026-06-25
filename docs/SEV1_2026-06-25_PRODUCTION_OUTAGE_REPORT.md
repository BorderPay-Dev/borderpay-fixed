# Sev-1 Production Outage Report — 2026-06-25

Status: Resolved, under observation.

## Incident Summary
A production web/PWA deployment introduced a runtime frontend crash (`Can't find variable: ArrowRight`) that prevented users from accessing BorderPay app surfaces.

This was a customer-facing outage, not a local/dev failure.

## Timeline (EAT, UTC+3)
- Outage detected: ~2026-06-25 15:4x (customer report from production app)
- Active impact window: approximately 2 hours (customer-reported)
- Runtime fix deployed: import restoration in `BusinessDashboard`
- Recovery propagation fix deployed: service-worker cache-bust + SW update hardening + in-app cache purge recovery
- Production returned to stable access: after latest production alias switched to crash-fixed deployment

## Customer Impact
- Users hit error boundary and could not reliably access app flows.
- Both Individual and Business users were affected due to stale PWA/runtime bundle propagation.
- Core customer journeys were interrupted during outage window.

## Root Cause
Primary trigger:
- Missing `ArrowRight` import in `components/business/BusinessDashboard.tsx` while symbol was used in JSX.

Amplifier:
- PWA clients could retain stale crashy bundles through service-worker/runtime cache behavior, extending incident impact after code fix existed.

## Why Safeguards Failed
- Deployment was promoted without runtime journey verification in production context.
- Build/READY status was treated as sufficient evidence.
- Predeploy gate did not include a strict compile-time type check that catches missing JSX symbols.

## Corrective Actions Implemented
1. Runtime crash fix shipped to production (`ArrowRight` import restored).
2. Emergency PWA cache-bust deployed.
3. Service worker update lifecycle hardened (`updateViaCache:none`, periodic update checks, immediate waiting-worker activation).
4. ErrorBoundary recovery hardened to clear SW + CacheStorage and reload from inside the app (no uninstall required).
5. Predeploy gate enhanced with executable FX checks.
6. Predeploy gate enhanced with mandatory TypeScript compile check (`npm run type-check`) to block missing symbol imports before promotion.

## Prevention Policy (Operational)
Production promotion requires successful runtime journey verification, not only CI/build/deploy status.

Minimum mandatory journey checks before promotion:
1. Login
2. Dashboard
3. Wallet
4. Receive
5. Send
6. Transactions
7. External Accounts
8. Settings

Promotion must be blocked if any required journey fails.

## Current Incident Status
- Sev-1 crash incident: Resolved
- Production stability: Under observation
- Team access incident: OPEN (runtime business-account verification pending)
- FX executable verification incident: OPEN (real transfer evidence pending)
