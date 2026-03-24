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
import { useAuth } from './utils/auth/useAuth';
import { ThemeLanguageProvider } from './utils/i18n/ThemeLanguageContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useInactivityTimer } from './utils/auth/useInactivityTimer';
import { PINManager } from './utils/security/SecurityManager';
import { AppLockScreen } from './components/security/AppLockScreen';

type AppState = 'splash' | 'onboarding' | 'login' | 'signup' | 'forgot-password' | 'reset-password' | 'dashboard' | 'loading';

// ── Device IP fingerprinting ──
async function getDeviceFingerprint(): Promise<{ ip: string; ua: string }> {
  let ip = 'unknown';
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    ip = data.ip || 'unknown';
  } catch { /* silent */ }
  return { ip, ua: navigator.userAgent };
}

function checkNewDevice(fingerprint: { ip: string; ua: string }): boolean {
  const stored = localStorage.getItem('borderpay_known_devices');
  const devices: Array<{ ip: string; ua: string }> = stored ? JSON.parse(stored) : [];
  const isKnown = devices.some(d => d.ip === fingerprint.ip && d.ua === fingerprint.ua);
  return !isKnown;
}

function registerDevice(fingerprint: { ip: string; ua: string }) {
  const stored = localStorage.getItem('borderpay_known_devices');
  const devices: Array<{ ip: string; ua: string }> = stored ? JSON.parse(stored) : [];
  // Keep last 10 devices
  devices.push(fingerprint);
  if (devices.length > 10) devices.shift();
  localStorage.setItem('borderpay_known_devices', JSON.stringify(devices));
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
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('token=') || hash.includes('access_token=')) {
      setAppState('reset-password');
    }
  }, []);

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

          getDeviceFingerprint().then(fp => {
            if (checkNewDevice(fp)) {
              setNewDeviceDetected(true);
              registerDevice(fp);
            }
          });

          setAppState('dashboard');
        } else {
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
      await sessionAPI.create({
        id: loginUser.id,
        email: loginUser.email,
        full_name: loginUser.user_metadata?.full_name || loginUser.email?.split('@')[0] || 'User',
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
      const hasPIN = PINManager.hasPIN(user.id);
      if (hasPIN) {
        setAppLocked(true);
      }
      setLockChecked(true);
    }
  }, [appState, user?.id, lockChecked]);

  useEffect(() => {
    if (appState !== 'dashboard' || !user?.id) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && PINManager.hasPIN(user.id)) {
        setAppLocked(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [appState, user?.id]);

  // Show splash screen on first load (covers auth initialization too)
  if (showSplash || authLoading || appState === 'loading') {
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