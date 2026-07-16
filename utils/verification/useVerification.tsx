/**
 * Verification hook — mirrors the app-wide Bridge verification parser so
 * cached approved profiles do not briefly render as starter on first paint.
 *
 * Synchronous hydration from localStorage on first render — no loading
 * spinner shown to users who already have a cached profile.
 */

import { useState, useEffect } from 'react';
import { authAPI } from '../supabase/client';
import { backendAPI } from '../api/backendAPI';
import { ENV_CONFIG, deriveKycStatus } from '../config/environment';

export interface VerificationStatus {
  isVerified:       boolean;
  kycTier:          number;
  loading:          boolean;
  accountStatus:    'starter' | 'verified' | 'active';
  canCreateProducts: boolean;
}

function deriveFromProfile(profile?: any): VerificationStatus {
  const verified = deriveKycStatus(profile) === 'verified';
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

    (async () => {
      try {
        const profileResult = await backendAPI.user.getProfile();
        if (cancelled) return;
        if (profileResult.success && profileResult.data?.user) {
          const p = profileResult.data.user;
          try { localStorage.setItem('borderpay_user', JSON.stringify(p)); } catch {}
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
