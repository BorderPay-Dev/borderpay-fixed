/**
 * BorderPay Africa - Verification Hook
 *
 * Synchronous hydration from localStorage on first render — NO loading
 * state shown to users who already have a cached profile. The hook then
 * fires a background refresh to pick up any server-side changes.
 *
 * Account/email status MUST never flicker — if the cached profile shows
 * `kyc_status === verified`, the UI shows "verified" immediately.
 */

import { useState, useEffect } from 'react';
import { authAPI } from '../supabase/client';
import { backendAPI } from '../api/backendAPI';
import {
  ENV_CONFIG,
  isFullEnrollment,
  canCreateFinancialProducts,
} from '../config/environment';

export interface VerificationStatus {
  isVerified:       boolean;   // kyc_status is Full Enrollment
  kycTier:          number;    // 0 = none, 2 = full enrollment
  loading:          boolean;
  accountStatus:    'starter' | 'verified' | 'active';
  /** True when financial product creation is allowed */
  canCreateProducts: boolean;
}

function deriveFromKyc(kycStatus?: string | null): VerificationStatus {
  const verified = isFullEnrollment(kycStatus || '');
  return {
    isVerified:        verified,
    kycTier:           verified ? ENV_CONFIG.kycTier.FULL_ENROLLMENT : ENV_CONFIG.kycTier.NONE,
    loading:           false,
    accountStatus:     verified ? 'verified' : 'starter',
    canCreateProducts: canCreateFinancialProducts(kycStatus || ''),
  };
}

function readSyncStatus(): VerificationStatus {
  try {
    const stored = authAPI.getStoredUser();
    if (stored?.kyc_status) {
      return deriveFromKyc(stored.kyc_status);
    }
  } catch { /* ignore */ }
  // Unknown — assume starter, but not "loading" so the UI stops flickering.
  return {
    isVerified:        false,
    kycTier:           0,
    loading:           false,
    accountStatus:     'starter',
    canCreateProducts: false,
  };
}

export function useVerification(userId: string): VerificationStatus {
  // Synchronous hydration — never start in "loading" state if we have cache.
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
          const kycStatus = p.kyc_status || 'pending';
          try { localStorage.setItem('borderpay_user', JSON.stringify(p)); } catch {}
          const next = deriveFromKyc(kycStatus);
          // Only update if the verification value has actually changed —
          // prevents an unnecessary re-render that could cause a flicker.
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
