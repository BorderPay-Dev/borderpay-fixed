import React, { useState, useEffect, useCallback } from 'react';
import { Toaster } from 'sonner';
import { SplashScreen } from './components/onboarding/SplashScreen';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { LoginScreen } from './components/auth/LoginScreen';
import { SignUpFlow } from './components/auth/SignUpFlow';
import { ForgotPassword } from './components/auth/ForgotPassword';
import { ForgotPin } from './components/auth/ForgotPin';
import { ResetPasswordScreen } from './components/auth/ResetPasswordScreen';
import { ResetPinScreen } from './components/auth/ResetPinScreen';
import { isPasswordRecovery, isBiometricLoginPending, isAppLocked, authAPI } from './utils/supabase/client';
import { EmailVerificationLanding } from './components/auth/EmailVerificationLanding';
import { MainApp } from './components/app/MainApp';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { sessionAPI } from './utils/api/sessionAPI';
import { backendAPI } from './utils/api/backendAPI';
import { readUserProfile } from './utils/supabase/client';
import { useAuth } from './utils/auth/useAuth';
import { ThemeLanguageProvider } from './utils/i18n/ThemeLanguageContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useInactivityTimer } from './utils/auth/useInactivityTimer';
import { PINManager } from './utils/security/SecurityManager';
import { AppLockScreen } from './components/security/AppLockScreen';

type AppState =
  | 'splash'
  | 'onboarding'
  | 'login'
  | 'signup'
  | 'forgot-password'
  | 'forgot-pin'
  | 'reset-password'
  | 'reset-pin'
  | 'dashboard'
  | 'loading'
  | 'verify-email';

// ── Device fingerprinting ──
// Uses a persistent random device ID (survives IP/UA changes) combined with
// IP for new-network detection. Trusted devices skip the alert entirely.

function getOrCreateDeviceId(): string {
  const KEY = 'borderpay_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function getDeviceFingerprint(): Promise<{ ip: string; ua: string; deviceId: string }> {
  let ip = 'unknown';
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    ip = data.ip || 'unknown';
  } catch { /* silent */ }
  return { ip, ua: navigator.userAgent, deviceId: getOrCreateDeviceId() };
}

function checkNewDevice(fingerprint: { ip: string; ua: string; deviceId: string }): boolean {
  const stored = localStorage.getItem('borderpay_known_devices');
  const devices: Array<{ ip: string; deviceId: string }> = stored ? JSON.parse(stored) : [];
  // Known if same deviceId OR same IP from a known device
  const isKnown = devices.some(d => d.deviceId === fingerprint.deviceId || d.ip === fingerprint.ip);
  return !isKnown;
}

function registerDevice(fingerprint: { ip: string; ua: string; deviceId: string }) {
  const stored = localStorage.getItem('borderpay_known_devices');
  const devices: Array<{ ip: string; deviceId: string }> = stored ? JSON.parse(stored) : [];
  // Don't duplicate
  if (devices.some(d => d.deviceId === fingerprint.deviceId)) {
    // Update IP for existing device
    const existing = devices.find(d => d.deviceId === fingerprint.deviceId);
    if (existing) existing.ip = fingerprint.ip;
  } else {
    devices.push({ ip: fingerprint.ip, deviceId: fingerprint.deviceId });
  }
  // Keep last 10 devices
  if (devices.length > 10) devices.shift();
  localStorage.setItem('borderpay_known_devices', JSON.stringify(devices));
}

function trustCurrentDevice() {
  const deviceId = getOrCreateDeviceId();
  const stored = localStorage.getItem('borderpay_trusted_devices');
  const trusted: string[] = stored ? JSON.parse(stored) : [];
  // Build a composite key — deviceId is enough since it's persistent per browser
  const fp = `${deviceId}`;
  if (!trusted.includes(fp)) {
    trusted.push(fp);
    localStorage.setItem('borderpay_trusted_devices', JSON.stringify(trusted));
  }
}

