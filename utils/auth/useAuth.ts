/**
 * BorderPay Africa - Centralized Auth Hook
 * Handles Supabase v2 auth with automatic state sync and retries
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase/client';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
}

/**
 * Centralized auth hook with automatic session sync
 * Follows Supabase v2 best practices
 */
export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    isAuthenticated: false,
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
        isAuthenticated: !!user && !!session,
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
