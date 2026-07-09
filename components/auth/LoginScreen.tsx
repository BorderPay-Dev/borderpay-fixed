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
 * 4. If refresh token expired → prompt for password
 * 5. DO NOT create new user — only authenticate existing users
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mail, Lock, Eye, EyeOff, Fingerprint, Loader2,
  X, AlertCircle,
} from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { sessionAPI } from '../../utils/api/sessionAPI';
import { toast } from 'sonner';

import { backendAPI } from '../../utils/api/backendAPI';
import { TOTPManager, BiometricManager } from '../../utils/security/SecurityManager';
import { TwoFactorVerify } from './TwoFactorVerify';
import { authAPI, storeUserProfile, setBiometricLoginPending, clearBiometricLoginPending, isAppLocked, setAppLocked, clearAppLocked } from '../../utils/supabase/client';
import { deriveKycStatus } from '../../utils/config/environment';
import { friendlyError } from '../../utils/errors/friendlyError';

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
  onNavigateToSignUp: () => void;
  onNavigateToForgotPassword?: () => void;
}

// ── Main Login Screen ─────────────────────────────────────────────────────────
export function LoginScreen({ onLoginSuccess, onNavigateToSignUp, onNavigateToForgotPassword }: LoginScreenProps) {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]   = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [inlineError, setInlineError] = useState('');

  // 2FA state
  const [show2FA, setShow2FA]       = useState(false);
  const [pendingUser, setPendingUser] = useState<any>(null);

  useEffect(() => {
    // Smooth signup -> verify -> signin handoff on the same device.
    try {
      const pending = JSON.parse(localStorage.getItem('borderpay_pending_signup') || 'null');
      if (pending?.email && !email) setEmail(String(pending.email));
      const justVerified = sessionStorage.getItem('borderpay_email_verified_just_now') === '1';
      if (justVerified) {
        sessionStorage.removeItem('borderpay_email_verified_just_now');
        toast.success('Email verified. Please sign in to continue.');
      }
    } catch { /* noop */ }
    // Intentional one-time hydration on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the biometric button ONLY when sign-in can actually run — i.e. all the
  // local session context the handler needs exists (biometric_user_id + enrolled
  // credential + cached borderpay_user + borderpay_refresh_token). Enrollment
  // alone is NOT sufficient: logout/cancel/failure can clear the session context
  // while leaving the enrollment flag, which would otherwise render a button that
  // immediately errors with "No biometric session found".
  useEffect(() => {
    setBiometricAvailable(BiometricManager.isLoginAvailable());
  }, []);

  // Auto-enroll biometrics after successful password login
  const tryBiometricEnrollment = async (userId: string, userName: string) => {
    try {
      if (BiometricManager.isEnrolled(userId)) return; // Already enrolled
      const supported = await BiometricManager.isSupported();
      if (!supported) return;
      const available = await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.();
      if (!available) return;
      // Silently enroll — if user cancels the prompt, we just skip
      await BiometricManager.enroll(userId, userName);
    } catch {
      // Non-critical — don't block login
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      setInlineError('Please enter your email and password.');
      return;
    }

    setInlineError('');
    setIsLoading(true);

    // Explicit password login is authoritative credential auth — clear any stale
    // biometric-pending gate (e.g. left behind by a crash mid-biometric) AND any
    // app-locked marker, so neither can block this login.
    clearBiometricLoginPending();
    clearAppLocked();

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
            userProfile = profileResult.data.user;
          }
        } catch (profileError) {
        }

        // Auth metadata is the source-of-truth for the user's name
        const authName = data.user.user_metadata?.full_name || data.user.user_metadata?.name || '';

        if (!userProfile) {
          userProfile = {
            id:           data.user.id,
            email:        data.user.email,
            full_name:    authName || data.user.email?.split('@')[0] || 'User',
            phone:        data.user.user_metadata?.phone || data.user.phone || '',
            country:      data.user.user_metadata?.country || '',
            account_type: data.user.user_metadata?.account_type || 'individual',
            kyc_status:   data.user.user_metadata?.kyc_status || 'pending',
            bridge_kyc_status: data.user.user_metadata?.bridge_kyc_status ?? null,
            bridge_kyb_status: data.user.user_metadata?.bridge_kyb_status ?? null,
            bridge_account_status: data.user.user_metadata?.bridge_account_status ?? null,
            created_at:   data.user.created_at,
          };
        } else if (!userProfile.full_name || userProfile.full_name === 'User') {
          // Backend profile missing name — supplement from auth metadata
          userProfile.full_name = authName || data.user.email?.split('@')[0] || 'User';
        }
        userProfile.derived_kyc_status = deriveKycStatus(userProfile);

        // Re-prime ALL biometric session state on explicit password login, so a
        // future biometric sign-in has the full context isLoginAvailable() needs:
        //   borderpay_token (L~92) · borderpay_user (storeUserProfile) ·
        //   borderpay_refresh_token · borderpay_biometric_user_id.
        storeUserProfile(userProfile);
        localStorage.setItem('borderpay_refresh_token', data.session.refresh_token);
        localStorage.setItem('borderpay_biometric_user_id', data.user.id);

        // Auto-enroll biometrics (non-blocking, fires in background)
        tryBiometricEnrollment(data.user.id, userProfile.full_name || data.user.email || 'User');

        const has2FA = TOTPManager.isEnabled(userProfile.id);
        const profileHas2FA = userProfile.two_factor_enabled || userProfile.mfa_enabled;

        // P0 security contract: if 2FA is enabled, enforce it immediately after
        // successful sign-in before app access (PIN/biometric remains downstream).
        if (has2FA || profileHas2FA) {
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

  // Tear down a session that was restored for the biometric gate but did NOT
  // pass WebAuthn. Clears the Supabase session and every local auth token so the
  // user is left fully signed out on the login screen.
  const clearRestoredSession = async () => {
    // Lift the routing gates first so a failed/aborted attempt can't strand the
    // app in a non-authenticated pending/locked state.
    clearBiometricLoginPending();
    clearAppLocked();
    try { await supabase.auth.signOut(); } catch { /* best-effort */ }
    localStorage.removeItem('borderpay_token');
    localStorage.removeItem('borderpay_refresh_token');
    localStorage.removeItem('borderpay_user');
  };

  // User cancelled / timed out the Face ID / Touch ID prompt (NOT a hard failure).
  const isCancelOrTimeout = (msg?: string) => !!msg && /cancel|timed out/i.test(msg);

  // Soft path for a LOCKED app when the user cancels/times out the biometric
  // prompt: keep the lock + the preserved session so they can simply retry Face/
  // Touch ID. Only the transient access token + the pending routing gate are
  // dropped. Crucially we do NOT global signOut and do NOT clear
  // borderpay_refresh_token / borderpay_user (that would be a full logout). A
  // cancelled unlock must not punish the user by destroying the locked session.
  const keepLockForRetry = () => {
    clearBiometricLoginPending();
    setAppLocked();                                   // ensure still locked (idempotent)
    localStorage.removeItem('borderpay_token');       // drop only the transient access token
    // borderpay_app_locked, borderpay_user, borderpay_refresh_token preserved.
  };

  // ── Biometric Sign-In (session-first, WebAuthn-gated) ──────────────────────
  // ORDER CONTRACT (do not reorder):
  //   1. Restore the Supabase session from the stored refresh token FIRST, so the
  //      authenticated WebAuthn options/verify endpoints receive a valid user JWT
  //      (they return 401 without one).
  //   2. DO NOT navigate into the app yet.
  //   3. Run the WebAuthn assertion (the real access gate).
  //   4. Only on WebAuthn success complete the existing login flow.
  //   5. On WebAuthn failure, sign the session out and clear local auth, then
  //      stay on the login screen.
  // This is NOT passwordless passkey login: the refresh token restores the
  // session and biometric gates access. No Supabase native passkeys / MFA.
  const handleBiometricLogin = async () => {
    setIsBiometricLoading(true);
    let completed = false;

    try {
      // Step 1: Device support
      if (!window.PublicKeyCredential) {
        toast.error('Biometric authentication not supported on this browser');
        return;
      }

      // Step 2: Stored biometric context
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

      if (!BiometricManager.isEnrolled(storedUserId)) {
        toast.info('Biometric not set up yet. Sign in with your password — biometrics will be enabled automatically.');
        if (userProfile.email) setEmail(userProfile.email);
        return;
      }

      const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        toast.info('Platform biometric not available. Please sign in with your password.');
        if (userProfile.email) setEmail(userProfile.email);
        return;
      }

      if (!refreshToken) {
        // No refresh token to restore a session — WebAuthn options would 401.
        toast.info('Session expired. Please sign in with your password.');
        if (userProfile.email) setEmail(userProfile.email);
        return;
      }

      // Mark biometric login as PENDING before refreshing. refreshSession() fires
      // onAuthStateChange, which would otherwise flip global isAuthenticated true
      // and let App.tsx route to the dashboard before WebAuthn runs. While pending,
      // useAuth / AppContext / App.tsx all treat the app as NOT authenticated.
      setBiometricLoginPending();

      // Step 3: Restore the Supabase session BEFORE any WebAuthn call, so the
      // authenticated options/verify endpoints receive a valid user JWT. We do
      // NOT navigate into the app here — access is still gated by WebAuthn below.
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (refreshError || !refreshData?.session) {
        await clearRestoredSession();
        toast.info('Session expired. Please sign in with your password.');
        if (userProfile.email) setEmail(userProfile.email);
        return;
      }

      // Make the fresh access token visible to the API layer (apiCall reads
      // borderpay_token) so the WebAuthn calls below are authorized.
      localStorage.setItem('borderpay_token', refreshData.session.access_token);
      localStorage.setItem('borderpay_refresh_token', refreshData.session.refresh_token);

      // Step 4: WebAuthn assertion — the access gate. Still NOT in the app.
      const result = await BiometricManager.verify(storedUserId);
      if (!result.success) {
        const msg = result.error || 'Biometric verification failed, try again';
        // Step 5a: LOCKED + user cancel/timeout → soft path. Keep the lock and the
        // preserved session so they can retry Face/Touch ID; do NOT full-logout.
        if (isAppLocked() && isCancelOrTimeout(msg)) {
          keepLockForRetry();
          toast.info('Biometric cancelled. Try again, or use your password.');
          return;
        }
        // Step 5b: hard failure (expired refresh, unknown credential, server
        // verification failure) OR not locked → tear down to password.
        await clearRestoredSession();
        setInlineError(msg);
        toast.error(msg);
        return;
      }

      // Step 6: WebAuthn succeeded → lift the routing gates (pending + any app
      // lock), then complete the login flow with controlled navigation (the only
      // authorized entry to the dashboard for biometric sign-in / unlock).
      clearBiometricLoginPending();
      clearAppLocked();
      await (window as any).__borderpay_reload_auth?.();
      completed = true;
      const sessionUser = refreshData.session.user;
      const mergedProfile = {
        ...userProfile,
        ...sessionUser?.user_metadata,
        id:    sessionUser?.id || userProfile.id,
        email: sessionUser?.email || userProfile.email,
      };
      storeUserProfile(mergedProfile);

      toast.success('Biometric authentication successful!');

      const has2FA = TOTPManager.isEnabled(mergedProfile.id);
      if (has2FA || mergedProfile.two_factor_enabled || mergedProfile.mfa_enabled) {
        setPendingUser(mergedProfile);
        setShow2FA(true);
      } else {
        onLoginSuccess(mergedProfile);
      }
    } catch (error: any) {
      const cancelled = error?.name === 'NotAllowedError' || isCancelOrTimeout(error?.message);
      // Any unexpected error before completion must not leave a half-open session.
      // Exception: a LOCKED app + user cancel/timeout keeps the lock for retry
      // rather than tearing down to a full logout.
      if (!completed) {
        if (isAppLocked() && cancelled) {
          keepLockForRetry();
        } else {
          await clearRestoredSession();
        }
      }
      const msg = cancelled
        ? 'Biometric verification was cancelled or timed out.'
        : (error?.message || 'Biometric authentication failed. Please try again.');
      if (isAppLocked() && cancelled) { toast.info(msg); } else { setInlineError(msg); toast.error(msg); }
    } finally {
      setIsBiometricLoading(false);
    }
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

          {/* Biometric Sign-In — only shown when enrolled */}
          {biometricAvailable && (
            <>
              <div className="flex items-center gap-4 my-6">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-xs text-gray-500 uppercase tracking-[0.2em]">Or</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>

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

              <p className="text-center text-[10px] text-gray-600 -mt-2">
                Uses Face ID or Touch ID for quick sign-in
              </p>
            </>
          )}
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

    </div>
  );
}
