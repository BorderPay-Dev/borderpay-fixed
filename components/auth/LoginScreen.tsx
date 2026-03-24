import { BorderPayLogo } from '../cards/BorderPayLogo';
/**
 * BorderPay Africa - Login Screen
 * Floating labels, password toggle, biometric sign-in
 * Full-width CTAs with zoom animation
 * 2FA enforcement: checks security status after password auth
 *
 * BIOMETRIC SIGN-IN FLOW:
 * 1. User clicks "Sign in with biometrics"
 * 2. WebAuthn device check (Touch ID / Face ID) — fast path
 * 3. Refresh Supabase session via stored refresh_token
 * 4. If no refresh_token / expired → trigger SmileID liveness verification
 * 5. SmileID success → session restored → dashboard
 * 6. SmileID fail → "Verification failed, try again"
 * 7. DO NOT create new user — only authenticate existing users
 */

import React, { useState, useEffect, useRef } from 'react';
import { BASE_URL, ANON_KEY } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mail, Lock, Eye, EyeOff, Fingerprint, Loader2,
  ShieldCheck, X, Camera, AlertCircle, CheckCircle,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { sessionAPI } from '../../utils/api/sessionAPI';
import { toast } from 'sonner';

import { backendAPI } from '../../utils/api/backendAPI';
import { TOTPManager, BiometricManager } from '../../utils/security/SecurityManager';
import { TwoFactorVerify } from './TwoFactorVerify';
import { projectId } from '../../utils/supabase/info';
import { authAPI } from '../../utils/supabase/client';
import { ENV_CONFIG } from '../../utils/config/environment';
import { friendlyError } from '../../utils/errors/friendlyError';

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
  onNavigateToSignUp: () => void;
  onNavigateToForgotPassword?: () => void;
}

// ── SmileID Biometric Auth Modal ─────────────────────────────────────────────
interface SmileIDAuthModalProps {
  userId: string;
  onSuccess: () => void;
  onFail: () => void;
  onClose: () => void;
}

