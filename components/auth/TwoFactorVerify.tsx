/**
 * BorderPay Africa - 2FA Verification Screen
 * Used during login when 2FA is enabled.
 * Verifies TOTP code entirely client-side via SecurityManager.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Shield, ArrowLeft, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { TOTPManager } from '../../utils/security/SecurityManager';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';

interface TwoFactorVerifyProps {
  onVerifySuccess: () => void;
  onBack: () => void;
  userEmail?: string;
  userId?: string;
}

export function TwoFactorVerify({ onVerifySuccess, onBack, userEmail, userId }: TwoFactorVerifyProps) {
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);

  // Resolve userId from props or localStorage
  const resolvedUserId = userId || (() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) return JSON.parse(stored).id;
      // Also check biometric user id
      return localStorage.getItem('borderpay_biometric_user_id') || '';
    } catch { return ''; }
  })();

  const handleVerify = async () => {
    if (token.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    if (!resolvedUserId) {
      setError('Session expired. Please sign in again.');
      return;
    }

    setVerifying(true);
    setError('');

    try {
      console.log('🔐 Verifying 2FA code client-side...');
      const isValid = await TOTPManager.verifyCode(resolvedUserId, token);

      if (isValid) {
        console.log('✅ 2FA verification successful');
        toast.success('2FA verified successfully');
        onVerifySuccess();
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        
        if (newAttempts >= 5) {
          setError('Too many failed attempts. Please try again later.');
          toast.error('Too many failed 2FA attempts');
        } else {
          setError(`Invalid code. ${5 - newAttempts} attempts remaining.`);
        }
        setToken('');
      }
    } catch (err: any) {
      console.error('2FA verification error:', err);
      setError(err.message || 'Verification failed. Please try again.');
      setToken('');
    } finally {
      setVerifying(false);
    }
  };

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (token.length === 6) {
      handleVerify();
    }
  }, [token]);

  return (
    <div className="fixed inset-0 bg-[#0B0E11] flex flex-col overflow-hidden">
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10 relative z-[2]">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <h1 className="text-lg font-semibold text-white">Two-Factor Authentication</h1>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-[2]">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-20 h-20 rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-6"
        >
          <Shield className="w-10 h-10 text-[#C7FF00]" />
        </motion.div>

        <h2 className="text-xl font-bold text-white mb-2">Enter Verification Code</h2>
        <p className="text-sm text-gray-400 text-center mb-2">
          Open your authenticator app and enter the 6-digit code
        </p>
        {userEmail && (
          <p className="text-xs text-gray-500 mb-8">
            for {userEmail}
          </p>
        )}

        {/* OTP Input */}
        <div className="mb-6">
          <InputOTP
            maxLength={6}
            value={token}
            onChange={(value) => {
              setToken(value);
              setError('');
            }}
            disabled={verifying || attempts >= 5}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>

        {/* Error */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-sm mb-4"
          >
            {error}
          </motion.p>
        )}

        {/* Verify Button */}
        <button
          onClick={handleVerify}
          disabled={token.length !== 6 || verifying || attempts >= 5}
          className="w-full max-w-xs h-12 rounded-2xl bg-[#C7FF00] text-[#0B0E11] font-bold text-base
                     disabled:opacity-40 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2 transition-all"
        >
          {verifying ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <Lock className="w-5 h-5" />
              Verify Code
            </>
          )}
        </button>

        <p className="text-xs text-gray-500 mt-6 text-center max-w-xs">
          If you've lost access to your authenticator app, please contact support.
        </p>
      </div>
    </div>
  );
}
