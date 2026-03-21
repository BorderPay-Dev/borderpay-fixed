/**
 * BorderPay Africa - Biometric Setup Screen
 * Enrolls Face ID / Touch ID / Fingerprint via WebAuthn.
 * Entirely client-side, no backend required.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Fingerprint, ArrowLeft, CheckCircle, AlertCircle, Shield, X } from 'lucide-react';
import { toast } from 'sonner';
import { BiometricManager } from '../../utils/security/SecurityManager';

interface BiometricSetupProps {
  userId: string;
  onBack: () => void;
  onComplete: () => void;
}

export function BiometricSetup({ userId, onBack, onComplete }: BiometricSetupProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    checkSupport();
  }, []);

  const checkSupport = async () => {
    const isSupported = await BiometricManager.isSupported();
    setSupported(isSupported);
    setEnrolled(BiometricManager.isEnrolled(userId));
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      // Get user name from stored profile
      let userName = 'BorderPay User';
      try {
        const stored = localStorage.getItem('borderpay_user');
        if (stored) {
          const user = JSON.parse(stored);
          userName = user.full_name || user.email || userName;
        }
      } catch { /* fallback */ }

      const result = await BiometricManager.enroll(userId, userName);

      if (result.success) {
        setSuccess(true);
        setEnrolled(true);
        toast.success('Biometric enrolled successfully!');
        setTimeout(() => onComplete(), 2000);
      } else {
        toast.error(result.error || 'Enrollment failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Enrollment failed');
    } finally {
      setEnrolling(false);
    }
  };

  const handleDisable = () => {
    if (confirm('Disable biometric authentication? You can re-enable it anytime.')) {
      BiometricManager.disable(userId);
      setEnrolled(false);
      toast.success('Biometric disabled');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0B0E11]/95 backdrop-blur-lg border-b border-white/5">
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="bp-text-h3 font-bold">Biometric Setup</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="px-6 py-8 max-w-md mx-auto">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-24 h-24 rounded-full bg-[#C7FF00]/10 flex items-center justify-center"
          >
            {success ? (
              <CheckCircle className="w-12 h-12 text-[#C7FF00]" />
            ) : (
              <Fingerprint className="w-12 h-12 text-[#C7FF00]" />
            )}
          </motion.div>
        </div>

        {success ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-4"
          >
            <h2 className="text-xl font-bold">Biometric Enabled!</h2>
            <p className="text-sm text-gray-400">
              You can now use Face ID, Touch ID, or your fingerprint to unlock BorderPay and confirm transactions.
            </p>
            <div className="bg-[#C7FF00]/5 border border-[#C7FF00]/20 rounded-2xl p-4 mt-6">
              <p className="text-xs text-[#C7FF00]">
                Biometric data never leaves your device. It's processed by your device's secure enclave.
              </p>
            </div>
          </motion.div>
        ) : supported === false ? (
          <div className="text-center space-y-4">
            <h2 className="text-xl font-bold">Not Supported</h2>
            <p className="text-sm text-gray-400">
              Your device or browser doesn't support biometric authentication. Try using a device with a fingerprint sensor or face recognition.
            </p>
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
              <div className="flex items-center gap-2 justify-center">
                <AlertCircle size={16} className="text-red-400" />
                <p className="text-xs text-red-400">WebAuthn platform authenticator not available</p>
              </div>
            </div>
          </div>
        ) : enrolled ? (
          <div className="text-center space-y-6">
            <h2 className="text-xl font-bold">Biometric Active</h2>
            <p className="text-sm text-gray-400">
              Biometric authentication is currently enabled for your account.
            </p>
            <div className="bg-[#C7FF00]/5 border border-[#C7FF00]/20 rounded-2xl p-4 flex items-center gap-3">
              <Shield size={20} className="text-[#C7FF00] flex-shrink-0" />
              <p className="text-xs text-[#C7FF00] text-left">
                Face ID / Touch ID / Fingerprint is active for login and transaction verification
              </p>
            </div>

            <button
              onClick={handleDisable}
              className="w-full py-4 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 font-semibold hover:bg-red-500/20 transition-colors"
            >
              Disable Biometric
            </button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="text-center">
              <h2 className="text-xl font-bold mb-2">Enable Biometric Login</h2>
              <p className="text-sm text-gray-400">
                Use Face ID, Touch ID, or your fingerprint to quickly unlock BorderPay and approve transactions.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-3">
              {[
                { title: 'Instant Unlock', desc: 'Open the app with a glance or touch' },
                { title: 'Transaction Approval', desc: 'Confirm payments without entering your PIN' },
                { title: 'On-Device Security', desc: 'Biometric data never leaves your device' },
              ].map((feature, i) => (
                <div key={i} className="flex gap-3 bg-white/5 border border-white/10 rounded-2xl p-4">
                  <div className="w-6 h-6 rounded-full bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[#C7FF00] text-xs font-bold">{i + 1}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{feature.title}</p>
                    <p className="text-xs text-gray-400">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Enroll Button */}
            <button
              onClick={handleEnroll}
              disabled={enrolling || supported === null}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {enrolling ? (
                <>
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>Setting up...</span>
                </>
              ) : (
                <>
                  <Fingerprint size={22} />
                  <span>Enable Biometric</span>
                </>
              )}
            </button>

            <p className="text-xs text-gray-500 text-center">
              Your biometric data is processed by your device's secure hardware and never sent to our servers.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
