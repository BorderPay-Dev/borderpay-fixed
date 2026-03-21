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

  // Development diagnostics (remove in production if needed)
  useEffect(() => {
    console.log('BorderPay Africa App Started');
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
    console.log('PWA install outcome:', outcome);
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
      console.log('Reset token detected in URL, navigating to reset-password');
      setAppState('reset-password');
    }
  }, []);

  // Check authentication state and route appropriately
  useEffect(() => {
    console.log('App: Auth state changed', {
      authLoading,
      isAuthenticated,
      showSplash,
      appState,
      hasUser: !!user,
      hasSeenOnboarding,
    });

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
        // Don't override if we're actively logging out
        if (isLoggingOut) {
          console.log('App: Logout in progress — skipping route determination');
          return;
        }

        if (isAuthenticated && user) {
          // Don't interrupt the signup flow - user may be authenticated
          // but still completing KYC/PoA steps
          if (appState === 'signup') {
            console.log('App: User authenticated but in signup flow - staying in signup');
            return;
          }
          console.log('App: User authenticated -> Dashboard');

          // ── Device IP detection on dashboard entry ──
          getDeviceFingerprint().then(fp => {
            if (checkNewDevice(fp)) {
              console.log('🔐 App: New device/IP detected:', fp.ip);
              setNewDeviceDetected(true);
              // Register the device after detection
              registerDevice(fp);
            }
          });

          setAppState('dashboard');
        } else {
          if (!hasSeenOnboarding) {
            console.log('App: First time visitor -> Onboarding flow');
            setAppState('onboarding');
          } else {
            console.log('App: Returning visitor -> Login screen');
            setAppState('login');
          }
        }
      } catch (error) {
        console.error('App: Route determination failed:', error);
        setAppState(hasSeenOnboarding ? 'login' : 'onboarding');
      }
    };

    determineRoute();
  }, [authLoading, isAuthenticated, user, showSplash, hasSeenOnboarding]);

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

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
    console.log('App: Login success, going to dashboard...');
    try {
      await sessionAPI.create({
        id: loginUser.id,
        email: loginUser.email,
        full_name: loginUser.user_metadata?.full_name || loginUser.email?.split('@')[0] || 'User',
      });
    } catch (error) {
      console.error('App: Session creation failed (non-critical):', error);
      // Don't redirect — Supabase auth already succeeded,
      // useEffect will route to dashboard via isAuthenticated
    }
  };

  const handleSignUpSuccess = async (signupUser: any) => {
    console.log('App: Signup flow complete, creating session and going to dashboard...');
    try {
      await sessionAPI.create({
        id: signupUser.id,
        email: signupUser.email,
        full_name: signupUser.full_name || signupUser.user_metadata?.full_name || signupUser.email?.split('@')[0] || 'User',
      });
      // User has completed the full signup flow (including KYC + PoA)
      // Explicitly go to dashboard now
      setAppState('dashboard');
    } catch (error) {
      console.error('App: Session creation failed:', error);
      // Still try to go to dashboard
      setAppState('dashboard');
    }
  };

  const handleLogout = async () => {
    try {
      console.log('App: Logging out...');
      setIsLoggingOut(true);
      // Sign out from Supabase auth FIRST to clear session
      await signOut();
      // Then destroy backend session
      await sessionAPI.destroy();
      // Clear new device state
      setNewDeviceDetected(false);
      setAppState('login');
    } catch (error) {
      console.error('App: Logout failed:', error);
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
    console.log('App: Inactivity timeout — silent auto-logout triggered');
    setIsLoggingOut(true);
    try {
      await signOut();
      await sessionAPI.destroy();
    } catch (e) {
      console.error('App: Session destroy during inactivity logout failed:', e);
    }
    setNewDeviceDetected(false);
    setAppState('login');
    setIsLoggingOut(false);
  }, [signOut]);

  // Silent inactivity timer — no warning, just auto-logout after 30 min
  useInactivityTimer({
    onLogout: handleInactivityLogout,
    timeoutMs: 30 * 60 * 1000,   // 30 minutes
    warningMs: 0,                  // no warning — silent logout
    enabled: appState === 'dashboard' && isAuthenticated,
  });

  // ── App Lock: check on dashboard entry ──
  useEffect(() => {
    if (appState === 'dashboard' && user?.id && !lockChecked) {
      const hasPIN = PINManager.hasPIN(user.id);
      if (hasPIN) {
        console.log('🔐 App: User has PIN — locking app');
        setAppLocked(true);
      }
      setLockChecked(true);
    }
  }, [appState, user?.id, lockChecked]);

  // Re-lock on visibility change (tab/app returns from background)
  useEffect(() => {
    if (appState !== 'dashboard' || !user?.id) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && PINManager.hasPIN(user.id)) {
        console.log('🔐 App: Visibility change — re-locking');
        setAppLocked(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [appState, user?.id]);

  // Show splash screen on first load
  if (showSplash) {
    return (
      <SplashScreen onComplete={handleSplashComplete} />
    );
  }
  
  // Show loading while auth is initializing
  if (authLoading || appState === 'loading') {
    return (
      <div className="app-container flex items-center justify-center bg-[#0B0E11]">
        <LoadingSpinner />
      </div>
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
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="28" height="28">
                    <text x="50" y="75" fontFamily="Arial, sans-serif" fontSize="80" fontWeight="bold" textAnchor="middle" fill="#000">b</text>
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
          toastOptions={{
            style: {
              background: 'transparent',
              border: 'none',
              boxShadow: 'none',
              padding: 0,
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