function AppContent() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [skipSplashOnce] = useState(() => {
    try {
      const path = String(window.location.pathname || '').replace(/\/+$/, '');
      const params = new URLSearchParams(window.location.search);
      const skipByQuery =
        params.get('skip_splash') === '1';
      const sessionSkip = sessionStorage.getItem('borderpay_skip_splash_once') === '1';
      const localTs = Number(localStorage.getItem('borderpay_skip_splash_once_ts') || '0');
      const localSkip = Number.isFinite(localTs) && localTs > 0 && (Date.now() - localTs) < 10 * 60 * 1000;
      const skip = skipByQuery || sessionSkip || localSkip;
      if (sessionSkip) sessionStorage.removeItem('borderpay_skip_splash_once');
      if (localSkip) localStorage.removeItem('borderpay_skip_splash_once_ts');
      return skip;
    } catch {
      return false;
    }
  });
  const [showSplash, setShowSplash] = useState(() => !skipSplashOnce);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(() => {
    return localStorage.getItem('borderpay_onboarding_done') === 'true';
  });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [newDeviceDetected, setNewDeviceDetected] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const { user, session, loading: authLoading, isAuthenticated, signOut } = useAuth();
  const [authBootTimedOut, setAuthBootTimedOut] = useState(false);
  const effectiveAuthLoading = authLoading && !authBootTimedOut;

  // App lock state — show lock screen when user has PIN and enters dashboard
  const [appLocked, setAppLocked] = useState(false);
  const [lockChecked, setLockChecked] = useState(false);

  // Normalize hosted verification callback paths to the in-app KYC route.
  // Bridge may return to /onboarding/kyc-complete; map it to /?screen=kyc.
  useEffect(() => {
    try {
      const path = String(window.location.pathname || '').replace(/\/+$/, '');
      if (path !== '/onboarding/kyc-complete') return;
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.searchParams.set('screen', 'kyc');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch { /* noop */ }
  }, []);

  // ── Android PWA Install Prompt ──
  useEffect(() => {
    const isAndroid = /android/i.test(navigator.userAgent);
    if (!isAndroid) return;

    const dismissed = localStorage.getItem('borderpay_pwa_dismissed');
    if (dismissed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener);
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem('borderpay_pwa_dismissed', 'true');
  };

  // Sev-1 fail-open guard: auth bootstrap must never pin splash forever.
  useEffect(() => {
    if (!authLoading) {
      setAuthBootTimedOut(false);
      return;
    }
    const t = window.setTimeout(() => {
      setAuthBootTimedOut(true);
      try { console.warn('[auth] bootstrap timeout fail-open'); } catch { /* noop */ }
    }, 6500);
    return () => window.clearTimeout(t);
  }, [authLoading]);

  // Sev-1 fail-safe: splash must never trap the app.
  useEffect(() => {
    if (!showSplash) return;
    const t = window.setTimeout(() => {
      setShowSplash(false);
      try { console.warn('[boot] splash watchdog forced continue'); } catch { /* noop */ }
    }, 5500);
    return () => window.clearTimeout(t);
  }, [showSplash]);

  // Sev-1 fail-safe: if route resolution remains "loading" after splash/auth are
  // done, fail-open to login/onboarding instead of pinning boot forever.
  useEffect(() => {
    if (showSplash || effectiveAuthLoading || appState !== 'loading') return;
    const t = window.setTimeout(() => {
      setAppState(hasSeenOnboarding ? 'login' : 'onboarding');
      try { console.warn('[boot] route loading watchdog forced route'); } catch { /* noop */ }
    }, 1800);
    return () => window.clearTimeout(t);
  }, [showSplash, effectiveAuthLoading, appState, hasSeenOnboarding]);

  // Check for password reset token in URL hash
  // Detect password reset tokens in URL hash — but don't change state until splash is done
  const [pendingResetPassword, setPendingResetPassword] = useState(false);
  const [pendingResetPin, setPendingResetPin] = useState(false);

  // Detect /auth/verify?token=…&purpose=… — extracted once on mount and
  // forwarded to <EmailVerificationLanding>. Stored in state so we don't
  // re-parse the URL on every render.
  const [pendingVerify, setPendingVerify] = useState<{ token: string; purpose: 'signup_individual' | 'signup_business' | 'password_reset' | 'email_change' } | null>(null);

  useEffect(() => {
    // ── Verify-link hardening ────────────────────────────────────────────
    // Accept the email-verification token whether it arrives in the QUERY
    // string (`?token=…&purpose=…`, the canonical sender shape) OR in the URL
    // HASH (`#token=…&purpose=…`). Some email clients / redirect chains move or
    // strip the query string, so reading the hash too prevents a "clicked the
    // link, stayed unverified" dead-end. We detect the verify route as the
    // FIRST thing on mount so it wins over the auth router.
    const rawHash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams  = new URLSearchParams(rawHash);
    const queryParams = new URLSearchParams(window.location.search);

    const isVerifyRoute = window.location.pathname === '/auth/verify';
    const verifyToken =
      (isVerifyRoute ? (queryParams.get('token') || hashParams.get('token')) : '') || '';
    const verifyPurpose =
      ((isVerifyRoute ? (queryParams.get('purpose') || hashParams.get('purpose')) : '') ||
        'signup_individual') as any;

    if (isVerifyRoute && verifyToken) {
      setPendingVerify({ token: verifyToken, purpose: verifyPurpose });
    }

    // Password-reset detection (hash #access_token=… from Supabase recovery).
    // Guard: do NOT treat a verify token as a reset token — only trigger reset
    // when we're NOT on the verify route and a recovery/access token is present.
    if (!isVerifyRoute && (rawHash.includes('access_token=') || rawHash.includes('type=recovery') || isPasswordRecovery())) {
      setPendingResetPassword(true);
    }

    if (window.location.pathname === '/auth/pin-reset' && (queryParams.get('token') || hashParams.get('token'))) {
      setPendingResetPin(true);
    }
  }, []);

  // Supabase fires PASSWORD_RECOVERY asynchronously after it parses the recovery
  // hash (which it then CLEARS). Catch that event — and the sessionStorage flag it
  // sets — so a recovery deep link always routes to the reset-password screen even
  // if the hash was consumed before the mount effect above read it.
  useEffect(() => {
    const onRecovery = () => setPendingResetPassword(true);
    window.addEventListener('borderpay:password_recovery', onRecovery);
    if (isPasswordRecovery()) setPendingResetPassword(true);
    return () => window.removeEventListener('borderpay:password_recovery', onRecovery);
  }, []);

  // Apply verify-email state once splash + auth load have settled.
  useEffect(() => {
    if (pendingVerify && !showSplash && !effectiveAuthLoading) {
      setAppState('verify-email');
    }
  }, [pendingVerify, showSplash, effectiveAuthLoading]);

  // Apply pending reset-password state only after splash + auth have finished
  useEffect(() => {
    if (pendingResetPassword && !showSplash && !effectiveAuthLoading) {
      setAppState('reset-password');
      setPendingResetPassword(false);
    }
  }, [pendingResetPassword, showSplash, effectiveAuthLoading]);

  useEffect(() => {
    if (pendingResetPin && !showSplash && !effectiveAuthLoading) {
      setAppState('reset-pin');
      setPendingResetPin(false);
    }
  }, [pendingResetPin, showSplash, effectiveAuthLoading]);

  // Check authentication state and route appropriately
  useEffect(() => {
    // Wait for auth to finish loading
    if (effectiveAuthLoading) {
      return;
    }

    // Wait for splash to finish
    if (showSplash) {
      return;
    }

    // P0 hotfix: do not override an in-flight out-of-band auth screen.
    //
    // The general invariant is "if the user has actively navigated to one
    // of these out-of-band auth screens, the auth router must keep its
    // hands off." There are four such screens:
    //
    //   • 'verify-email'    — opened from URL (?token=…&purpose=…),
    //                         hydrated by the effect at ~line 154.
    //   • 'reset-password'  — opened from URL #access_token hash,
    //                         hydrated by the effect at ~line 161.
    //   • 'signup'          — set by handleNavigateToSignUp when the
    //                         user clicks the Sign Up link on Login.
    //   • 'forgot-password' — set by handleNavigateToForgotPassword
    //                         when the user clicks Forgot Password on
    //                         Login.
    //
    // Why all four belong in the same guard:
    //
    //   In PR #8 (commit 8fb03ee) `appState` was added to this effect's
    //   dep array so the reset-password race could be fixed. That made
    //   the effect re-fire whenever appState changes. The original PR
    //   only added 'verify-email' and 'reset-password' to the early
    //   return, because those were the symptoms users were reporting.
    //   But 'signup' and 'forgot-password' have the same shape: a user
    //   click sets appState, this effect re-fires, sees the user as
    //   unauthenticated, and falls through to setAppState('login') —
    //   clobbering the in-flight navigation on the same render cycle.
    //   That's the live "the signup button doesn't work" symptom
    //   reported after PR #8 shipped.
    //
    //   A second guard for the authenticated business-signup window
    //   used to live further down (inside `if (isAuthenticated && user)`)
    //   but is now redundant — this early return covers it before
    //   determineRoute() runs. End state for that flow is unchanged.
    //
    // Why the guard checks appState directly instead of the pending* flags:
    //
    //   • pendingVerify stays truthy across the entire verification UI life
    //     (only cleared by EmailVerificationLanding.onNavigateToLogin when
    //     the user explicitly leaves). So a `if (pendingVerify) return;`
    //     guard would have worked for verify alone.
    //
    //   • pendingResetPassword is DIFFERENT — the effect at ~line 161 sets
    //     appState='reset-password' AND immediately clears the flag in the
    //     same effect body. By the very next render the flag is already
    //     false, so a `if (pendingResetPassword) return;` guard would not
    //     hold across the lifetime of the reset-password screen.
    //
    //   • 'signup' and 'forgot-password' have no pending* mirror at all —
    //     they are set directly by click handlers, not by URL parsing.
    //     The appState check is the only correct guard for them.
    if (
      appState === 'verify-email'   ||
      appState === 'reset-password' ||
      appState === 'reset-pin'      ||
      appState === 'signup'         ||
      appState === 'forgot-password' ||
      appState === 'forgot-pin'
    ) {
      return;
    }
    // Belt-and-braces: also bail while the URL → state is being parsed on
    // first mount. Both flags are set synchronously in their mount-only
    // effects, so this catches the brief render-N window before the
    // 'verify-email' / 'reset-password' state setter has been observed.
    //
    // pendingResetPassword is important here even though it gets cleared
    // in the same effect that sets appState='reset-password': on render N
    // (the render where showSplash + authLoading both flip false), all
    // three effects run with closures captured from render N. The
    // reset-password effect schedules setAppState('reset-password') +
    // setPendingResetPassword(false) for render N+1, but this auth-router
    // effect's closure still sees appState='login' and
    // pendingResetPassword=true. Without this guard its
    // setAppState('login') would land in the same batch and clobber the
    // 'reset-password' the sibling effect just scheduled.
    if (pendingVerify)        return;
    if (pendingResetPassword) return;
    if (pendingResetPin)      return;

    // Now determine where to route based on auth state
    const determineRoute = async () => {
      try {
        if (isLoggingOut) {
          return;
        }

        // Biometric sign-in restores the Supabase session BEFORE WebAuthn runs.
        // While that gate is pending we must NOT route to the dashboard AND must
        // NOT clear borderpay_token (the else-branch below would) — the token was
        // just set so the authenticated WebAuthn calls are authorized. Stay put
        // until the handler clears the pending flag (on WebAuthn success → it
        // calls onLoginSuccess directly; on failure it signs out).
        if (isBiometricLoginPending()) {
          return;
        }

        // "Lock app" — keep the preserved session out of the dashboard and route
        // to login (where biometric unlock is offered). Don't fall through to the
        // not-authenticated branch (it would clear borderpay_token, but the lock
        // already removed it; routing here is explicit and avoids onboarding).
        if (isAppLocked()) {
          setAppState('login');
          return;
        }

        if (isAuthenticated && user) {
          // Note: the pre-existing authenticated guard
          // `if (appState === 'signup') return;` lived here historically
          // to protect the business-signup finalization window (user
          // freshly authenticated by signInWithPassword but business
          // profile not yet created — the auth-router would otherwise
          // race onSignUpSuccess to setAppState('dashboard')). It is
          // now redundant because the upstream guard at ~line 220
          // already early-returns for appState === 'signup' before
          // determineRoute() runs. TypeScript flags the comparison as
          // unreachable, which is correct. End state is unchanged
          // (both paths land on BusinessDashboard via onSignUpSuccess).

          // Device fingerprint check (non-blocking)
          getDeviceFingerprint().then(fp => {
            const trusted = localStorage.getItem('borderpay_trusted_devices');
            const trustedList: string[] = trusted ? JSON.parse(trusted) : [];

            // Skip alert for trusted devices (matches deviceId stored by trustCurrentDevice)
            if (trustedList.includes(fp.deviceId)) return;

            if (checkNewDevice(fp)) {
              setNewDeviceDetected(true);
              registerDevice(fp);
            }
          });

          setAppState('dashboard');
        } else {
          // Auth has finished loading but user is not authenticated.
          // Clear any stale cached token so we don't loop here forever.
          const cachedToken = localStorage.getItem('borderpay_token');
          if (cachedToken) {
            localStorage.removeItem('borderpay_token');
          }

          if (!hasSeenOnboarding) {
            setAppState('onboarding');
          } else {
            setAppState('login');
          }
        }
      } catch {
        setAppState(hasSeenOnboarding ? 'login' : 'onboarding');
      }
    };

    determineRoute();
  }, [effectiveAuthLoading, isAuthenticated, user, showSplash, hasSeenOnboarding, pendingVerify, pendingResetPassword, pendingResetPin, appState]);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const handleOnboardingComplete = () => {
    setHasSeenOnboarding(true);
    localStorage.setItem('borderpay_onboarding_done', 'true');
    setAppState('login');
  };

  const handleOnboardingSkip = () => {
    setHasSeenOnboarding(true);
    localStorage.setItem('borderpay_onboarding_done', 'true');
    setAppState('login');
  };

  const handleLoginSuccess = async (loginUser: any) => {
    try {
      // Never block dashboard first paint on remote profile/session calls.
      // Resolve from local/auth hints immediately, then enrich in background.
      let fullName = loginUser.user_metadata?.full_name || loginUser.user_metadata?.name;
      let accountType = loginUser?.user_metadata?.account_type;

      if (!fullName || fullName === 'User') {
        // Check cached profile
        try {
          const cachedUser = readUserProfile();
          if (cachedUser?.full_name && cachedUser.full_name !== 'User') {
            fullName = cachedUser.full_name;
          }
          if (!accountType && cachedUser?.account_type) {
            accountType = cachedUser.account_type;
          }
        } catch {}
      }

      // Read account type from Supabase auth-token payload when metadata is sparse.
      if (!accountType) {
        try {
          for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
            const p = JSON.parse(localStorage.getItem(k) || 'null');
            const meta = (p?.user || p?.currentSession?.user)?.user_metadata || {};
            if (meta.account_type === 'business' || meta.account_type === 'individual') {
              accountType = meta.account_type;
              break;
            }
          }
        } catch { /* ignore */ }
      }

      const resolvedFullName = fullName || loginUser.email?.split('@')[0] || 'User';
      try {
        const cached = readUserProfile() || {};
        localStorage.setItem('borderpay_user', JSON.stringify({
          ...cached,
          id: loginUser.id,
          email: loginUser.email,
          full_name: resolvedFullName,
          account_type: accountType || cached?.account_type || 'individual',
        }));
      } catch { /* ignore cache write */ }

      setAppState('dashboard');

      // Background-only enrich (no UI blocking).
      void (async () => {
        try {
          const profileResult = await backendAPI.user.getProfile();
          if (profileResult?.success && profileResult.data?.user) {
            const p = profileResult.data.user;
            const nextName = p.full_name || resolvedFullName;
            const nextType = p.account_type || accountType || 'individual';
            const cached = readUserProfile() || {};
            localStorage.setItem('borderpay_user', JSON.stringify({
              ...cached,
              ...p,
              id: loginUser.id,
              email: loginUser.email,
              full_name: nextName,
              account_type: nextType,
            }));
          }
        } catch { /* non-fatal */ }
      })();

      void sessionAPI.create({
        id: loginUser.id,
        email: loginUser.email,
        full_name: resolvedFullName,
      });
    } catch {
      // Non-critical — Supabase auth already succeeded
      setAppState('dashboard');
    }
  };

  const handleSignUpSuccess = async (signupUser: any) => {
    try {
      await sessionAPI.create({
        id: signupUser.id,
        email: signupUser.email,
        full_name: signupUser.full_name || signupUser.user_metadata?.full_name || signupUser.email?.split('@')[0] || 'User',
      });
      setAppState('dashboard');
    } catch {
      setAppState('dashboard');
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await signOut();
      await sessionAPI.destroy();
      setNewDeviceDetected(false);
      setAppState('login');
    } catch {
      setAppState('login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  // "Lock app" — LOCAL-only sign-out that keeps a refreshable session behind
  // biometric (distinct from Log out, which fully revokes). Routes to the login
  // screen, where the biometric button is available for unlock.
  const handleLock = async () => {
    try {
      await authAPI.lockApp();
    } finally {
      setAppState('login');
    }
  };

  const handleNavigateToSignUp = () => {
    setAppState('signup');
  };

  const handleNavigateToLogin = () => {
    setAppState('login');
  };

  const handleNavigateToForgotPassword = () => {
    setAppState('forgot-password');
  };

  const handleNavigateToForgotPin = () => {
    setAppState('forgot-pin');
  };

  const handleNavigateToResetPassword = () => {
    setAppState('reset-password');
  };

  // ── Inactivity auto-logout (30 min, silent — no warning modal) ──
  const handleInactivityLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await signOut();
      await sessionAPI.destroy();
    } catch { /* silent */ }
    setNewDeviceDetected(false);
    setAppState('login');
    setIsLoggingOut(false);
  }, [signOut]);

  // Inactivity auto-logout after 30 min
  useInactivityTimer({
    onLogout: handleInactivityLogout,
    timeoutMs: 30 * 60 * 1000,   // 30 minutes
    warningMs: 0,                  // no warning — silent logout
    enabled: appState === 'dashboard' && isAuthenticated,
  });

  useEffect(() => {
    if (appState === 'dashboard' && user?.id && !lockChecked) {
      try {
        const hasPIN = PINManager.hasPIN(user.id);
        if (hasPIN) {
          setAppLocked(true);
        }
      } catch { /* corrupt localStorage — skip lock */ }
      setLockChecked(true);
    }
  }, [appState, user?.id, lockChecked]);

  useEffect(() => {
    if (appState !== 'dashboard' || !user?.id) return;
    const handleVisibility = () => {
      try {
        if (document.visibilityState === 'visible' && PINManager.hasPIN(user.id)) {
          setAppLocked(true);
        }
      } catch { /* silent */ }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [appState, user?.id]);

  // Show splash screen on first load (covers auth initialization too)
  // Keep splash visible until both auth check AND splash animation are complete
  // P0: startup must always render branded splash while auth/route bootstrap is unresolved.
  // `skipSplashOnce` should only skip the extra animation hop, never force the app
  // into the generic loading fallback.
  const showSplashScreen =
    appState === 'loading' ||
    effectiveAuthLoading ||
    (!skipSplashOnce && showSplash);
  if (showSplashScreen) {
    return (
      <SplashScreen onComplete={handleSplashComplete} />
    );
  }

  if (appState === 'onboarding') {
    return (
      <OnboardingFlow 
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingSkip}
      />
    );
  }

  if (appState === 'login') {
    return (
      <LoginScreen
        onLoginSuccess={handleLoginSuccess}
        onNavigateToSignUp={handleNavigateToSignUp}
        onNavigateToForgotPassword={handleNavigateToForgotPassword}
      />
    );
  }

  if (appState === 'signup') {
    return (
      <SignUpFlow
        onSignUpSuccess={handleSignUpSuccess}
        onNavigateToLogin={handleNavigateToLogin}
      />
    );
  }

  if (appState === 'forgot-password') {
    return (
      <ForgotPassword
        onNavigateToLogin={handleNavigateToLogin}
        onNavigateToResetPassword={handleNavigateToResetPassword}
      />
    );
  }

  if (appState === 'reset-password') {
    return (
      <ResetPasswordScreen
        onNavigateToLogin={handleNavigateToLogin}
      />
    );
  }

  if (appState === 'forgot-pin') {
    return (
      <ForgotPin
        onNavigateToLogin={handleNavigateToLogin}
      />
    );
  }

  if (appState === 'reset-pin') {
    return (
      <ResetPinScreen
        onNavigateToLogin={handleNavigateToLogin}
      />
    );
  }

  if (appState === 'verify-email' && pendingVerify) {
    return (
      <EmailVerificationLanding
        token={pendingVerify.token}
        purpose={pendingVerify.purpose}
        onNavigateToLogin={() => {
          setPendingVerify(null);
          // Clean the URL so a refresh doesn't re-trigger verification.
          try { window.history.replaceState({}, '', '/'); } catch { /* ignore */ }
          handleNavigateToLogin();
        }}
      />
    );
  }

  if (appState === 'dashboard' && user?.id) {
    // Show app lock screen if locked
    if (appLocked && PINManager.hasPIN(user.id)) {
      return (
        <AppLockScreen
          userId={user.id}
          onUnlock={() => setAppLocked(false)}
          onLogout={handleLogout}
          onForgotPIN={handleNavigateToForgotPin}
        />
      );
    }

    return (
      <>
        <MainApp
          userId={user.id}
          onLogout={handleLogout}
          onLock={handleLock}
          newDeviceDetected={newDeviceDetected}
          onDismissNewDevice={() => setNewDeviceDetected(false)}
          onTrustDevice={() => { trustCurrentDevice(); setNewDeviceDetected(false); }}
        />
        {/* Android PWA Install Banner */}
        {showInstallBanner && (
          <div className="fixed bottom-20 left-4 right-4 z-[200] animate-in slide-in-from-bottom duration-300">
            <div className="bg-[#1A1D21] border border-[#C7FF00]/30 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-[#C7FF00] flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="20" height="28">
                    <rect x="10" y="5" width="24" height="95" rx="12" fill="#000" />
                    <path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#000" />
                    <circle cx="66" cy="16" r="8" fill="none" stroke="#000" strokeWidth="1.8" />
                    <text x="66" y="20.5" textAnchor="middle" fontSize="12" fontWeight="bold" fontFamily="Arial, sans-serif" fill="#000">R</text>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold">Install BorderPay</p>
                  <p className="text-gray-400 text-xs">Add to home screen for the best experience</p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={dismissInstallBanner}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 text-gray-400 text-xs font-semibold transition-colors active:scale-[0.98]"
                >
                  Not Now
                </button>
                <button
                  onClick={handleInstallPWA}
                  className="flex-1 py-2.5 rounded-xl bg-[#C7FF00] text-black text-xs font-bold transition-colors active:scale-[0.98]"
                >
                  Install
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback
  return (
    <div className="fixed inset-0 bg-[#0B0E11] flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeLanguageProvider>
        <AppContent />
        <Toaster
          position="top-center"
          theme="dark"
          richColors
          toastOptions={{
            style: {
              background: '#1A1F26',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#F3F4F6',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              borderRadius: '14px',
              fontSize: '13px',
              padding: '12px 16px',
            },
          }}
          gap={8}
          visibleToasts={3}
          offset={16}
        />
      </ThemeLanguageProvider>
    </ErrorBoundary>
  );
}
