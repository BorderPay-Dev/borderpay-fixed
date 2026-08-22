/**
 * BorderPay Africa - 2FA Setup Screen
 * Client-side TOTP implementation (RFC 6238)
 * Generates secret locally, verifies codes with HMAC-SHA1 via Web Crypto
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 */

import React, { useState, useEffect } from 'react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { motion } from 'motion/react';
import { Shield, Copy, CheckCircle, Smartphone, Lock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { TOTPManager } from '../../utils/security/SecurityManager';
import { backendAPI } from '../../utils/api/backendAPI';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';
import { friendlyError } from '../../utils/errors/friendlyError';
import { useScaRequirement } from '../../utils/security/useScaRequirement';

interface TwoFactorSetupProps {
  userId: string;
  onBack: () => void;
  onComplete: () => void;
}

export function TwoFactorSetup({ userId, onBack, onComplete }: TwoFactorSetupProps) {
  const locallyEnabled = TOTPManager.isEnabled(userId);
  const [step, setStep] = useState<'qr' | 'verify' | 'success'>('qr');
  const [qrCodeUri, setQrCodeUri] = useState('');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(!locallyEnabled);
  const [alreadyEnabled, setAlreadyEnabled] = useState(locallyEnabled);
  const [disablePassword, setDisablePassword] = useState('');
  const [disablePin, setDisablePin] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [disabling, setDisabling] = useState(false);
  const scaRequired = useScaRequirement() !== 'not_required';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const localEnabled = TOTPManager.isEnabled(userId);

        // Fast-path: when local signal already says 2FA is enabled, don't
        // block UI on a backend round-trip.
        if (localEnabled) {
          if (cancelled) return;
          setAlreadyEnabled(true);
          setCheckingStatus(false);
          return;
        }

        let backendEnabled = false;
        try {
          const sec: any = await backendAPI.auth.getSecurityStatus(userId);
          backendEnabled = Boolean(sec?.success && sec?.data?.two_factor_enabled);
        } catch {
          // best effort
        }
        if (cancelled) return;
        const enabled = localEnabled || backendEnabled;
        setAlreadyEnabled(enabled);
        if (!enabled) await generateSetup();
      } finally {
        if (!cancelled) setCheckingStatus(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const generateSetup = async () => {
    let userEmail = 'user@borderpay.africa';
    try {
      const storedUser = localStorage.getItem('borderpay_user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        userEmail = user.email || userEmail;
      }
    } catch { /* fallback email */ }

    try {
      const setupData = await TOTPManager.generateSecret(userId, userEmail);
      setSecret(setupData.secret);
      setQrCodeUri(setupData.qrCodeUri);
    } catch (err: any) {
      toast.error(friendlyError(err, 'Could not start 2FA setup'));
    }
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

  const handleDisable2FA = async () => {
    if (!disablePassword.trim()) {
      toast.error('Enter your password to disable 2FA');
      return;
    }
    setDisabling(true);
    try {
      let authorizationId = '';
      if (scaRequired) {
        const authorization: any = await backendAPI.auth.authorizeSCA({
          operation: 'security_change', resource: 'disable_2fa', request: { action: 'disable_2fa' },
          pin: disablePin, totp: disableToken,
        });
        if (!authorization?.success || !authorization?.data?.authorization_id) {
          toast.error(friendlyError(authorization?.error, 'Strong authentication failed'));
          return;
        }
        authorizationId = authorization.data.authorization_id;
      }
      const r = await TOTPManager.disable(userId, disablePassword.trim(), authorizationId);
      if (!r.success) {
        toast.error(friendlyError(r.error, 'Could not disable 2FA'));
        return;
      }
      setDisablePassword('');
      setAlreadyEnabled(false);
      await generateSetup();
      toast.success('2FA disabled. You can set it up again.');
    } catch (err: any) {
      toast.error(friendlyError(err, 'Could not disable 2FA'));
    } finally {
      setDisabling(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white pb-safe">
      {/* Header */}
      {!alreadyEnabled && <FloatingBackButton onBack={onBack} />}
      <div className="sticky top-0 z-10 bg-[#0B0E11]/95 backdrop-blur-lg border-b border-white/5">
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <div className="w-10" />
          <h1 className="bp-text-h3 font-bold">2FA Setup</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8 max-w-md mx-auto">
        {checkingStatus && (
          <div className="text-center py-10">
            <div className="mx-auto w-8 h-8 border-2 border-white/30 border-t-[#C7FF00] rounded-full animate-spin mb-4" />
            <p className="bp-text-body text-gray-400">Checking 2FA status…</p>
          </div>
        )}

        {!checkingStatus && alreadyEnabled && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-6"
          >
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-[#C7FF00]" strokeWidth={2} />
              </div>
            </div>
            <h2 className="bp-text-h2">2FA is already enabled</h2>
            <p className="bp-text-body text-gray-400">
              This screen is locked because 2FA is active. Disable 2FA to unlock setup again.
            </p>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-left space-y-3">
              <label className="bp-text-small text-gray-400">Password</label>
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                className="w-full px-4 py-3 rounded-xl bg-black/25 border border-white/10 text-white outline-none focus:border-[#C7FF00]/60"
              />
              {scaRequired && <>
                <input
                  type="password"
                  value={disablePin}
                  onChange={(event) => setDisablePin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Transaction PIN"
                  inputMode="numeric"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
                />
                <input
                  value={disableToken}
                  onChange={(event) => setDisableToken(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Current authenticator code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
                />
              </>}
              <button
                onClick={handleDisable2FA}
                disabled={disabling || !disablePassword.trim()}
                className="w-full bg-[#C7FF00] disabled:opacity-50 disabled:cursor-not-allowed text-black py-3 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
              >
                {disabling ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </div>
          </motion.div>
        )}

        {!checkingStatus && !alreadyEnabled && step === 'success' && (
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

        {!checkingStatus && !alreadyEnabled && step === 'qr' && (
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

        {!checkingStatus && !alreadyEnabled && step === 'verify' && (
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
