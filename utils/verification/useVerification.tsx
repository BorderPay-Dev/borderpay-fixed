/**
 * BorderPay Africa - Verification Hook
 *
 * Checks user KYC status and wallet activation via backend API (KV store).
 *
 * KYC Tier logic:
 *   Tier 0 (not verified) → blocks wallet/account/card creation
 *   Tier 2 / Full Enrollment → unlocks all features
 *
 * Sandbox mode: wallet activation is bypassed; all features accessible.
 */

import { useState, useEffect } from 'react';
import { authAPI } from '../supabase/client';
import { backendAPI } from '../api/backendAPI';
import {
  ENV_CONFIG,
  isFullEnrollment,
  canCreateFinancialProducts,
  shouldShowActivation,
} from '../config/environment';

export interface VerificationStatus {
  isVerified:       boolean;   // kyc_status is Full Enrollment (Tier 2)
  kycTier:          number;    // 0 = none, 2 = full enrollment
  walletsActivated: boolean;   // wallets exist OR sandbox bypass
  loading:          boolean;
  accountStatus:    'starter' | 'verified' | 'active';
  /** True when financial product creation is allowed */
  canCreateProducts: boolean;
  /** True when the $10 activation screen must be shown */
  showActivation:    boolean;
}

export function useVerification(userId: string): VerificationStatus {
  const [status, setStatus] = useState<VerificationStatus>({
    isVerified:        false,
    kycTier:           0,
    walletsActivated:  ENV_CONFIG.skipActivation, // sandbox: pre-activated
    loading:           true,
    accountStatus:     'starter',
    canCreateProducts: ENV_CONFIG.skipActivation,
    showActivation:    false,
  });

  useEffect(() => {
    if (userId) checkVerificationStatus();
  }, [userId]);

  const checkVerificationStatus = async () => {
    try {
      // ── 1. Fast path: pull cached user from localStorage ─────────────────
      const storedUser = authAPI.getStoredUser();
      let kycStatus    = storedUser?.kyc_status || 'pending';
      let isUnlocked   = storedUser?.is_unlocked || false;

      // ── 2. Fresh profile from backend if cache is stale ──────────────────
      if (!storedUser || !storedUser.kyc_status) {
        try {
          const profileResult = await backendAPI.user.getProfile();
          if (profileResult.success && profileResult.data?.user) {
            const p  = profileResult.data.user;
            kycStatus  = p.kyc_status || 'pending';
            isUnlocked = p.is_unlocked || false;
            localStorage.setItem('borderpay_user', JSON.stringify(p));
          }
        } catch (profileErr) {
          console.warn('⚠️ useVerification: Could not fetch backend profile:', profileErr);
        }
      }

      // ── 3. KYC tier resolution ────────────────────────────────────────────
      const verified = isFullEnrollment(kycStatus);
      const kycTier  = verified ? ENV_CONFIG.kycTier.FULL_ENROLLMENT : ENV_CONFIG.kycTier.NONE;

      // ── 4. Wallet activation check ────────────────────────────────────────
      // Sandbox mode: treat all wallets as activated
      let walletsActivated = ENV_CONFIG.skipActivation || isUnlocked;

      if (!ENV_CONFIG.skipActivation) {
        try {
          const walletsResult = await backendAPI.wallets.getWallets();
          if (walletsResult.success) {
            const wallets = walletsResult.data?.wallets || [];
            walletsActivated = Array.isArray(wallets) && wallets.length > 0;
          }
        } catch (walletsErr) {
          console.warn('⚠️ useVerification: Could not check wallets:', walletsErr);
          walletsActivated = isUnlocked;
        }
      }

      // ── 5. Derived flags ──────────────────────────────────────────────────
      const canCreateProducts = canCreateFinancialProducts(kycStatus);
      const showActivation    = shouldShowActivation(walletsActivated);

      // ── 6. Account status label ───────────────────────────────────────────
      let accountStatus: 'starter' | 'verified' | 'active' = 'starter';
      if (walletsActivated)  accountStatus = 'active';
      else if (verified)     accountStatus = 'verified';

      setStatus({
        isVerified:        verified,
        kycTier,
        walletsActivated,
        loading:           false,
        accountStatus,
        canCreateProducts,
        showActivation,
      });

      console.log('✅ useVerification:', {
        kycStatus,
        kycTier,
        verified,
        walletsActivated,
        canCreateProducts,
        env: ENV_CONFIG.env,
      });
    } catch (error) {
      console.error('❌ useVerification: Error:', error);
      setStatus({
        isVerified:        false,
        kycTier:           0,
        walletsActivated:  ENV_CONFIG.skipActivation,
        loading:           false,
        accountStatus:     'starter',
        canCreateProducts: ENV_CONFIG.skipActivation,
        showActivation:    false,
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

  // All sensitive features require Full Enrollment (Tier 2)
  if (!verificationStatus.isVerified) {
    return {
      canAccess: false,
      reason: 'complete_kyc', // "Complete identity verification to continue"
    };
  }

  // In sandbox, everything is accessible after KYC
  if (ENV_CONFIG.isSandbox) {
    return { canAccess: true };
  }

  // In live, wallet activation required for wallet/cards/transfers
  if (
    (feature === 'wallet' || feature === 'usd-account') &&
    verificationStatus.showActivation
  ) {
    return {
      canAccess: true, // Can see screen but activation prompt shown
      reason: 'activate_wallet',
    };
  }

  if (feature === 'cards') {
    return {
      canAccess: true,
      reason: verificationStatus.showActivation ? 'activate_wallet' : undefined,
    };
  }

  if (
    (feature === 'transfers' || feature === 'bills') &&
    verificationStatus.showActivation
  ) {
    return {
      canAccess: false,
      reason: 'activate_wallet',
    };
  }

  return { canAccess: true };
}
