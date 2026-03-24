/**
 * BorderPay Africa - 2FA Setup Screen
 * Client-side TOTP implementation (RFC 6238)
 * Generates secret locally, verifies codes with HMAC-SHA1 via Web Crypto
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Shield, Copy, CheckCircle, ArrowLeft, Smartphone, Lock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { TOTPManager } from '../../utils/security/SecurityManager';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';
import { friendlyError } from '../../utils/errors/friendlyError';

interface TwoFactorSetupProps {
  userId: string;
  onBack: () => void;
  onComplete: () => void;
}

export function TwoFactorSetup({ userId, onBack, onComplete }: TwoFactorSetupProps) {
  const [step, setStep] = useState<'qr' | 'verify' | 'success'>('qr');
  const [qrCodeUri, setQrCodeUri] = useState('');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    generateSetup();
  }, []);

  const generateSetup = () => {
    // Get user email from stored profile
    let userEmail = 'user@borderpay.africa';
    try {
      const storedUser = localStorage.getItem('borderpay_user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        userEmail = user.email || userEmail;
      }
    } catch { /* fallback email */ }

    const setupData = TOTPManager.generateSecret(userId, userEmail);
    setSecret(setupData.secret);
    setQrCodeUri(setupData.qrCodeUri);
  };

  const handleCopySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success('Secret key copied to clipboard');
    setTimeout(() => setCopied(false), 3000);
  };

  const handleVerify = async () => {
    if (token.length !== 6) {
      toast.error('Please enter a 6-digit code');
      return;
    }

    setVerifying(true);
    try {
      const result = await TOTPManager.verifyAndEnable(userId, token);

      if (result.success) {
        setStep('success');
        toast.success('2FA enabled successfully!');
        setTimeout(() => onComplete(), 2000);
      } else {
        toast.error(friendlyError(result.error, 'Invalid verification code'));
        setToken('');
      }
    } catch (error: any) {
      toast.error('Verification failed');
      setToken('');
    } finally {
      setVerifying(false);
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
          <h1 className="bp-text-h3 font-bold">2FA Setup</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8 max-w-md mx-auto">
        {step === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-6"
          >
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-[#C7FF00]" strokeWidth={2} />
              </div>
            </div>
            <h2 className="bp-text-h2">2FA Enabled!</h2>
            <p className="bp-text-body text-gray-400">
              Two-factor authentication is now active. You'll need your authenticator app code when signing in.
            </p>
            <div className="bg-[#C7FF00]/5 border border-[#C7FF00]/20 rounded-2xl p-4">
              <p className="text-xs text-[#C7FF00]">
                Keep your authenticator app backup codes safe. If you lose access, you won't be able to sign in.
              </p>
            </div>
          </motion.div>
        )}

        {step === 'qr' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                <Shield className="w-10 h-10 text-[#C7FF00]" strokeWidth={2} />
              </div>
            </div>

            {/* Title */}
            <div className="text-center mb-8">
              <h2 className="bp-text-h2 mb-2">Scan QR Code</h2>
              <p className="bp-text-body text-gray-400">
                Use Google Authenticator or any TOTP app to scan this QR code
              </p>
            </div>

            {/* QR Code */}
            <div className="bg-white p-6 rounded-3xl flex justify-center mb-6">
              <QRCodeSVG value={qrCodeUri} size={200} level="H" />
            </div>

            {/* Manual Entry */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="bp-text-small text-gray-400">Secret Key</span>
                <button
                  onClick={handleCopySecret}
                  className="flex items-center gap-2 text-[#C7FF00] hover:text-[#B8F000] transition-colors"
                >
                  {copied ? (
                    <>
                      <CheckCircle size={16} />
                      <span className="bp-text-small">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      <span className="bp-text-small">Copy</span>
                    </>
                  )}
                </button>
              </div>
              <code className="bp-text-body text-white font-mono break-all">
                {secret}
              </code>
            </div>

            {/* Instructions */}
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-[#C7FF00] text-xs font-bold">1</span>
                </div>
                <p className="bp-text-body text-gray-300">
                  Download Google Authenticator or any TOTP app
                </p>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-[#C7FF00] text-xs font-bold">2</span>
                </div>
                <p className="bp-text-body text-gray-300">
                  Scan the QR code or enter the secret key manually
                </p>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-[#C7FF00] text-xs font-bold">3</span>
                </div>
                <p className="bp-text-body text-gray-300">
                  Enter the 6-digit code from the app to verify
                </p>
              </div>
            </div>

            {/* Continue Button */}
            <button
              onClick={() => setStep('verify')}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] mt-8"
            >
              Continue to Verification
            </button>
          </motion.div>
        )}

        {step === 'verify' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                <Smartphone className="w-10 h-10 text-[#C7FF00]" strokeWidth={2} />
              </div>
            </div>

            {/* Title */}
            <div className="text-center mb-8">
              <h2 className="bp-text-h2 mb-2">Enter Verification Code</h2>
              <p className="bp-text-body text-gray-400">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>

            {/* OTP Input */}
            <div className="flex justify-center mb-8">
              <InputOTP
                maxLength={6}
                value={token}
                onChange={(value) => setToken(value)}
                onComplete={handleVerify}
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

            {/* Verify Button */}
            <button
              onClick={handleVerify}
              disabled={verifying}
              className={`w-full py-4 rounded-full font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${token.length === 6 ? 'bg-[#C7FF00] text-black' : 'bg-white/10 text-white/40'}`}
            >
              {verifying ? (
                <>
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Lock size={20} />
                  <span>Enable 2FA</span>
                </>
              )}
            </button>

            {/* Back Button */}
            <button
              onClick={() => setStep('qr')}
              className="w-full text-gray-400 py-4 rounded-full font-semibold hover:text-white transition-colors"
            >
              Back to QR Code
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
