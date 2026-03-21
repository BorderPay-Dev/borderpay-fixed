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

/** ← Change this to 'live' when going to production */
export const ENV: AppEnvironment = 'live';

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

  /** Whether the $10 wallet activation step is required */
  activationRequired:  ENV === 'live',

  /** Wallet activation is automatically bypassed in sandbox */
  skipActivation:      ENV === 'sandbox',

  /**
   * KYC tier constants
   * Tier 0 = not verified (blocks wallet/account/card creation)
   * Tier 2 = Full Enrollment (unlocks all features)
   */
  kycTier: {
    NONE:            0,
    FULL_ENROLLMENT: 2,
  },
} as const;

/**
 * Returns true if the given kyc_status string represents Full Enrollment (Tier 2).
 * Accepts: 'verified' | 'approved' | 'tier2' | 'full_enrollment'
 */
export function isFullEnrollment(kycStatus: string | null | undefined): boolean {
  if (!kycStatus) return false;
  const s = kycStatus.toLowerCase().trim();
  return (
    s === 'verified'        ||
    s === 'approved'        ||
    s === 'tier2'           ||
    s === 'full_enrollment' ||
    s === 'complete'        ||
    s === 'completed'
  );
}

/**
 * Returns true if user is allowed to create wallets / accounts / cards.
 * In sandbox: always true (beta bypass).
 * In live: requires Full Enrollment (Tier 2).
 */
export function canCreateFinancialProducts(kycStatus: string | null | undefined): boolean {
  if (isSandbox()) return true; // Beta bypass
  return isFullEnrollment(kycStatus);
}

/**
 * Returns true if the wallet activation screen should be shown.
 * In sandbox: never (wallets treated as activated).
 * In live: only when wallets are NOT yet activated.
 */
export function shouldShowActivation(walletsActivated: boolean): boolean {
  if (isSandbox()) return false;
  return !walletsActivated;
}
