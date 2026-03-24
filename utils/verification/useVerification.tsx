/**
 * BorderPay Africa - Verification Hook
 *
 * Checks user KYC status via backend API.
 *
 * KYC logic:
 *   Not enrolled -> blocks wallet/account/card creation
 *   Full Enrollment (via enroll-customer-full) -> unlocks all features
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

export function useVerification(userId: string): VerificationStatus {
  const [status, setStatus] = useState<VerificationStatus>({
    isVerified:        false,
    kycTier:           0,
    loading:           true,
    accountStatus:     'starter',
    canCreateProducts: false,
  });

  useEffect(() => {
    if (userId) checkVerificationStatus();
  }, [userId]);

  const checkVerificationStatus = async () => {
    try {
      // -- 1. Fast path: pull cached user from localStorage --
      const storedUser = authAPI.getStoredUser();
      let kycStatus    = storedUser?.kyc_status || 'pending';

      // -- 2. Fresh profile from backend if cache is stale --
      if (!storedUser || !storedUser.kyc_status) {
        try {
          const profileResult = await backendAPI.user.getProfile();
          if (profileResult.success && profileResult.data?.user) {
            const p  = profileResult.data.user;
            kycStatus  = p.kyc_status || 'pending';
            localStorage.setItem('borderpay_user', JSON.stringify(p));
          }
        } catch { /* silent */ }
      }

      // -- 3. KYC tier resolution --
      const verified = isFullEnrollment(kycStatus);
      const kycTier  = verified ? ENV_CONFIG.kycTier.FULL_ENROLLMENT : ENV_CONFIG.kycTier.NONE;

      // -- 4. Derived flags --
      const canCreateProducts = canCreateFinancialProducts(kycStatus);

      // -- 5. Account status label --
      let accountStatus: 'starter' | 'verified' | 'active' = 'starter';
      if (verified) accountStatus = 'verified';

      setStatus({
        isVerified:        verified,
        kycTier,
        loading:           false,
        accountStatus,
        canCreateProducts,
      });

    } catch {
      setStatus({
        isVerified:        false,
        kycTier:           0,
        loading:           false,
        accountStatus:     'starter',
        canCreateProducts: false,
      });
    }
  };

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
