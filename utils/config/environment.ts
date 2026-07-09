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
   * 2 = Fully verified by KYC/KYB (unlocks all features)
   */
  kycTier: {
    NONE:            0,
    FULL_ENROLLMENT: 2,
  },
} as const;

/**
 * Returns true if the given kyc_status string represents Full Enrollment.
 *
 * Accepts every canonical form: 'verified' | 'approved' | 'active' | 'tier2' |
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
    s === 'active' ||
    s === 'tier2' ||
    s === 'full_enrollment' ||
    s === 'full enrollment'
  );
}

/** Canonical KYC status used by display + gating across the app. */
export type DerivedKycStatus =
  | 'rejected' | 'verified' | 'under_review' | 'pending' | 'not_started';

/** Minimal profile shape deriveKycStatus reads (all optional / defensive). */
export interface KycProfileLike {
  account_type?:          string | null;
  kyc_status?:            string | null;
  bridge_kyc_status?:     string | null;
  bridge_kyb_status?:     string | null;
  bridge_account_status?: string | null;
}

/**
 * Bridge-first KYC status derivation (Bridge Core PR — status unification).
 *
 * Bridge identity status is authoritative ONLY when terminal (approved/rejected),
 * so a Bridge rejection is shown even when legacy kyc_status is still 'pending'
 * (the exact display/trust bug we are fixing), WITHOUT downgrading a previously
 * legacy-verified user whose Bridge status is merely non-terminal (pending /
 * under_review / not_started).
 *
 * Precedence:
 *   1. Bridge terminal REJECT  -> 'rejected'   (bridge_kyc/kyb or account)
 *   2. Bridge terminal APPROVE -> 'verified'   (bridge_kyc/kyb === approved)
 *   3. legacy terminal         -> 'rejected' | 'verified'
 *   4. most-informative in-progress state (prefer Bridge's) -> under_review/pending
 *   5. otherwise               -> 'not_started'
 *
 * NOTE: bridge_account_status is used only as a REJECT signal here; marking a user
 * verified from account_status alone is deferred to the (separate, deploy-gated)
 * backend propagation PR after Bridge status semantics are confirmed.
 */
export function deriveKycStatus(profile: KycProfileLike | null | undefined): DerivedKycStatus {
  if (!profile) return 'not_started';
  const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();

  const isBusiness = norm(profile.account_type) === 'business';
  const bridgeKyc  = isBusiness ? norm(profile.bridge_kyb_status) : norm(profile.bridge_kyc_status);
  const bridgeAcct = norm(profile.bridge_account_status);
  const legacy     = norm(profile.kyc_status);

  // 1. Bridge terminal rejection wins (overrides a stale legacy 'pending').
  if (bridgeKyc === 'rejected' || bridgeAcct === 'rejected') return 'rejected';
  // 2. Bridge terminal approval.
  if (bridgeKyc === 'approved' || bridgeKyc === 'active') return 'verified';
  // 3. Legacy terminal states (preserve existing verified users when Bridge is
  //    non-terminal/absent).
  if (legacy === 'rejected' || legacy === 'failed') return 'rejected';
  if (isFullEnrollment(legacy)) return 'verified';
  // 4. In-progress — prefer the more specific Bridge state for display.
  if (bridgeKyc === 'under_review') return 'under_review';
  if (bridgeKyc === 'pending' || legacy === 'pending') return 'pending';
  // 5. Nothing started.
  return 'not_started';
}

/** Gating helper — true only when the Bridge-first derived status is verified. */
export function isKycVerified(profile: KycProfileLike | null | undefined): boolean {
  return deriveKycStatus(profile) === 'verified';
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
