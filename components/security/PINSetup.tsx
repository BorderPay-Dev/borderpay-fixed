/**
 * BorderPay Africa - PIN Setup Screen
 * 6-digit transaction PIN with confirmation
 * Uses client-side SecurityManager (Web Crypto SHA-256 hashing)
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PINManager } from '../../utils/security/SecurityManager';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';
import { friendlyError } from '../../utils/errors/friendlyError';

interface PINSetupProps {
  userId: string;
  onBack: () => void;
  onComplete: () => void;
}

export function PINSetup({ userId, onBack, onComplete }: PINSetupProps) {
  const [step, setStep] = useState<'enter' | 'confirm' | 'success'>('enter');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePinEnter = (value: string) => {
    setPin(value);
    if (value.length === 6) {
      // Auto-advance to confirmation
      setTimeout(() => setStep('confirm'), 300);
    }
  };

  const handleConfirmPinEnter = async (value: string) => {
    setConfirmPin(value);
    if (value.length === 6) {
      await verifyAndSetup(pin, value);
    }
  };

  const verifyAndSetup = async (enteredPin: string, confirmedPin: string) => {
    if (enteredPin !== confirmedPin) {
      toast.error('PINs do not match');
      setConfirmPin('');
      setTimeout(() => {
        setStep('enter');
        setPin('');
      }, 1000);
      return;
    }

    setLoading(true);
    try {
      const result = await PINManager.setupPIN(userId, enteredPin);

      if (result.success) {
        setStep('success');
        toast.success('Transaction PIN set successfully!');
        setTimeout(() => onComplete(), 1500);
      } else {
        toast.error(friendlyError(result.error, 'Unable to set up your transaction PIN.'));
        setStep('enter');
        setPin('');
        setConfirmPin('');
      }
    } catch (error: any) {
      toast.error('Unable to set up your transaction PIN. Please try again.');
      setStep('enter');
      setPin('');
      setConfirmPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToEnter = () => {
    setStep('enter');
    setConfirmPin('');
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
          <h1 className="bp-text-h3 font-bold">Setup Transaction PIN</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8 max-w-md mx-auto">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
            {step === 'success' ? (
              <CheckCircle className="w-10 h-10 text-[#C7FF00]" strokeWidth={2} />
            ) : (
              <Lock className="w-10 h-10 text-[#C7FF00]" strokeWidth={2} />
            )}
          </div>
        </div>

        {step === 'success' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-4"
          >
            <h2 className="bp-text-h2 mb-2">PIN Created!</h2>
            <p className="bp-text-body text-gray-400">
              Your 6-digit transaction PIN has been securely set up. You'll need it to confirm transactions.
            </p>
            <div className="bg-[#C7FF00]/5 border border-[#C7FF00]/20 rounded-2xl p-4 mt-6">
              <p className="text-xs text-[#C7FF00]">
                Your PIN is encrypted and stored securely on this device. Never share it with anyone.
              </p>
            </div>
          </motion.div>
        ) : step === 'enter' ? (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            {/* Title */}
            <div className="text-center mb-8">
              <h2 className="bp-text-h2 mb-2">Create Your PIN</h2>
              <p className="bp-text-body text-gray-400">
                Enter a 6-digit PIN to secure your transactions
              </p>
            </div>

            {/* PIN Input */}
            <div className="flex justify-center mb-8">
              <InputOTP
                maxLength={6}
                value={pin}
                onChange={handlePinEnter}
                inputMode="numeric"
                pattern="[0-9]*"
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

            {/* Security Tips */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-[#C7FF00]">
                <AlertCircle size={18} />
                <span className="bp-text-small font-semibold">Security Tips</span>
              </div>
              <ul className="space-y-2 bp-text-small text-gray-300 pl-6">
                <li className="list-disc">Don't use obvious numbers like 123456 or 000000</li>
                <li className="list-disc">Don't use your birthday or phone number</li>
                <li className="list-disc">Keep your PIN private and secure</li>
              </ul>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            {/* Title */}
            <div className="text-center mb-8">
              <h2 className="bp-text-h2 mb-2">Confirm Your PIN</h2>
              <p className="bp-text-body text-gray-400">
                Re-enter your PIN to confirm
              </p>
            </div>

            {/* Confirm PIN Input */}
            <div className="flex justify-center mb-8">
              <InputOTP
                maxLength={6}
                value={confirmPin}
                onChange={handleConfirmPinEnter}
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={loading}
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

            {loading && (
              <div className="flex items-center justify-center gap-2 text-[#C7FF00]">
                <div className="w-5 h-5 border-2 border-[#C7FF00] border-t-transparent rounded-full animate-spin" />
                <span className="bp-text-body">Setting up your PIN...</span>
              </div>
            )}

            {/* Back Button */}
            {!loading && (
              <button
                onClick={handleBackToEnter}
                className="w-full text-gray-400 py-4 rounded-full font-semibold hover:text-white transition-colors"
              >
                Back to PIN Entry
              </button>
            )}
          </motion.div>
        )}

        {/* Progress Indicator */}
        {step !== 'success' && (
          <div className="flex justify-center gap-2 mt-8">
            <div className={`w-2 h-2 rounded-full ${step === 'enter' ? 'bg-[#C7FF00]' : 'bg-gray-700'}`} />
            <div className={`w-2 h-2 rounded-full ${step === 'confirm' ? 'bg-[#C7FF00]' : 'bg-gray-700'}`} />
          </div>
        )}
      </div>
    </div>
  );
}
