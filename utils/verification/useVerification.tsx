/**
 * Verification hook — source of truth is the verification-partner KYC
 * status delivered by webhook to `user_profiles.bridge_kyc_status` (or
 * `business_profiles.bridge_kyb_status` for business accounts).
 *
 * The legacy `kyc_status` column is intentionally NOT consulted anymore.
 * Users marked verified under the previous provider are downgraded by
 * the accompanying database migration and must re-verify through the
 * current partner. The UI will show "starter" until our webhook handler
 * receives an `approved` event from the partner.
 *
 * Synchronous hydration from localStorage on first render — no loading
 * spinner shown to users who already have a cached profile.
 */

import { useState, useEffect } from 'react';
import { authAPI } from '../supabase/client';
import { backendAPI } from '../api/backendAPI';
import { ENV_CONFIG } from '../config/environment';

const VERIFICATION_REFRESH_COOLDOWN_MS = 5 * 60_000;
let inflightProfileRefresh: Promise<any> | null = null;

export interface VerificationStatus {
  isVerified:       boolean;
  kycTier:          number;
  loading:          boolean;
  accountStatus:    'starter' | 'verified' | 'active';
  canCreateProducts: boolean;
}

function isApproved(value?: string | null): boolean {
  if (typeof value !== 'string') return false;
  return ['approved', 'active', 'authorized', 'verified', 'completed', 'complete'].includes(value.toLowerCase());
}

function deriveFromProfile(profile?: any): VerificationStatus {
  // Business accounts use bridge_kyb_status; individuals use bridge_kyc_status.
  const accountStatusApproved = isApproved(profile?.bridge_account_status);
  const verified =
    profile?.account_type === 'business'
      ? (isApproved(profile?.bridge_kyb_status) || isApproved(profile?.bridge_kyc_status) || accountStatusApproved)
      : (isApproved(profile?.bridge_kyc_status) || accountStatusApproved);
  return {
    isVerified:        verified,
    kycTier:           verified ? ENV_CONFIG.kycTier.FULL_ENROLLMENT : ENV_CONFIG.kycTier.NONE,
    loading:           false,
    accountStatus:     verified ? 'verified' : 'starter',
    canCreateProducts: verified,
  };
}

function readSyncStatus(): VerificationStatus {
  try {
    const stored = authAPI.getStoredUser();
    if (stored) return deriveFromProfile(stored);
  } catch { /* ignore */ }
  return {
    isVerified:        false,
    kycTier:           0,
    loading:           false,
    accountStatus:     'starter',
    canCreateProducts: false,
  };
}

export function useVerification(userId: string): VerificationStatus {
  const [status, setStatus] = useState<VerificationStatus>(() => readSyncStatus());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const cacheKey = `borderpay_verification_refreshed_at:${userId}`;

    const recentlyRefreshed = (() => {
      try {
        const ts = Number(localStorage.getItem(cacheKey) || 0);
        return Number.isFinite(ts) && ts > 0 && (Date.now() - ts) < VERIFICATION_REFRESH_COOLDOWN_MS;
      } catch {
        return false;
      }
    })();
    if (recentlyRefreshed) return;

    (async () => {
      try {
        if (!inflightProfileRefresh) {
          inflightProfileRefresh = backendAPI.user.getProfile()
            .finally(() => { inflightProfileRefresh = null; });
        }
        const profileResult = await inflightProfileRefresh;
        if (cancelled) return;
        if (profileResult.success && profileResult.data?.user) {
          const p = profileResult.data.user;
          try { localStorage.setItem('borderpay_user', JSON.stringify(p)); } catch {}
          try { localStorage.setItem(cacheKey, String(Date.now())); } catch {}
          const next = deriveFromProfile(p);
          setStatus(prev =>
            prev.isVerified === next.isVerified &&
            prev.kycTier === next.kycTier &&
            prev.accountStatus === next.accountStatus &&
            prev.canCreateProducts === next.canCreateProducts
              ? prev
              : next
          );
        }
      } catch { /* keep cached state */ }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return status;
}

/**
 * Check if user can access a feature based on verification status.
 * Updated to use kycTier for gating.
 */
export function canAccessFeature(
  feature: 'wallet' | 'cards' | 'transfers' | 'bills' | 'usd-account',
  verificationStatus: VerificationStatus
): { canAccess: boolean; reason?: string } {

  // All sensitive features require Full Enrollment
  if (!verificationStatus.isVerified) {
    return {
      canAccess: false,
      reason: 'complete_kyc', // "Complete identity verification to continue"
    };
  }

  return { canAccess: true };
}
