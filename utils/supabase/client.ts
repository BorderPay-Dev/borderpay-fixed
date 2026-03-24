/**
 * BorderPay Africa – Supabase Client
 * Single source of truth for authentication and data access.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from './info';

// ── Environment ──────────────────────────────────────────────────────────────
// Vite exposes VITE_* vars at runtime; fall back to the legacy info.tsx values
// so existing deployments keep working without any config change.

const _supabaseUrl = import.meta.env.VITE_SUPABASE_URL || `https://${projectId}.supabase.co`;
const _anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY || publicAnonKey;
export const SUPABASE_URL    = _supabaseUrl;
export const ANON_KEY        = _anonKey;
export const BASE_URL        = `${SUPABASE_URL}/functions/v1`;

/** True when Supabase credentials are present */
export const hasSupabase = Boolean(SUPABASE_URL && ANON_KEY);

// ── Singleton Supabase client ─────────────────────────────────────────────────
const GLOBAL_KEY = '__borderpay_supabase_singleton__';

function getOrCreateClient(): SupabaseClient {
  if ((globalThis as any)[GLOBAL_KEY]) return (globalThis as any)[GLOBAL_KEY];

  if (!hasSupabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
  });

  client.auth.onAuthStateChange((event, session) => {
    if (session?.access_token) {
      localStorage.setItem('borderpay_token', session.access_token);
    } else if (event === 'SIGNED_OUT') {
      localStorage.removeItem('borderpay_token');
      localStorage.removeItem('borderpay_user');
    }
  });

  (globalThis as any)[GLOBAL_KEY] = client;
  return client;
}

export const supabase = getOrCreateClient();

// ── Auth API ─────────────────────────────────────────────────────────────────
export const authAPI = {
  /** Sign in with Supabase auth */
  signin: async (credentials: { email: string; password: string }) => {
    if (!hasSupabase) {
      throw new Error('Supabase is not configured. Cannot sign in.');
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;

      if (data.session) {
        localStorage.setItem('borderpay_token', data.session.access_token);

        // Try fetching the full profile from the backend
        try {
          const profileRes = await fetch(`${BASE_URL}/get-user-profile`, {
            headers: {
              Authorization: `Bearer ${data.session.access_token}`,
              apikey: ANON_KEY,
            },
          });
          if (profileRes.ok) {
            const profileData = await profileRes.json();
            if (profileData.success && profileData.data?.user) {
              localStorage.setItem('borderpay_user', JSON.stringify(profileData.data.user));
              return { success: true, data: { user: profileData.data.user, access_token: data.session.access_token } };
            }
          }
        } catch { /* fall through to fallback */ }

        // Fallback: build profile from Supabase Auth user
        const fallback = {
          ...data.user,
          full_name: data.user.user_metadata?.full_name || '',
          country:   data.user.user_metadata?.country   || 'UNKNOWN',
          phone:     data.user.phone || data.user.user_metadata?.phone || '',
          kyc_status: data.user.user_metadata?.kyc_status || 'pending',
        };
        localStorage.setItem('borderpay_user', JSON.stringify(fallback));
        return { success: true, data: { user: fallback, access_token: data.session.access_token } };
      }

      return { success: false, error: 'No session created' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  },

  /** Sign up – posts to the backend Edge Function */
  signup: async (userData: any) => {
    if (!hasSupabase) {
      throw new Error('Supabase is not configured. Cannot sign up.');
    }

    try {
      const res = await fetch(`${BASE_URL}/auth-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
        body: JSON.stringify(userData),
      });
      const data = await res.json();
      if (data.success && data.data?.access_token) {
        localStorage.setItem('borderpay_token', data.data.access_token);
        localStorage.setItem('borderpay_user', JSON.stringify(data.data.user));
      }
      return data;
    } catch {
      return { success: false, error: 'Network error' };
    }
  },

  /** Sign out */
  signout: async () => {
    try {
      const token = authAPI.getToken();
      if (hasSupabase && token) {
        await fetch(`${BASE_URL}/auth-signout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
        }).catch(() => {});
        await supabase.auth.signOut();
      }
    } finally {
      localStorage.removeItem('borderpay_token');
      localStorage.removeItem('borderpay_user');
    }
  },

  /** Password reset request */
  resetPasswordRequest: async (email: string) => {
    try {
      const res = await fetch(`${BASE_URL}/auth-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
        body: JSON.stringify({ email }),
      });
      return await res.json();
    } catch { return { success: false, error: 'Network error' }; }
  },

  /** Password reset confirm */
  resetPasswordConfirm: async (access_token: string, new_password: string) => {
    try {
      const res = await fetch(`${BASE_URL}/auth-reset-password-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
        body: JSON.stringify({ access_token, new_password }),
      });
      return await res.json();
    } catch { return { success: false, error: 'Network error' }; }
  },

  /** Verify session validity */
  verifySession: async () => {
    const token = authAPI.getToken();
    if (!token) return { success: false };
    try {
      const res = await fetch(`${BASE_URL}/auth-verify-session`, {
        headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
      });
      return await res.json();
    } catch { return { success: false }; }
  },

  getStoredUser: () => {
    try { return JSON.parse(localStorage.getItem('borderpay_user') || 'null'); }
    catch { return null; }
  },

  getToken: () => localStorage.getItem('borderpay_token'),
};

export const getAccessToken = () => authAPI.getToken();

// ── Data Cache ────────────────────────────────────────────────────────────────
export const dataCache = {
  get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(`borderpay_cache_${key}`);
      if (!item) return null;
      const { data, expiry } = JSON.parse(item);
      if (Date.now() > expiry) { localStorage.removeItem(`borderpay_cache_${key}`); return null; }
      return data;
    } catch { return null; }
  },
  set(key: string, data: any, ttlSeconds = 600) {
    localStorage.setItem(`borderpay_cache_${key}`, JSON.stringify({ data, expiry: Date.now() + ttlSeconds * 1000 }));
  },
  invalidate(key: string) { localStorage.removeItem(`borderpay_cache_${key}`); },
};
