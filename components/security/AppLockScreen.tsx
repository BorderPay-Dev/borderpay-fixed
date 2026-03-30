import { BorderPayLogo } from '../cards/BorderPayLogo';
/**
 * BorderPay Africa - App Lock Screen
 * Shown when app resumes or on initial load when PIN/biometric is enabled.
 * Requires PIN or biometric to access the app.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Lock, Fingerprint, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PINManager, BiometricManager } from '../../utils/security/SecurityManager';

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';

interface AppLockScreenProps {
  userId: string;
  onUnlock: () => void;
  onLogout: () => void;
}

export function AppLockScreen({ userId, onUnlock, onLogout }: AppLockScreenProps) {
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockTimer, setLockTimer] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricTriggered, setBiometricTriggered] = useState(false);

  const MAX_ATTEMPTS = 5;
  const LOCK_DURATION = 60; // 1 minute lockout
  const MAX_LOCKOUTS = 3;

  useEffect(() => {
    checkBiometric();
  }, []);

  // Auto-trigger biometric on mount
  useEffect(() => {
    if (biometricAvailable && !biometricTriggered) {
      setBiometricTriggered(true);
      // Small delay so the UI renders first
      const timer = setTimeout(() => handleBiometric(), 500);
      return () => clearTimeout(timer);
    }
  }, [biometricAvailable]);

  useEffect(() => {
    if (locked && lockTimer > 0) {
      const timer = setTimeout(() => setLockTimer(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (locked && lockTimer <= 0) {
      setLocked(false);
      setAttempts(0);
    }
  }, [locked, lockTimer]);

  const checkBiometric = async () => {
    const enrolled = BiometricManager.isEnrolled(userId);
    const supported = await BiometricManager.isSupported();
    setBiometricAvailable(enrolled && supported);
  };

  const handlePinChange = async (value: string) => {
    setPin(value);
    setError('');

    if (value.length === 6) {
      setVerifying(true);
      try {
        const isValid = await PINManager.verifyPIN(userId, value);
        if (isValid) {
          setAttempts(0);
          onUnlock();
        } else {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          setPin('');

          if (newAttempts >= MAX_ATTEMPTS) {
            setLocked(true);
            setLockTimer(LOCK_DURATION);
            setError(`Too many attempts. Locked for ${LOCK_DURATION}s.`);
          } else {
            setError(`Incorrect PIN. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`);
          }
        }
      } catch {
        setError('Verification failed');
        setPin('');
      } finally {
        setVerifying(false);
      }
    }
  };

  const handleBiometric = async () => {
    if (locked) return;
    setVerifying(true);
    setError('');

    try {
      const result = await BiometricManager.verify(userId);
      if (result.success) {
        onUnlock();
      } else {
        setError(result.error || 'Biometric verification failed');
      }
    } catch (err: any) {
      setError(err.message || 'Biometric failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0B0E11] flex flex-col overflow-hidden">
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />

      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-[2]">
        {/* Logo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="w-20 h-20 rounded-3xl bg-[#C7FF00] flex items-center justify-center shadow-lg">
            <BorderPayLogo size={48} color="#000000" />
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-8"
        >
          <h1 className="text-xl font-bold text-white mb-2">Welcome Back</h1>
          <p className="text-sm text-gray-400">Enter your PIN to unlock BorderPay</p>
        </motion.div>

        {locked ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Lock size={28} className="text-red-400" />
            </div>
            <p className="text-red-400 font-semibold mb-2">Temporarily Locked</p>
            <p className="text-gray-500 text-sm">
              Try again in <span className="text-white font-mono text-lg">{lockTimer}s</span>
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-xs"
          >
            {/* PIN Input */}
            <div className="flex justify-center mb-6">
              <InputOTP
                maxLength={6}
                value={pin}
                onChange={handlePinChange}
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={verifying || locked}
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
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center justify-center gap-2 mb-4"
              >
                <AlertCircle size={14} className="text-red-400" />
                <p className="text-red-400 text-xs">{error}</p>
              </motion.div>
            )}

            {/* Verifying */}
            {verifying && (
              <div className="flex items-center justify-center gap-2 mb-4">
                <div className="w-4 h-4 border-2 border-[#C7FF00] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-400">Verifying...</span>
              </div>
            )}

            {/* Biometric */}
            {biometricAvailable && (
              <button
                onClick={handleBiometric}
                disabled={verifying}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white hover:bg-white/[0.07] transition-all active:scale-[0.98] disabled:opacity-50 mt-4"
              >
                <Fingerprint size={24} className="text-[#C7FF00]" />
                <span className="text-sm font-semibold">Use Biometric</span>
              </button>
            )}
          </motion.div>
        )}
      </div>

      {/* Bottom: Sign out option */}
      <div className="pb-safe px-6 py-6 relative z-[2]">
        <button
          onClick={() => {
            if (confirm('Sign out of BorderPay?')) {
              onLogout();
            }
          }}
          className="w-full text-center text-sm text-gray-500 hover:text-gray-300 transition-colors py-2"
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
