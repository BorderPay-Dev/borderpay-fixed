/**
 * BorderPay Africa - Centralized Auth Hook
 * Handles Supabase v2 auth with automatic state sync and retries
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, isPasswordRecovery, isBiometricLoginPending } from '../supabase/client';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
}

/**
 * Read Supabase session synchronously from localStorage.
 * Avoids the login flicker caused by awaiting getSession() then getUser() on every mount.
 * Returns null if no session is stored or it has expired.
 */
function readSessionSync(): { session: Session | null; user: User | null } {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed?.access_token && parsed?.user) {
          const exp = parsed.expires_at ? parsed.expires_at * 1000 : 0;
          if (exp && Date.now() >= exp) return { session: null, user: null };
          return { session: parsed as Session, user: parsed.user as User };
        }
      }
    }
  } catch { /* silent */ }
  return { session: null, user: null };
}

/**
 * Centralized auth hook with automatic session sync.
 * Hydrates synchronously from localStorage first (no flicker),
 * then background-refreshes via Supabase.
 */
export function useAuth() {
  // Synchronous hydration from localStorage — kills the "briefly logged-out" flicker
  const initial = (() => {
    try { return readSessionSync(); } catch { return { session: null, user: null }; }
  })();

  const [authState, setAuthState] = useState<AuthState>({
    user: initial.user,
    session: initial.session,
    // If we found a valid local session, skip the "loading" splash entirely.
    // Background refresh will confirm/correct below.
    loading: !initial.user,
    // A Supabase password-recovery session is NOT a login — it must route to the
    // reset-password screen, never the dashboard. Likewise, a session restored
    // mid-biometric-login is NOT yet authenticated until WebAuthn passes.
    isAuthenticated: !!initial.user && !!initial.session && !isPasswordRecovery() && !isBiometricLoginPending(),
  });

  const loadAuth = useCallback(async () => {
    try {
      // Skip Supabase calls if client is not configured
      if (!supabase?.auth) {
        setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
        return;
      }

      const session = sessionData?.session ?? null;
      let user = null;

      if (session) {
        const { data: userData } = await supabase.auth.getUser();
        user = userData?.user ?? null;
      }

      setAuthState({
        user,
        session,
        loading: false,
        // Recovery session ≠ login, and a mid-biometric-login refresh ≠ login yet
        // (see notes above) — keep the app out of the dashboard until WebAuthn passes.
        isAuthenticated: !!user && !!session && !isPasswordRecovery() && !isBiometricLoginPending(),
      });
    } catch {
      setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      localStorage.removeItem('borderpay_token');
      localStorage.removeItem('borderpay_user');
      localStorage.removeItem('borderpay_refresh_token');

      if (supabase?.auth) {
        await supabase.auth.signOut();
      }

      setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
    } catch {
      setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
    }
  }, []);

  const getAccessToken = useCallback((): string | null => {
    return authState.session?.access_token ?? null;
  }, [authState.session]);

  useEffect(() => {
    loadAuth();

    let subscription: any = null;
    if (supabase?.auth) {
      const { data } = supabase.auth.onAuthStateChange(() => {
        loadAuth();
      });
      subscription = data?.subscription;
    }

    const handleStorage = () => {
      const token = localStorage.getItem('borderpay_token');
      if (!token) {
        loadAuth();
      }
    };
    window.addEventListener('storage', handleStorage);

    (window as any).__borderpay_reload_auth = loadAuth;

    return () => {
      subscription?.unsubscribe();
      window.removeEventListener('storage', handleStorage);
      delete (window as any).__borderpay_reload_auth;
    };
  }, [loadAuth]);

  return {
    user: authState.user,
    session: authState.session,
    loading: authState.loading,
    isAuthenticated: authState.isAuthenticated,
    signOut,
    getAccessToken,
    reload: loadAuth,
  };
}

/**
 * Helper to get user metadata fields
 */
export function getUserMetadata(user: User | null) {
  return {
    id: user?.id ?? null,
    email: user?.email ?? null,
    fullName: user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'User',
    phoneNumber: user?.user_metadata?.phone_number ?? null,
    metadata: user?.user_metadata ?? {},
  };
}
