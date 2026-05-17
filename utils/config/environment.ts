/**
 * BorderPay Africa — Environment Configuration
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  GLOBAL ENV SWITCH — change this one line to go production   │
 * │                                                              │
 * │  'sandbox' → Beta mode  (simulation only, no real money)     │
 * │  'live'    → Production (real wallets, real money)           │
 * └──────────────────────────────────────────────────────────────┘
 */

export type AppEnvironment = 'sandbox' | 'live';

/** Reads from VITE_APP_ENV env var. Set to 'live' in Vercel production env. */
export const ENV = (import.meta.env.VITE_APP_ENV === 'live' ? 'live' : 'sandbox') as AppEnvironment;

// ─── Derived helpers (read-only, DO NOT change) ──────────────────────────────

export const isSandbox = (): boolean => ENV === 'sandbox';
export const isLive    = (): boolean => ENV === 'live';

export const ENV_CONFIG = {
  env:                 ENV,
  isSandbox:           ENV === 'sandbox',
  isLive:              ENV === 'live',

  /** Short label shown in badges */
  label:               ENV === 'sandbox' ? 'BETA' : 'LIVE',

  /** Banner copy shown across all dashboard screens in sandbox */
  betaBannerText:      'Beta Mode — Simulation Only (No real money)',

  /** Sub-label under user avatar/header */
  betaAccessText:      'Beta Access Enabled',

  /**
   * KYC status constants
   * 0 = not verified (blocks wallet/account/card creation)
   * 2 = Fully verified via Bridge KYC/KYB (unlocks all features)
   */
  kycTier: {
    NONE:            0,
    FULL_ENROLLMENT: 2,
  },
} as const;

/**
 * Returns true if the given kyc_status string represents Full Enrollment.
 *
 * Accepts every canonical form: 'verified' | 'approved' | 'tier2' |
 * 'full_enrollment' | 'full enrollment'. Trims and lowercases so a row
 * with stray whitespace (legacy data wrote "Approved " with a trailing
 * space) doesn't make the entire app render the "starter" state.
 */
export function isFullEnrollment(kycStatus: string | null | undefined): boolean {
  if (!kycStatus) return false;
  const s = String(kycStatus).trim().toLowerCase();
  return (
    s === 'verified' ||
    s === 'approved' ||
    s === 'tier2' ||
    s === 'full_enrollment' ||
    s === 'full enrollment'
  );
}

/**
 * Returns true if user is allowed to create wallets / accounts / cards.
 * In sandbox: always true (beta bypass).
 * In live: requires Full Enrollment.
 */
export function canCreateFinancialProducts(kycStatus: string | null | undefined): boolean {
  if (isSandbox()) return true; // Beta bypass
  return isFullEnrollment(kycStatus);
}

