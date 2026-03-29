import React, { useState, useEffect, useCallback } from 'react';
import { Toaster } from 'sonner';
import { SplashScreen } from './components/onboarding/SplashScreen';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { LoginScreen } from './components/auth/LoginScreen';
import { SignUpFlow } from './components/auth/SignUpFlow';
import { ForgotPassword } from './components/auth/ForgotPassword';
import { ResetPasswordScreen } from './components/auth/ResetPasswordScreen';
import { MainApp } from './components/app/MainApp';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { sessionAPI } from './utils/api/sessionAPI';
import { backendAPI } from './utils/api/backendAPI';
import { useAuth } from './utils/auth/useAuth';
import { ThemeLanguageProvider } from './utils/i18n/ThemeLanguageContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useInactivityTimer } from './utils/auth/useInactivityTimer';
import { PINManager } from './utils/security/SecurityManager';
import { AppLockScreen } from './components/security/AppLockScreen';

type AppState = 'splash' | 'onboarding' | 'login' | 'signup' | 'forgot-password' | 'reset-password' | 'dashboard' | 'loading';

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
  const [showSplash, setShowSplash] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(() => {
    return localStorage.getItem('borderpay_onboarding_done') === 'true';
  });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [newDeviceDetected, setNewDeviceDetected] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const { user, session, loading: authLoading, isAuthenticated, signOut } = useAuth();

  // App lock state — show lock screen when user has PIN and enters dashboard
  const [appLocked, setAppLocked] = useState(false);
  const [lockChecked, setLockChecked] = useState(false);

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

  // Check for password reset token in URL hash
  // Detect password reset tokens in URL hash — but don't change state until splash is done
  const [pendingResetPassword, setPendingResetPassword] = useState(false);
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('token=') || hash.includes('access_token=')) {
      setPendingResetPassword(true);
    }
  }, []);

  // Apply pending reset-password state only after splash + auth have finished
  useEffect(() => {
    if (pendingResetPassword && !showSplash && !authLoading) {
      setAppState('reset-password');
      setPendingResetPassword(false);
    }
  }, [pendingResetPassword, showSplash, authLoading]);

  // Check authentication state and route appropriately
  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      return;
    }

    // Wait for splash to finish
    if (showSplash) {
      return;
    }

    // Now determine where to route based on auth state
    const determineRoute = async () => {
      try {
        if (isLoggingOut) {
          return;
        }

        if (isAuthenticated && user) {
          if (appState === 'signup') {
            return;
          }

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
          // If we still have a token in localStorage, auth might still be settling
          // (e.g. Supabase session refresh) — wait before showing login
          const cachedToken = localStorage.getItem('borderpay_token');
          if (cachedToken && appState === 'loading') {
            // Give auth one more cycle to settle
            return;
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
  }, [authLoading, isAuthenticated, user, showSplash, hasSeenOnboarding]);

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
      // Try to get the real name from profile DB first, then user_metadata, then email prefix
      let fullName = loginUser.user_metadata?.full_name;

      if (!fullName || fullName === 'User') {
        // Check cached profile
        try {
          const cached = localStorage.getItem('borderpay_user');
          if (cached) {
            const cachedUser = JSON.parse(cached);
            if (cachedUser.full_name && cachedUser.full_name !== 'User') {
              fullName = cachedUser.full_name;
            }
          }
        } catch {}
      }

      if (!fullName || fullName === 'User') {
        // Fetch from DB profile
        try {
          const profileResult = await backendAPI.user.getProfile();
          if (profileResult.success && profileResult.data?.user?.full_name) {
            fullName = profileResult.data.user.full_name;
          }
        } catch {}
      }

      await sessionAPI.create({
        id: loginUser.id,
        email: loginUser.email,
        full_name: fullName || loginUser.email?.split('@')[0] || 'User',
      });
    } catch {
      // Non-critical — Supabase auth already succeeded
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

  const handleNavigateToSignUp = () => {
    setAppState('signup');
  };

  const handleNavigateToLogin = () => {
    setAppState('login');
  };

  const handleNavigateToForgotPassword = () => {
    setAppState('forgot-password');
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
  const showSplashScreen = showSplash || authLoading || appState === 'loading';
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

  if (appState === 'dashboard' && user?.id) {
    // Show app lock screen if locked
    if (appLocked && PINManager.hasPIN(user.id)) {
      return (
        <AppLockScreen
          userId={user.id}
          onUnlock={() => setAppLocked(false)}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <>
        <MainApp
          userId={user.id}
          onLogout={handleLogout}
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