function SmileIDAuthModal({ userId, onSuccess, onFail, onClose }: SmileIDAuthModalProps) {
  const [status, setStatus] = useState<'loading' | 'widget' | 'polling' | 'success' | 'failed'>('loading');
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  // Load SmileID widget for liveness verification (NOT enrollment)
  useEffect(() => {
    loadWidget();
    return () => stopPolling();
  }, []);

  // Listen for postMessage from SmileID widget
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data) return;
      const data = typeof event.data === 'string'
        ? (() => { try { return JSON.parse(event.data); } catch { return null; } })()
        : event.data;
      if (!data) return;

      if (
        data.event === 'smileid:complete' ||
        data.status === 'complete'        ||
        data.ResultCode === '1012'        ||
        data.SmileJobID
      ) {
        handleVerificationResult('success');
      }
      if (data.event === 'smileid:error') {
        handleVerificationResult('failed');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const loadWidget = async () => {
    setStatus('loading');
    try {
      const token = authAPI.getToken();
      const response = await fetch(
        `${BASE_URL}/smile-callback-handler`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || ANON_KEY}`,
            'apikey': ANON_KEY,
          },
          body: JSON.stringify({
            job_id: `biometric-signin-${userId}-${Date.now()}`,
            product: 'biometric_kyc',
            user_id: userId,
            mode: 'authentication', // NOT enrollment
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const link = data.data?.web_url || data.data?.mobile_url ||
                     data.data?.smile_link || data.data?.verification_url || data.data?.link;
        if (link) {
          const url = new URL(link);
          url.searchParams.set('theme_color', 'C7FF00');
          url.searchParams.set('partner_name', 'BorderPay Africa');
          setVerificationUrl(url.toString());
          setStatus('widget');
          startPolling();
          return;
        }
      }
    } catch (e) {
    }

    // No fallback — backend must provide the URL
    setStatus('failed');
    onFail();
  };

  const startPolling = () => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const token = authAPI.getToken();
        const res = await fetch(
          `${BASE_URL}/smile-callback-handler?userId=${userId}`,
          {
            headers: {
              'Authorization': `Bearer ${token || ANON_KEY}`,
              'apikey': ANON_KEY,
            },
          }
        );
        const data = await res.json();
        if (data.success) {
          if (data.status === 'verified') handleVerificationResult('success');
          else if (data.status === 'failed') handleVerificationResult('failed');
        }
      } catch { /* silent */ }
    }, 3000);
  };

  const handleVerificationResult = (result: 'success' | 'failed') => {
    stopPolling();
    if (result === 'success') {
      setStatus('success');
      setTimeout(() => onSuccess(), 1500);
    } else {
      setStatus('failed');
      setTimeout(() => onFail(), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[#C7FF00]" />
          <span className="text-xs font-bold text-white tracking-wide uppercase">
            {status === 'success' ? 'VERIFIED' : status === 'failed' ? 'FAILED' : 'IDENTITY VERIFICATION'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center"
        >
          <X size={14} className="text-white" />
        </button>
      </div>

      {/* Info strip */}
      <div className="px-4 py-2 bg-[#C7FF00]/5 border-b border-[#C7FF00]/10">
        <p className="text-[10px] text-[#C7FF00]/80 text-center">
          Quick face scan to verify your identity — this is NOT a new enrollment
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-[#C7FF00]/30 animate-ping" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Fingerprint className="w-8 h-8 text-[#C7FF00]" />
              </div>
            </div>
            <p className="text-sm text-gray-400">Preparing verification...</p>
          </div>
        )}

        {(status === 'widget' || status === 'polling') && verificationUrl && (
          <iframe
            ref={iframeRef}
            src={verificationUrl}
            className="w-full h-full border-0"
            allow="camera; microphone; geolocation"
            title="SmileID Identity Verification"
          />
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-20 h-20 rounded-full bg-[#C7FF00]/20 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-[#C7FF00]" />
            </div>
            <p className="text-lg font-bold text-white">Identity Verified!</p>
            <p className="text-sm text-gray-400">Signing you in...</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-red-400" />
            </div>
            <p className="text-lg font-bold text-white">Verification Failed</p>
            <p className="text-sm text-gray-400 text-center">
              Verification failed. Please try again or sign in with your email and password.
            </p>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      {status === 'widget' && (
        <div className="px-4 py-3 border-t border-white/10">
          <div className="flex gap-2">
            <button
              onClick={() => loadWidget()}
              className="flex-1 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-gray-400 flex items-center justify-center gap-2"
            >
              <RefreshCw size={12} />
              Reload
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl text-xs text-[#C7FF00] font-semibold"
            >
              Use Password Instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Login Screen ─────────────────────────────────────────────────────────
export function LoginScreen({ onLoginSuccess, onNavigateToSignUp, onNavigateToForgotPassword }: LoginScreenProps) {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]   = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [inlineError, setInlineError] = useState('');

  // 2FA state
  const [show2FA, setShow2FA]       = useState(false);
  const [pendingUser, setPendingUser] = useState<any>(null);

  // SmileID biometric auth modal
  const [showSmileIDModal, setShowSmileIDModal] = useState(false);
  const [smileIDUserId, setSmileIDUserId]       = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      setInlineError('Please enter your email and password.');
      return;
    }

    setInlineError('');
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      if (data.user && data.session) {
        localStorage.setItem('borderpay_token', data.session.access_token);
        localStorage.setItem('borderpay_refresh_token', data.session.refresh_token);


        let userProfile: any = null;
        try {
          const profileResult = await backendAPI.user.getProfile();
          if (profileResult.success && profileResult.data?.user) {
            localStorage.setItem('borderpay_user', JSON.stringify(profileResult.data.user));
            userProfile = profileResult.data.user;
          }
        } catch (profileError) {
        }

        if (!userProfile) {
          userProfile = {
            id:           data.user.id,
            email:        data.user.email,
            full_name:    data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'User',
            phone:        data.user.user_metadata?.phone || data.user.phone || '',
            country:      data.user.user_metadata?.country || '',
            account_type: data.user.user_metadata?.account_type || 'individual',
            kyc_status:   data.user.user_metadata?.kyc_status || 'pending',
            created_at:   data.user.created_at,
          };
          localStorage.setItem('borderpay_user', JSON.stringify(userProfile));
        }

        const has2FA      = TOTPManager.isEnabled(userProfile.id);
        const profileHas2FA = userProfile.two_factor_enabled || userProfile.mfa_enabled;
        const isVerified  = userProfile.kyc_status === 'verified' || userProfile.kyc_status === 'approved';

        if (isVerified && (has2FA || profileHas2FA)) {
          setPendingUser(userProfile);
          setShow2FA(true);
          return;
        }

        toast.success('Welcome back!');
        onLoginSuccess(userProfile);
      }
    } catch (error: any) {
      const message = friendlyError(error, 'Login failed. Please check your credentials and try again.');
      setInlineError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handle2FASuccess = () => {
    toast.success('Welcome back!');
    if (pendingUser) onLoginSuccess(pendingUser);
  };

  const handle2FABack = () => {
    supabase.auth.signOut();
    localStorage.removeItem('borderpay_token');
    localStorage.removeItem('borderpay_refresh_token');
    localStorage.removeItem('borderpay_user');
    setShow2FA(false);
    setPendingUser(null);
    toast.info('Please sign in again');
  };

  // ── Biometric Sign-In (Fixed) ─────────────────────────────────────────────
  const handleBiometricLogin = async () => {
    setIsBiometricLoading(true);

    try {
      // Step 1: Check device biometric support
      if (!window.PublicKeyCredential) {
        toast.error('Biometric authentication not supported on this browser');
        return;
      }

      // Step 2: Get stored user context
      const storedUserId   = localStorage.getItem('borderpay_biometric_user_id');
      const storedUser     = localStorage.getItem('borderpay_user');
      const refreshToken   = localStorage.getItem('borderpay_refresh_token');

      if (!storedUserId || !storedUser) {
        const msg = 'No biometric session found. Please sign in with your email & password first to enable biometric login.';
        setInlineError(msg);
        toast.error(msg);
        return;
      }

      const userProfile = JSON.parse(storedUser);

      // Step 3: WebAuthn device biometric check (Touch ID / Face ID)
      if (BiometricManager.isEnrolled(storedUserId)) {
        const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!available) {
          toast.info('Platform biometric not available. Using SmileID verification...');
        } else {
          const result = await BiometricManager.verify(storedUserId);
          if (!result.success) {
            toast.error('Biometric verification failed, try again');
            return;
          }
        }
      }

      // Step 4: Restore Supabase session via refresh_token (most reliable path)
      if (refreshToken) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (refreshData?.session && !refreshError) {
          // Session refreshed successfully
          localStorage.setItem('borderpay_token', refreshData.session.access_token);
          localStorage.setItem('borderpay_refresh_token', refreshData.session.refresh_token);
          localStorage.setItem('borderpay_user', JSON.stringify({
            ...userProfile,
            ...refreshData.session.user?.user_metadata,
            id:    refreshData.session.user?.id || userProfile.id,
            email: refreshData.session.user?.email || userProfile.email,
          }));

          toast.success('Biometric authentication successful!');

          // Check 2FA
          const has2FA = TOTPManager.isEnabled(userProfile.id);
          const isVerified = userProfile.kyc_status === 'verified' || userProfile.kyc_status === 'approved';
          if (isVerified && (has2FA || userProfile.two_factor_enabled || userProfile.mfa_enabled)) {
            setPendingUser(userProfile);
            setShow2FA(true);
          } else {
            onLoginSuccess(userProfile);
          }
          return;
        }

      }

      // Step 5: Refresh token exhausted or missing → SmileID liveness check
      // This verifies the user's identity via facial recognition (NOT enrollment)
      toast.info('Session expired. Verifying identity via SmileID...');
      setSmileIDUserId(storedUserId);
      setShowSmileIDModal(true);

    } catch (error: any) {
      const msg = error.name === 'NotAllowedError'
        ? 'Biometric verification was cancelled or timed out.'
        : (error.message || 'Biometric authentication failed. Please try again.');
      setInlineError(msg);
      toast.error(msg);
    } finally {
      setIsBiometricLoading(false);
    }
  };

  // ── SmileID verification success → try Supabase session restore ──────────
  const handleSmileIDSuccess = async () => {
    setShowSmileIDModal(false);

    const storedUser   = localStorage.getItem('borderpay_user');
    const refreshToken = localStorage.getItem('borderpay_refresh_token');

    if (!storedUser) {
      toast.error('Session expired. Please sign in with email and password.');
      return;
    }

    const userProfile = JSON.parse(storedUser);

    // Attempt one more session refresh after SmileID proof-of-liveness
    if (refreshToken) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (data?.session && !error) {
        localStorage.setItem('borderpay_token', data.session.access_token);
        localStorage.setItem('borderpay_refresh_token', data.session.refresh_token);
        toast.success('Identity verified! Welcome back.');
        onLoginSuccess(userProfile);
        return;
      }
    }

    // If still can't refresh, tell user to re-enter password
    toast.info('Identity verified! Please enter your password to complete sign-in.');
    // Pre-fill email if available
    if (userProfile.email) setEmail(userProfile.email);
  };

  const handleSmileIDFail = () => {
    setShowSmileIDModal(false);
    const msg = 'Biometric verification failed. Please try again or sign in with your password.';
    setInlineError(msg);
    toast.error(msg);
  };

  // Show 2FA screen
  if (show2FA) {
    return (
      <TwoFactorVerify
        onVerifySuccess={handle2FASuccess}
        onBack={handle2FABack}
        userEmail={email}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-[#0B0E11] text-white flex items-center justify-center px-safe py-safe overflow-hidden fixed inset-0">
      {/* Animated gradient background */}
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />

      {/* Centered Content Container */}
      <div className={`w-full max-w-md overflow-y-auto overflow-x-hidden max-h-[100dvh] px-4 py-6 hide-scrollbar relative z-[2] ${''}`}>
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-[#C7FF00] flex items-center justify-center mb-6 shadow-lg">
            <BorderPayLogo size={36} color="#000000" />
          </div>

          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight text-center">
            Welcome Back
          </h1>
          <p className="text-sm text-gray-400 text-center">
            Sign in to continue
          </p>
        </div>

        {/* Inline Error Banner */}
        <AnimatePresence>
          {inlineError && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              className="mb-4 flex items-start gap-3 bg-[#C7FF00] text-black px-4 py-3 rounded-2xl shadow-[0_0_20px_rgba(199,255,0,0.25)]"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p className="text-sm font-semibold flex-1 leading-snug">{inlineError}</p>
              <button
                type="button"
                onClick={() => setInlineError('')}
                className="w-5 h-5 rounded-full bg-black/10 flex items-center justify-center flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          {/* Email */}
          <div className="relative">
            <label className="block text-xs text-gray-400 uppercase tracking-[0.2em] font-semibold mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-12 pr-4 py-4 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl text-white font-medium focus:outline-none focus:border-[#C7FF00] focus:bg-white/[0.07] focus:shadow-[0_0_20px_rgba(199,255,0,0.15)] transition-all placeholder:text-gray-600"
              />
            </div>
          </div>

          {/* Password */}
          <div className="relative">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs text-gray-400 uppercase tracking-[0.2em] font-semibold">
                Password
              </label>
              <button
                type="button"
                onClick={onNavigateToForgotPassword}
                className="text-[9px] text-[#C7FF00] font-semibold hover:underline uppercase tracking-[0.2em]"
              >
                Forgot Password?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full pl-12 pr-12 py-4 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl text-white font-medium focus:outline-none focus:border-[#C7FF00] focus:bg-white/[0.07] focus:shadow-[0_0_20px_rgba(199,255,0,0.15)] transition-all placeholder:text-gray-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Sign In Button */}
          <motion.button
            type="submit"
            disabled={isLoading}
            whileTap={{ scale: 0.98 }}
            className="w-full bg-[#C7FF00] text-black py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 transition-all hover:bg-[#D4FF33] hover:shadow-[0_0_20px_rgba(199,255,0,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ letterSpacing: '0.025em' }}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </motion.button>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-white/5" />
            <span className="text-xs text-gray-500 uppercase tracking-[0.2em]">Or</span>
            <div className="flex-1 h-px bg-white/5" />
          </div>

          {/* Biometric Sign-In */}
          <motion.button
            type="button"
            onClick={handleBiometricLogin}
            disabled={isBiometricLoading}
            whileTap={{ scale: 0.98 }}
            className="w-full bg-white/[0.04] backdrop-blur-md border border-white/[0.08] text-white py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-3 transition-all hover:border-[#C7FF00] hover:bg-white/[0.07] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ letterSpacing: '0.025em' }}
          >
            {isBiometricLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-[#C7FF00]" />
                Authenticating...
              </>
            ) : (
              <>
                <Fingerprint className="w-6 h-6 text-[#C7FF00]" />
                Biometric Sign-In
              </>
            )}
          </motion.button>

          {/* Biometric hint */}
          <p className="text-center text-[10px] text-gray-600 -mt-2">
            Uses Face ID, Touch ID, or SmileID facial verification
          </p>
        </form>

        {/* Footer */}
        <div className="mt-8">
          <div className="text-center">
            <p className="text-sm text-gray-400">
              Don't have an account?{' '}
              <button
                onClick={onNavigateToSignUp}
                className="text-[#C7FF00] font-semibold hover:underline"
              >
                Sign Up
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* SmileID Biometric Auth Modal */}
      <AnimatePresence>
        {showSmileIDModal && smileIDUserId && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed inset-0 z-[9999]"
          >
            <SmileIDAuthModal
              userId={smileIDUserId}
              onSuccess={handleSmileIDSuccess}
              onFail={handleSmileIDFail}
              onClose={() => setShowSmileIDModal(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
