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
    // Supabase password-recovery deep link: this is NOT a normal login. With
    // detectSessionInUrl (default on), Supabase parses the recovery session from
    // the URL hash, clears the hash, and fires PASSWORD_RECOVERY. We stash the
    // recovery access token for ResetPasswordScreen and flag recovery so the app
    // routes to the reset screen — and we MUST NOT store it as borderpay_token
    // (doing so is what wrongly sent recovery clicks to the dashboard).
    if (event === 'PASSWORD_RECOVERY') {
      try {
        if (session?.access_token) {
          localStorage.setItem('borderpay_recovery_token', session.access_token);
        }
        // Expiry aligned to the Supabase recovery session so the marker and the
        // session share a lifetime (localStorage → survives PWA close/reopen).
        const expMs = session?.expires_at ? session.expires_at * 1000 : Date.now() + 60 * 60 * 1000;
        localStorage.setItem('borderpay_recovery_expires_at', String(expMs));
        localStorage.setItem('borderpay_password_recovery', '1');
        window.dispatchEvent(new CustomEvent('borderpay:password_recovery'));
      } catch { /* ignore */ }
      return;
    }
    if (event === 'SIGNED_OUT') {
      localStorage.removeItem('borderpay_token');
      clearUserProfile();
      clearPasswordRecovery();
      clearBiometricLoginPending();
    } else if (session?.access_token) {
      localStorage.setItem('borderpay_token', session.access_token);
    }
  });

  (globalThis as any)[GLOBAL_KEY] = client;
  return client;
}

export const supabase = getOrCreateClient();

// ── Secure user profile storage ─────────────────────────────────────────────
// Exported so all components use a single read/write path.
// Strips internal Supabase metadata before caching to limit PII exposure.
const USER_STORAGE_KEY = 'borderpay_user';

/**
 * Fields safe to cache locally. Everything else is fetched on demand.
 *
 * Includes `account_type` so the business/individual route doesn't fall
 * back to 'individual' on every refresh, plus the other fields that the
 * Dashboard / KYC / admin guard hooks read synchronously at first paint.
 */
const SAFE_FIELDS = [
  'id', 'email', 'full_name', 'country', 'phone',
  'account_type',                    // ← business vs individual routing
  'kyc_status',
  'kyc_level',
  'avatar_url', 'profile_picture_url', 'currency',
  'bridge_customer_id',              // Bridge identity, used by KYC/KYB flows
  'bridge_kyc_status',               // Bridge KYC status badge on dashboards
  'admin_kyc_decision',              // KYC review screen reads this
  'is_admin',                        // admin panel routing
  'account_status',
  'created_at',
  'date_of_birth', 'address', 'city', 'state', 'postal_code',
];

export function storeUserProfile(profile: any): void {
  if (!profile) return;
  // Strip unnecessary internal fields (aud, role, app_metadata, etc.)
  const cleaned: Record<string, any> = {};
  for (const key of SAFE_FIELDS) {
    if (profile[key] !== undefined) cleaned[key] = profile[key];
  }
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(cleaned));
}

export function readUserProfile(): any | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearUserProfile(): void {
  localStorage.removeItem(USER_STORAGE_KEY);
}

// ── Password-recovery (Supabase reset link) state ───────────────────────────
// A recovery session must drive the reset-password screen, never a normal login.
// Stored in localStorage WITH AN EXPIRY aligned to the Supabase recovery session,
// so the marker and the session share a lifetime: a PWA close/reopen mid-reset
// can't drop the marker while the Supabase session lingers (which would have
// re-routed to the dashboard — the exact lifecycle bug we're fixing).
const RECOVERY_TOKEN_KEY = 'borderpay_recovery_token';
const RECOVERY_FLAG_KEY  = 'borderpay_password_recovery';
const RECOVERY_EXP_KEY   = 'borderpay_recovery_expires_at';

export function isPasswordRecovery(): boolean {
  try {
    if (localStorage.getItem(RECOVERY_FLAG_KEY) !== '1') return false;
    const raw = localStorage.getItem(RECOVERY_EXP_KEY);
    const exp = raw ? Number(raw) : 0;
    // Self-heal: once the recovery window passes, drop the marker so normal
    // login can resume.
    if (!exp || Date.now() >= exp) { clearPasswordRecovery(); return false; }
    return true;
  } catch { return false; }
}
export function getRecoveryToken(): string | null {
  try { return isPasswordRecovery() ? localStorage.getItem(RECOVERY_TOKEN_KEY) : null; } catch { return null; }
}
export function clearPasswordRecovery(): void {
  try {
    localStorage.removeItem(RECOVERY_TOKEN_KEY);
    localStorage.removeItem(RECOVERY_FLAG_KEY);
    localStorage.removeItem(RECOVERY_EXP_KEY);
    // Clean up any legacy sessionStorage markers from earlier builds.
    sessionStorage.removeItem(RECOVERY_TOKEN_KEY);
    sessionStorage.removeItem(RECOVERY_FLAG_KEY);
  } catch { /* ignore */ }
}

// ── Biometric-login pending gate ────────────────────────────────────────────
// Biometric sign-in restores the Supabase session BEFORE running the WebAuthn
// assertion (the WebAuthn endpoints need a valid user JWT). That refresh fires
// onAuthStateChange → useAuth/AppContext would otherwise flip isAuthenticated
// true and App.tsx would route to the dashboard — bypassing the biometric gate.
// To prevent that race we mark "biometric login pending" BEFORE refreshSession;
// useAuth, AppContext and App.tsx all treat a pending state as NOT authenticated
// (same pattern as password recovery). The flag is short-lived and self-heals so
// a crash mid-flow can never strand the app in a non-authenticated state. It is
// cleared on WebAuthn success (right before navigation) and on every
// failure / sign-out path.
const BIOMETRIC_PENDING_FLAG_KEY = 'borderpay_biometric_login_pending';
const BIOMETRIC_PENDING_EXP_KEY  = 'borderpay_biometric_login_pending_expires_at';
const BIOMETRIC_PENDING_TTL_MS   = 2 * 60 * 1000; // 2 min — covers refresh + Touch ID/Face ID prompt

export function isBiometricLoginPending(): boolean {
  try {
    if (localStorage.getItem(BIOMETRIC_PENDING_FLAG_KEY) !== '1') return false;
    const raw = localStorage.getItem(BIOMETRIC_PENDING_EXP_KEY);
    const exp = raw ? Number(raw) : 0;
    // Self-heal: once the short window passes, drop the marker so normal auth
    // routing resumes even if a failure path was missed.
    if (!exp || Date.now() >= exp) { clearBiometricLoginPending(); return false; }
    return true;
  } catch { return false; }
}
export function setBiometricLoginPending(): void {
  try {
    localStorage.setItem(BIOMETRIC_PENDING_FLAG_KEY, '1');
    localStorage.setItem(BIOMETRIC_PENDING_EXP_KEY, String(Date.now() + BIOMETRIC_PENDING_TTL_MS));
  } catch { /* ignore */ }
}
export function clearBiometricLoginPending(): void {
  try {
    localStorage.removeItem(BIOMETRIC_PENDING_FLAG_KEY);
    localStorage.removeItem(BIOMETRIC_PENDING_EXP_KEY);
  } catch { /* ignore */ }
}

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
              storeUserProfile(profileData.data.user);
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
        storeUserProfile(fallback);
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
        storeUserProfile(data.data.user);
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
      clearUserProfile();
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

  getStoredUser: () => readUserProfile(),

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
