/**
 * BorderPay Africa - Centralized Auth Hook
 * Handles Supabase v2 auth with automatic state sync and retries
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, hasSupabase } from '../supabase/client';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
}

/**
 * Centralized auth hook with automatic session sync
 * Follows Supabase v2 best practices from the reference guide
 */
export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    isAuthenticated: false,
  });

  /**
   * Load auth state from Supabase (v2 async methods)
   */
  const loadAuth = useCallback(async () => {
    try {
      console.log('🔐 useAuth: Loading auth state...');

      // Check for mock user first (demo/preview mode)
      const mockToken = localStorage.getItem('borderpay_token');
      if (mockToken === 'mock-token') {
        const storedUser = localStorage.getItem('borderpay_user');
        if (storedUser) {
          const mockUser = JSON.parse(storedUser) as User;
          console.log('✅ useAuth: Mock user loaded');
          setAuthState({
            user: mockUser,
            session: { access_token: 'mock-token' } as any,
            loading: false,
            isAuthenticated: true,
          });
          return;
        }
      }

      // Skip Supabase calls if client is not configured
      if (!supabase?.auth) {
        console.log('ℹ️ useAuth: No Supabase client');
        setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
        return;
      }

      // Get session (v2 async)
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('❌ useAuth: Session error:', sessionError);
        setAuthState({
          user: null,
          session: null,
          loading: false,
          isAuthenticated: false,
        });
        return;
      }

      const session = sessionData?.session ?? null;

      // Only call getUser() if we have a session
      let user = null;

      if (session) {
        const { data: userData, error: userError } = await supabase.auth.getUser();

        if (userError) {
          console.warn('⚠️ useAuth: User error:', userError.message);
        } else {
          user = userData?.user ?? null;
        }
      } else {
        console.log('ℹ️ useAuth: No session found');
      }

      console.log('✅ useAuth: Auth loaded', {
        hasUser: !!user,
        hasSession: !!session,
        userId: user?.id,
      });

      setAuthState({
        user,
        session,
        loading: false,
        isAuthenticated: !!user && !!session,
      });
    } catch (error) {
      console.error('❌ useAuth: Load auth failed:', error);
      setAuthState({
        user: null,
        session: null,
        loading: false,
        isAuthenticated: false,
      });
    }
  }, []);

  /**
   * Sign out helper
   */
  const signOut = useCallback(async () => {
    try {
      console.log('🚪 useAuth: Signing out...');
      localStorage.removeItem('borderpay_token');
      localStorage.removeItem('borderpay_user');
      localStorage.removeItem('borderpay_refresh_token');

      if (supabase?.auth) {
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.warn('⚠️ useAuth: Sign out error:', error);
        }
      }

      setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
      console.log('✅ useAuth: Signed out successfully');
    } catch (error) {
      console.error('❌ useAuth: Sign out failed:', error);
      setAuthState({ user: null, session: null, loading: false, isAuthenticated: false });
    }
  }, []);

  /**
   * Get access token helper
   */
  const getAccessToken = useCallback((): string | null => {
    return authState.session?.access_token ?? null;
  }, [authState.session]);

  /**
   * Initialize auth and subscribe to changes
   */
  useEffect(() => {
    // Load initial auth state
    loadAuth();

    // Subscribe to auth state changes (v2 pattern)
    console.log('🔔 useAuth: Subscribing to auth state changes...');

    let subscription: any = null;
    if (supabase?.auth) {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        console.log('🔔 useAuth: Auth event:', event);
        loadAuth();
      });
      subscription = data?.subscription;
    }

    // Listen for mock token changes (storage events from same window)
    const handleStorage = () => {
      const token = localStorage.getItem('borderpay_token');
      if (token === 'mock-token' || !token) {
        loadAuth();
      }
    };
    window.addEventListener('storage', handleStorage);

    // Also expose reload globally for mock login to trigger
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
    reload: loadAuth, // Manual reload if needed
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